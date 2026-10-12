// ====== 帳單頁：水電瓦斯分項追蹤 ======
// 只看趨勢，不加進信用卡帳單的合計。圖上是「每月均攤＝金額 ÷ 計費月數」，兩個月一期和一個月一期才比得起來。
// 共用工具在 shared.js、health-charts.js（drawTimeChart）；載入由 bills.js 的 loadPageData 呼叫 loadUtilityBills()。

const UTIL_TYPES = [
  { key: "water", label: "水費", icon: "💧", months: 2 },
  { key: "electric", label: "電費", icon: "⚡", months: 2 },
  { key: "gas", label: "瓦斯", icon: "🔥", months: 2 }, // 台北瓦斯也是兩個月一期
];

const UTIL_LIST_LIMIT = 12;
const UTIL_MODES = [
  { key: "amount", label: "月均金額", unit: "元/月", decimals: 0 },
  { key: "usage", label: "月均用量", unit: "度/月", decimals: 1 },
  { key: "price", label: "每度單價", unit: "元/度", decimals: 2 },
];
const UTIL_CHART_LIMIT = 6; // 圖表預設只畫最近 6 期（雙月一期＝一年），要看更早的再展開
const util = { bills: [], type: "electric", mode: "amount", editingId: null, showAll: false, chartAll: false };
try {
  const saved = localStorage.getItem("utilType");
  if (UTIL_TYPES.some(t => t.key === saved)) util.type = saved;
} catch (e) { /* 讀不到就用預設 */ }

function applyUtilityBills(rows) {
  util.bills = rows || [];
}

async function loadUtilityBills() {
  applyUtilityBills(await api("getUtilityBills"));
  renderUtilities();
}

// ====== 純邏輯（regression-check 會測）======
function utilTypeMeta(key) {
  return UTIL_TYPES.find(t => t.key === key) || UTIL_TYPES[0];
}

