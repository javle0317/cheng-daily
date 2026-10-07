// ====== 健康記錄頁（血壓）======
// WEBAPP_URL / api() / 登入流程 / showConfirm 等共用邏輯在 shared.js。

let state = {
  readings: [],
  granularity: "month", // "month" | "year"
  compareMode: false, // 分起床/睡前比較（只看收縮壓）
  month: new Date().getMonth(),
  year: new Date().getFullYear(),
  listFilter: "all", // all / morning / evening
  version: 0, // 寫入回應 +1；背景載入回來時 version 變了就丟掉（見 health-body.js 的 apply）
};

function applyBpData(readings, fromLoader) {
  if (!fromLoader) state.version++;
  state.readings = readings || [];
}

// 血壓、體重（health-body.js）、驗血（health-labs.js）三個分頁並行載入；某一個失敗不影響其他
window.loadPageData = async function () {
  const loaders = [
    { tab: "bp", load: async () => {
      const v = state.version;
      const data = await api("getBloodPressureData");
      if (state.version !== v) return;
      applyBpData(data, true);
      renderBpAll();
    } },
    ...(window.healthLoaders || []),
  ];
  let current = "bp";
  try {
    const saved = localStorage.getItem("healthTab");
    if (["bp", "body", "labs"].includes(saved)) current = saved;
  } catch (e) { /* ignore */ }
  const fail = (rs) => {
    const failed = rs.filter(r => r.status === "rejected");
    if (!failed.length) return;
    let msg = "部分資料載入失敗：" + failed.map(f => f.reason.message).join("；");
    if (msg.includes("unknown action")) msg += "（Apps Script 可能還沒重新部署成新版本）";
    setStatus(msg, true);
    showAlert(msg);
  };
  // 先等「正在看的分頁」載完就進畫面，其他分頁在背景繼續載（切過去時多半已經好了）。
  // 驗證失敗（密碼錯）要丟出去讓登入流程留在登入頁。
  const first = loaders.filter(l => l.tab === current);
  const rest = loaders.filter(l => l.tab !== current);
  // 其他分頁同時在背景開始載，只是不等它們
  const restPromise = Promise.allSettled(rest.map(l => l.load()));
  const firstResults = await Promise.allSettled(first.map(l => l.load()));
  const authFail = firstResults.find(r => r.status === "rejected" && r.reason && r.reason.message === "unauthorized");
  if (authFail) throw authFail.reason;
  // 正在看的分頁失敗：等其他分頁的結果，全部都失敗才當成登入失敗（可能是斷線）
  if (firstResults.every(r => r.status === "rejected")) {
    const rs = await restPromise;
    if (rs.every(r => r.status === "rejected")) throw firstResults[0].reason;
  }
  restPromise.then((rs) => {
    const auth = rs.find(r => r.status === "rejected" && r.reason && r.reason.message === "unauthorized");
    if (auth) { localStorage.removeItem("dailyhub_password"); location.reload(); return; }
    // 登入成功後 shared.js 會把狀態列蓋成「已連上 Google Sheet」，所以延後一下再顯示失敗訊息
    setTimeout(() => fail([...firstResults, ...rs]), 500);
  });
  // 當前分頁整個失敗但密碼是對的：仍進畫面（其他分頁可用），錯誤由上面的提示顯示
};

// ====== 新增表單的彈窗（血壓、體組成、驗血各一個，表單本身的欄位 id 與送出邏輯不變）======
// 約定同首頁：多欄位的輸入用彈窗，進頁面先看資料與圖表。錯誤用 Toast（層級在彈窗之上），成功才關閉。
function openFormModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeFormModal(id) { document.getElementById(id).classList.add("hidden"); }
[["bpFormModal", "bpFormClose", "openBpForm"], ["bodyFormModal", "bodyFormClose", "openBodyForm"], ["labFormModal", "labFormClose", "openLabForm"]].forEach(([modal, closeBtn, openBtn]) => {
  document.getElementById(closeBtn).addEventListener("click", () => closeFormModal(modal));
  document.getElementById(modal).addEventListener("click", (e) => { if (e.target.id === modal) closeFormModal(modal); });
  document.getElementById(openBtn).addEventListener("click", () => openFormModal(modal));
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !document.getElementById("dialogModal").classList.contains("hidden")) return;
  ["bpFormModal", "bodyFormModal", "labFormModal"].forEach(id => { if (!document.getElementById(id).classList.contains("hidden")) closeFormModal(id); });
});

