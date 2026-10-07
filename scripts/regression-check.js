// 關鍵邏輯的回歸檢查：node scripts/regression-check.js
// 沒有測試框架，直接把前端／後端的原始碼載進 vm 跑（DOM 用萬用替身，Apps Script 服務用假物件），
// 檢查「改過會壞」的純邏輯：數字解析、跳脫、連續天數、寫入防護、驗血項目驗證。
// 登入、日期切換、匯入的畫面流程需要瀏覽器，見 README「回歸檢查清單」。
process.env.TZ = "Asia/Taipei"; // 行事曆測試的日期運算以台北時間為準
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok  " + name);
  else { failed++; console.log("FAIL  " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}

// ---- 前端：萬用 DOM 替身 ----
const stub = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "length" ? 0 : stub),
  apply: () => stub, construct: () => stub, set: () => true,
});
function loadFrontend(files, cutAt, fixedNow) {
  const store = {};
  const ctx = {
    document: stub, window: {}, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
    location: stub, performance: { now: () => 0 }, console, URL, fetch: () => Promise.reject(new Error("no network in tests")),
    setTimeout, clearTimeout, Intl, Date: fixedNow ? class extends Date { constructor(...a) { super(...(a.length ? a : [fixedNow])); } static now() { return new Date(fixedNow).getTime(); } } : Date, Math, JSON, Set, Map, Promise, Object, Array, String, Number,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  files.forEach(f => {
    let src = read(f);
    if (cutAt && src.includes(cutAt)) src = src.slice(0, src.indexOf(cutAt));
    vm.runInContext(src, ctx, { filename: f });
  });
  return ctx;
}

console.log("前端：數字解析與跳脫");
const charts = loadFrontend(["shared.js", "health-charts.js"], "// ====== Auth flow");
check('"1,000" → 1000', charts.parseStrictNumber("1,000") === 1000);
check('"12abc" → null（不能截成 12）', charts.parseStrictNumber("12abc") === null);
check('" 3.5 " → 3.5', charts.parseStrictNumber(" 3.5 ") === 3.5);
check('"" → null', charts.parseStrictNumber("") === null);
check('"1,0" → null', charts.parseStrictNumber("1,0") === null);
check("escapeHtml 跳脫標籤與引號", charts.escapeHtml('<img onerror="x">&\'') === "&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;");

console.log("前端：習慣連續天數");
const app = loadFrontend(["shared.js", "app.js"], "// ====== Boot ======");
const day = off => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + off); return app.toDateStr(d); };
// let/const 宣告的頂層變數不會變成 context 的屬性，要在 context 裡執行程式碼才讀得到
app.__logs = [];
function streakFor(doneOffsets, workdaysOnly) {
  app.__logs = doneOffsets.map(o => ({ habitId: "h", periodKey: day(o), count: 1 }));
  vm.runInContext("state.holidayDates = new Set(); state.habitLogs = __logs;", app);
  return app.computeStreak({ id: "h", target: 1, workdaysOnly });
}
check("每日：今天沒做，昨天起連續 3 天 = 3", streakFor([-1, -2, -3], false) === 3);
check("每日：前天漏做就斷", streakFor([0, -2, -3], false) === 1);
// 固定「今天」= 2026-10-04（週日）：週五 10/2 漏做，週四 10/1、週三 9/30 有做 → 連續天數必須是 0
{
  const sun = loadFrontend(["shared.js", "app.js"], "// ====== Boot ======", "2026-10-04T12:00:00");
  sun.__logs = [{ habitId: "h", periodKey: "2026-10-01", count: 1 }, { habitId: "h", periodKey: "2026-09-30", count: 1 }];
  vm.runInContext("state.holidayDates = new Set(); state.habitLogs = __logs;", sun);
  check("僅工作日、週日打開：週五漏做不能被當寬限（連續 0）", sun.computeStreak({ id: "h", target: 1, workdaysOnly: true }) === 0);
  sun.__logs.push({ habitId: "h", periodKey: "2026-10-02", count: 1 });
  vm.runInContext("state.habitLogs = __logs;", sun);
  check("僅工作日、週日打開：週五、週四、週三都做 = 3", sun.computeStreak({ id: "h", target: 1, workdaysOnly: true }) === 3);
}


