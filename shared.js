// ====== index.html / health.html 共用：設定、工具、API、登入流程、確認彈窗 ======
// 每個頁面各自的 <script> 要先定義 window.loadPageData（讀資料＋畫面渲染的
// 入口），再呼叫這裡的 initAuth()。

const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw-_yrxEFqaCI8WIKAPKgMnHW0qUKhQxIw9on9_dwZeeeSznsKdPypk_XjWESKuLvem/exec";

const PASSWORD_KEY = "dailyhub_password";

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function setStatus(msg, isError) {
  const el = document.getElementById("statusLine");
  el.textContent = msg || "";
  el.style.color = isError ? "var(--danger)" : "var(--text-dim)";
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 1800);
}

function setFormBusy(form, busy) {
  // 送出期間整張表單（輸入框、下拉、勾選、按鈕）全部鎖住，等後端回應完才能再操作
  form.querySelectorAll("input, select, textarea, button").forEach(el => {
    if (busy) {
      el.dataset.wasDisabled = el.disabled ? "1" : "";
      el.disabled = true;
    } else {
      el.disabled = el.dataset.wasDisabled === "1";
      delete el.dataset.wasDisabled;
    }
  });
  const btn = form.querySelector('button[type="submit"]');
  if (!btn) return;
  if (busy) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = "處理中…";
  } else if (btn.dataset.originalText) {
    btn.textContent = btn.dataset.originalText;
  }
}

// 列表裡單一項目（勾選、刪除、改金額等）的操作：呼叫後端期間把那一列的
// 所有控制項鎖住，回來前不能再點，避免連點送出重複請求
async function withRowLock(el, fn, alsoLock = []) {
  const row = el.closest("li") || el;
  if (row.classList.contains("pending")) return;
  row.classList.add("pending");
  // alsoLock：同一畫面上會跟這個操作互相影響的其他控制項（例如清單裡的「清除已完成」）
  const controls = [row, ...alsoLock].flatMap(r => [...r.querySelectorAll("input, button, select, textarea")]
    .concat(r.matches("input, button, select, textarea") ? [r] : []));
  controls.forEach(c => { c.dataset.wasDisabled = c.disabled ? "1" : ""; c.disabled = true; });
  try {
    return await fn();
  } finally {
    row.classList.remove("pending");
    controls.forEach(c => { c.disabled = c.dataset.wasDisabled === "1"; delete c.dataset.wasDisabled; });
  }
}



// ====== API ======
async function api(action, params = {}) {
  const password = localStorage.getItem(PASSWORD_KEY);
  const url = new URL(WEBAPP_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("password", password || "");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "unknown error");
  return json.data;
}

// ====== Auth flow ======
function showLockScreen(errorMsg) {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("lockScreen").classList.remove("hidden");
  document.getElementById("lockLoading").classList.add("hidden");
  document.getElementById("lockForm").classList.remove("hidden");
  document.getElementById("lockError").textContent = errorMsg || "";
}

function showLockLoading() {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("lockScreen").classList.remove("hidden");
  document.getElementById("lockForm").classList.add("hidden");
  document.getElementById("lockLoading").classList.remove("hidden");
}

function showApp() {
  document.getElementById("lockScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

async function tryUnlock(password) {
  localStorage.setItem(PASSWORD_KEY, password);
  const form = document.getElementById("lockForm");
  setFormBusy(form, true);
  try {
    await window.loadPageData();
    showApp();
    setStatus("已連上 Google Sheet");
  } catch (err) {
    localStorage.removeItem(PASSWORD_KEY);
    showLockScreen("密碼錯誤，或無法連線，請再試一次");
  } finally {
    setFormBusy(form, false);
  }
}

function initAuth() {
  const savedPassword = localStorage.getItem(PASSWORD_KEY);
  if (savedPassword) {
    showLockLoading();
    tryUnlock(savedPassword);
  } else {
    showLockScreen();
  }
}

document.getElementById("lockForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const pw = document.getElementById("passwordInput").value;
  tryUnlock(pw);
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(PASSWORD_KEY);
  document.getElementById("passwordInput").value = "";
  showLockScreen();
});

// ====== 確認/輸入 modal（取代原生 confirm()/prompt()，手機瀏覽器對話框關閉後
// 有時不會立刻重繪畫面，且外觀跟整個 App 風格不一致） ======
let dialogResolve = null;
let dialogIsPrompt = false;

function showConfirm(message) {
  dialogIsPrompt = false;
  return openDialog(message);
}

function showPrompt(message, defaultValue = "") {
  dialogIsPrompt = true;
  return openDialog(message, defaultValue);
}

function openDialog(message, defaultValue = "") {
  return new Promise(resolve => {
    dialogResolve = resolve;
    document.getElementById("dialogMessage").textContent = message;
    const input = document.getElementById("dialogInput");
    input.classList.toggle("hidden", !dialogIsPrompt);
    input.value = defaultValue;
    document.getElementById("dialogModal").classList.remove("hidden");
    if (dialogIsPrompt) setTimeout(() => input.focus(), 0);
  });
}

function resolveDialog(ok) {
  document.getElementById("dialogModal").classList.add("hidden");
  if (!dialogResolve) return;
  const input = document.getElementById("dialogInput");
  const result = !ok ? (dialogIsPrompt ? null : false) : (dialogIsPrompt ? input.value : true);
  dialogResolve(result);
  dialogResolve = null;
}

document.getElementById("dialogOkBtn").addEventListener("click", () => resolveDialog(true));
document.getElementById("dialogCancelBtn").addEventListener("click", () => resolveDialog(false));
document.getElementById("dialogModal").addEventListener("click", (e) => {
  if (e.target.id === "dialogModal") resolveDialog(false);
});
