// ====== 練字字帖頁（描紅：只印淺灰色的字，不畫格線）======
// 版面計算在 practice-layout.js（純函式）；這裡負責資料、字型、畫面與列印。
// 內容放在 Sheet 的 Copybook 分頁（getCopybook / importCopybookEntries），要新增或修改內容直接改 Sheet。
// 網址 ?lang=zh|en&ids=id1,id2 可以重現同一頁（重新整理、重印內容不變）；按「重新抽」換一批。

// 字型：中文霞鶩文楷 TC（Google Fonts，只載入本頁用到的字）、英文 Andika（印刷體）。字型名稱不能含雙引號（會塞進 SVG 屬性）。
const ZH_FONT = "'LXGW WenKai TC','Kaiti TC','BiauKai','STKaiti',serif";
const EN_FONT = "Andika,'Helvetica Neue',Arial,sans-serif";

const PREFS_KEY = "practicePrefs";
const RECENT_KEY = "practiceRecent";

const state = { entries: [], lang: "zh", ids: [], used: [], next: null };

function loadPrefs() {
  try { return { gray: "medium", ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch (e) { return { gray: "medium" }; }
}
const prefs = loadPrefs();
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* 存不了就只對這次有效 */ }
}

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "{}")[state.lang] || []; } catch (e) { return []; }
}
function addRecent(ids) {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}");
    all[state.lang] = [...ids, ...(all[state.lang] || [])].filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
    localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}

const entriesOf = (lang) => state.entries.filter(e => e.lang === lang);
const byId = (id) => state.entries.find(e => e.id === id);

window.loadPageData = async function () {
  const data = await api("getCopybook");
  state.entries = data.entries || [];
  const q = new URLSearchParams(location.search);
  state.lang = q.get("lang") === "en" ? "en" : "zh";
  state.ids = (q.get("ids") || "").split(",").filter(id => byId(id));
  syncControls();
  const fresh = !state.ids.length;
  if (fresh) pickRandom();
  await rebuild();
  if (fresh) addRecent(state.used.map(u => u.id));
};

// ====== 取材：隨機，最近用過的排後面；整篇放得進一頁的排前面（一週的字帖不要從一首長詩的中間開始）======
function fitsOnPage(entry) {
  if (state.lang === "zh") return zhEntryColumns(zhClauses(entry.text), ZH_PAGE.ROWS) <= zhGeometry().sheetCols;
  const geo = enGeometry();
  return enWrap(enWords(entry.text), 0, geo.width, makeMeasure(geo.fontSize), 1e9).lines.length <= geo.lines;
}

function pickRandom() {
  const order = pickOrder(entriesOf(state.lang), getRecent());
  const fits = order.filter(fitsOnPage);
  state.ids = fits.concat(order.filter(e => !fits.includes(e))).map(e => e.id);
}

// ====== 字型 ======
function injectLink(id, href) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement("link"); el.id = id; el.rel = "stylesheet"; document.head.appendChild(el); }
  if (el.getAttribute("href") !== href) el.setAttribute("href", href);
}

async function ensureFont(lang, text) {
  try {
    if (lang === "zh") {
      const chars = [...new Set(Array.from(text))].join("");
      injectLink("fontZh", `https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC&display=block&text=${encodeURIComponent(chars)}`);
      await Promise.race([document.fonts.load("16px 'LXGW WenKai TC'", chars), new Promise(r => setTimeout(r, 8000))]);
    } else {
      injectLink("fontEn", "https://fonts.googleapis.com/css2?family=Andika:wght@400&display=block");
      await Promise.race([document.fonts.load("16px Andika"), new Promise(r => setTimeout(r, 8000))]);
    }
  } catch (e) { /* 載不到就用備援字型 */ }
}

// 用一個看不見的 SVG <text> 量寬度：跟最後畫出來的文字走同一套排版（單位 = mm），換行才不會超出右邊界
let measureText = null;
function makeMeasure(fontSizeMm) {
  if (!measureText) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    svg.setAttribute("class", "measure-svg");
    svg.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;";
    measureText = document.createElementNS(ns, "text");
    svg.appendChild(measureText);
    document.body.appendChild(svg);
  }
  measureText.setAttribute("font-family", EN_FONT);
  measureText.setAttribute("font-size", String(fontSizeMm));
  return (t) => { measureText.textContent = t; return measureText.getComputedTextLength(); };
}