function utilMonths(b) {
  const n = Number(b.months);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// 帳單金額；留空（只有用量的歷史紀錄）＝ null
function utilAmount(b) {
  if (b.amount === "" || b.amount === undefined || b.amount === null) return null;
  const n = Number(b.amount);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// 每月均攤（四捨五入到整數元）；沒有金額回傳 null
function utilMonthlyAvg(b) {
  const a = utilAmount(b);
  return a === null ? null : Math.round(a / utilMonths(b));
}

function utilMonthLabel(m) {
  const [y, mo] = String(m).split("-");
  return `${y}年${mo}月`;
}

function utilMoney(n) {
  return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
}

function utilUsage(b) {
  const n = Number(b.usage);
  return b.usage !== "" && b.usage !== undefined && b.usage !== null && Number.isFinite(n) && n > 0 ? n : null;
}

function utilRound(n, dec) {
  const f = Math.pow(10, dec);
  return Math.round(n * f) / f;
}

// 某類型的趨勢點（依帳單月份排序）：date 用該月 1 號當 x 軸，label 是提示文字。
// mode：amount＝每月均攤金額、usage＝每月均攤用量（度）、price＝每度單價（只算有填用量的帳單）
function utilPoints(bills, type, mode) {
  mode = mode || "amount";
  return bills
    .filter(b => b.type === type && /^\d{4}-\d{2}$/.test(String(b.billingMonth)))
    .filter(b => mode === "amount" ? utilAmount(b) !== null : mode === "usage" ? utilUsage(b) !== null : utilAmount(b) !== null && utilUsage(b) !== null)
    .sort((a, b) => String(a.billingMonth).localeCompare(String(b.billingMonth)))
    .map(b => {
      const months = utilMonths(b);
      const u = utilUsage(b);
      const a = utilAmount(b);
      const value = mode === "usage" ? utilRound(u / months, 1) : mode === "price" ? utilRound(a / u, 2) : utilMonthlyAvg(b);
      return {
        date: `${b.billingMonth}-01`,
        value,
        label: `${utilMonthLabel(b.billingMonth)}（${[a !== null ? `帳單 ${utilMoney(a)}` : "只有用量", u !== null ? `用量 ${u} 度` : null, `${months} 個月`].filter(Boolean).join("，")}）`,
      };
    });
}

// 摘要：最近一期、與前一期比、最近 6 期平均、去年同期（同月份）
function utilSummary(points) {
  if (!points.length) return null;
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const recent = points.slice(-6);
  const avg6 = recent.reduce((s, p) => s + p.value, 0) / recent.length;
  const lastYear = points.find(p => p.date.slice(5, 7) === last.date.slice(5, 7) && Number(p.date.slice(0, 4)) === Number(last.date.slice(0, 4)) - 1) || null;
  return { last, prev, avg6, lastYear, n: recent.length };
}

// 年對年：最近 limit 期裡，找得到「去年同月」的每一期（新到舊）。points 是某個圖表模式的點（date＝yyyy-MM-01）。
// diff＝今年－去年，pct＝變化百分比（去年是 0 時為 null）
function utilYoY(points, limit) {
  const byMonth = new Map(points.map(p => [p.date.slice(0, 7), p]));
  return points.slice(-(limit || UTIL_CHART_LIMIT)).reverse()
    .map(p => {
      const prevKey = `${Number(p.date.slice(0, 4)) - 1}-${p.date.slice(5, 7)}`;
      const prev = byMonth.get(prevKey) || null;
      if (!prev) return null;
      const diff = p.value - prev.value;
      return { date: p.date, value: p.value, prev: prev.value, diff, pct: prev.value > 0 ? (diff / prev.value) * 100 : null };
    })
    .filter(Boolean);
}

// 這個類型有沒有任何一筆填了用量（沒有就不顯示用量／單價的切換）
function utilHasUsage(bills, type) {
  return bills.some(b => b.type === type && utilUsage(b) !== null);
}

const UTIL_FMT = {
  amount: n => utilMoney(n),
  usage: n => `${utilRound(n, 1)} 度`,
  price: n => `$${n.toFixed(2)}`,
};

// 批次匯入：{ items: [{ type, billingMonth, months, amount, usage, note }] }；有任何問題整批不匯入，讓使用者修正
function parseUtilImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  const arr = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
  if (!arr) return null;
  const problems = [];
  const items = [];
  const seen = new Set();
  arr.forEach((it, i) => {
    const tag = `第 ${i + 1} 筆`;
    const type = it && it.type;
    const month = String((it && it.billingMonth) || "").trim();
    const amountRaw = it && it.amount !== undefined && it.amount !== null && it.amount !== "" ? parseStrictNumber(it.amount) : "";
    const monthsRaw = it && it.months !== undefined && it.months !== "" ? parseStrictNumber(it.months) : utilTypeMeta(type).months;
    const usageRaw = it && it.usage !== undefined && it.usage !== null && it.usage !== "" ? parseStrictNumber(it.usage) : "";
    const bad = [];
    if (!UTIL_TYPES.some(t => t.key === type)) bad.push(`類型「${type}」不是 water／electric／gas`);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) bad.push(`月份「${month}」格式要 yyyy-MM`);
    if (amountRaw === null || (amountRaw !== "" && amountRaw < 0)) bad.push(`金額「${it && it.amount}」不是有效數字`);
    if (monthsRaw === null || !Number.isInteger(monthsRaw) || monthsRaw < 1 || monthsRaw > 12) bad.push("計費月數要是 1–12 的整數");
    if (usageRaw === null || (usageRaw !== "" && usageRaw < 0)) bad.push(`用量「${it && it.usage}」不是有效數字`);
    if (amountRaw === "" && usageRaw === "") bad.push("金額和用量至少要有一個");
    const key = `${type}|${month}`;
    if (!bad.length && seen.has(key)) bad.push("跟前面的同類型同月份重複了");
    if (bad.length) { problems.push(`${tag}：${bad.join("；")}`); return; }
    seen.add(key);
    items.push({ type, billingMonth: month, months: monthsRaw, amount: amountRaw, usage: usageRaw, note: String((it && it.note) || "").trim() });
  });
  return { items, problems };
}