// ====== 分頁切換（血壓 / 體重 / 驗血）======
const HEALTH_TAB_KEY = "healthTab";

function setHealthTab(tab) {
  document.querySelectorAll(".health-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("main [data-tab]").forEach(el => el.classList.toggle("hidden", el.dataset.tab !== tab));
  try { localStorage.setItem(HEALTH_TAB_KEY, tab); } catch (e) { /* ignore */ }
}

document.querySelectorAll(".health-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => setHealthTab(btn.dataset.tab));
});

(function initHealthTab() {
  let tab = "bp";
  try {
    const saved = localStorage.getItem(HEALTH_TAB_KEY);
    if (["bp", "body", "labs"].includes(saved)) tab = saved;
  } catch (e) { /* ignore */ }
  setHealthTab(tab);
})();

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function getBucketCount() {
  return state.granularity === "month"
    ? new Date(state.year, state.month + 1, 0).getDate()
    : 12;
}

function getBucketKey(r) {
  return state.granularity === "month" ? Number(r.date.slice(8, 10)) : Number(r.date.slice(5, 7));
}

function getFilteredReadings() {
  if (state.granularity === "month") {
    const monthStr = `${state.year}-${String(state.month + 1).padStart(2, "0")}`;
    return state.readings.filter(r => r.date.startsWith(monthStr));
  }
  return state.readings.filter(r => r.date.startsWith(String(state.year)));
}

// ====== Rendering ======
function renderBpAll() {
  renderPeriodNav();
  renderAlertBanner();
  renderStats();
  renderChart();
  renderPulseChart();
  renderList();
  renderDateOptions();
  syncPeriodLock();
  updateBpFormValidity();
}

// 新增表單的日期只開放今天/昨天（選昨天是給睡前量血壓跨日的情境）
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function formatDateOption(label, d) {
  return `${label}(${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_LABELS[d.getDay()]})`;
}

function renderDateOptions() {
  const select = document.getElementById("bpDate");
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const todayStr = toDateStr(today);
  const previous = select.value;
  select.innerHTML = "";
  [["今天", today], ["昨天", yesterday]].forEach(([label, d]) => {
    const opt = document.createElement("option");
    opt.value = toDateStr(d);
    opt.textContent = formatDateOption(label, d);
    select.appendChild(opt);
  });
  select.value = [...select.options].some(o => o.value === previous) ? previous : todayStr;
}

// 選昨天時，時段鎖死為睡前
function syncPeriodLock() {
  const isYesterday = document.getElementById("bpDate").value !== toDateStr(new Date());
  const period = document.getElementById("bpPeriod");
  if (isYesterday) period.value = "evening";
  period.disabled = isYesterday;
}

function renderPeriodNav() {
  const label = document.getElementById("bpPeriodLabel");
  document.getElementById("bpListTitle").textContent = state.granularity === "month"
    ? `每日量測紀錄 · ${state.year}/${state.month + 1}`
    : `每日量測紀錄 · ${state.year} 年`;
  label.textContent = state.granularity === "month"
    ? `${state.year} 年 ${state.month + 1} 月`
    : `${state.year} 年`;
}

document.getElementById("bpPeriodPrev").addEventListener("click", () => {
  if (state.granularity === "month") {
    state.month--;
    if (state.month < 0) { state.month = 11; state.year--; }
  } else {
    state.year--;
  }
  renderBpAll();
});

document.getElementById("bpPeriodNext").addEventListener("click", () => {
  if (state.granularity === "month") {
    state.month++;
    if (state.month > 11) { state.month = 0; state.year++; }
  } else {
    state.year++;
  }
  renderBpAll();
});

document.getElementById("bpGranularity").addEventListener("change", (e) => {
  state.granularity = e.target.value;
  renderBpAll();
});

document.getElementById("bpCompareToggle").addEventListener("change", (e) => {
  state.compareMode = e.target.checked;
  renderBpAll();
});