console.log("前端：每週／每月連續統計");
{
  // 固定「今天」= 2026-10-05（週一）。本週 key = 2026-10-05，上週 = 2026-09-28，以此類推
  const mon = loadFrontend(["shared.js", "app.js"], "// ====== Boot ======", "2026-10-05T12:00:00");
  const setLogs = (logs) => { mon.__logs = logs; vm.runInContext("state.habitLogs = __logs; state.holidayDates = new Set();", mon); };
  const wk = (key, count) => ({ habitId: "w", periodKey: key, count });
  const weekly = { id: "w", frequency: "weekly", target: 3 };
  const weeks = ["2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31"];
  setLogs([wk(weeks[1], 3), wk(weeks[2], 3), wk(weeks[3], 3)]);
  check("週：本週未達標不算斷，前三週達標 = 3", mon.computePeriodStreak(weekly) === 3);
  setLogs([wk(weeks[0], 3), wk(weeks[1], 3)]);
  check("週：本週達標也算進去 = 2", mon.computePeriodStreak(weekly) === 2);
  setLogs([wk(weeks[1], 3), wk(weeks[2], 2), wk(weeks[3], 3)]);
  check("週：中間漏一週就斷 = 1", mon.computePeriodStreak(weekly) === 1);
  setLogs([wk(weeks[1], 3), wk(weeks[2], 2), wk(weeks[3], 3), wk(weeks[4], 3), wk(weeks[5], 3)]);
  check("週：歷史最長可以大於目前（3 對 1）", mon.computePeriodStats(weekly).longest === 3 && mon.computePeriodStreak(weekly) === 1);
  check("previousPeriodKey 週：跨月", mon.previousPeriodKey(weekly, "2026-10-05") === "2026-09-28");

  const monthly = { id: "m", frequency: "monthly", target: 2 };
  const mo = (key, count) => ({ habitId: "m", periodKey: key, count });
  check("previousPeriodKey 月：1 月 → 前一年 12 月", mon.previousPeriodKey(monthly, "2026-01") === "2025-12");
  check("previousPeriodKey 月：3 月 → 2 月", mon.previousPeriodKey(monthly, "2026-03") === "2026-02");
  setLogs([mo("2026-09", 2), mo("2026-08", 2), mo("2026-07", 2)]);
  check("月：本月未達標，前三個月達標 = 3", mon.computePeriodStreak(monthly) === 3);
  setLogs([mo("2026-10", 2), mo("2026-09", 2), mo("2026-08", 1)]);
  check("月：本月達標、上月達標、再前一月未達標 = 2", mon.computePeriodStreak(monthly) === 2);
  setLogs([mo("2025-12", 2), mo("2026-01", 2), mo("2026-02", 2)]);
  const st = mon.computePeriodStats(monthly);
  check("月：歷史最長跨年 = 3、今年達標 2 個月", st.longest === 3 && st.extra === 2, st);
  const hist = mon.getPeriodHistory(weekly, 6);
  check("getPeriodHistory：6 期、最後一個是本期", hist.length === 6 && hist[5].current && hist[5].key === "2026-10-05" && hist[0].key === "2026-08-31", hist.map(h => h.key));
}

