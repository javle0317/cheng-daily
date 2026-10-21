// ====== 裝潢報價頁 ======
// WEBAPP_URL / api() / 登入流程 / showConfirm 等共用邏輯在 shared.js。
// 價格欄位是「單價」，小計＝數量 × 單價；優惠價沒填就當沒優惠（＝原價），原價沒填就當只有成交價。
// 統計一律不含「不買」(dropped)。

const RENO_STATUSES = [
  { key: "quoted", label: "報價中" },
  { key: "signed", label: "已簽約" },
  { key: "paid", label: "已付款" },
  { key: "dropped", label: "不買" },
];
const reno = { items: [], log: [], filter: "all", vendor: "all" };

function applyReno(data) {
  reno.items = (data && data.items) || [];
  reno.log = (data && data.log) || [];
}

window.loadPageData = async function () {
  applyReno(await api("getReno"));
  renderReno();
};

// ====== 純邏輯（regression-check 會測）======
function renoMoney(n) {
  return "NT$ " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

function renoNum(v) {
  return v === "" || v === null || v === undefined ? null : Number(v);
}

// 一個品項的有效單價與小計；原價、優惠價缺一個就拿另一個補
function renoLine(it) {
  const qty = renoNum(it.qty);
  const q = qty === null || !Number.isFinite(qty) ? 1 : qty;
  const list = renoNum(it.listPrice), deal = renoNum(it.dealPrice);
  const unitDeal = deal !== null ? deal : (list !== null ? list : 0);
  const unitList = list !== null ? list : unitDeal;
  return { qty: q, unitList, unitDeal, list: q * unitList, deal: q * unitDeal };
}

function renoSummarize(items) {
  const out = { list: 0, deal: 0, saved: 0, byStatus: {} };
  RENO_STATUSES.forEach(s => { out.byStatus[s.key] = { count: 0, deal: 0 }; });
  items.forEach(it => {
    const st = out.byStatus[it.status] ? it.status : "quoted";
    const l = renoLine(it);
    out.byStatus[st].count += 1;
    if (st === "dropped") return;
    out.byStatus[st].deal += l.deal;
    out.list += l.list;
    out.deal += l.deal;
  });
  out.saved = out.list - out.deal;
  return out;
}

// 匯入：{ vendor, date, note?, items: [{ name, qty?, unit?, listPrice?, dealPrice?, note?, status? }] }
function parseRenoImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  if (!data || !Array.isArray(data.items)) return null;
  const problems = [];
  const vendor = String(data.vendor || "").trim();
  const date = String(data.date || "").trim();
  if (!vendor) problems.push("沒有商家（vendor）");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`報價日期「${date}」格式要 yyyy-MM-dd`);
  const items = [];
  const seen = new Set();
  data.items.forEach((it, i) => {
    const tag = `第 ${i + 1} 筆`;
    const name = String((it && it.name) || "").trim();
    if (!name) { problems.push(`${tag}：沒有品項名稱`); return; }
    const bad = [];
    const price = (k, label) => {
      const raw = it[k];
      if (raw === undefined || raw === null || raw === "") return "";
      const n = parseStrictNumber(raw);
      if (n === null) { bad.push(`${label}「${raw}」不是有效數字`); return ""; }
      return n;
    };
    const listPrice = price("listPrice", "原價");
    const dealPrice = price("dealPrice", "優惠價");
    let qty = 1;
    if (it.qty !== undefined && it.qty !== null && it.qty !== "") {
      qty = parseStrictNumber(it.qty);
      if (qty === null || qty < 0) { bad.push(`數量「${it.qty}」不是有效數字`); qty = 1; }
    }
    if (listPrice === "" && dealPrice === "") bad.push("原價和優惠價至少要有一個");
    const status = String(it.status || "").trim();
    if (status && !RENO_STATUSES.some(s => s.key === status)) bad.push(`狀態「${status}」不是 quoted／signed／paid／dropped`);
    if (seen.has(name)) bad.push("品項名稱重複了");
    if (bad.length) { problems.push(`${tag}（${name}）：${bad.join("；")}`); return; }
    seen.add(name);
    items.push({ name, qty, unit: String(it.unit || "").trim(), listPrice, dealPrice, note: String(it.note || "").trim(), status });
  });
  if (!items.length && !problems.length) problems.push("items 是空的");
  return { vendor, date, note: String(data.note || "").trim(), items, problems };
}

