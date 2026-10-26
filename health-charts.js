// ====== 健康頁共用：狀態分級顏色 + 以日期為 x 軸的折線圖 ======
// 體重（health-body.js）跟驗血（health-labs.js）共用。分級沿用血壓頁的四級色
// （good / warning / serious / critical），顏色一定搭配文字標籤，不能只靠顏色傳達。

const LEVEL_VAR = {
  good: "var(--status-good)",
  ok: "var(--text-dim)", // 寵物驗血「醫師說無妨」：中性色，不當警示
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
};

const LEVEL_ICON = { good: "🟢", ok: "⚪", warning: "🟡", serious: "🟠", critical: "🔴" };

const HEALTH_DISCLAIMER = "分級僅供參考，請以醫師診斷及報告上的參考範圍為準。";

function fmtHealthDate(dateStr) {
  return String(dateStr).replace(/-/g, "/");
}

function toNum(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function roundTo(n, dec) {
  const f = Math.pow(10, dec);
  return Math.round(n * f) / f;
}

// 一個帶顏色與文字的狀態標籤（例如「🟠 中度肥胖」）
function buildLevelBadge(level, text) {
  const span = document.createElement("span");
  span.className = `level-badge level-${level}`;
  span.textContent = `${LEVEL_ICON[level]} ${text}`;
  return span;
}

// points: [{ date: "yyyy-MM-dd", value: number, level?: "good"|... }]
// opts: { bands?: [{from,to,level,label}], decimals?: number, color?: string, yPad?: number, highlightLast?: boolean, unit?: string, fmtX?: date => string }
// point 可帶 label（提示文字用，取代日期）
function drawTimeChart(container, points, opts = {}) {
  container.innerHTML = "";
  if (!points.length) {
    container.innerHTML = `<p class="empty-hint">還沒有資料可以畫圖</p>`;
    return;
  }
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const color = opts.color || "var(--series-systolic)";
  const dec = opts.decimals ?? 1;

  const W = 640, H = 220;
  const marginLeft = 40, marginRight = 12, marginTop = 12, marginBottom = 26;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;

  const times = sorted.map(p => new Date(p.date + "T00:00:00").getTime());
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const values = sorted.map(p => p.value);
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const pad = opts.yPad ?? Math.max((yMax - yMin) * 0.25, Math.abs(yMax) * 0.02, 0.5);
  yMin -= pad;
  yMax += pad;

  const xScale = t => tMax === tMin ? marginLeft + plotW / 2 : marginLeft + ((t - tMin) / (tMax - tMin)) * plotW;
  const yScale = y => marginTop + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="bp-svg" role="img">`;

  (opts.bands || []).forEach(b => {
    const from = Math.max(b.from, yMin);
    const to = Math.min(b.to, yMax);
    if (to <= from) return;
    const y1 = yScale(to);
    const y2 = yScale(from);
    svg += `<rect x="${marginLeft}" y="${y1}" width="${plotW}" height="${y2 - y1}" class="bp-band bp-band-${b.level}"></rect>`;
    if (b.label && y2 - y1 > 11) {
      svg += `<text x="${marginLeft + 4}" y="${y1 + 10}" class="bp-band-label">${b.label}</text>`;
    }
  });

  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = yScale(v);
    svg += `<line x1="${marginLeft}" y1="${y}" x2="${marginLeft + plotW}" y2="${y}" class="bp-grid"></line>`;
    svg += `<text x="${marginLeft - 6}" y="${y}" class="bp-axis-label" text-anchor="end" dominant-baseline="middle">${roundTo(v, dec)}</text>`;
  }

  // x 軸：頭、尾（資料少時全部）日期標籤
  const labelIdx = sorted.length <= 6 ? sorted.map((_, i) => i) : [0, Math.floor(sorted.length / 2), sorted.length - 1];
  labelIdx.forEach(i => {
    const anchor = i === 0 ? "start" : i === sorted.length - 1 ? "end" : "middle";
    svg += `<text x="${xScale(times[i])}" y="${H - 8}" class="bp-axis-label" text-anchor="${anchor}">${opts.fmtX ? escapeHtml(opts.fmtX(sorted[i].date)) : sorted[i].date.slice(2).replace(/-/g, "/")}</text>`;
  });

  if (sorted.length > 1) {
    const path = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(times[i])},${yScale(p.value)}`).join(" ");
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }
  sorted.forEach((p, i) => {
    const fill = p.level ? LEVEL_VAR[p.level] : color;
    const isLast = opts.highlightLast && i === sorted.length - 1;
    svg += `<circle cx="${xScale(times[i])}" cy="${yScale(p.value)}" r="${isLast ? 6.5 : 4}" fill="${fill}" stroke="${isLast ? color : "var(--card-bg)"}" stroke-width="${isLast ? 2.5 : 1.5}"><title>${p.label ? escapeHtml(p.label) : fmtHealthDate(p.date)}：${roundTo(p.value, dec)}${opts.unit ? " " + escapeHtml(opts.unit) : ""}</title></circle>`;
  });
  svg += `</svg>`;
  container.innerHTML = svg;
}

// ====== 驗血分級共用（人用驗血 health-labs.js、寵物驗血 pets-labs.js）======
function levelResult(level, text) { return { level, text }; }