// 只看最近 7 天的平均（單次量測偶發偏高沒有意義），對照衛教常見門檻給提示文字。
// 一律附「僅供參考，請以醫生診斷為準」，避免看起來像在做醫療診斷。
function renderAlertBanner() {
  const banner = document.getElementById("bpAlertBanner");
  const todayStr = toDateStr(new Date());
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = toDateStr(cutoff);
  const recent = state.readings.filter(r => r.date >= cutoffStr && r.date <= todayStr);

  if (recent.length < 3) {
    banner.classList.add("hidden");
    return;
  }

  const avgSys = avg(recent.map(r => Number(r.systolic)));
  const avgDia = avg(recent.map(r => Number(r.diastolic)));
  const sys = Math.round(avgSys);
  const dia = Math.round(avgDia);

  let msg = null;
  let level = "warning";
  if (avgSys >= 180 || avgDia >= 120) {
    msg = `最近 7 天平均 ${sys}/${dia}，屬於高血壓危象範圍，建議儘快就醫`;
    level = "critical";
  } else if (avgSys >= 140 || avgDia >= 90) {
    msg = `最近 7 天平均 ${sys}/${dia}，屬於高血壓範圍，建議留意並與醫生討論`;
    level = "serious";
  } else if (avgSys < 90 || avgDia < 60) {
    msg = `最近 7 天平均 ${sys}/${dia}，偏低，如果有頭暈等不適建議留意`;
    level = "warning";
  }

  if (!msg) {
    banner.classList.add("hidden");
    return;
  }
  banner.textContent = `${msg}（僅供參考，請以醫生診斷為準）`;
  banner.className = `bp-alert bp-alert-${level}`;
}