// ====== 排版與畫面 ======
let buildToken = 0;
async function rebuild() {
  const token = ++buildToken;
  const host = document.getElementById("sheetHost");
  const empty = document.getElementById("practiceEmpty");
  const list = entriesOf(state.lang);
  empty.classList.toggle("hidden", list.length > 0);
  if (!list.length) { host.innerHTML = ""; setInfo("這個語言還沒有內容。"); return; }

  const order = state.ids.map(byId).filter(e => e && e.lang === state.lang);
  const gray = PRACTICE_GRAYS[prefs.gray] || PRACTICE_GRAYS.medium;
  let svg, used, next, summary;

  if (state.lang === "zh") {
    const packed = packZhColumns({ entries: order, rows: ZH_PAGE.ROWS, maxCols: zhGeometry().sheetCols });
    used = packed.used; next = packed.next;
    const titles = {};
    used.forEach(u => { titles[u.id] = zhLabel(u.title); });
    await ensureFont("zh", Object.values(titles).join("") + packed.columns.map(c => c.chars.join("")).join(""));
    if (token !== buildToken) return;
    svg = renderZhSvg({ columns: packed.columns, titles, gray, fontFamily: ZH_FONT });
    const chars = packed.columns.reduce((n, c) => n + c.chars.length, 0);
    summary = `本頁 ${used.length} 篇、${packed.columns.length} 欄・${chars} 字。每天寫兩欄（約一首絕句），可以寫 ${Math.ceil(packed.columns.length / 2)} 天。`;
  } else {
    const geo = enGeometry();
    await ensureFont("en", "");
    if (token !== buildToken) return;
    const wrapped = wrapEnLines({ entries: order, maxLines: geo.lines, maxWidth: geo.width, measure: makeMeasure(geo.fontSize) });
    used = wrapped.used; next = wrapped.next;
    svg = renderEnSvg({ lines: wrapped.lines, gray, header: sourcesText(used, 2), fontFamily: EN_FONT });
    summary = `本頁 ${used.length} 篇、${wrapped.lines.length} 行。每天寫 3 行，可以寫 ${Math.ceil(wrapped.lines.length / 3)} 天。`;
  }

  state.used = used;
  state.next = next;
  host.innerHTML = svg;
  document.getElementById("pageStyle").textContent = `@page { size: A4 ${state.lang === "zh" ? "landscape" : "portrait"}; margin: 0; }`;
  document.body.classList.toggle("print-landscape", state.lang === "zh");
  document.body.classList.toggle("print-portrait", state.lang !== "zh");
  setInfo(summary + (next ? "　（這篇太長，一頁排不下，後半段沒有印出來。）" : ""));
  updateUrl();
}

function setInfo(t) { document.getElementById("practiceInfo").textContent = t; }

function updateUrl() {
  const q = new URLSearchParams({ lang: state.lang });
  if (state.used.length) q.set("ids", state.used.map(u => u.id).join(","));
  try { history.replaceState(null, "", "?" + q.toString()); } catch (e) { /* ignore */ }
}

function syncControls() {
  document.querySelectorAll(".practice-lang").forEach(b => b.classList.toggle("active", b.dataset.lang === state.lang));
  document.getElementById("optGray").value = prefs.gray;
}

// ====== 操作 ======
async function shuffle() {
  pickRandom();
  await rebuild();
  addRecent(state.used.map(u => u.id));
}
document.getElementById("practiceShuffle").addEventListener("click", shuffle);

document.querySelectorAll(".practice-lang").forEach(btn => {
  btn.addEventListener("click", async () => {
    state.lang = btn.dataset.lang;
    syncControls();
    await shuffle();
  });
});

document.getElementById("optGray").addEventListener("change", async (e) => {
  prefs.gray = e.target.value;
  savePrefs();
  await rebuild();
});

document.getElementById("practicePrint").addEventListener("click", async () => {
  await rebuild(); // 確保字型載完、畫面是最新的再印
  window.print();
});

document.getElementById("importSeedBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await fetch("data/copybook-seed.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("讀不到內建範例檔");
    const list = await res.json();
    const data = await api("importCopybookEntries", { entries: JSON.stringify(list) });
    state.entries = data.entries || [];
    showToast(`已匯入 ${data.added} 篇（略過 ${data.skipped} 篇重複的）`);
    await shuffle();
  } catch (err) {
    setStatus("匯入失敗：" + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

initAuth();
