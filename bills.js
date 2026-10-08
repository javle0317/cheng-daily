// ====== 信用卡帳單頁 ======
// WEBAPP_URL / api() / 登入流程 / showConfirm 等共用邏輯在 shared.js。
// 銀行清單寫在 bills.html 的 #billBank 下拉選項裡，之後開新卡就加那裡。

let state = {
  bills: [],
  year: new Date().getFullYear(),
  compareLastYear: false,
  compareExtraYear: "",
  bankChartMonth: "",
  listFilter: "all",
  listMonth: "",
};

function applyBillData(bills) {
  state.bills = bills || [];
}

window.loadPageData = async function () {
  applyBillData(await api("getCreditCardBills"));
  renderBillsAll();
};

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function formatAmount(n) {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "萬";
  return String(n);
}

function getBillsForYear(year) {
  return state.bills.filter(b => b.billingMonth && b.billingMonth.startsWith(String(year)));
}

function monthlyTotals(year) {
  const totals = {};
  getBillsForYear(year).forEach(b => {
    const m = Number(b.billingMonth.slice(5, 7));
    totals[m] = (totals[m] || 0) + Number(b.fullAmount);
  });
  return totals;
}

function getAvailableYears() {
  const years = new Set(state.bills.map(b => Number(b.billingMonth.slice(0, 4))));
  return [...years].sort((a, b) => b - a);
}

// ====== 繳款狀態 ======
function getPaidVal(b) {
  return b.paidAmount === "" || b.paidAmount === undefined || b.paidAmount === null ? null : Number(b.paidAmount);
}

// 已繳金額等於全額 = 繳清，鎖定不能再修改
function isPaidOff(b) {
  const paid = getPaidVal(b);
  return paid !== null && paid === Number(b.fullAmount);
}