// 匯入前預覽：哪些是新增、哪些有調價、哪些沒變（跟後端 importRenoQuote 的比對規則一致：商家＋品項名稱）
function renoImportPlan(existing, parsed) {
  const plan = { added: [], changed: [], same: [] };
  parsed.items.forEach(f => {
    const row = existing.find(r => r.vendor === parsed.vendor && r.name === f.name);
    if (!row) { plan.added.push(f); return; }
    const same = Number(row.qty) === f.qty && String(row.unit) === f.unit &&
      String(row.listPrice) === String(f.listPrice) && String(row.dealPrice) === String(f.dealPrice) &&
      String(row.note) === f.note && (f.status === "" || row.status === f.status);
    if (same) plan.same.push(f);
    else plan.changed.push({ before: renoLine(row), after: renoLine(f), name: f.name });
  });
  return plan;
}

// ====== 渲染 ======
function statusLabel(key) {
  const s = RENO_STATUSES.find(x => x.key === key);
  return s ? s.label : "報價中";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderReno() {
  renderRenoSummary();
  renderRenoVendorSelect();
  renderRenoFilter();
  renderRenoVendors();
}

function renderRenoSummary() {
  const host = document.getElementById("renoSummary");
  host.innerHTML = "";
  if (!reno.items.length) { host.appendChild(el("p", "progress-line", "還沒有報價。按上面的「匯入報價」貼上整理好的資料。")); return; }
  const s = renoSummarize(reno.items);
  const grid = el("div", "reno-stats");
  const stat = (label, value, cls) => {
    const d = el("div", "reno-stat" + (cls ? " " + cls : ""));
    d.appendChild(el("span", "reno-stat-label", label));
    d.appendChild(el("strong", "reno-stat-value", value));
    grid.appendChild(d);
  };
  stat("優惠後總額", renoMoney(s.deal), "main");
  stat("原價總額", renoMoney(s.list));
  stat("省下", renoMoney(s.saved), s.saved > 0 ? "good" : "");
  host.appendChild(grid);
  const by = s.byStatus;
  const committed = by.signed.deal + by.paid.deal;
  const lines = [
    `已簽約＋已付款 ${renoMoney(committed)}（已付 ${renoMoney(by.paid.deal)}，待付 ${renoMoney(by.signed.deal)}）`,
    `報價中 ${renoMoney(by.quoted.deal)}（${by.quoted.count} 項）` + (by.dropped.count ? `　·　不買 ${by.dropped.count} 項（不計入）` : ""),
  ];
  lines.forEach(t => host.appendChild(el("p", "progress-line", t)));
}

function renderRenoVendorSelect() {
  const sel = document.getElementById("renoVendorSelect");
  const vendors = [];
  reno.items.forEach(it => { if (!vendors.includes(it.vendor)) vendors.push(it.vendor); });
  if (reno.vendor !== "all" && !vendors.includes(reno.vendor)) reno.vendor = "all"; // 選的商家被刪光了
  sel.innerHTML = "";
  sel.appendChild(new Option(`全部商家（${vendors.length}）`, "all"));
  vendors.forEach(v => sel.appendChild(new Option(v, v)));
  sel.value = reno.vendor;
  sel.classList.toggle("hidden", vendors.length < 2);
}
document.getElementById("renoVendorSelect").addEventListener("change", (e) => {
  reno.vendor = e.target.value;
  renderRenoVendors();
});

function renderRenoFilter() {
  const host = document.getElementById("renoFilter");
  host.innerHTML = "";
  [{ key: "all", label: "全部" }, ...RENO_STATUSES].forEach(s => {
    const b = el("button", "seg-btn" + (reno.filter === s.key ? " on" : ""), s.label);
    b.type = "button";
    b.addEventListener("click", () => { reno.filter = s.key; renderRenoFilter(); renderRenoVendors(); });
    host.appendChild(b);
  });
}

function renderRenoVendors() {
  const host = document.getElementById("renoVendors");
  host.innerHTML = "";
  const vendors = [];
  reno.items.forEach(it => { if (!vendors.includes(it.vendor)) vendors.push(it.vendor); });
  let any = false;
  vendors.forEach(vendor => {
    if (reno.vendor !== "all" && vendor !== reno.vendor) return;
    const all = reno.items.filter(it => it.vendor === vendor);
    const shown = all.filter(it => reno.filter === "all" || (it.status || "quoted") === reno.filter);
    if (!shown.length) return;
    any = true;
    host.appendChild(renderRenoVendor(vendor, all, shown));
  });
  if (reno.items.length && !any) host.appendChild(el("p", "progress-line", "這個狀態下沒有品項"));
}

function renderRenoVendor(vendor, all, shown) {
  const box = el("div", "reno-vendor");
  const sum = renoSummarize(shown);
  const head = el("div", "reno-vendor-head");
  head.appendChild(el("h3", "reno-vendor-name", vendor));
  const tot = el("div", "reno-vendor-total");
  tot.appendChild(el("strong", "", renoMoney(sum.deal)));
  if (sum.saved > 0) tot.appendChild(el("span", "reno-vendor-orig", `原價 ${renoMoney(sum.list)}，省 ${renoMoney(sum.saved)}`));
  head.appendChild(tot);
  box.appendChild(head);

  const tools = el("div", "reno-vendor-tools");
  const delV = el("button", "ghost-btn reno-del", "刪除商家");
  delV.type = "button";
  delV.addEventListener("click", async () => {
    if (!(await showConfirm(`確定刪除「${vendor}」的全部 ${all.length} 個品項和報價紀錄？`))) return;
    await runRenoWrite(box, () => api("deleteRenoVendor", { vendor }), "刪除失敗");
  });
  tools.appendChild(delV);
  box.appendChild(tools);

  const list = el("ul", "item-list reno-items");
  shown.forEach(it => list.appendChild(renderRenoItem(it)));
  box.appendChild(list);
  return box;
}

function renderRenoItem(it) {
  const st = it.status || "quoted";
  const l = renoLine(it);
  const li = el("li", "item-row reno-row" + (st === "dropped" ? " done" : ""));
  const main = el("div", "reno-main");
  main.appendChild(el("span", "item-text", it.name));
  const unit = String(it.unit || "");
  const sub = [`${l.qty}${unit ? " " + unit : ""} × ${renoMoney(l.unitDeal)}`];
  if (it.note) sub.push(String(it.note));
  main.appendChild(el("span", "reno-sub", sub.join("　·　")));
  li.appendChild(main);

  const price = el("div", "reno-price");
  price.appendChild(el("strong", "", renoMoney(l.deal)));
  if (l.list !== l.deal) price.appendChild(el("s", "reno-orig", renoMoney(l.list)));
  li.appendChild(price);

  const sel = el("select", "reno-status");
  sel.setAttribute("aria-label", "狀態");
  RENO_STATUSES.forEach(s => sel.appendChild(new Option(s.label, s.key)));
  sel.value = st;
  sel.addEventListener("change", () => runRenoWrite(li, () => api("setRenoStatus", { ids: JSON.stringify([it.id]), status: sel.value }), "更新失敗", () => { sel.value = st; }));
  li.appendChild(sel);

  const rounds = reno.log.filter(x => x.itemId === it.id).length;
  const hist = el("button", "habit-info-btn", rounds > 1 ? `ⓘ${rounds}` : "ⓘ");
  hist.type = "button";
  hist.title = `報價紀錄（${rounds} 輪）`;
  hist.setAttribute("aria-label", "報價紀錄");
  hist.addEventListener("click", () => openRenoHistory(it));
  li.appendChild(hist);

  const del = el("button", "delete-btn", "✕");
  del.type = "button";
  del.title = "刪除";
  del.addEventListener("click", async () => {
    if (!(await showConfirm(`確定刪除「${it.name}」和它的報價紀錄？`))) return;
    await runRenoWrite(li, () => api("deleteRenoItem", { id: it.id }), "刪除失敗");
  });
  li.appendChild(del);

  li.dataset.lockKey = `reno:${it.id}`;
  lockIfPending(li);
  return li;
}

async function runRenoWrite(rowEl, call, failText, onFail) {
  await withRowLock(rowEl, async () => {
    try {
      applyReno(await call());
      releasePending(rowEl);
      renderReno();
    } catch (err) {
      if (onFail) onFail();
      setStatus(failText + "：" + err.message, true);
    }
  });
}

// ====== History ======
function openRenoHistory(it) {
  document.getElementById("renoHistoryTitle").textContent = `${it.vendor}｜${it.name}`;
  const body = document.getElementById("renoHistoryBody");
  body.innerHTML = "";
  const rows = reno.log.filter(x => x.itemId === it.id).sort((a, b) => Number(a.round) - Number(b.round));
  if (!rows.length) body.appendChild(el("p", "progress-line", "沒有報價紀錄"));
  let prev = null;
  rows.forEach(r => {
    const l = renoLine(r);
    const card = el("div", "reno-round");
    const top = el("div", "reno-round-top");
    top.appendChild(el("strong", "", `第 ${r.round} 輪`));
    top.appendChild(el("span", "reno-sub", String(r.date || "")));
    card.appendChild(top);
    const unit = String(r.unit || "");
    card.appendChild(el("div", "", `${l.qty}${unit ? " " + unit : ""} × 優惠 ${renoMoney(l.unitDeal)}` + (l.unitList !== l.unitDeal ? `（原價 ${renoMoney(l.unitList)}）` : "")));
    const tot = el("div", "reno-round-total");
    tot.appendChild(el("strong", "", `小計 ${renoMoney(l.deal)}`));
    if (prev) {
      const d = l.deal - prev.deal;
      const chg = el("span", "reno-chg " + (d < 0 ? "down" : d > 0 ? "up" : ""), d === 0 ? "與上一輪相同" : `${d < 0 ? "▼ 少" : "▲ 多"} ${renoMoney(Math.abs(d))}`);
      tot.appendChild(chg);
    }
    card.appendChild(tot);
    if (r.note) card.appendChild(el("div", "reno-sub", String(r.note)));
    body.appendChild(card);
    prev = l;
  });
  document.getElementById("renoHistoryModal").classList.remove("hidden");
}

document.getElementById("renoHistoryClose").addEventListener("click", () => document.getElementById("renoHistoryModal").classList.add("hidden"));
document.getElementById("renoHistoryModal").addEventListener("click", (e) => {
  if (e.target.id === "renoHistoryModal") e.target.classList.add("hidden");
});

// ====== 匯入 ======
function closeRenoImport() {
  document.getElementById("renoImportModal").classList.add("hidden");
}
document.getElementById("openRenoImport").addEventListener("click", () => {
  document.getElementById("renoImportText").value = "";
  document.getElementById("renoImportMsg").textContent = "";
  document.getElementById("renoImportModal").classList.remove("hidden");
});
document.getElementById("renoImportClose").addEventListener("click", closeRenoImport);
document.getElementById("renoImportModal").addEventListener("click", (e) => {
  if (e.target.id === "renoImportModal") closeRenoImport();
});

document.getElementById("renoImportForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById("renoImportMsg");
  const parsed = parseRenoImport(document.getElementById("renoImportText").value);
  if (!parsed) { msg.textContent = "格式不對，請整段貼上對話裡給你的資料（要有 vendor、date、items）"; return; }
  if (parsed.problems.length) { msg.textContent = "⚠️ 有問題，整批沒有匯入：" + parsed.problems.slice(0, 5).join("；") + (parsed.problems.length > 5 ? `…（共 ${parsed.problems.length} 處）` : ""); return; }
  const plan = renoImportPlan(reno.items, parsed);
  if (!plan.added.length && !plan.changed.length) { msg.textContent = `「${parsed.vendor}」這 ${plan.same.length} 個品項都跟現有的一樣，沒有要更新的`; return; }
  const lines = [`確定匯入「${parsed.vendor}」（${parsed.date}）？`, `新增 ${plan.added.length} 項、價格或數量有變 ${plan.changed.length} 項、沒變略過 ${plan.same.length} 項`];
  plan.changed.slice(0, 5).forEach(c => lines.push(`・${c.name}：${renoMoney(c.before.deal)} → ${renoMoney(c.after.deal)}`));
  if (plan.changed.length > 5) lines.push(`…（共 ${plan.changed.length} 項有變）`);
  if (!(await showConfirm(lines.join("\n")))) return;
  setFormBusy(form, true);
  try {
    applyReno(await api("importRenoQuote", { vendor: parsed.vendor, date: parsed.date, note: parsed.note, items: JSON.stringify(parsed.items) }));
    renderReno();
    closeRenoImport();
    showToast(`已匯入：新增 ${plan.added.length}、更新 ${plan.changed.length}`);
  } catch (err) {
    msg.textContent = "匯入失敗：" + err.message;
  } finally {
    setFormBusy(form, false);
  }
});

// ====== Boot ======
initAuth();
