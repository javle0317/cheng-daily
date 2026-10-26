// ====== index.html / health.html 共用：設定、工具、API、登入流程、確認彈窗 ======
// 每個頁面各自的 <script> 要先定義 window.loadPageData（讀資料＋畫面渲染的
// 入口），再呼叫這裡的 initAuth()。

const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw-_yrxEFqaCI8WIKAPKgMnHW0qUKhQxIw9on9_dwZeeeSznsKdPypk_XjWESKuLvem/exec";

const PASSWORD_KEY = "dailyhub_password";

const PET_NAMES = ["林萌", "咪嚕"]; // 之後又養新寵物，這裡跟 Code.gs 的 PET_NAMES 都要加（首頁與寵物頁共用）

// ====== 寵物紀錄的類型（寵物頁、首頁事件彈窗、首頁循環行程「記到寵物紀錄」共用；跟 Code.gs 的 PET_LOG_TYPES 一致）======
const PET_TYPES = [
  { key: "food", label: "飼料", icon: "🍖", predict: true, finishable: true, titleLabel: "品項（例如：主食罐 12 入）", noteLabel: "備註（例如：到期日 2027/03）" },
  { key: "litter", label: "貓砂", icon: "🧺", predict: true, finishable: true, titleLabel: "品項", noteLabel: "備註（選填）" },
  { key: "vet", label: "看醫生", icon: "🏥", titleLabel: "看什麼（例如：耳朵發炎）", noteLabel: "醫囑／重要事項（選填）" },
  { key: "medicine", label: "用藥／疫苗", icon: "💊", titleLabel: "藥品或疫苗名稱", noteLabel: "備註（用法、劑量、下次施打日）" },
  { key: "grooming", label: "美容", icon: "✂️", titleLabel: "項目", noteLabel: "備註（選填）" },
  { key: "daycare", label: "安親", icon: "🏡", titleLabel: "項目（例如：全日安親）", noteLabel: "備註（選填）" },
  { key: "other", label: "其他", icon: "📝", titleLabel: "項目", noteLabel: "備註（選填）" },
];
const PET_ICON = { "林萌": "🐕", "咪嚕": "🐈" };

function typeMeta(key) {
  return PET_TYPES.find(t => t.key === key) || PET_TYPES[PET_TYPES.length - 1];
}

// 舊事件標題猜類型（搬移時當預設值，使用者可以改）
function guessPetType(title) {
  const t = String(title || "");
  if (/美容|洗澡|剪毛|剪甲|SPA/i.test(t)) return "grooming";
  if (/砂/.test(t)) return "litter";
  if (/飼料|罐|主食|肉泥|零食|凍乾|糧|餐包/.test(t)) return "food";
  if (/疫苗|驅蟲|除蚤|心絲蟲|預防針/.test(t)) return "medicine";
  if (/醫|診|檢查|手術|洗牙|看病|急診|住院|健檢|回診|抽血|超音波/.test(t)) return "vet";
  if (/藥/.test(t)) return "medicine";
  return "other";
}

// 前端需要的後端最低版本（Code.gs 的 BACKEND_VERSION）。後端比這個舊 = Dean 還沒把新版 Code.gs 部署成新版本，
// 會跳一次提醒，不用等到畫面出現怪現象才發現。改了後端行為、前端依賴時，兩邊一起加版本。
const BACKEND_MIN_VERSION = "2026-10-23.1";
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