function buildPayBtn(b, paidVal) {
  const payBtn = document.createElement("button");
  payBtn.className = "pay-btn";
  payBtn.title = "登記/修改已繳金額";
  payBtn.textContent = paidVal === null ? "登記已繳" : "修改已繳";
  payBtn.addEventListener("click", async () => {
    const input = await showPrompt("已繳金額（留空清除）：", paidVal === null ? "" : String(paidVal));
    if (input === null) return;
    // 跟後端同一套嚴格解析：1,000 要先轉成 1000 才能跟帳單全額比，也才不會漏掉「繳清後鎖定」的確認
    const paid = input.trim() === "" ? null : parseStrictNumber(input);
    if (input.trim() !== "" && paid === null) { setStatus(`已繳金額「${input.trim()}」不是有效數字`, true); return; }
    if (paid !== null && paid === Number(b.fullAmount)) {
      if (!(await showConfirm("已繳金額等於帳單全額，登記後就視為繳清、不能再修改，確定嗎？"))) return;
    }
    await withRowLock(payBtn, async () => {
      try {
        applyBillData(await api("setCreditCardBillPaid", { id: b.id, paidAmount: paid === null ? "" : paid }));
        releasePending(payBtn);
        renderBillsAll();
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
  });
  return payBtn;
}

// 還沒登記過已繳金額的帳單集中放最上面；已到截止日（含當天）還沒繳的標紅字、排最前
function renderUnpaid() {
  const card = document.getElementById("billUnpaidCard");
  const list = document.getElementById("billUnpaidList");
  const today = toDateStr(new Date());
  const unpaid = state.bills
    .filter(b => getPaidVal(b) === null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  card.classList.toggle("hidden", unpaid.length === 0);
  card.classList.toggle("has-overdue", unpaid.some(b => String(b.date) <= today));
  list.innerHTML = "";
  unpaid.forEach(b => {
    const overdue = String(b.date) <= today;
    const li = document.createElement("li");
    li.className = "item-row bill-row" + (overdue ? " bill-overdue" : "");

    const bankBadge = document.createElement("span");
    bankBadge.className = "owner-badge";
    bankBadge.textContent = `${b.bank} ${String(b.billingMonth).slice(5)}月`;

    const fullSpan = document.createElement("span");
    fullSpan.className = "item-text";
    fullSpan.textContent = `全額 $${formatAmount(b.fullAmount)}`;

    const lowestSpan = document.createElement("span");
    lowestSpan.className = "item-time";
    lowestSpan.textContent = `最低 $${formatAmount(b.lowestAmount)}`;

    const dateSpan = document.createElement("span");
    dateSpan.className = "item-time";
    if (overdue) {
      const days = Math.round((new Date(today) - new Date(b.date)) / 86400000);
      dateSpan.textContent = days === 0 ? `⚠️ 今天截止` : `⚠️ 已逾期 ${days} 天（${b.date}）`;
    } else {
      dateSpan.textContent = `截止 ${b.date}`;
    }

    li.append(bankBadge, fullSpan, lowestSpan, dateSpan, buildPayBtn(b, null));
    li.dataset.lockKey = `bill:${b.id}`;
    lockIfPending(li);
    list.appendChild(li);
  });
}

// ====== Rendering ======
function renderBillsAll() {
  renderUnpaid();
  renderYearNav();
  renderCompareOptions();
  renderStats();
  renderYearChart();
  renderBankChartOptions();
  renderBankChart();
  renderList();
  updateBillFormValidity();
}

function renderYearNav() {
  document.getElementById("billYearLabel").textContent = `${state.year} 年`;
}

document.getElementById("billYearPrev").addEventListener("click", () => {
  state.year--;
  renderBillsAll();
});

document.getElementById("billYearNext").addEventListener("click", () => {
  state.year++;
  renderBillsAll();
});

document.getElementById("billCompareLastYear").addEventListener("change", (e) => {
  state.compareLastYear = e.target.checked;
  renderYearChart();
});

function renderCompareOptions() {
  const select = document.getElementById("billCompareExtraYear");
  const years = getAvailableYears().filter(y => y !== state.year && y !== state.year - 1);
  const current = select.value;
  select.innerHTML = `<option value="">+ 再加一個年份</option>` +
    years.map(y => `<option value="${y}">${y} 年</option>`).join("");
  if (years.includes(Number(current))) select.value = current;
}

document.getElementById("billCompareExtraYear").addEventListener("change", (e) => {
  state.compareExtraYear = e.target.value;
  renderYearChart();
});

function renderStats() {
  const container = document.getElementById("billStatsRow");
  const totals = monthlyTotals(state.year);
  const months = Object.keys(totals);
  container.innerHTML = "";
  if (!months.length) {
    container.innerHTML = `<p class="empty-hint">這年還沒有帳單資料</p>`;
    return;
  }
  const values = months.map(m => totals[m]);
  const yearTotal = values.reduce((a, b) => a + b, 0);
  const maxMonth = months.reduce((best, m) => (totals[m] > totals[best] ? m : best), months[0]);

  const tiles = [
    { label: "全年消費總額", value: `$${formatAmount(yearTotal)}` },
    { label: "月平均", value: `$${formatAmount(yearTotal / months.length)}` },
    { label: "最高月份", value: `${Number(maxMonth)} 月 ($${formatAmount(totals[maxMonth])})` },
  ];
  tiles.forEach(t => {
    const tile = document.createElement("div");
    tile.className = "bp-stat-tile";
    const value = document.createElement("div");
    value.className = "bp-stat-value";
    value.textContent = t.value;
    const label = document.createElement("div");
    label.className = "bp-stat-label";
    label.textContent = t.label;
    tile.appendChild(value);
    tile.appendChild(label);
    container.appendChild(tile);
  });
}

function renderYearChart() {
  const container = document.getElementById("billYearChart");
  const years = [state.year];
  if (state.compareLastYear) years.push(state.year - 1);
  if (state.compareExtraYear) years.push(Number(state.compareExtraYear));

  const colors = ["var(--series-systolic)", "var(--series-diastolic)", "var(--series-pulse)"];
  const series = years.map((y, i) => {
    const totals = monthlyTotals(y);
    const points = [];
    for (let m = 1; m <= 12; m++) {
      if (totals[m] !== undefined) points.push({ x: m, y: totals[m] });
    }
    return { label: `${y} 年`, color: colors[i], points };
  });

  const hasData = series.some(s => s.points.length > 0);
  if (!hasData) {
    container.innerHTML = `<p class="empty-hint">這段期間還沒有帳單資料可以畫圖</p>`;
    return;
  }

  const allValues = series.flatMap(s => s.points.map(p => p.y));
  const yMax = Math.max(...allValues) * 1.15 || 1000;

  const W = 640, H = 240;
  const marginLeft = 54, marginRight = 16, marginTop = 10, marginBottom = 24;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;

  const xScale = x => marginLeft + ((x - 1) / 11) * plotW;
  const yScale = y => marginTop + plotH - (y / yMax) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="bp-svg" role="img" aria-label="年度月消費趨勢圖">`;

  [0, 0.25, 0.5, 0.75, 1].forEach(frac => {
    const v = yMax * frac;
    const y = yScale(v);
    svg += `<line x1="${marginLeft}" y1="${y}" x2="${marginLeft + plotW}" y2="${y}" class="bp-grid"></line>`;
    svg += `<text x="${marginLeft - 6}" y="${y}" class="bp-axis-label" text-anchor="end" dominant-baseline="middle">$${formatAmount(v)}</text>`;
  });

  for (let m = 1; m <= 12; m++) {
    svg += `<text x="${xScale(m)}" y="${H - 6}" class="bp-axis-label" text-anchor="middle">${m}</text>`;
  }

  series.forEach(s => {
    if (!s.points.length) return;
    const path = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.x)},${yScale(p.y)}`).join(" ");
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`;
    s.points.forEach(p => {
      svg += `<circle cx="${xScale(p.x)}" cy="${yScale(p.y)}" r="3.5" fill="${s.color}"><title>${escapeHtml(s.label)} ${p.x}月 $${formatAmount(p.y)}</title></circle>`;
    });
  });

  svg += `</svg>`;

  let legend = `<div class="bp-legend">`;
  series.forEach(s => {
    legend += `<span class="bp-legend-item"><span class="bp-legend-dot" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>`;
  });
  legend += `</div>`;

  container.innerHTML = legend + svg;
}

function renderBankChartOptions() {
  const select = document.getElementById("billBankChartMonth");
  const months = [...new Set(state.bills.map(b => b.billingMonth))].sort().reverse();
  const current = select.value || state.bankChartMonth;
  select.innerHTML = months.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  if (months.includes(current)) {
    select.value = current;
  } else if (months.length) {
    select.value = months[0];
  }
  state.bankChartMonth = select.value;
}

document.getElementById("billBankChartMonth").addEventListener("change", (e) => {
  state.bankChartMonth = e.target.value;
  renderBankChart();
});

function renderBankChart() {
  const container = document.getElementById("billBankChart");
  const billingMonth = state.bankChartMonth;
  const bills = state.bills.filter(b => b.billingMonth === billingMonth);
  if (!bills.length) {
    container.innerHTML = `<p class="empty-hint">還沒有帳單資料</p>`;
    return;
  }

  const sorted = [...bills].sort((a, b) => Number(b.fullAmount) - Number(a.fullAmount));
  const maxVal = Math.max(...sorted.map(b => Number(b.fullAmount)), 1);

  const W = 640, barH = 26, gap = 10;
  const marginLeft = 52, marginRight = 70, marginTop = 8;
  const H = marginTop + sorted.length * (barH + gap);
  const plotW = W - marginLeft - marginRight;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="bp-svg bp-svg-small" role="img" aria-label="各銀行帳單比較">`;
  sorted.forEach((b, i) => {
    const y = marginTop + i * (barH + gap);
    const w = Math.max((Number(b.fullAmount) / maxVal) * plotW, 2);
    svg += `<text x="${marginLeft - 6}" y="${y + barH / 2}" class="bp-axis-label" text-anchor="end" dominant-baseline="middle">${escapeHtml(b.bank)}</text>`;
    svg += `<rect x="${marginLeft}" y="${y}" width="${w}" height="${barH}" fill="var(--series-systolic)" rx="4"><title>${escapeHtml(b.bank)} $${formatAmount(b.fullAmount)}</title></rect>`;
    svg += `<text x="${marginLeft + w + 6}" y="${y + barH / 2}" class="bp-axis-label" dominant-baseline="middle">$${formatAmount(b.fullAmount)}</text>`;
  });
  svg += `</svg>`;
  container.innerHTML = svg;
}

// 帳單月份 "2026-09" → "2026年09月"
function formatBillMonth(m) {
  const [y, mo] = String(m).split("-");
  return `${y}年${mo}月`;
}

// 月份下拉選單：只列目前銀行篩選下有資料的月份（新到舊），選到的月份不存在時退回最新一個月
function syncMonthFilter(allBills) {
  const sel = document.getElementById("billListMonth");
  const months = [...new Set(allBills.map(b => b.billingMonth))].sort().reverse();
  if (!months.includes(state.listMonth)) state.listMonth = months[0] || "";
  sel.innerHTML = "";
  months.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = formatBillMonth(m);
    sel.appendChild(opt);
  });
  sel.value = state.listMonth;
  sel.classList.toggle("hidden", !months.length);
}

function renderList() {
  const container = document.getElementById("billList");
  const byBank = state.bills.filter(b => state.listFilter === "all" || b.bank === state.listFilter);
  syncMonthFilter(byBank);
  const bills = byBank
    .filter(b => b.billingMonth === state.listMonth)
    .sort((a, b) => a.bank.localeCompare(b.bank));

  container.innerHTML = "";
  if (!bills.length) {
    container.innerHTML = `<p class="empty-hint">還沒有帳單紀錄</p>`;
    return;
  }

  const byMonth = {};
  bills.forEach(b => { (byMonth[b.billingMonth] ||= []).push(b); });

  Object.keys(byMonth).sort().reverse().forEach(month => {
    const group = document.createElement("div");
    const heading = document.createElement("h3");
    heading.className = "sub-heading";
    heading.textContent = formatBillMonth(month);
    group.appendChild(heading);

    const ul = document.createElement("ul");
    ul.className = "item-list";
    byMonth[month].forEach(b => {
      const li = document.createElement("li");
      li.className = "item-row bill-row";

      const bankBadge = document.createElement("span");
      bankBadge.className = "owner-badge";
      bankBadge.textContent = b.bank;

      const fullSpan = document.createElement("span");
      fullSpan.className = "item-text";
      fullSpan.textContent = `全額 $${formatAmount(b.fullAmount)}`;

      const lowestSpan = document.createElement("span");
      lowestSpan.className = "item-time";
      lowestSpan.textContent = `最低 $${formatAmount(b.lowestAmount)}`;

      const paidVal = b.paidAmount === "" || b.paidAmount === undefined || b.paidAmount === null ? null : Number(b.paidAmount);
      const paidSpan = document.createElement("span");
      paidSpan.className = "item-time";
      paidSpan.textContent = paidVal === null ? "尚未登記已繳" : isPaidOff(b) ? "✅ 已繳清" : `已繳 $${formatAmount(paidVal)}`;

      const dateSpan = document.createElement("span");
      dateSpan.className = "item-time";
      dateSpan.textContent = `截止 ${b.date}`;

      const li2 = document.createElement("div");
      li2.className = "item-meta-row";

      if (paidVal !== null) {
        const remain = Number(b.fullAmount) - paidVal;
        if (remain > 0) {
          const remainSpan = document.createElement("span");
          remainSpan.className = "item-time";
          remainSpan.textContent = `剩餘 $${formatAmount(remain)}`;
          li2.appendChild(remainSpan);
        }
      }

      const paidOff = isPaidOff(b);
      const payBtn = paidOff ? null : buildPayBtn(b, paidVal);

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.title = "刪除";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async () => {
        if (!(await showConfirm("確定要刪除這筆帳單嗎？"))) return;
        await withRowLock(delBtn, async () => {
          try {
            applyBillData(await api("deleteCreditCardBill", { id: b.id }));
        releasePending(delBtn);
            renderBillsAll();
          } catch (err) {
            setStatus("刪除失敗：" + err.message, true);
          }
        });
      });

      if (payBtn) li2.appendChild(payBtn);
      li2.appendChild(delBtn);

      li.appendChild(bankBadge);
      li.appendChild(fullSpan);
      li.appendChild(lowestSpan);
      li.appendChild(paidSpan);
      li.appendChild(dateSpan);
      li.appendChild(li2);
      li.dataset.lockKey = `bill:${b.id}`;
      lockIfPending(li);
      ul.appendChild(li);
    });
    group.appendChild(ul);
    container.appendChild(group);
  });
}