console.log("後端：數字解析、驗血項目驗證、公式防護");
const calls = { formats: [], rows: [], locks: 0, unlocks: 0 };
const gs = {
  Utilities: { getUuid: () => "uuid", formatDate: () => "d" },
  LockService: { getScriptLock: () => ({ waitLock: () => { calls.locks++; }, releaseLock: () => { calls.unlocks++; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => "secret" }) },
  ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
  CacheService: {}, CalendarApp: {}, SpreadsheetApp: {}, Logger: { log() {} },
};
const be = vm.createContext(Object.assign({ console, Date, JSON, Object, String, Number, isNaN, isFinite, Error }, gs));
vm.runInContext(read("apps-script/Code.gs"), be, { filename: "Code.gs" });
check('後端 "1,000" → 1000', be.parseNumStrict_("1,000") === 1000);
check('後端 "12abc" → NaN', Number.isNaN(be.parseNumStrict_("12abc")));
check("後端 空白 → null", be.parseNumStrict_("") === null && be.parseNumStrict_(undefined) === null);
check("公式開頭會被偵測", ["=1+1", "+1", "-1", "@SUM(A1)"].every(be.needsTextGuard_) && !be.needsTextGuard_("鉀 K"));
const fakeSheet = {
  getLastRow: () => 4,
  getRange: (r, c, nr, nc) => ({
    setNumberFormat: f => { calls.formats.push([r, c, f]); },
    setValues: v => { calls.rows.push([r, c, v]); },
    setValue: v => { calls.rows.push([r, c, v]); },
  }),
};
be.appendRowSafe_(fakeSheet, ["id", "=HYPERLINK(\"x\")", "正常", 12]);
check("appendRowSafe_：只有公式那格設成純文字格式", calls.formats.length === 1 && calls.formats[0][1] === 2 && calls.formats[0][2] === "@", calls.formats);
check("appendRowSafe_：寫在最後一列的下一列", calls.rows[0][0] === 5);
const norm = be.normalizeLabExtras_([{ name: "X", value: "1,000", unit: "u" }, { name: "X", value: 7 }, { name: "  ", value: 1 }]);
check("驗血其他項目：同名去重（最後一筆為準）、千分位", norm.order.length === 1 && norm.byName.X.value === 7, norm);
let threw = false;
try { be.normalizeLabExtras_([{ name: "Y", value: "abc" }]); } catch (e) { threw = true; }
check("驗血其他項目：無效數值丟錯、不寫入", threw);

const throws = f => { try { f(); return false; } catch (e) { return true; } };
check("numArg_：千分位 1,000 → 1000", be.numArg_("1,000", "金額") === 1000);
check("numArg_：abc 丟錯（不是存成 0）", throws(() => be.numArg_("abc", "金額")));
check("numArg_：必填空白丟錯；emptyValue 空白回傳預設", throws(() => be.numArg_("", "帳單全額")) && be.numArg_("", "最低", { emptyValue: 0 }) === 0);
check("numArg_：整數、範圍檢查", throws(() => be.numArg_("1.5", "次數", { int: true })) && throws(() => be.numArg_("40", "星期", { max: 6 })) && throws(() => be.numArg_("-1", "金額", { min: 0 })));
check("所有金額寫入入口都用 numArg_（Code.gs 不再有 parseFloat/parseInt 解析輸入）", !/parseFloat\(|parseInt\(/.test(read("apps-script/Code.gs").replace(/\/\/.*$/gm, "")));

console.log("練字字帖：版面計算（practice-layout.js）");
{
  const L = vm.createContext({ console, Math, Array, String, Number, Set, Object });
  vm.runInContext(read("practice-layout.js"), L, { filename: "practice-layout.js" });
  const E = (id, text, title = id) => ({ id, title, author: "", text });
  check("zhClauses：依標點與換行切句，空白去掉、標點不留", JSON.stringify(L.zhClauses("床前明月光，疑是地上霜。\n舉頭 望明月，低頭思故鄉。")) === JSON.stringify(["床前明月光", "疑是地上霜", "舉頭望明月", "低頭思故鄉"]));
  let r = L.packZhColumns({ entries: [E("a", "床前明月光，疑是地上霜。舉頭望明月，低頭思故鄉。")], rows: 14, maxCols: 15 });
  check("packZh：五言絕句每欄 14 字 → 兩句一欄（10 字）× 2 欄，不會是 15 + 5", r.columns.length === 2 && r.columns.every(c => c.chars.length === 10), r.columns.map(c => c.chars.join("")));
  r = L.packZhColumns({ entries: [E("a", "白日依山盡，黃河入海流。欲窮千里目，更上一層樓。")], rows: 20, maxCols: 15 });
  check("packZh：每欄 20 字時一首五絕剛好一欄（對照使用者的字帖）", r.columns.length === 1 && r.columns[0].chars.length === 20);
  r = L.packZhColumns({ entries: [E("a", "朝辭白帝彩雲間，千里江陵一日還。兩岸猿聲啼不住，輕舟已過萬重山。")], rows: 14, maxCols: 15 });
  check("packZh：七言絕句兩句一欄 14 字 × 2 欄", r.columns.length === 2 && r.columns.every(c => c.chars.length === 14));
  r = L.packZhColumns({ entries: [E("a", "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸")], rows: 8, maxCols: 10 });
  check("packZh：超過一欄的長句才拆（20 字、每欄 8 → 3 欄）", r.columns.length === 3 && r.columns[2].chars.length === 4);
  r = L.packZhColumns({ entries: [E("a", "甲甲甲甲甲，乙乙乙乙乙。丙丙丙丙丙，丁丁丁丁丁。")], rows: 5, maxCols: 3 });
  check("packZh：第一篇排不完時，欄數用完就停，next 指到下一個沒排的子句", r.columns.length === 3 && r.next && r.next.id === "a" && r.next.clauseIndex === 3 && r.used.length === 1, r);
  r = L.packZhColumns({ entries: [E("a", "甲甲甲，乙乙乙。"), E("b", "丙丙丙丙丙丙，丁丁丁丁丁丁。戊戊戊戊戊戊，己己己己己己。"), E("c", "庚庚庚，辛辛辛。")], rows: 6, maxCols: 3 });
  check("packZh：第二篇起整篇排不進剩下的欄數就跳過（不切到一半），改排後面放得下的", r.used.map(u => u.id).join() === "a,c" && r.columns.length === 2 && r.next === null, r);
  r = L.packZhColumns({ entries: [E("a", "甲甲甲，乙乙乙。丙丙丙，丁丁丁。")], startClause: 2, rows: 8, maxCols: 5 });
  check("packZh：startClause 從指定子句接著排", r.columns[0].chars.join("") === "丙丙丙丁丁丁", r.columns);
  r = L.packZhColumns({ entries: [E("a", "甲甲甲，乙乙乙。"), E("b", "丙丙丙，丁丁丁。")], rows: 14, maxCols: 5 });
  check("packZh：不同篇不接在同一欄、每篇第一欄有 first 標記", r.columns.length === 2 && r.columns.every(c => c.first) && r.used.length === 2);
  check("zhEntryColumns：跟實際排版欄數一致（五絕 2、七律 4、20 字句每欄 8 = 3）", L.zhEntryColumns(["床前明月光", "疑是地上霜", "舉頭望明月", "低頭思故鄉"], 14) === 2 && L.zhEntryColumns(Array(8).fill("七七七七七七七"), 14) === 4 && L.zhEntryColumns(["一".repeat(20)], 8) === 3);
  const g = L.zhGeometry();
  check("zhGeometry：每欄 14 字 → 格高 12.7mm、字 10.4mm、欄距 17.8mm、一頁 15 欄（≈ 7 首絕句 = 一週）", g.cell === 12.7 && g.fontSize === 10.41 && g.pitch === 17.8 && g.sheetCols === 15, g);
  check("zhLabel：取「・」前面、最多 7 字", L.zhLabel("水調歌頭・明月幾時有") === "水調歌頭" && L.zhLabel("黃鶴樓送孟浩然之廣陵") === "黃鶴樓送孟浩然…");

  const measure = (t) => t.length * 2; // 一個字元 2mm
  let w = L.wrapEnLines({ entries: [E("a", "aaa bbb ccc ddd eee")], maxLines: 10, maxWidth: 16, measure });
  check("wrapEn：依單字換行（每行最多 8 字元）", JSON.stringify(w.lines.map(l => l.text)) === JSON.stringify(["aaa bbb", "ccc ddd", "eee"]), w.lines);
  w = L.wrapEnLines({ entries: [E("a", "aaa bbb ccc ddd eee")], maxLines: 2, maxWidth: 16, measure });
  check("wrapEn：行數用完就停，next 指到下一個單字", w.lines.length === 2 && w.next && w.next.wordIndex === 4, w);
  w = L.wrapEnLines({ entries: [E("a", "one two three four five six")], startWord: 3, maxLines: 5, maxWidth: 200, measure });
  check("wrapEn：startWord 從指定單字接著排", w.lines[0].text === "four five six");
  w = L.wrapEnLines({ entries: [E("a", "one two\nthree four")], maxLines: 5, maxWidth: 200, measure });
  check("wrapEn：段落（換行）另起一行", w.lines.length === 2 && w.lines[1].text === "three four");
  w = L.wrapEnLines({ entries: [E("a", "aaa bbb"), E("b", "ccc ddd eee fff ggg hhh iii jjj kkk"), E("c", "lll")], maxLines: 3, maxWidth: 16, measure });
  check("wrapEn：第二篇起整篇排不進剩下行數就跳過", w.used.map(u => u.id).join() === "a,c" && w.lines.length === 2 && w.next === null, w);
  const entries = ["a", "b", "c", "d"].map(id => E(id, "x"));
  const order = L.pickOrder(entries, ["a", "b"], () => 0);
  check("pickOrder：沒用過的排前面、最近用過的排後面", order.slice(0, 2).every(e => ["c", "d"].includes(e.id)) && order.slice(2).every(e => ["a", "b"].includes(e.id)), order.map(e => e.id));

  const svgZh = L.renderZhSvg({ columns: [{ chars: ["床", "前"], entryId: "a", first: true }, { chars: ["明"], entryId: "a", first: false }], titles: { a: "靜夜思<b>" } });
  check("renderZhSvg：沒有格線（只有淡淡的欄線、沒有 rect 格子）、字有畫出來、標題只在第一欄且有跳脫", !svgZh.includes("<rect") && !svgZh.includes("stroke-dasharray") && svgZh.includes(">床<") && (svgZh.match(/靜夜思&lt;b&gt;/g) || []).length === 1 && svgZh.includes('width="297mm"'));
  const svgEn = L.renderEnSvg({ lines: [{ text: "Hello & bye" }], header: "A <b>" });
  check("renderEnSvg：只有灰色文字、沒有任何四線格；文字有跳脫", svgEn.includes("Hello &amp; bye") && svgEn.includes("A &lt;b&gt;") && !svgEn.includes("stroke-dasharray") && svgEn.includes('height="297mm"'));
  const ge = L.enGeometry();
  check("enGeometry：行距 12mm → 一頁 21 行、字 6mm", ge.lines === 21 && ge.fontSize === 6, ge);
}
const seed = JSON.parse(read("data/copybook-seed.json"));
check("內建範例：每篇都有 lang/title/text，zh 與 en 都有，且沒有重複標題", seed.length > 30 && seed.every(e => ["zh", "en"].includes(e.lang) && e.title && e.text) && new Set(seed.map(e => e.lang + e.title)).size === seed.length);

console.log("後端：欄位型別驗證（文字／日期／時間／列舉）");
check("dateArg_：2026-02-30 無效、2026-02-28 有效", throws(() => be.dateArg_("2026-02-30", "x")) && be.dateArg_("2026-02-28", "x") === "2026-02-28");
check("dateArg_：optional 空白通過，必填空白丟錯", be.dateArg_("", "x", { optional: true }) === "" && throws(() => be.dateArg_("", "x")));
check("monthArg_ / timeArg_", be.monthArg_("2026-10", "x") === "2026-10" && throws(() => be.monthArg_("2026-13", "x")) && be.timeArg_("", "x") === "" && be.timeArg_("08:30", "x") === "08:30" && throws(() => be.timeArg_("25:00", "x")));
check("enumArg_：不在清單丟錯；空白可給預設", throws(() => be.enumArg_("x", "對象", ["me"])) && be.enumArg_("", "對象", ["me"], { emptyValue: "" }) === "");
check("textArg_：必填、長度上限、trim", throws(() => be.textArg_("  ", "標題", { required: true })) && throws(() => be.textArg_("a".repeat(11), "標題", { max: 10 })) && be.textArg_("  hi ", "標題") === "hi");
{
  const rows = [];
  const sheet = { getDataRange: () => ({ getValues: () => [["id"]] }), getLastRow: () => 1, getRange: (r, c, nr, nc) => ({ setNumberFormat() {}, setValues: v => rows.push(v[0]) }) };
  gs.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sheet });
  be.SpreadsheetApp.getActiveSpreadsheet = gs.SpreadsheetApp.getActiveSpreadsheet;
  be.addEvent("2026-10-05", "08:30", "看牙醫", "備註", "me", "1,200", "false");
  check("addEvent：欄位依型別寫入（金額 1,200 → 1200、owner/時間正確）", rows[0] && rows[0][1] === "2026-10-05" && rows[0][2] === "me" && rows[0][3] === "08:30" && rows[0][7] === 1200 && rows[0][8] === false, rows[0]);
  check("addEvent：壞日期／壞金額／空標題都丟錯且不寫入",
    (() => { const n = rows.length; return throws(() => be.addEvent("2026/10/05", "", "x", "", "me", "", "")) && throws(() => be.addEvent("2026-10-05", "", "x", "", "me", "abc", "")) && throws(() => be.addEvent("2026-10-05", "", " ", "", "me", "", "")) && rows.length === n; })());
  check("addCreditCardBill：銀行必填、月份格式、金額 abc 丟錯", throws(() => be.addCreditCardBill("", "2026-10", "2026-10-20", "100", "")) && throws(() => be.addCreditCardBill("國泰", "2026-10-01", "2026-10-20", "100", "")) && throws(() => be.addCreditCardBill("國泰", "2026-10", "2026-10-20", "abc", "")));
}

console.log("後端：練字內容庫");
{
  const rows2 = [];
  const existing = [["id", "lang", "title", "author", "text", "createdAt"]];
  const sheet2 = { getDataRange: () => ({ getValues: () => existing.map(r => r.slice()) }), getLastRow: () => existing.length, getRange: () => ({ setNumberFormat() {}, setValues: v => { rows2.push(v[0]); existing.push(v[0]); } }) };
  be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sheet2 });
  const res1 = be.importCopybookEntries(JSON.stringify([{ lang: "zh", title: "靜夜思", author: "李白", text: "床前明月光\r\n疑是地上霜" }]));
  check("importCopybookEntries：寫入一列，換行統一成 \\n", res1.added === 1 && rows2[0][1] === "zh" && rows2[0][4] === "床前明月光\n疑是地上霜", rows2[0]);
  const before = rows2.length;
  const res = be.importCopybookEntries(JSON.stringify([{ lang: "zh", title: "靜夜思", text: "x" }, { lang: "zh", title: "春曉", text: "春眠不覺曉" }]));
  check("importCopybookEntries：重複的略過、新的加入（可重複執行）", res.added === 1 && res.skipped === 1 && rows2.length === before + 1, res);
  check("importCopybookEntries：壞語言、空篇名、空內容、過長都丟錯", throws(() => be.importCopybookEntries(JSON.stringify([{ lang: "fr", title: "a", text: "x" }]))) && throws(() => be.importCopybookEntries(JSON.stringify([{ lang: "en", title: " ", text: "x" }]))) && throws(() => be.importCopybookEntries(JSON.stringify([{ lang: "en", title: "a", text: " " }]))) && throws(() => be.importCopybookEntries(JSON.stringify([{ lang: "en", title: "a", text: "x".repeat(8001) }]))));
  check("importCopybookEntries：有一筆不合格就整批不寫", (() => { const n = rows2.length; return throws(() => be.importCopybookEntries(JSON.stringify([{ lang: "zh", title: "新的", text: "x" }, { lang: "zh", title: "", text: "x" }]))) && rows2.length === n; })());
  check("importCopybookEntries：不是 JSON／空陣列丟錯", throws(() => be.importCopybookEntries("not json")) && throws(() => be.importCopybookEntries("[]")));
}