// ====== 渲染 ======
function renderUtilities() {
  renderUtilTypes();
  if (util.mode !== "amount" && !utilHasUsage(util.bills, util.type)) util.mode = "amount";
  renderUtilModes();
  const mode = UTIL_MODES.find(m => m.key === util.mode) || UTIL_MODES[0];
  const points = utilPoints(util.bills, util.type, mode.key);
  const shown = util.chartAll ? points : points.slice(-UTIL_CHART_LIMIT);
  drawTimeChart(document.getElementById("utilChart"), shown, {
    unit: mode.unit, decimals: mode.decimals, fmtX: d => `${d.slice(2, 4)}/${d.slice(5, 7)}`,
  });
  const tools = document.getElementById("utilChartTools");
  const toggle = document.getElementById("utilChartToggle");
  tools.classList.toggle("hidden", points.length <= UTIL_CHART_LIMIT);
  toggle.textContent = util.chartAll ? `只看最近 ${UTIL_CHART_LIMIT} 期` : `圖表只畫最近 ${UTIL_CHART_LIMIT} 期，顯示全部 ${points.length} 期`;
  const s = utilSummary(points);
  const el = document.getElementById("utilStats");
  const fmt = UTIL_FMT[mode.key];
  const diff = (d) => (d === 0 ? "持平" : `${d > 0 ? "▲" : "▼"}${fmt(Math.abs(d)).replace(" 度", "")}`);
  if (!s) {
    el.textContent = "";
  } else {
    const parts = [mode.key === "price" ? `最近一期每度 ${fmt(s.last.value)}` : `最近一期月均 ${fmt(s.last.value)}`];
    if (s.prev) parts.push(`比前一期 ${diff(s.last.value - s.prev.value)}`);
    if (s.n > 1) parts.push(`最近 ${s.n} 期平均 ${fmt(s.avg6)}`);
    el.textContent = parts.join("　·　");
  }
  renderUtilYoY(points, mode, fmt);
  renderUtilList();
}

function renderUtilYoY(points, mode, fmt) {
  const box = document.getElementById("utilYoY");
  box.innerHTML = "";
  const rows = utilYoY(points, UTIL_CHART_LIMIT);
  const head = document.createElement("h3");
  head.className = "sub-heading";
  head.textContent = `年對年（${mode.label}，今年對去年同期）`;
  box.appendChild(head);
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "還沒有去年同期的資料可以比（有去年同一期的帳單或用量才會出現）";
    box.appendChild(p);
    return;
  }
  const table = document.createElement("table");
  table.className = "util-yoy";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>期別</th><th>今年</th><th>去年</th><th>變化</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    const cells = [utilMonthLabel(r.date.slice(0, 7)), fmt(r.value), fmt(r.prev)];
    cells.forEach((t, i) => { const td = document.createElement("td"); td.textContent = t; if (i === 0) td.className = "util-yoy-month"; tr.appendChild(td); });
    const td = document.createElement("td");
    if (r.diff === 0) { td.textContent = "持平"; }
    else {
      td.className = r.diff > 0 ? "util-up" : "util-down";
      td.textContent = `${r.diff > 0 ? "▲" : "▼"}${r.pct === null ? "" : Math.abs(r.pct).toFixed(0) + "%"}`;
      td.title = `${r.diff > 0 ? "多" : "少"} ${fmt(Math.abs(r.diff))}`;
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
}

function renderUtilModes() {
  const box = document.getElementById("utilModes");
  box.innerHTML = "";
  const has = utilHasUsage(util.bills, util.type);
  box.classList.toggle("hidden", !has);
  if (!has) return;
  UTIL_MODES.forEach(m => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg-btn" + (m.key === util.mode ? " on" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", m.key === util.mode ? "true" : "false");
    b.textContent = m.label;
    b.addEventListener("click", () => { util.mode = m.key; renderUtilities(); });
    box.appendChild(b);
  });
}

function renderUtilTypes() {
  const box = document.getElementById("utilTypes");
  box.innerHTML = "";
  UTIL_TYPES.forEach(t => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg-btn" + (t.key === util.type ? " on" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", t.key === util.type ? "true" : "false");
    b.textContent = `${t.icon} ${t.label}`;
    b.addEventListener("click", () => {
      util.type = t.key;
      util.showAll = false;
      util.chartAll = false;
      try { localStorage.setItem("utilType", t.key); } catch (e) { /* 存不了就算了 */ }
      renderUtilities();
    });
    box.appendChild(b);
  });
}

function renderUtilList() {
  const box = document.getElementById("utilList");
  box.innerHTML = "";
  const rows = util.bills
    .filter(b => b.type === util.type)
    .sort((a, b) => String(b.billingMonth).localeCompare(String(a.billingMonth)));
  if (!rows.length) {
    box.innerHTML = `<p class="empty-hint">還沒有${utilTypeMeta(util.type).label}帳單，按右上角「＋」新增</p>`;
    return;
  }
  // 只先列最近 12 筆，更早的按鈕展開（資料會一年一年變多）
  const shown = util.showAll ? rows : rows.slice(0, UTIL_LIST_LIMIT);
  const ul = document.createElement("ul");
  ul.className = "item-list";
  shown.forEach(b => ul.appendChild(buildUtilRow(b)));
  box.appendChild(ul);
  if (rows.length > UTIL_LIST_LIMIT) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "ghost-btn util-more";
    more.textContent = util.showAll ? "只看最近 12 筆" : `顯示全部 ${rows.length} 筆`;
    more.addEventListener("click", () => { util.showAll = !util.showAll; renderUtilList(); });
    box.appendChild(more);
  }
}

