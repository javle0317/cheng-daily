// ====== 健康頁共用：狀態分級顏色 + 以日期為 x 軸的折線圖 ======
// 體重（health-body.js）跟驗血（health-labs.js）共用。分級沿用血壓頁的四級色
// （good / warning / serious / critical），顏色一定搭配文字標籤，不能只靠顏色傳達。

const LEVEL_VAR = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
};

const LEVEL_ICON = { good: "🟢", warning: "🟡", serious: "🟠", critical: "🔴" };

const HEALTH_DISCLAIMER = "分級僅供參考，請以醫師診斷及報告上的參考範圍為準。";

function fmtHealthDate(dateStr) {
  return String(dateStr).replace(/-/g, "/");
}

function toNum(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
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
// opts: { bands?: [{from,to,level,label}], decimals?: number, color?: string, yPad?: number }
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
    svg += `<text x="${xScale(times[i])}" y="${H - 8}" class="bp-axis-label" text-anchor="${anchor}">${sorted[i].date.slice(2).replace(/-/g, "/")}</text>`;
  });

  if (sorted.length > 1) {
    const path = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(times[i])},${yScale(p.value)}`).join(" ");
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }
  sorted.forEach((p, i) => {
    const fill = p.level ? LEVEL_VAR[p.level] : color;
    svg += `<circle cx="${xScale(times[i])}" cy="${yScale(p.value)}" r="4.5" fill="${fill}" stroke="var(--card-bg)" stroke-width="1.5"><title>${fmtHealthDate(p.date)}：${roundTo(p.value, dec)}${opts.unit ? " " + escapeHtml(opts.unit) : ""}</title></circle>`;
  });
  svg += `</svg>`;
  container.innerHTML = svg;
}