function renderStats() {
  const container = document.getElementById("bpStatsRow");
  const readings = getFilteredReadings();
  container.innerHTML = "";
  if (!readings.length) {
    container.innerHTML = `<p class="empty-hint">這段期間還沒有紀錄</p>`;
    return;
  }

  const systolics = readings.map(r => Number(r.systolic));
  const diastolics = readings.map(r => Number(r.diastolic));
  const tiles = [
    { label: "平均", value: `${Math.round(avg(systolics))}/${Math.round(avg(diastolics))}` },
    { label: "最高收縮壓", value: `${Math.max(...systolics)}` },
    { label: "最低收縮壓", value: `${Math.min(...systolics)}` },
    { label: "量測次數", value: `${readings.length}` },
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

function buildSeries() {
  const readings = getFilteredReadings();
  const bucketCount = getBucketCount();

  if (!state.compareMode) {
    const sysBuckets = {};
    const diaBuckets = {};
    readings.forEach(r => {
      const k = getBucketKey(r);
      (sysBuckets[k] ||= []).push(Number(r.systolic));
      (diaBuckets[k] ||= []).push(Number(r.diastolic));
    });
    const sysPoints = [];
    const diaPoints = [];
    for (let k = 1; k <= bucketCount; k++) {
      if (sysBuckets[k]) sysPoints.push({ x: k, y: avg(sysBuckets[k]) });
      if (diaBuckets[k]) diaPoints.push({ x: k, y: avg(diaBuckets[k]) });
    }
    return {
      bucketCount,
      series: [
        { label: "收縮壓", color: "var(--series-systolic)", points: sysPoints },
        { label: "舒張壓", color: "var(--series-diastolic)", points: diaPoints },
      ],
    };
  }

  const morningBuckets = {};
  const eveningBuckets = {};
  readings.forEach(r => {
    const k = getBucketKey(r);
    const target = r.period === "morning" ? morningBuckets : eveningBuckets;
    (target[k] ||= []).push(Number(r.systolic));
  });
  const morningPoints = [];
  const eveningPoints = [];
  for (let k = 1; k <= bucketCount; k++) {
    if (morningBuckets[k]) morningPoints.push({ x: k, y: avg(morningBuckets[k]) });
    if (eveningBuckets[k]) eveningPoints.push({ x: k, y: avg(eveningBuckets[k]) });
  }
  return {
    bucketCount,
    series: [
      { label: "起床收縮壓", color: "var(--series-systolic)", points: morningPoints },
      { label: "睡前收縮壓", color: "var(--series-diastolic)", points: eveningPoints },
    ],
  };
}

function renderChart() {
  const container = document.getElementById("bpChart");
  const { bucketCount, series } = buildSeries();
  const hasData = series.some(s => s.points.length > 0);
  if (!hasData) {
    container.innerHTML = `<p class="empty-hint">這段期間還沒有資料可以畫圖</p>`;
    return;
  }

  const W = 640, H = 260;
  const marginLeft = 34, marginRight = 92, marginTop = 10, marginBottom = 24; // 右邊留給分級色帶的文字標籤
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;
  const yMin = 40, yMax = 200;

  const xScale = x => marginLeft + ((x - 1) / Math.max(1, bucketCount - 1)) * plotW;
  const yScale = y => marginTop + plotH - ((Math.min(Math.max(y, yMin), yMax) - yMin) / (yMax - yMin)) * plotH;

  // 血壓分級色帶（門檻跟 7 天提示共用同一套標準），色塊本身不代表意義，一定要
  // 搭配右側文字標籤（狀態色不能只靠顏色傳達）
  const bands = [
    { from: 140, to: yMax, status: "critical", label: "高血壓二期+" },
    { from: 130, to: 140, status: "serious", label: "高血壓一期" },
    { from: 120, to: 130, status: "warning", label: "血壓升高" },
    { from: yMin, to: 120, status: "good", label: "正常" },
  ];

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="bp-svg" role="img" aria-label="血壓趨勢圖">`;

  bands.forEach(b => {
    const y1 = yScale(b.to);
    const y2 = yScale(b.from);
    svg += `<rect x="${marginLeft}" y="${y1}" width="${plotW}" height="${y2 - y1}" class="bp-band bp-band-${b.status}"></rect>`;
    svg += `<text x="${marginLeft + plotW + 6}" y="${(y1 + y2) / 2}" class="bp-band-label" dominant-baseline="middle">${b.label}</text>`;
  });

  [40, 80, 120, 160, 200].forEach(v => {
    const y = yScale(v);
    svg += `<line x1="${marginLeft}" y1="${y}" x2="${marginLeft + plotW}" y2="${y}" class="bp-grid"></line>`;
    svg += `<text x="${marginLeft - 6}" y="${y}" class="bp-axis-label" text-anchor="end" dominant-baseline="middle">${v}</text>`;
  });

  const xTickEvery = state.granularity === "month" ? 5 : 1;
  for (let k = 1; k <= bucketCount; k += xTickEvery) {
    svg += `<text x="${xScale(k)}" y="${H - 6}" class="bp-axis-label" text-anchor="middle">${k}</text>`;
  }

  series.forEach(s => {
    if (!s.points.length) return;
    const path = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.x)},${yScale(p.y)}`).join(" ");
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`;
    s.points.forEach(p => {
      svg += `<circle cx="${xScale(p.x)}" cy="${yScale(p.y)}" r="3.5" fill="${s.color}"><title>${s.label} ${Math.round(p.y)}</title></circle>`;
    });
  });

  svg += `</svg>`;

  let legend = `<div class="bp-legend">`;
  series.forEach(s => {
    legend += `<span class="bp-legend-item"><span class="bp-legend-dot" style="background:${s.color}"></span>${s.label}</span>`;
  });
  legend += `</div>`;

  container.innerHTML = legend + svg;
}

function renderPulseChart() {
  const container = document.getElementById("bpPulseChart");
  const readings = getFilteredReadings();
  if (!readings.length) { container.innerHTML = ""; return; }

  const bucketCount = getBucketCount();
  const buckets = {};
  readings.forEach(r => {
    const k = getBucketKey(r);
    (buckets[k] ||= []).push(Number(r.pulse));
  });
  const points = [];
  for (let k = 1; k <= bucketCount; k++) {
    if (buckets[k]) points.push({ x: k, y: avg(buckets[k]) });
  }
  if (!points.length) { container.innerHTML = ""; return; }

  const W = 640, H = 100;
  const marginLeft = 34, marginRight = 10, marginTop = 16, marginBottom = 20;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;
  const ys = points.map(p => p.y);
  const yMin = Math.floor((Math.min(...ys, 50) - 5) / 10) * 10;
  const yMax = Math.ceil((Math.max(...ys, 90) + 5) / 10) * 10;

  const xScale = x => marginLeft + ((x - 1) / Math.max(1, bucketCount - 1)) * plotW;
  const yScale = y => marginTop + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.x)},${yScale(p.y)}`).join(" ");
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="bp-svg bp-svg-small" role="img" aria-label="脈搏趨勢圖">`;
  svg += `<text x="${marginLeft}" y="12" class="bp-axis-label" text-anchor="start">脈搏（bpm）</text>`;
  svg += `<path d="${path}" fill="none" stroke="var(--series-pulse)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`;
  points.forEach(p => {
    svg += `<circle cx="${xScale(p.x)}" cy="${yScale(p.y)}" r="3" fill="var(--series-pulse)"><title>脈搏 ${Math.round(p.y)}</title></circle>`;
  });
  svg += `</svg>`;
  container.innerHTML = svg;
}