console.log("後端：同步到 Google 行事曆（對帳）");
{
  const ev = (o) => Object.assign({ id: "e1", date: "2026-10-10", time: "", title: "看牙醫", owner: "me", notes: "", hideFromCalendar: false }, o);
  const rule = (o) => Object.assign({ id: "r1", owner: "shared", title: "打球", time: "19:00", notes: "", frequency: "weekly", dayOfWeek: 3, dayOfMonth: "", endDate: "" }, o);
  const today = "2026-10-07"; // 週三
  let d = be.desiredCalendarEvents_([ev({}), ev({ id: "e2", time: "08:30", owner: "林萌", title: "打疫苗", notes: "地圖連結" }), ev({ id: "e3", hideFromCalendar: true }), ev({ id: "e4", date: "2026-09-01" })], [], [], today);
  check("desired：一次性事件（owner 標籤、有時間／全天、備註）；記帳用與太舊的不同步", d.length === 2 && d[0].title === "[承承] 看牙醫" && d[0].time === "" && d[1].title === "[林萌] 打疫苗" && d[1].time === "08:30" && d[1].description === "地圖連結", d);
  d = be.desiredCalendarEvents_([], [rule({})], [], today);
  check("desired：每週三循環展開成單次（視窗 −7 ～ +120 天）、key 含規則 id 與日期", d.length >= 17 && d.length <= 19 && d.every(x => x.key.startsWith("r:r1:") && be.calWeekday_(x.date) === 3 && x.title === "[一起] 打球" && x.time === "19:00"), d.length);
  d = be.desiredCalendarEvents_([], [rule({ endDate: "2026-10-14" })], [{ recurringId: "r1", date: "2026-10-07" }], today);
  check("desired：截止日當天含、之後不展開；跳過日被扣掉", d.map(x => x.date).join() === "2026-09-30,2026-10-14", d.map(x => x.date));
  d = be.desiredCalendarEvents_([], [rule({ frequency: "monthly", dayOfWeek: "", dayOfMonth: 15, time: "" })], [], today);
  check("desired：每月 15 號（沒時間 = 全天）", d.length >= 4 && d.every(x => x.date.endsWith("-15") && x.time === ""), d.map(x => x.date));
  check("calAddDays_：跨月跨年", be.calAddDays_("2026-12-31", 1) === "2027-01-01" && be.calAddDays_("2026-03-01", -1) === "2026-02-28");

  const D = (key, over) => Object.assign({ key, title: "t", date: "2026-10-10", time: "", description: "" }, over);
  let plan = be.planCalendarSync_([D("a"), D("b", { title: "新" }), D("c")], [{ key: "a", title: "t", date: "2026-10-10", time: "", description: "" }, { key: "b", title: "舊", date: "2026-10-10", time: "", description: "" }, { key: "z", title: "t", date: "2026-10-10", time: "", description: "" }]);
  check("plan：沒變的略過、標題變了更新、新的建立、App 已刪除的移除", plan.unchanged === 1 && plan.update.length === 1 && plan.create.length === 1 && plan.create[0].key === "c" && plan.del.length === 1 && plan.del[0].key === "z", plan);
  plan = be.planCalendarSync_([D("a")], [{ key: "a", title: "t", date: "2026-10-10", time: "", description: "" }]);
  check("plan：完全相同不產生任何動作（冪等）", !plan.create.length && !plan.update.length && !plan.del.length && plan.unchanged === 1);
  plan = be.planCalendarSync_([D("a")], [{ key: "a", title: "t", date: "2026-10-10", time: "", description: "" }, { key: "a", title: "t", date: "2026-10-10", time: "", description: "" }]);
  check("plan：同一個 key 重複出現，多的刪掉", plan.del.length === 1 && plan.unchanged === 1);

  // 假的 CalendarApp：事件物件、getEvents、createEvent、createAllDayEvent
  be.Session = { getScriptTimeZone: () => "Asia/Taipei" };
  be.Utilities.formatDate = (date, tz, fmt) => { const t = new Date(date.getTime() + 8 * 3600000).toISOString(); return fmt === "HH:mm" ? t.slice(11, 16) : t.slice(0, 10); };
  const calEvents = [];
  const mkEvent = (title, start, allDay, desc) => {
    const e = { title, start, allDay, desc: desc || "", tag: null, deleted: false };
    return Object.assign(e, {
      getTag: () => e.tag, setTag: (k, v) => { e.tag = v; }, isAllDayEvent: () => e.allDay, getTitle: () => e.title, getAllDayStartDate: () => e.start,
      getStartTime: () => e.start, getDescription: () => e.desc, setTitle: v => { e.title = v; }, setDescription: v => { e.desc = v; },
      setTime: s => { e.start = s; }, setAllDayDate: s => { e.start = s; }, deleteEvent: () => { e.deleted = true; },
    });
  };
  const fakeCal = {
    getEvents: () => calEvents.filter(e => !e.deleted),
    createEvent: (title, start, end, o) => { const e = mkEvent(title, start, false, o.description); calEvents.push(e); return e; },
    createAllDayEvent: (title, day, o) => { const e = mkEvent(title, day, true, o.description); calEvents.push(e); return e; },
  };
  const manual = mkEvent("太太自己加的", new Date("2026-10-12T10:00:00+08:00"), false); calEvents.push(manual); // 沒有標記
  const data = { events: [ev({ time: "08:30" }), ev({ id: "e2", date: "2026-10-11", title: "全天" })], rules: [], exceptions: [] };
  let res = be.reconcileWith_(fakeCal, data, today, true);
  check("乾跑：只算不動（行事曆上沒有新增事件）", res.dryRun && res.created === 2 && calEvents.length === 1);
  res = be.reconcileWith_(fakeCal, data, today, false);
  const synced = calEvents.filter(e => e.tag && !e.deleted);
  check("對帳：建立 2 個、帶標記，定時事件是 08:30 起（台灣時間）、全天事件是全天", res.created === 2 && synced.length === 2 && synced.find(e => e.tag === "e:e1").start.getTime() === new Date("2026-10-10T08:30:00+08:00").getTime() && synced.find(e => e.tag === "e:e2").allDay === true);
  res = be.reconcileWith_(fakeCal, data, today, false);
  check("再對帳一次：沒有任何動作（冪等）", res.created === 0 && res.updated === 0 && res.deleted === 0 && res.unchanged === 2, res);
  data.events[0].title = "看牙醫（改）"; data.events[0].time = "";
  data.events.splice(1, 1);
  res = be.reconcileWith_(fakeCal, data, today, false);
  const alive = calEvents.filter(e => !e.deleted);
  check("App 改標題＋定時改全天（刪掉重建）、刪除事件 → 行事曆跟著變；別人手動加的事件不被動到", res.updated === 1 && res.deleted === 1 && alive.some(e => e.tag === "e:e1" && e.allDay && e.title === "[承承] 看牙醫（改）") && !alive.some(e => e.tag === "e:e2") && !manual.deleted, res);
  check("保險：資料表空卻要刪一大堆事件 → 中止，不清空行事曆", (() => { for (let i = 0; i < 6; i++) { const e = mkEvent("x" + i, new Date("2026-10-20T10:00:00+08:00"), false); e.tag = "z:" + i; calEvents.push(e); } return throws(() => be.reconcileWith_(fakeCal, { events: [], rules: [], exceptions: [] }, today, false)); })());
  // 狀態與旗標
  const propStore = {};
  const origProps = be.PropertiesService.getScriptProperties;
  be.PropertiesService.getScriptProperties = () => ({ getProperty: k => (k in propStore ? propStore[k] : null), setProperty: (k, v) => { propStore[k] = v; }, deleteProperty: k => { delete propStore[k]; } });
  check("沒設定 CALENDAR_ID：功能關閉，寫入也不會設旗標", be.getCalendarSyncStatus().enabled === false && (be.markCalendarDirty_(), !propStore.CAL_DIRTY));
  propStore.CALENDAR_ID = "cal-id";
  be.markCalendarDirty_();
  check("設定 CALENDAR_ID 後：寫入會設待同步旗標，狀態可讀", propStore.CAL_DIRTY === "1" && be.getCalendarSyncStatus().enabled && be.getCalendarSyncStatus().dirty);
  const codeGs = read("apps-script/Code.gs");
  const bodyOf = (fn) => { const i = codeGs.indexOf("function " + fn + "("); return codeGs.slice(i, codeGs.indexOf("\n}\n", i)); };
  check("寫入 Events／循環行程／跳過日的 7 個函式都會標記待同步（改花費金額不用）", ["addEvent", "deleteEvent", "addRecurringEvent", "setRecurringEndDate", "deleteRecurringEvent", "addRecurringException", "deleteRecurringException"].every(fn => bodyOf(fn).includes("markCalendarDirty_();")) && !bodyOf("setEventAmount").includes("markCalendarDirty_"));
  be.PropertiesService.getScriptProperties = origProps; // 後面的傳輸測試要用原本的密碼屬性
}

