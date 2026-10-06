// ====== 練字字帖：版面計算（純函式，不碰 DOM，瀏覽器和 scripts/regression-check.js 都會載入）======
// practice.js 負責畫面、字型與資料；這裡只負責「把文字切成欄／行、塞進一頁、輸出 SVG 字串」。
// 單位一律是公釐（SVG 的 viewBox 就是紙張的 mm 尺寸，列印時 1 單位 = 1mm）。
//
// 設計原則（描紅，不是臨摹）：只印淺灰色的字，不畫田字格／米字格，版面越乾淨越好。
// 一張 A4 要夠寫一週：中文每欄 14 字（五言絕句兩句一欄、七言絕句兩句一欄），一頁約 15 欄 ≈ 7 首絕句。

const PRACTICE_GRAYS = { light: "#d2d2d2", medium: "#b4b4b4", dark: "#8f8f8f" };

// 中文標點：描紅不印標點，只拿來斷句
const ZH_PUNCT = "，。、；：？！…·,.;:?!「」『』（）《》〈〉—－﹁﹂“”‘’\"'()[]";

// 把一篇中文切成「子句」：依標點切，換行也切。
function zhClauses(text) {
  const out = [];
  String(text || "").split(/\n+/).forEach(line => {
    let cur = "";
    for (const ch of line.replace(/\s+/g, "")) {
      if (ZH_PUNCT.includes(ch)) {
        if (cur) { out.push(cur); cur = ""; }
      } else {
        cur += ch;
      }
    }
    if (cur) out.push(cur);
  });
  return out;
}

// 把幾篇文章依序塞進一頁的欄位（直排，每欄最多 rows 字，最多 maxCols 欄）。
// entries：已排好順序的 [{id,title,author,text}]，第一篇從 startClause 開始。
// 整個子句不拆（塞不下就換欄），所以五言兩句 = 10 字一欄、七言兩句 = 14 字一欄；超過一欄的長句才拆。
// 每篇文章換欄開始；第二篇起如果「整篇」排不進剩下的欄數就跳過（一週的字帖不要切到一半的詩）。
// 回傳 { columns: [{chars, entryId, first}], used: [{id,title,author}], next: {id, clauseIndex} | null }
function packZhColumns({ entries, startClause = 0, rows, maxCols }) {
  const columns = [];
  const used = [];
  let cur = [];
  let curEntry = null;
  let curFirst = false;
  let next = null;

  const flush = () => { if (cur.length) { columns.push({ chars: cur, entryId: curEntry, first: curFirst }); cur = []; } };

  outer:
  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];
    const clauses = zhClauses(entry.text);
    flush();
    if (ei > 0 && columns.length + zhEntryColumns(clauses, rows) > maxCols) continue; // 整篇放不下，換下一篇
    let placedAny = false;
    for (let ci = ei === 0 ? startClause : 0; ci < clauses.length; ci++) {
      const chars = Array.from(clauses[ci]);
      if (cur.length && curEntry === entry.id && cur.length + chars.length <= rows) {
        cur = cur.concat(chars);
        continue;
      }
      flush();
      const needed = Math.ceil(chars.length / rows);
      if (columns.length + needed > maxCols) {
        next = { id: entry.id, clauseIndex: ci };
        if (placedAny) used.push({ id: entry.id, title: entry.title, author: entry.author });
        break outer;
      }
      curEntry = entry.id;
      for (let i = 0; i < chars.length; i += rows) {
        const chunk = chars.slice(i, i + rows);
        const first = !placedAny && i === 0;
        if (i + rows < chars.length) columns.push({ chars: chunk, entryId: entry.id, first });
        else { cur = chunk; curFirst = first; }
      }
      placedAny = true;
    }
    if (placedAny) used.push({ id: entry.id, title: entry.title, author: entry.author });
    flush();
  }
  flush();
  return { columns, used, next };
}

// 一篇（子句陣列）單獨排需要幾欄
function zhEntryColumns(clauses, rows) {
  let cols = 0, cur = 0;
  clauses.forEach(c => {
    const n = Array.from(c).length;
    if (cur && cur + n <= rows) { cur += n; return; }
    if (cur) cols++;
    cols += Math.floor((n - 1) / rows);
    cur = ((n - 1) % rows) + 1;
  });
  return cols + (cur ? 1 : 0);
}