function renderList() {
  const container = document.getElementById("bpList");
  const readings = getFilteredReadings()
    .filter(r => state.listFilter === "all" || r.period === state.listFilter)
    .sort((a, b) => a.date.localeCompare(b.date) || a.period.localeCompare(b.period));

  container.innerHTML = "";
  if (!readings.length) {
    container.innerHTML = `<p class="empty-hint">這段期間還沒有紀錄</p>`;
    return;
  }

  const byDate = {};
  readings.forEach(r => { (byDate[r.date] ||= []).push(r); });

  Object.keys(byDate).sort().reverse().forEach(date => {
    const group = document.createElement("div");
    const heading = document.createElement("h3");
    heading.className = "sub-heading";
    heading.textContent = date;
    group.appendChild(heading);

    const ul = document.createElement("ul");
    ul.className = "item-list";
    byDate[date].forEach(r => {
      const li = document.createElement("li");
      li.className = "item-row";

      const periodBadge = document.createElement("span");
      periodBadge.className = "owner-badge";
      periodBadge.textContent = r.period === "morning" ? "🌅 起床" : "🌙 睡前";

      const valueSpan = document.createElement("span");
      valueSpan.className = "item-text";
      valueSpan.textContent = `${r.systolic}/${r.diastolic}`;

      const pulseSpan = document.createElement("span");
      pulseSpan.className = "item-time";
      pulseSpan.textContent = `脈搏 ${r.pulse}`;

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.title = "刪除";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async () => {
        if (!(await showConfirm("確定要刪除這筆血壓紀錄嗎？"))) return;
        await withRowLock(delBtn, async () => {
          try {
            applyBpData(await api("deleteBloodPressureReading", { id: r.id }));
            releasePending(delBtn);
            renderBpAll();
          } catch (err) {
            setStatus("刪除失敗：" + err.message, true);
          }
        });
      });

      li.appendChild(periodBadge);
      li.appendChild(valueSpan);
      li.appendChild(pulseSpan);
      li.appendChild(delBtn);
      li.dataset.lockKey = `bp:${r.id}`;
      lockIfPending(li);
      ul.appendChild(li);
    });
    group.appendChild(ul);
    container.appendChild(group);
  });
}

document.getElementById("bpListFilter").addEventListener("change", (e) => {
  state.listFilter = e.target.value;
  renderList();
});

// ====== 新增血壓紀錄 ======
function updateBpFormValidity() {
  const date = document.getElementById("bpDate").value;
  const systolic = document.getElementById("bpSystolic").value;
  const diastolic = document.getElementById("bpDiastolic").value;
  const pulse = document.getElementById("bpPulse").value;
  document.getElementById("bpSubmitBtn").disabled = !(date && systolic && diastolic && pulse);
}

document.getElementById("bpDate").addEventListener("change", syncPeriodLock);

["bpDate", "bpPeriod", "bpSystolic", "bpDiastolic", "bpPulse"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateBpFormValidity);
  document.getElementById(id).addEventListener("change", updateBpFormValidity);
});

document.getElementById("bpForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("bpDate").value;
  const period = document.getElementById("bpPeriod").value;
  const systolic = document.getElementById("bpSystolic").value;
  const diastolic = document.getElementById("bpDiastolic").value;
  const pulse = document.getElementById("bpPulse").value;
  if (!date || !systolic || !diastolic || !pulse) return;
  setFormBusy(e.target, true);
  try {
    applyBpData(await api("addBloodPressureReading", { date, period, systolic, diastolic, pulse }));
    document.getElementById("bpSystolic").value = "";
    document.getElementById("bpDiastolic").value = "";
    document.getElementById("bpPulse").value = "";
    renderBpAll();
    closeFormModal("bpFormModal");
    showToast("已新增血壓紀錄");
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    syncPeriodLock();
    updateBpFormValidity();
  }
});