function buildUtilRow(b) {
  const li = document.createElement("li");
  li.className = "item-row util-row";
  li.dataset.lockKey = `util:${b.id}`;

  const month = document.createElement("span");
  month.className = "owner-badge";
  month.textContent = utilMonthLabel(b.billingMonth);
  const amount = document.createElement("span");
  amount.className = "item-text";
  amount.textContent = utilAmount(b) === null ? "只有用量" : utilMoney(utilAmount(b));
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "ghost-btn util-edit";
  edit.title = "編輯";
  edit.textContent = "✏️";
  edit.addEventListener("click", () => openUtilForm(b));
  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete-btn";
  del.title = "刪除";
  del.textContent = "✕";
  del.addEventListener("click", async () => {
    if (!(await showConfirm(`確定要刪除 ${utilMonthLabel(b.billingMonth)} 的${utilTypeMeta(b.type).label}帳單嗎？`))) return;
    await withRowLock(del, async () => {
      try {
        applyUtilityBills(await api("deleteUtilityBill", { id: b.id }));
        releasePending(del);
        renderUtilities();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    });
  });
  li.append(month, amount, spacer, edit, del);
  // 第二行小字：計費月數與每月均攤，有備註接在後面
  const sub = document.createElement("div");
  sub.className = "item-time util-sub";
  const u = utilUsage(b);
  const a = utilAmount(b);
  sub.textContent = `${utilMonths(b)} 個月`
    + (a !== null ? `・月均 ${utilMoney(utilMonthlyAvg(b))}` : "")
    + (u !== null ? `・用量 ${u} 度` : "")
    + (a !== null && u !== null ? `（每度 $${(a / u).toFixed(2)}）` : "")
    + (b.note ? `　📝 ${b.note}` : "");
  li.appendChild(sub);
  lockIfPending(li);
  return li;
}

// ====== 新增／編輯彈窗 ======
function initUtilForm() {
  const sel = document.getElementById("utilType");
  UTIL_TYPES.forEach(t => {
    const o = document.createElement("option");
    o.value = t.key;
    o.textContent = `${t.icon} ${t.label}`;
    sel.appendChild(o);
  });
}
initUtilForm();

function updateUtilFormValidity() {
  document.getElementById("utilSubmit").disabled = !(document.getElementById("utilMonth").value
    && (document.getElementById("utilAmount").value.trim() !== "" || document.getElementById("utilUsage").value.trim() !== ""));
}
["utilMonth", "utilAmount", "utilUsage"].forEach(id => document.getElementById(id).addEventListener("input", updateUtilFormValidity));
// 新增時換類型會帶入該類型常見的計費月數（水電 2 個月、瓦斯 1 個月）；編輯時不動
document.getElementById("utilType").addEventListener("change", (e) => {
  if (!util.editingId) document.getElementById("utilMonths").value = String(utilTypeMeta(e.target.value).months);
});

function openUtilForm(b) {
  util.editingId = b ? b.id : null;
  document.getElementById("utilModalTitle").textContent = b ? "編輯帳單" : "新增帳單";
  document.getElementById("utilSubmit").textContent = b ? "儲存" : "新增";
  const type = b ? b.type : util.type;
  document.getElementById("utilType").value = type;
  document.getElementById("utilMonth").value = b ? String(b.billingMonth) : "";
  document.getElementById("utilAmount").value = b && utilAmount(b) !== null ? String(utilAmount(b)) : "";
  document.getElementById("utilMonths").value = String(b ? utilMonths(b) : utilTypeMeta(type).months);
  document.getElementById("utilUsage").value = b && utilUsage(b) !== null ? String(utilUsage(b)) : "";
  document.getElementById("utilNote").value = b ? b.note || "" : "";
  document.getElementById("utilHint").textContent = b ? "" : "同類型同月份已經有帳單的話，會更新那一筆。";
  document.getElementById("utilImportBox").classList.toggle("hidden", !!b);
  document.getElementById("utilImportText").value = "";
  document.getElementById("utilImportMsg").textContent = "";
  updateUtilFormValidity();
  document.getElementById("utilModal").classList.remove("hidden");
}
function closeUtilForm() { document.getElementById("utilModal").classList.add("hidden"); }
document.getElementById("openUtilForm").addEventListener("click", () => openUtilForm(null));
document.getElementById("utilClose").addEventListener("click", closeUtilForm);
document.getElementById("utilModal").addEventListener("click", (e) => { if (e.target.id === "utilModal") closeUtilForm(); });

document.getElementById("utilForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const hint = document.getElementById("utilHint");
  const amountRaw = document.getElementById("utilAmount").value.trim();
  const amount = amountRaw === "" ? "" : parseStrictNumber(amountRaw);
  if (amount === null || (amount !== "" && amount < 0)) { hint.textContent = `金額「${amountRaw}」不是有效數字`; return; }
  const usageRaw = document.getElementById("utilUsage").value.trim();
  const usage = usageRaw === "" ? "" : parseStrictNumber(usageRaw);
  if (usage === null || (usage !== "" && usage < 0)) { hint.textContent = `用量「${usageRaw}」不是有效數字`; return; }
  if (amount === "" && usage === "") { hint.textContent = "金額和用量至少要填一個"; return; }
  const params = {
    type: document.getElementById("utilType").value,
    billingMonth: document.getElementById("utilMonth").value,
    amount,
    months: document.getElementById("utilMonths").value,
    usage,
    note: document.getElementById("utilNote").value,
  };
  const editing = util.editingId;
  if (editing) params.id = editing;
  setFormBusy(e.target, true);
  try {
    applyUtilityBills(await api(editing ? "updateUtilityBill" : "addUtilityBill", params));
    util.type = params.type; // 切到剛記的類型才看得到
    renderUtilities();
    closeUtilForm();
    showToast(editing ? "已儲存" : "已記下帳單");
  } catch (err) {
    hint.textContent = (editing ? "儲存失敗：" : "新增失敗：") + err.message;
  } finally {
    setFormBusy(e.target, false);
    updateUtilFormValidity();
  }
});