// 英文：依單字換行（measure(text) 回傳這行的寬度 mm，由呼叫端用實際字型量），最多 maxLines 行。
// 段落（換行）處另起一行；第二篇起整篇排不進剩下行數就跳過。
// 回傳 { lines: [{text, entryId}], used, next: {id, wordIndex} | null }
function enWords(text) {
  const words = [];
  String(text || "").split(/\n+/).forEach(par => {
    par.trim().split(/\s+/).filter(Boolean).forEach((w, i) => words.push({ w, brk: i === 0 && words.length > 0 }));
  });
  return words;
}

function enWrap(words, startWord, maxWidth, measure, maxLines) {
  const lines = [];
  let cur = "";
  let next = null;
  for (let wi = startWord; wi < words.length; wi++) {
    const { w, brk } = words[wi];
    if (cur && (brk || measure(cur + " " + w) > maxWidth)) {
      lines.push(cur);
      cur = "";
      if (lines.length >= maxLines) { next = wi; break; }
    }
    cur = cur ? cur + " " + w : w;
  }
  if (next === null && cur) lines.push(cur);
  return { lines, next };
}

function wrapEnLines({ entries, startWord = 0, maxLines, maxWidth, measure }) {
  const lines = [];
  const used = [];
  let next = null;
  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];
    const words = enWords(entry.text);
    const room = maxLines - lines.length;
    if (room <= 0) break;
    if (ei > 0 && enWrap(words, 0, maxWidth, measure, 1e9).lines.length > room) continue; // 整篇放不下，換下一篇
    const r = enWrap(words, ei === 0 ? startWord : 0, maxWidth, measure, room);
    r.lines.forEach(text => lines.push({ text, entryId: entry.id }));
    if (r.lines.length) used.push({ id: entry.id, title: entry.title, author: entry.author });
    if (r.next !== null) { next = { id: entry.id, wordIndex: r.next }; break; }
  }
  return { lines, used, next };
}

// 隨機順序：沒用過的排前面（各自洗牌），最近用過的排後面。rng 預設 Math.random，測試時可注入。
function pickOrder(entries, recentIds, rng = Math.random) {
  const recent = new Set(recentIds || []);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return shuffle(entries.filter(e => !recent.has(e.id))).concat(shuffle(entries.filter(e => recent.has(e.id))));
}

function svgEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 英文頁首的來源清單：最多列 max 篇，其餘寫「等 N 篇」
function sourcesText(used, max = 3) {
  const fmt = u => `${u.title}${u.author ? " — " + u.author : ""}`;
  const shown = used.slice(0, max).map(fmt).join("   ·   ");
  return used.length > max ? `${shown}   ·   +${used.length - max}` : shown;
}

// 頁面角落的 10cm 刻度尺：印出來量一下是不是 100mm，確認沒有被「縮放符合頁面」縮小。很淡、很小，不搶字帖
function rulerSvg(x, y) {
  let s = `<line x1="${x}" y1="${y}" x2="${x + 100}" y2="${y}" stroke="#bbb" stroke-width="0.2"/>`;
  for (let i = 0; i <= 10; i++) s += `<line x1="${x + i * 10}" y1="${y - (i % 5 === 0 ? 1.4 : 0.9)}" x2="${x + i * 10}" y2="${y}" stroke="#bbb" stroke-width="0.2"/>`;
  s += `<text x="${x + 102}" y="${y}" font-size="2.4" fill="#aaa" font-family="sans-serif">10 cm</text>`;
  return s;
}

// ====== 中文頁（A4 橫向 297×210，直排，欄由右到左）======
// 每欄 14 字：格子高 ≈ 12.9mm、字約 10.6mm（硬筆描紅的舒服大小）；欄距是字高的 1.4 倍，一頁 15 欄。
const ZH_PAGE = { W: 297, H: 210, M: 10, HEADER: 12, ROWS: 14, COL_RATIO: 1.4, FONT_RATIO: 0.82 };