console.log("後端：傳輸與寫入鎖");
const out = o => JSON.parse(o.text);
check("GET 一律拒絕", out(be.doGet({ parameter: { action: "getData", password: "secret" } })).error === "請改用 POST");
check("POST body 不是 JSON → bad request", out(be.doPost({ postData: { contents: "not json" } })).error === "bad request");
check("POST 密碼錯 → unauthorized，且不取鎖", (() => { calls.locks = 0; const r = out(be.doPost({ postData: { contents: JSON.stringify({ action: "addGoal", password: "x" }) } })); return r.error === "unauthorized" && calls.locks === 0; })());
check("寫入 action 會取鎖並釋放；get 不取鎖", (() => {
  calls.locks = 0; calls.unlocks = 0;
  out(be.doPost({ postData: { contents: JSON.stringify({ action: "nope", password: "secret" }) } }));
  const afterWrite = [calls.locks, calls.unlocks];
  calls.locks = 0; calls.unlocks = 0;
  out(be.doPost({ postData: { contents: JSON.stringify({ action: "getNope", password: "secret" }) } }));
  return afterWrite[0] === 1 && afterWrite[1] === 1 && calls.locks === 0;
})());

console.log(failed ? `\n${failed} 項失敗` : "\n全部通過");
process.exit(failed ? 1 : 0);