function classifyRange(v, low, high) {
  let over = 0;
  let dir = "";
  if (high !== null && v > high) { over = high === 0 ? 1 : (v - high) / Math.abs(high); dir = "偏高"; }
  else if (low !== null && v < low) { over = low === 0 ? 1 : (low - v) / Math.abs(low); dir = "偏低"; }
  if (!dir) return (low === null && high === null) ? null : levelResult("good", "正常");
  if (over <= 0.15) return levelResult("warning", dir);
  if (over <= 0.5) return levelResult("serious", dir);
  return levelResult("critical", "明顯" + dir);
}

function refText(low, high) {
  if (low !== null && high !== null) return `${low}-${high}`;
  if (high !== null) return `<${high}`;
  if (low !== null) return `>${low}`;
  return "未填";
}

// ====== 趨勢說明（圖表下方）：這個指標是越高/越低越好、趨勢是變好還是變壞、各級切點 ======
const LEVEL_RANK = { good: 0, ok: 0, warning: 1, serious: 2, critical: 3 };
const BETTER_TEXT = { lower: "越低越好", higher: "越高越好", range: "落在參考範圍內最好" };

// 比較兩個點：往好、往壞、或持平。先比分級（燈號），同燈號再看數值方向。
function compareHealth(item, from, to) {
  const cf = item.classifyPoint(from), ct = item.classifyPoint(to);
  if (cf && ct && cf.level !== ct.level) {
    return LEVEL_RANK[ct.level] < LEVEL_RANK[cf.level]
      ? { icon: "✅", text: "往好的方向（燈號變好）" }
      : { icon: "⚠️", text: "往壞的方向（燈號變差）" };
  }
  if (cf && ct && cf.level === "ok" && ct.level === "ok") return { icon: "➖", text: (from.value < to.value ? "上升" : "下降") + "（醫師說無妨，不評好壞）" };
  if (cf && ct && ct.level === "good") return { icon: "✅", text: "維持在正常範圍" };
  if (from.value === to.value) return { icon: "➖", text: "沒有變化" };
  // 有「正常」區間時，一律用「離正常區間多遠」比：原本 lower 類只看大小，
  // 已經低於正常下限（如血糖 60）卻繼續下降，會被誤判成「變好」
  const goodBand = item.bandList().find(b => b.level === "good");
  if (goodBand) {
    const dist = v => v < goodBand.from ? goodBand.from - v : v > goodBand.to ? v - goodBand.to : 0;
    const df = dist(from.value), dt = dist(to.value);
    if (df === dt) return { icon: "➖", text: from.value < to.value ? "上升（離正常範圍的距離沒變）" : "下降（離正常範圍的距離沒變）" };
    return dt < df
      ? { icon: "✅", text: "往好的方向（燈號沒變，數值更接近正常範圍）" }
      : { icon: "⚠️", text: "往壞的方向（燈號沒變，數值離正常範圍更遠）" };
  }
  let improved;
  if (item.better === "lower") improved = to.value < from.value;
  else if (item.better === "higher") improved = to.value > from.value;
  else {
    const good = item.bandList().find(b => b.level === "good");
    const center = good ? (good.from + good.to) / 2 : null;
    improved = center === null ? null : Math.abs(to.value - center) < Math.abs(from.value - center);
  }
  if (improved === null) return { icon: "➖", text: from.value < to.value ? "上升" : "下降" };
  return improved ? { icon: "✅", text: "往好的方向（燈號沒變，數值朝好的方向）" } : { icon: "⚠️", text: "往壞的方向（燈號沒變，數值朝不好的方向）" };
}

function renderLabExplain(box, item) {
  box.innerHTML = "";
  if (!item) return;
  const hist = item.history();
  const addLine = (html) => {
    const p = document.createElement("p");
    p.className = "explain-line";
    p.innerHTML = html;
    box.appendChild(p);
  };
  const esc = escapeHtml;

  const head = document.createElement("div");
  head.className = "explain-head";
  head.textContent = `${item.label}：${BETTER_TEXT[item.better] || ""}`;
  box.appendChild(head);

  if (hist.length >= 2) {
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    const first = hist[0];
    const a = compareHealth(item, prev, last);
    addLine(`<b>與上次（${fmtHealthDate(prev.date)}）</b>：${roundTo(prev.value, item.dec)} → ${roundTo(last.value, item.dec)}　${a.icon} ${esc(a.text)}`);
    if (hist.length > 2) {
      const b = compareHealth(item, first, last);
      addLine(`<b>整體（${fmtHealthDate(first.date)} 起）</b>：${roundTo(first.value, item.dec)} → ${roundTo(last.value, item.dec)}　${b.icon} ${esc(b.text)}`);
    }
  } else {
    addLine("只有一筆紀錄，還看不出趨勢。");
  }

  addLine(`<b>參考範圍</b>：${esc(item.refLabel())}${item.unit ? "（" + esc(item.unit) + "）" : ""}`);
  const bands = item.bandList();
  if (bands.length) {
    const fmt = n => (Math.abs(n) >= 1e8 ? "∞" : roundTo(n, item.dec));
    const parts = bands.map((b, i) => {
      // 第一段視為「小於上界」、最後一段視為「大於等於下界」（資料裡的 300、600 只是畫圖用的上限）
      const from = i === 0 ? "" : fmt(b.from);
      const to = i === bands.length - 1 ? "" : fmt(b.to);
      const range = !from ? `< ${to}` : !to ? `≥ ${from}` : `${from}–${to}`;
      return `${LEVEL_ICON[b.level]} ${esc(b.label || "")} ${range}`;
    });
    addLine(`<b>燈號切點</b>：${parts.join("　")}`);
  }
  if (item.desc) addLine(esc(item.desc));
}