function zhGeometry(rows = ZH_PAGE.ROWS) {
  const gridH = ZH_PAGE.H - 2 * ZH_PAGE.M - ZH_PAGE.HEADER;
  const cell = Math.min(14, Math.floor((gridH / rows) * 10) / 10);
  const pitch = Math.round(cell * ZH_PAGE.COL_RATIO * 10) / 10;
  return { cell, pitch, sheetCols: Math.floor((ZH_PAGE.W - 2 * ZH_PAGE.M) / pitch), fontSize: Math.round(cell * ZH_PAGE.FONT_RATIO * 100) / 100 };
}

// 標題：取篇名「・」前面那段，最多 7 字，放在每首第一欄的上方（小字、深一點的灰，不是描紅用）
function zhLabel(title) {
  const t = Array.from(String(title || "").split("・")[0]);
  return t.length > 7 ? t.slice(0, 7).join("") + "…" : t.join("");
}

function renderZhSvg({ columns, titles = {}, gray = PRACTICE_GRAYS.medium, fontFamily = "serif", rows = ZH_PAGE.ROWS }) {
  const { W, H, M, HEADER } = ZH_PAGE;
  const { cell, pitch, fontSize } = zhGeometry(rows);
  const y0 = M + HEADER;
  let g = "";
  columns.forEach((col, k) => {
    const x = W - M - (k + 1) * pitch;
    g += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + rows * cell}" stroke="#e4e4e4" stroke-width="0.2"/>`;
    if (k === 0) g += `<line x1="${x + pitch}" y1="${y0}" x2="${x + pitch}" y2="${y0 + rows * cell}" stroke="#e4e4e4" stroke-width="0.2"/>`;
    col.chars.forEach((ch, r) => {
      g += `<text x="${(x + pitch / 2).toFixed(2)}" y="${(y0 + (r + 0.5) * cell).toFixed(2)}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central" fill="${gray}" font-family="${fontFamily}">${svgEscape(ch)}</text>`;
    });
    if (col.first && titles[col.entryId]) {
      g += `<text x="${(x + pitch / 2).toFixed(2)}" y="${y0 - 2.5}" font-size="3.2" text-anchor="middle" fill="#777" font-family="${fontFamily}">${svgEscape(titles[col.entryId])}</text>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" class="sheet-svg">${rulerSvg(M, M + 3)}${g}</svg>`;
}

// ====== 英文頁（A4 直向 210×297，只有灰色字，沒有格線）======
// 行距 12mm、字 6mm：一頁約 21 行、每行約 60 字元，一天寫 3 行 ≈ 一週一張。
const EN_PAGE = { W: 210, H: 297, M: 14, HEADER: 12, PITCH: 12, FONT_RATIO: 0.5 };

function enGeometry(pitch = EN_PAGE.PITCH) {
  return {
    lines: Math.floor((EN_PAGE.H - 2 * EN_PAGE.M - EN_PAGE.HEADER) / pitch),
    fontSize: Math.round(pitch * EN_PAGE.FONT_RATIO * 100) / 100,
    width: EN_PAGE.W - 2 * EN_PAGE.M,
  };
}

function renderEnSvg({ lines, gray = PRACTICE_GRAYS.medium, header = "", fontFamily = "sans-serif", pitch = EN_PAGE.PITCH }) {
  const { W, H, M, HEADER } = EN_PAGE;
  const { fontSize } = enGeometry(pitch);
  const y0 = M + HEADER;
  let g = "";
  lines.forEach((ln, i) => {
    // 基線放在每行間距的 65% 處，字上下留白平均
    g += `<text x="${M}" y="${(y0 + i * pitch + pitch * 0.65).toFixed(2)}" font-size="${fontSize}" fill="${gray}" font-family="${fontFamily}">${svgEscape(ln.text)}</text>`;
  });
  const head = `<text x="${W - M}" y="${M + 3}" font-size="3.2" text-anchor="end" fill="#777" font-family="sans-serif">${svgEscape(header)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" class="sheet-svg">${rulerSvg(M, M + 3)}${head}${g}</svg>`;
}
