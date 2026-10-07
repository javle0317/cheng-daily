// ====== index.html / health.html 共用：設定、工具、API、登入流程、確認彈窗 ======
// 每個頁面各自的 <script> 要先定義 window.loadPageData（讀資料＋畫面渲染的
// 入口），再呼叫這裡的 initAuth()。

const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw-_yrxEFqaCI8WIKAPKgMnHW0qUKhQxIw9on9_dwZeeeSznsKdPypk_XjWESKuLvem/exec";

const PASSWORD_KEY = "dailyhub_password";

// 前端需要的後端最低版本（Code.gs 的 BACKEND_VERSION）。後端比這個舊 = Dean 還沒把新版 Code.gs 部署成新版本，
// 會跳一次提醒，不用等到畫面出現怪現象才發現。改了後端行為、前端依賴時，兩邊一起加版本。
const BACKEND_MIN_VERSION = "2026-10-08.1";
let backendWarned = false;

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
  // 狀態列在頁面最底下，錯誤寫在那裡使用者根本看不到（只覺得按了新增沒反應），
  // 所以錯誤一律同時用頂部的紅色提示顯示，停留久一點
  if (isError && msg) showToast(msg, { error: true });
}

let toastTimer = null;
function showToast(msg, opts = {}) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("toast-error", !!opts.error);
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, opts.error ? 5000 : 1800);
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
// 所有控制項鎖住，回來前不能再點，避免連點送出重複請求。
//
// 鎖要「跟著資料走」，不能只綁在畫面上的那一列：寫入是排隊送的，前一筆回來會把整份清單重畫，
// 這時還在排隊的那一筆對應的新 <li> 是全新的、沒有鎖，可以再點一次造成重複計次。
// 所以有 data-lock-key 的列（render 時設成「類型:id」，習慣是「習慣id|週期」）會把處理中狀態存在 pendingKeys，
// 重畫後用 lockIfPending(li) 重新鎖上；操作結束（或 releasePending 提前釋放）時一併解開。
const pendingKeys = new Set();
const pendingRows = new Map(); // key → 重畫後被重新鎖上的 <li>

function lockControls(row) {
  row.classList.add("pending");
  const controls = [...row.querySelectorAll("input, button, select, textarea")];
  controls.forEach(c => { c.dataset.wasDisabled = c.disabled ? "1" : ""; c.disabled = true; });
  return controls;
}

function unlockControls(row, controls) {
  row.classList.remove("pending");
  controls.forEach(c => { c.disabled = c.dataset.wasDisabled === "1"; delete c.dataset.wasDisabled; });
}

// render 完一列之後呼叫：這一列對應的操作還在處理中就重新鎖上
function lockIfPending(li) {
  const key = li.dataset.lockKey;
  if (!key || !pendingKeys.has(key)) return;
  const controls = lockControls(li);
  if (!pendingRows.has(key)) pendingRows.set(key, []);
  pendingRows.get(key).push({ li, controls });
}

// 回應已經拿到、準備重畫之前先呼叫：讓重畫出來的這一列不要被鎖著（自己的操作已完成）
function releasePending(li) {
  const row = li && li.closest ? (li.closest("li") || li) : li;
  const key = row && row.dataset ? row.dataset.lockKey : null;
  if (key) pendingKeys.delete(key);
}

async function withRowLock(el, fn, alsoLock = []) {
  const row = el.closest("li") || el;
  if (row.classList.contains("pending")) return;
  const key = row.dataset.lockKey || null;
  if (key) {
    if (pendingKeys.has(key)) return;
    pendingKeys.add(key);
  }
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
    if (key) {
      pendingKeys.delete(key);
      // 操作失敗沒有重畫時，之前被重新鎖上的新 <li> 也要解開
      (pendingRows.get(key) || []).forEach(({ li, controls: cs }) => unlockControls(li, cs));
      pendingRows.delete(key);
    }
  }
}