document.getElementById("billListFilter").addEventListener("change", (e) => {
  state.listFilter = e.target.value;
  renderList();
});

document.getElementById("billListMonth").addEventListener("change", (e) => {
  state.listMonth = e.target.value;
  renderList();
});

// ====== 新增帳單 ======
function updateBillFormValidity() {
  const bank = document.getElementById("billBank").value;
  const billingMonth = document.getElementById("billBillingMonth").value;
  const date = document.getElementById("billDate").value;
  const fullAmount = document.getElementById("billFullAmount").value;
  const lowestAmount = document.getElementById("billLowestAmount").value;
  document.getElementById("billSubmitBtn").disabled = !(bank && billingMonth && date && fullAmount && lowestAmount);
}

["billBank", "billBillingMonth", "billDate", "billFullAmount", "billLowestAmount"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateBillFormValidity);
  document.getElementById(id).addEventListener("change", updateBillFormValidity);
});

// 新增帳單的彈窗（約定同首頁：多欄位輸入用彈窗，進頁面先看待繳款與圖表）
function openBillForm() { document.getElementById("billFormModal").classList.remove("hidden"); }
function closeBillForm() { document.getElementById("billFormModal").classList.add("hidden"); }
document.getElementById("openBillForm").addEventListener("click", openBillForm);
document.getElementById("billFormClose").addEventListener("click", closeBillForm);
document.getElementById("billFormModal").addEventListener("click", (e) => { if (e.target.id === "billFormModal") closeBillForm(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("dialogModal").classList.contains("hidden")) closeBillForm();
});

document.getElementById("billForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const bank = document.getElementById("billBank").value;
  const billingMonth = document.getElementById("billBillingMonth").value;
  const date = document.getElementById("billDate").value;
  const fullAmount = document.getElementById("billFullAmount").value;
  const lowestAmount = document.getElementById("billLowestAmount").value;
  if (!bank || !billingMonth || !date || !fullAmount || !lowestAmount) return;
  setFormBusy(e.target, true);
  try {
    applyBillData(await api("addCreditCardBill", { bank, billingMonth, date, fullAmount, lowestAmount }));
    document.getElementById("billFullAmount").value = "";
    document.getElementById("billLowestAmount").value = "";
    renderBillsAll();
    closeBillForm();
    showToast("已新增帳單");
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updateBillFormValidity();
  }
});

// ====== Boot ======
initAuth();
