// 關鍵邏輯的回歸檢查：node scripts/regression-check.js
// 沒有測試框架，直接把前端／後端的原始碼載進 vm 跑（DOM 用萬用替身，Apps Script 服務用假物件），
// 檢查「改過會壞」的純邏輯：數字解析、跳脫、連續天數、寫入防護、驗血項目驗證。
// 登入、日期切換、匯入的畫面流程需要瀏覽器，見 README「回歸檢查清單」。
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
