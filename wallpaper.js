// 鎖定畫面桌布頁：給 iOS 捷徑開啟後截圖用。獨立頁面，不載入 shared.js / app.js（它們會綁登入表單）。
// 資料來自後端唯讀動作 getWallpaperData，只認 WALLPAPER_TOKEN（存在 localStorage，不放網址）。
// 載入完成後 <body> 會加 data-ready="1"（失敗是 data-ready="error"），方便等待截圖。
const WALLPAPER_URL = "https://script.google.com/macros/s/AKfycbw-_yrxEFqaCI8WIKAPKgMnHW0qUKhQxIw9on9_dwZeeeSznsKdPypk_XjWESKuLvem/exec"; // 同 shared.js 的 WEBAPP_URL
const WALLPAPER_TOKEN_KEY = "dailyhub_wallpaper_token";

function escapeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatWallpaperTime(e) {
  if (!e.time) return "全天";
  return e.time;
}

// 純函式：把後端資料排成月曆格（週日開頭）。cells 的 null 是前後空白。
function buildMonthCells(todayStr, days, holidays) {
  const [y, m] = todayStr.split("-").map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const count = new Date(y, m, 0).getDate();
  const cells = Array(first).fill(null);
  for (let d = 1; d <= count; d++) {
    const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      d, today: ds === todayStr, dots: days[ds] || 0,
      holiday: !!holidays[ds], sun: new Date(y, m - 1, d).getDay() === 0,
    });
  }
  return cells;
}

function renderWallpaper(data) {
  const [y, m, d] = data.today.split("-").map(Number);
  const cells = buildMonthCells(data.today, data.days || {}, data.holidays || {});
  const dow = ["日", "一", "二", "三", "四", "五", "六"].map(x => `<div class="dow">${x}</div>`).join("");
  const grid = cells.map(c => c
    ? `<div class="cell${c.today ? " today" : ""}${c.holiday ? " holiday" : ""}${c.sun ? " sun" : ""}"><span>${c.d}</span>${c.dots ? "<i></i>" : ""}</div>`
    : "<div></div>").join("");
  const events = (data.events || []).length
    ? data.events.map(e => `<li><span class="t">${escapeText(formatWallpaperTime(e))}</span><span>${escapeText(e.title)}</span></li>`).join("")
    : '<li class="empty">今天沒有行程</li>';
  const habits = (data.pendingHabits || []).length
    ? data.pendingHabits.map(n => `<li class="habit"><span>${escapeText(n)}</span></li>`).join("")
    : `<li class="empty">${data.habitTotal ? "今天的練習都完成了 ✓" : "今天沒有每日練習"}</li>`;
  document.getElementById("main").innerHTML = `
    <div class="month-title"><span>${y} 年 ${m} 月</span><span>${m}/${d}</span></div>
    <div class="grid">${dow}${grid}</div>
    <h2>今日行程</h2><ul>${events}</ul>
    <h2>未完成練習</h2><ul>${habits}</ul>`;
}

async function loadWallpaper() {
  const token = localStorage.getItem(WALLPAPER_TOKEN_KEY);
  if (!token) { document.getElementById("setup").classList.add("show"); return; }
  document.getElementById("setup").classList.remove("show");
  try {
    const res = await fetch(WALLPAPER_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // 不觸發 CORS 預檢，同 shared.js
      body: JSON.stringify({ action: "getWallpaperData", token }),
    });
    const json = await res.json();
    if (!json.ok) {
      if (json.error === "unauthorized") localStorage.removeItem(WALLPAPER_TOKEN_KEY);
      throw new Error(json.error || "unknown error");
    }
    renderWallpaper(json.data);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    document.body.dataset.ready = "1";
  } catch (err) {
    document.getElementById("main").innerHTML = `<p style="color:var(--pop)">${escapeText(err.message)}</p>`;
    document.body.dataset.ready = "error";
    if (!localStorage.getItem(WALLPAPER_TOKEN_KEY)) document.getElementById("setup").classList.add("show");
  }
}

document.getElementById("setup").addEventListener("submit", (e) => {
  e.preventDefault();
  localStorage.setItem(WALLPAPER_TOKEN_KEY, document.getElementById("tokenInput").value.trim());
  loadWallpaper();
});

// ====== Boot ======
loadWallpaper();