// 批次貼上匯入：檢查通過後先確認筆數，再一次送出（全部成功或全部不寫）
document.getElementById("utilImportBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget; // 要在第一個 await 之前取：await 之後 currentTarget 會是 null
  const msg = document.getElementById("utilImportMsg");
  const parsed = parseUtilImport(document.getElementById("utilImportText").value);
  if (!parsed) { msg.textContent = "格式不對，請整段貼上對話裡給你的資料（要有 items 陣列）"; return; }
  if (parsed.problems.length) { msg.textContent = "⚠️ 有問題，整批沒有匯入：" + parsed.problems.slice(0, 5).join("；") + (parsed.problems.length > 5 ? `…（共 ${parsed.problems.length} 處）` : ""); return; }
  if (!parsed.items.length) { msg.textContent = "沒有可以匯入的帳單"; return; }
  const by = (k) => parsed.items.filter(i => i.type === k).length;
  const months = parsed.items.map(i => i.billingMonth).sort();
  const withUsage = parsed.items.filter(i => i.usage !== "").length;
  const usageOnly = parsed.items.filter(i => i.amount === "").length;
  const overwrite = parsed.items.filter(i => util.bills.some(b => b.type === i.type && String(b.billingMonth) === i.billingMonth)).length;
  const summary = `${parsed.items.length} 筆（水 ${by("water")}、電 ${by("electric")}、瓦斯 ${by("gas")}；${utilMonthLabel(months[0])} ～ ${utilMonthLabel(months[months.length - 1])}；有用量 ${withUsage} 筆${usageOnly ? `，其中 ${usageOnly} 筆只有用量` : ""}）`;
  if (!(await showConfirm(`確定匯入 ${summary}？` + (overwrite ? `\n其中 ${overwrite} 筆跟已有的同類型同月份重複，會更新那一筆。` : "")))) return;
  btn.disabled = true;
  try {
    applyUtilityBills(await api("addUtilityBills", { items: JSON.stringify(parsed.items) })); // api() 會把參數轉成字串，陣列要先轉成 JSON
    renderUtilities();
    closeUtilForm();
    showToast(`已匯入 ${parsed.items.length} 筆帳單`);
  } catch (err) {
    msg.textContent = "匯入失敗：" + err.message;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("utilChartToggle").addEventListener("click", () => {
  util.chartAll = !util.chartAll;
  renderUtilities();
});
