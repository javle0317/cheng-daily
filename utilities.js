// ====== 帳單頁：水電瓦斯分項追蹤 ======
// 只看趨勢，不加進信用卡帳單的合計。圖上是「每月均攤＝金額 ÷ 計費月數」，兩個月一期和一個月一期才比得起來。
// 共用工具在 shared.js、health-charts.js（drawTimeChart）；載入由 bills.js 的 loadPageData 呼叫 loadUtilityBills()。

const UTIL_TYPES = [
  { key: "water", label: "水費", icon: "💧", months: 2 },
  { key: "electric", label: "電費", icon: "⚡", months: 2 },
  { key: "gas", label: "瓦斯", icon: "🔥", months: 1 },
];

const UTIL_LIST_LIMIT = 12;
const util = { bills: [], type: "electric", editingId: null, showAll: false };
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

// 每月均攤（四捨五入到整數元）
function utilMonthlyAvg(b) {
  return Math.round((Number(b.amount) || 0) / utilMonths(b));
}

function utilMonthLabel(m) {
  const [y, mo] = String(m).split("-");
  return `${y}年${mo}月`;
}

function utilMoney(n) {
  return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// 某類型的趨勢點（依帳單月份排序）：date 用該月 1 號當 x 軸，label 是提示文字
function utilPoints(bills, type) {
  return bills
    .filter(b => b.type === type && /^\d{4}-\d{2}$/.test(String(b.billingMonth)) && Number(b.amount) >= 0)
    .sort((a, b) => String(a.billingMonth).localeCompare(String(b.billingMonth)))
    .map(b => ({
      date: `${b.billingMonth}-01`,
      value: utilMonthlyAvg(b),
      label: `${utilMonthLabel(b.billingMonth)}（帳單 ${utilMoney(b.amount)}，${utilMonths(b)} 個月）`,
    }));
}

// 摘要：最近一期每月均攤、與前一期比、最近 6 期平均、去年同期（同月份）
function utilSummary(points) {
  if (!points.length) return null;
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const recent = points.slice(-6);
  const avg6 = Math.round(recent.reduce((s, p) => s + p.value, 0) / recent.length);
  const lastYear = points.find(p => p.date.slice(5, 7) === last.date.slice(5, 7) && Number(p.date.slice(0, 4)) === Number(last.date.slice(0, 4)) - 1) || null;
  return { last, prev, avg6, lastYear, n: recent.length };
}

// ====== 渲染 ======
function renderUtilities() {
  renderUtilTypes();
  const points = utilPoints(util.bills, util.type);
  drawTimeChart(document.getElementById("utilChart"), points, {
    unit: "元/月", decimals: 0, fmtX: d => `${d.slice(2, 4)}/${d.slice(5, 7)}`,
  });
  const s = utilSummary(points);
  const el = document.getElementById("utilStats");
  if (!s) {
    el.textContent = "";
  } else {
    const parts = [`最近一期每月 ${utilMoney(s.last.value)}`];
    if (s.prev) {
      const d = s.last.value - s.prev.value;
      parts.push(d === 0 ? "與前一期持平" : `比前一期 ${d > 0 ? "▲" : "▼"}${utilMoney(Math.abs(d)).slice(1)}`);
    }
    if (s.lastYear) {
      const d = s.last.value - s.lastYear.value;
      parts.push(`去年同月 ${utilMoney(s.lastYear.value)}（${d === 0 ? "持平" : (d > 0 ? "▲" : "▼") + utilMoney(Math.abs(d)).slice(1)}）`);
    }
    if (s.n > 1) parts.push(`最近 ${s.n} 期平均每月 ${utilMoney(s.avg6)}`);
    el.textContent = parts.join("　·　");
  }
  renderUtilList();
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
  amount.textContent = utilMoney(b.amount);
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
  sub.textContent = `${utilMonths(b)} 個月・每月 ${utilMoney(utilMonthlyAvg(b))}` + (b.note ? `　📝 ${b.note}` : "");
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
  document.getElementById("utilSubmit").disabled = !(document.getElementById("utilMonth").value && document.getElementById("utilAmount").value.trim() !== "");
}
["utilMonth", "utilAmount"].forEach(id => document.getElementById(id).addEventListener("input", updateUtilFormValidity));
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
  document.getElementById("utilAmount").value = b ? String(b.amount) : "";
  document.getElementById("utilMonths").value = String(b ? utilMonths(b) : utilTypeMeta(type).months);
  document.getElementById("utilNote").value = b ? b.note || "" : "";
  document.getElementById("utilHint").textContent = b ? "" : "同類型同月份已經有帳單的話，會更新那一筆。";
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
  const amount = parseStrictNumber(amountRaw);
  if (amount === null || amount < 0) { hint.textContent = `金額「${amountRaw}」不是有效數字`; return; }
  const params = {
    type: document.getElementById("utilType").value,
    billingMonth: document.getElementById("utilMonth").value,
    amount,
    months: document.getElementById("utilMonths").value,
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