// 表單送出中（data-busy）：就算按鈕被別的程式（重畫畫面順手呼叫的「判斷按鈕該不該亮」之類）改回可按，
// 再按一次或按 Enter 也不會重複送出。用 document 的 capture 階段攔，比各表單自己的 submit 處理函式更早。
function blockBusySubmit(e) {
  const form = e.target;
  if (form && form.dataset && form.dataset.busy === "1") {
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  return false;
}
document.addEventListener("submit", blockBusySubmit, true);

function setFormBusy(form, busy) {
  if (busy) form.dataset.busy = "1"; else delete form.dataset.busy;
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
        // 舊資料可能不是 5 的倍數（08:32、23:59）：臨時補一個分鐘選項，不然讀回會變空字串、編輯儲存後變成全天事件
        minute.querySelectorAll("option[data-extra]").forEach(o => o.remove());
        if (m && ![...minute.options].some(o => o.value === m[2])) {
          const o = document.createElement("option");
          o.value = o.textContent = m[2];
          o.dataset.extra = "1";
          const after = [...minute.options].find(x => x.value && x.value > m[2]);
          minute.insertBefore(o, after || null);
        }
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

// 待登記的寵物事件：owner 是寵物、還沒登記或略過（doneIds 是 PetLog 的 sourceEventId 加上 PetSkipped 的 eventId）、
// 日期已經到了（還沒到的預約不能登記），預設再限定「有花費或標題看得出類型」；all=true 時列出所有寵物事件。
// 寵物頁的「待登記」清單與首頁寵物圖示上的紅點共用。
function migrationCandidates(events, doneIds, opts) {
  const o = opts || {};
  const today = o.today || toDateStr(new Date());
  const done = new Set([...doneIds].map(String));
  return events
    .filter(e => PET_NAMES.includes(e.owner) && !done.has(String(e.id)))
    .filter(e => String(e.date) <= today)
    .filter(e => o.all || Number(e.amount) > 0 || guessPetType(e.title) !== "other")
    .map(e => ({ event: e, type: guessPetType(e.title) }))
    .sort((a, b) => String(a.event.date).localeCompare(String(b.event.date)));
}

// ====== 全站共用的功能導覽（每頁 <body data-page="…">）======
// 首頁的表頭是只有圖示的一排（跟「清單」「登出」放一起）；其他頁面在表頭下面多一列「圖示＋文字」的導覽，
// 目前所在的那一頁反白。新增頁面時只要在這裡加一筆、該頁 body 加 data-page，所有頁面就同步多一個入口。
const APP_NAV = [
  { key: "home", href: "index.html", label: "首頁", title: "首頁", svg: '<path d="M4 11.5 12 4.5l8 7M6 10.5V20h4.5v-5.5h3V20H18v-9.5"/>' },
  { key: "health", href: "health.html", label: "健康", title: "健康記錄", svg: '<path d="M2.8 12.5h4.2l2.2-5.5 4.2 10.5 2.4-6.2 1.2 1.2h4.2"/>' },
  { key: "bills", href: "bills.html", label: "帳單", title: "信用卡帳單與水電瓦斯", svg: '<rect x="3" y="5.5" width="18" height="13" rx="2.2"/><path d="M3 10h18M6.5 15h3.5"/>' },
  { key: "pets", href: "pets.html", label: "寵物", title: "寵物", badge: "petPendingDot", linkId: "petLink", svg: '<circle cx="6.5" cy="10.5" r="1.8"/><circle cx="10" cy="6.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><circle cx="17.5" cy="10.5" r="1.8"/><path d="M12 12.5c-2.8 0-5 2.2-5 4.4 0 1.5 1.2 2.1 2.6 2.1.9 0 1.5-.4 2.4-.4s1.5.4 2.4.4c1.4 0 2.6-.6 2.6-2.1 0-2.2-2.2-4.4-5-4.4z"/>' },
  { key: "reno", href: "renovation.html", label: "裝潢", title: "裝潢報價", svg: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>' },
  { key: "recipes", href: "recipes.html", label: "飲食", title: "食譜與想吃的店", svg: '<path d="M6 3v5a2 2 0 0 0 4 0V3M8 3v18"/><ellipse cx="16.5" cy="7.5" rx="2.6" ry="4.5"/><path d="M16.5 12v9"/>' },
];

function navAnchor(item, withLabel, current) {
  const a = document.createElement("a");
  a.href = item.href;
  a.className = withLabel ? "app-nav-link" : "ghost-btn";
  if (item.linkId) a.id = item.linkId;
  a.title = item.title;
  a.setAttribute("aria-label", item.title);
  if (item.key === current) { a.classList.add("on"); a.setAttribute("aria-current", "page"); }
  a.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.svg}</svg>`
    + (withLabel ? `<span>${item.label}</span>` : "");
  if (item.badge) {
    a.classList.add("has-badge");
    const dot = document.createElement("span");
    dot.id = item.badge;
    dot.className = "notify-dot hidden";
    dot.setAttribute("aria-hidden", "true");
    a.appendChild(dot);
  }
  return a;
}

function initAppNav() {
  const page = document.body && document.body.dataset ? document.body.dataset.page : "";
  if (typeof page !== "string" || !page) return;
  if (page === "home") {
    // 首頁：表頭裡只有圖示（不含首頁自己）
    const host = document.getElementById("navIcons");
    if (host) APP_NAV.filter(i => i.key !== "home").forEach(i => host.appendChild(navAnchor(i, false, page)));
    return;
  }
  const header = document.querySelector("#app > .app-header");
  if (!header) return;
  const nav = document.createElement("nav");
  nav.className = "app-nav";
  nav.setAttribute("aria-label", "功能");
  APP_NAV.forEach(i => nav.appendChild(navAnchor(i, true, page)));
  header.insertAdjacentElement("afterend", nav);
}
initAppNav();

// ====== 全站關掉瀏覽器的「表單歷史記憶」（輸入框下拉出現以前填過的值）======
// 每個輸入框與表單都補 autocomplete="off"（已經自己寫了的不動；密碼欄不動，留給密碼管理員）。
// 之後動態產生的輸入框（驗血的項目列等）由 MutationObserver 補上。
// 注意：<datalist> 是我們刻意提供的建議（食譜標籤、驗血項目名稱），不受這個影響，仍然會出現。
function disableInputHistory(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("input, textarea, form").forEach(el => {
    if (el.type === "password" || el.hasAttribute("autocomplete")) return;
    el.setAttribute("autocomplete", "off");
  });
}
disableInputHistory(document);
if (typeof MutationObserver === "function" && document.body) {
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType !== 1) return;
    if (n.matches && n.matches("input, textarea, form") && n.type !== "password" && !n.hasAttribute("autocomplete")) n.setAttribute("autocomplete", "off");
    disableInputHistory(n);
  }))).observe(document.body, { childList: true, subtree: true });
}