// 嚴格解析使用者／匯入的數字：允許千分位（"1,000" → 1000）與前後空白；
// 空白、"12abc"、"1,0"、NaN 之類一律回傳 null（不要像 parseFloat 那樣偷偷截斷成 12 或 1）
function parseStrictNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let t = v.trim();
  if (!t) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// 組 HTML 字串（SVG 圖表等）時，使用者輸入的文字（銀行名稱、驗血單位…）一律先過這個
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ====== API ======
async function apiRequest(action, params) {
  const password = localStorage.getItem(PASSWORD_KEY);
  // 全部用 POST，密碼與資料放 body 不放網址。Content-Type 用 text/plain 是為了不觸發 CORS 預檢，
  // Apps Script 不處理 OPTIONS；後端自己 JSON.parse(postData.contents)。值一律轉成字串，維持跟以前網址參數相同的型別。
  const body = { action, password: password || "" };
  Object.entries(params).forEach(([k, v]) => { body[k] = String(v); });

  const t0 = performance.now();
  const res = await fetch(WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  // 量測：每次 API 的耗時，開瀏覽器 console 看 apiTimings（要判斷哪裡慢、要不要加快取時用）
  (window.apiTimings ||= []).push({ action, ms: Math.round(performance.now() - t0) });
  window.backendVersion = json.v || "";
  if (typeof renderVersionLine === "function" && document.getElementById("versionLine")) renderVersionLine();
  if (json.ok && !backendWarned && (!json.v || json.v < BACKEND_MIN_VERSION)) {
    backendWarned = true;
    showToast(`⚠️ 後端程式（Apps Script）不是最新版：目前 ${json.v || "舊版"}，需要 ${BACKEND_MIN_VERSION}。請貼上最新的 Code.gs，並用「管理部署作業 → 編輯 → 新版本」重新部署。`, { error: true });
  }
  if (!json.ok) throw new Error(json.error || "unknown error");
  return json.data;
}

// 寫入（不是 get 開頭的 action）一個接一個送：前一個回來才送下一個。
// 這樣回應一定照操作順序到達，快速連點時舊回應不會蓋掉新畫面，也不會有兩個寫入同時在飛；
// 讀取不排隊。後端另外有 LockService 擋住多個裝置同時寫。
let writeChain = Promise.resolve();
function api(action, params = {}) {
  if (action.startsWith("get")) return apiRequest(action, params);
  const run = writeChain.then(() => apiRequest(action, params)).then((data) => {
    // 讓頁面可以在「某類寫入成功」之後做事（例如首頁更新 Google 行事曆同步狀態）
    try { window.dispatchEvent(new CustomEvent("api-write", { detail: { action } })); } catch (e) { /* ignore */ }
    return data;
  });
  writeChain = run.catch(() => {});
  return run;
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
  renderVersionLine();
}

// 頁面最底下一行很小的版本資訊：前端版本（script 網址的 ?v=）與後端版本。
// 畫面怪怪的（例如新功能沒出現）時先看這裡，就知道是手機還在用舊的快取，還是後端沒部署到新版本。
function renderVersionLine() {
  const status = document.getElementById("statusLine");
  if (!status) return;
  let el = document.getElementById("versionLine");
  if (!el) {
    el = document.createElement("p");
    el.id = "versionLine";
    el.className = "version-line";
    status.insertAdjacentElement("afterend", el);
  }
  const me = [...document.scripts].find(sc => /shared\.js/.test(sc.src));
  const m = me && me.src.match(/[?&]v=(\d+)/);
  el.textContent = `版本　前端 ${m ? m[1] : "?"}　後端 ${window.backendVersion || "…"}`;
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
  // 直接重新載入：記憶體裡的資料、畫面上的內容、開著的彈窗一次全部清掉
  location.reload();
});

// ====== 24 小時制的時間選擇 ======
// <input type="time"> 的顯示格式跟著瀏覽器／系統（常常是上午／下午 12 小時制），網頁沒辦法強制。
// 所以把頁面上的 type="time" 換成「時」「分」兩個下拉（00–23、每 5 分鐘），一律 24 小時制；
// 換掉之後那個元素（同 id）仍然有 .value（"HH:mm" 或 ""），其他程式碼照舊用 .value 讀寫。
function initTimeSelects() {
  document.querySelectorAll('input[type="time"]').forEach(input => {
    const wrap = document.createElement("span");
    wrap.className = "time24";
    wrap.id = input.id;
    const mk = (label, values) => {
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", label + (input.title ? "（" + input.title + "）" : ""));
      const first = document.createElement("option");
      first.value = ""; first.textContent = label;
      sel.appendChild(first);
      values.forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
      return sel;
    };
    const pad = n => String(n).padStart(2, "0");
    const hour = mk("時", Array.from({ length: 24 }, (_, i) => pad(i)));
    const minute = mk("分", Array.from({ length: 12 }, (_, i) => pad(i * 5)));
    hour.addEventListener("change", () => { if (!hour.value) minute.value = ""; else if (!minute.value) minute.value = "00"; wrap.dispatchEvent(new Event("input", { bubbles: true })); });
    minute.addEventListener("change", () => { if (minute.value && !hour.value) hour.value = "00"; wrap.dispatchEvent(new Event("input", { bubbles: true })); });
    Object.defineProperty(wrap, "value", {
      get: () => (hour.value && minute.value ? hour.value + ":" + minute.value : ""),
      set: (v) => {
        const m = /^(\d{2}):(\d{2})$/.exec(String(v || ""));
        hour.value = m ? m[1] : "";
        minute.value = m ? m[2] : "";
      },
    });
    wrap.append(hour, document.createTextNode(":"), minute);
    input.replaceWith(wrap);
  });
}

// ====== 確認/輸入 modal（取代原生 confirm()/prompt()，手機瀏覽器對話框關閉後
// 有時不會立刻重繪畫面，且外觀跟整個 App 風格不一致） ======
let dialogResolve = null;
let dialogIsPrompt = false;

function showConfirm(message) {
  dialogIsPrompt = false;
  return openDialog(message);
}

// 只有「知道了」的訊息視窗（沒有取消鈕）：用在純通知，不需要使用者做選擇的地方
function showAlert(message) {
  dialogIsPrompt = false;
  return openDialog(message, "", { alertOnly: true });
}

function showPrompt(message, defaultValue = "") {
  dialogIsPrompt = true;
  return openDialog(message, defaultValue);
}

function openDialog(message, defaultValue = "", opts = {}) {
  return new Promise(resolve => {
    dialogResolve = resolve;
    document.getElementById("dialogMessage").textContent = message;
    document.getElementById("dialogCancelBtn").classList.toggle("hidden", !!opts.alertOnly);
    document.getElementById("dialogOkBtn").textContent = opts.alertOnly ? "知道了" : "確定";
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
