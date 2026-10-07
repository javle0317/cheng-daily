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

console.log("語言練習連動：挑卡、標題、連結、禁止手動勾選");
const pick = be.pickLangEntry_;
check("pickLangEntry_：沒有進度 → null", pick({}) === null && pick(undefined) === null);
check("pickLangEntry_：優先未完成", pick({ en: { cardId: "a", done: true }, ja: { cardId: "b", done: false } }).cardId === "b");
check("pickLangEntry_：全完成 → 第一個", pick({ en: { cardId: "a", done: true }, ja: { cardId: "b", done: true } }).cardId === "a");
check("formatLangTitle_：語言標籤＋正面", be.formatLangTitle_({ lang: "ja", front: "あ行" }) === "日文・あ行");
check("formatLangTitle_：長文截斷、換行壓成空白", be.formatLangTitle_({ lang: "en", front: "a\n\nb" + "x".repeat(60) }).length <= 44 && !/\n/.test(be.formatLangTitle_({ lang: "en", front: "a\nb" })));
check("formatLangTitle_：沒有 front 只顯示語言", be.formatLangTitle_({ lang: "en", front: "" }) === "英文");
const st = { en: { cardId: "e2", lang: "en", front: "x", done: false }, ja: { cardId: "j2", lang: "ja", front: "y", done: true } };
check("resolveLangEntry_：cardId 相符就用它", be.resolveLangEntry_(st, "e2", "英文・x").cardId === "e2");
check("resolveLangEntry_：在 lingo 換卡 → 依標題語言找到新卡", be.resolveLangEntry_(st, "j1", "日文・あ行").cardId === "j2");
check("resolveLangEntry_：找不到 → null", be.resolveLangEntry_({}, "j1", "日文・あ行") === null);
check("toggleHabitLog：語言練習不能直接勾選", throws(() => be.toggleHabitLog(be.LANG_HABIT_ID, "2026-10-07", 1)));
check("前後端 LANG_HABIT_ID 一致", vm.runInContext("LANG_HABIT_ID", app) === be.LANG_HABIT_ID);
check("langPracticeUrl：?card= 並編碼", vm.runInContext('langPracticeUrl("a b")', app) === "https://javle0317.github.io/cheng-lingo/?card=a%20b");

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
  check("addEvent：結束時間要有開始時間、要晚於開始時間；有效的會寫入（列的最後一欄）", throws(() => be.addEvent("2026-10-05", "", "x", "", "me", "", "", "10:00")) && throws(() => be.addEvent("2026-10-05", "10:00", "x", "", "me", "", "", "09:00")) && throws(() => be.addEvent("2026-10-05", "10:00", "x", "", "me", "", "", "10:00")) && (be.addEvent("2026-10-05", "10:00", "有結束", "", "me", "", "", "11:30"), rows[rows.length - 1][9] === "11:30"), rows[rows.length - 1]);
  check("addCreditCardBill：銀行必填、月份格式、金額 abc 丟錯", throws(() => be.addCreditCardBill("", "2026-10", "2026-10-20", "100", "")) && throws(() => be.addCreditCardBill("國泰", "2026-10-01", "2026-10-20", "100", "")) && throws(() => be.addCreditCardBill("國泰", "2026-10", "2026-10-20", "abc", "")));
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
  d = be.desiredCalendarEvents_([ev({ time: "11:00" }), ev({ id: "e2", time: "11:00", endTime: "12:30" }), ev({ id: "e3", time: "23:30" }), ev({ id: "e4" })], [rule({ endTime: "21:00" })], [], today);
  check("desired：沒填結束時間 = 開始 + 1 小時；有填就用；晚上不跨日（23:30 → 23:59）；全天事件沒有結束時間",
    d[0].endTime === "12:00" && d[1].endTime === "12:30" && d[2].endTime === "23:59" && d[3].endTime === "" && d.filter(x => x.key.startsWith("r:")).every(x => x.endTime === "21:00"), d.slice(0, 4).map(x => x.endTime));
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
  const mkEvent = (title, start, allDay, desc, end) => {
    const e = { title, start, end: end || start, allDay, desc: desc || "", tag: null, deleted: false };
    return Object.assign(e, {
      getTag: () => e.tag, setTag: (k, v) => { e.tag = v; }, isAllDayEvent: () => e.allDay, getTitle: () => e.title, getAllDayStartDate: () => e.start,
      getStartTime: () => e.start, getEndTime: () => e.end, getDescription: () => e.desc, setTitle: v => { e.title = v; }, setDescription: v => { e.desc = v; },
      setTime: (s, en) => { e.start = s; e.end = en; }, setAllDayDate: s => { e.start = s; }, deleteEvent: () => { e.deleted = true; },
    });
  };
  const fakeCal = {
    getEvents: () => calEvents.filter(e => !e.deleted),
    createEvent: (title, start, end, o) => { const e = mkEvent(title, start, false, o.description, end); calEvents.push(e); return e; },
    createAllDayEvent: (title, day, o) => { const e = mkEvent(title, day, true, o.description); calEvents.push(e); return e; },
  };
  const manual = mkEvent("太太自己加的", new Date("2026-10-12T10:00:00+08:00"), false); calEvents.push(manual); // 沒有標記
  const data = { events: [ev({ time: "08:30" }), ev({ id: "e2", date: "2026-10-11", title: "全天" })], rules: [], exceptions: [] };
  let res = be.reconcileWith_(fakeCal, data, today, true);
  check("乾跑：只算不動（行事曆上沒有新增事件）", res.dryRun && res.created === 2 && calEvents.length === 1);
  res = be.reconcileWith_(fakeCal, data, today, false);
  const synced = calEvents.filter(e => e.tag && !e.deleted);
  check("對帳：建立 2 個、帶標記，定時事件是 08:30–09:30（台灣時間、預設 1 小時）、全天事件是全天", res.created === 2 && synced.length === 2 && synced.find(e => e.tag === "e:e1").start.getTime() === new Date("2026-10-10T08:30:00+08:00").getTime() && synced.find(e => e.tag === "e:e1").end.getTime() === new Date("2026-10-10T09:30:00+08:00").getTime() && synced.find(e => e.tag === "e:e2").allDay === true);
  data.events[0].endTime = "10:15";
  res = be.reconcileWith_(fakeCal, data, today, false);
  check("改結束時間 → 更新（用 setTime），行事曆上的結束時間變 10:15；再對帳一次沒有動作", res.updated === 1 && calEvents.find(e => e.tag === "e:e1" && !e.deleted).end.getTime() === new Date("2026-10-10T10:15:00+08:00").getTime() && be.reconcileWith_(fakeCal, data, today, false).updated === 0);
  data.events[0].endTime = ""; data.events[0].time = "08:30"; be.reconcileWith_(fakeCal, data, today, false);
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

console.log("後端：編輯事件／循環行程（依表頭寫回）");
{
  const writes = [];
  const evHeaders = ["id", "date", "owner", "time", "title", "notes", "createdAt", "amount", "hideFromCalendar", "endTime"];
  const sheets = {
    Events: { values: [evHeaders, ["e1", "2026-10-10", "me", "08:30", "舊標題", "", "", "", false, ""]] },
    ShoppingList: { values: [["id", "item", "done", "createdAt", "category"], ["s1", "牛奶", false, "", "shopping"]] },
    RecurringEvents: { values: [["id", "owner", "title", "time", "notes", "frequency", "dayOfWeek", "dayOfMonth", "createdAt", "endDate", "endTime"], ["r1", "me", "打球", "19:00", "", "weekly", 3, "", "", "", ""]] },
  };
  Object.keys(sheets).forEach(name => {
    const sh = sheets[name];
    sh.getDataRange = () => ({ getValues: () => sh.values.map(r => r.slice()) });
    sh.getLastRow = () => sh.values.length;
    sh.getRange = (r, c) => ({ setNumberFormat() {}, setValue: v => writes.push({ name, row: r, col: c, v }), setValues() {} });
  });
  be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: n => sheets[n] });
  const col = (name, h) => sheets[name].values[0].indexOf(h) + 1;
  const wrote = (name, h) => { const w = writes.filter(x => x.name === name && x.col === col(name, h)); return w.length ? w[w.length - 1].v : undefined; };
  be.updateEvent({ id: "e1", date: "2026-10-11", time: "09:00", endTime: "10:15", title: "新標題", notes: "地點", owner: "wife", amount: "1,200", hideFromCalendar: "true" });
  check("updateEvent：依表頭名稱寫回正確的格（日期、時間、結束時間、標題、對象、金額、只記帳），都在 id 那一列", wrote("Events", "date") === "2026-10-11" && wrote("Events", "time") === "09:00" && wrote("Events", "endTime") === "10:15" && wrote("Events", "title") === "新標題" && wrote("Events", "owner") === "wife" && wrote("Events", "amount") === 1200 && wrote("Events", "hideFromCalendar") === true && writes.every(w => w.row === 2), writes);
  const n = writes.length;
  check("updateEvent：找不到 id、壞日期、空標題、結束早於開始、壞金額都丟錯且不寫入", throws(() => be.updateEvent({ id: "nope", date: "2026-10-11", title: "x", owner: "me" })) && throws(() => be.updateEvent({ id: "e1", date: "2026/10/11", title: "x", owner: "me" })) && throws(() => be.updateEvent({ id: "e1", date: "2026-10-11", title: " ", owner: "me" })) && throws(() => be.updateEvent({ id: "e1", date: "2026-10-11", time: "10:00", endTime: "09:00", title: "x", owner: "me" })) && throws(() => be.updateEvent({ id: "e1", date: "2026-10-11", title: "x", owner: "me", amount: "abc" })) && writes.length === n);
  be.updateEvent({ id: "e1", date: "2026-10-11", title: "=1+1", owner: "me" });
  check("updateEvent：公式開頭的標題走公式防護（先設純文字格式再寫入）", wrote("Events", "title") === "=1+1");
  be.updateRecurringEvent({ id: "r1", owner: "shared", title: "打球（改）", time: "20:00", endTime: "21:30", notes: "", frequency: "monthly", dayOfWeek: "3", dayOfMonth: "15", endDate: "2026-12-31" });
  check("updateRecurringEvent：改成每月 15 號 → 星期欄清空、日期欄 15、截止日與結束時間寫入", wrote("RecurringEvents", "frequency") === "monthly" && wrote("RecurringEvents", "dayOfWeek") === "" && wrote("RecurringEvents", "dayOfMonth") === 15 && wrote("RecurringEvents", "endDate") === "2026-12-31" && wrote("RecurringEvents", "endTime") === "21:30" && wrote("RecurringEvents", "time") === "20:00");
  check("updateRecurringEvent：壞頻率、每月缺日期、日期超出範圍、找不到 id 丟錯", throws(() => be.updateRecurringEvent({ id: "r1", title: "x", frequency: "daily" })) && throws(() => be.updateRecurringEvent({ id: "r1", title: "x", frequency: "monthly", dayOfMonth: "" })) && throws(() => be.updateRecurringEvent({ id: "r1", title: "x", frequency: "monthly", dayOfMonth: "32" })) && throws(() => be.updateRecurringEvent({ id: "nope", title: "x", frequency: "weekly", dayOfWeek: "1" })));
  be.updateShoppingItem("s1", "鮮奶 2 瓶");
  check("updateShoppingItem：只改 item 欄（勾選、分類不動），都在 id 那一列", wrote("ShoppingList", "item") === "鮮奶 2 瓶" && !writes.some(w => w.name === "ShoppingList" && w.col !== col("ShoppingList", "item")) && writes[writes.length - 1].row === 2);
  check("updateShoppingItem：空白、過長、找不到 id 丟錯", throws(() => be.updateShoppingItem("s1", "  ")) && throws(() => be.updateShoppingItem("s1", "x".repeat(5001))) && throws(() => be.updateShoppingItem("nope", "x")));
  const bodyOf2 = (fn) => { const t = read("apps-script/Code.gs"); const i = t.indexOf("function " + fn + "("); return t.slice(i, t.indexOf("\n}\n", i)); };
  check("updateEvent、updateRecurringEvent 都會標記待同步", bodyOf2("updateEvent").includes("markCalendarDirty_();") && bodyOf2("updateRecurringEvent").includes("markCalendarDirty_();"));
  be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => ({}) });
}

console.log("後端：讀取時間欄位");
{
  // Sheet 會把 "15:30" 這種字串存成「時間」型別，讀回來是 1899-12-30 的 Date；time 與 endTime 都要轉回 HH:mm
  const timeCell = new Date("1899-12-30T15:30:00+08:00");
  const sh = { getDataRange: () => ({ getValues: () => [["id", "time", "endTime", "title"], ["e1", timeCell, timeCell, "日文課"]] }) };
  const rows = be.sheetToObjects(sh);
  check("sheetToObjects：time、endTime 的時間型別格子都轉回 HH:mm（不是 1899-12-30 15:30:00）", rows[0].time === "15:30" && rows[0].endTime === "15:30", rows[0]);
}

console.log("視覺主題：色票對比（WCAG）");
{
  const css = read("style.css");
  const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
  const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
  const darkBlock = css.slice(darkStart, css.indexOf("}\n}", darkStart));
  const vars = (block) => { const o = {}; block.replace(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g, (_, k, v) => { o[k] = v; }); return o; };
  const lum = (hex) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  [["日間", vars(lightBlock)], ["夜間", vars(darkBlock)]].forEach(([name, v]) => {
    const pairs = [
      ["內文 / 頁面底", v.text, v.bg, 4.5], ["內文 / 卡片", v.text, v["card-bg"], 4.5], ["內文 / 輸入欄", v.text, v["input-bg"], 4.5],
      ["次要文字 / 卡片", v["text-dim"], v["card-bg"], 4.5], ["次要文字 / 頁面底", v["text-dim"], v.bg, 4.5],
      ["主按鈕文字 / 藏青", v["on-accent"], v.accent, 4.5], ["藏青 / 卡片（連結、框）", v.accent, v["card-bg"], 4.5],
      ["黃銅文字 / 卡片", v["brass-text"], v["card-bg"], 4.5], ["深綠 / 卡片", v.ok, v["card-bg"], 4.5], ["錯誤色 / 卡片", v.danger, v["card-bg"], 4.5],
      ["成功提示文字 / 底", v["success-text"], v["success-bg"], 4.5],
    ];
    pairs.forEach(([label, fg, bg, min]) => { const r = ratio(fg, bg); check(`${name}：${label} 對比 ${r.toFixed(2)} ≥ ${min}`, r >= min, { fg, bg, r }); });
  });
}

console.log("後端：傳輸與寫入鎖");
const out = o => JSON.parse(o.text);
check("每個回應都帶後端版本，且跟前端要求的最低版本一致", out(be.doGet({})).v === be.BACKEND_VERSION && read("shared.js").includes(`BACKEND_MIN_VERSION = "${be.BACKEND_VERSION}"`));
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

console.log("後端：登記體組成自動幫週活動習慣打卡");
{
  const realUtilities = be.Utilities, realGetSheet = be.getSheet, realToObjects = be.sheetToObjects;
  const pad = n => String(n).padStart(2, "0");
  be.Utilities = { getUuid: () => "uuid", formatDate: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
  const run = (habit, logs, date) => {
    const sheet = {
      getDataRange: () => ({ getValues: () => [["id", "habitId", "periodKey", "count", "createdAt"], ...logs] }),
      getLastRow: () => logs.length + 1,
      getRange: (r, c) => ({ setValue: v => { logs[r - 2][c - 1] = v; }, setNumberFormat() {}, setValues: v => { logs.push(v[0]); } }),
    };
    be.getSheet = () => sheet;
    be.sheetToObjects = () => (habit ? [habit] : []);
    be.markHabitProgress_("H", date);
    return logs;
  };
  const weekly = n => ({ id: "H", frequency: "weekly", target: n });
  check("週期鍵：週三 → 該週週一；週日 → 同一週的週一；跨月", be.periodKeyFor_("weekly", "2026-10-07") === "2026-10-05" && be.periodKeyFor_("weekly", "2026-10-11") === "2026-10-05" && be.periodKeyFor_("weekly", "2026-11-01") === "2026-10-26");
  check("週期鍵：monthly → yyyy-MM；daily → 當天", be.periodKeyFor_("monthly", "2026-10-07") === "2026-10" && be.periodKeyFor_("daily", "2026-10-07") === "2026-10-07");
  let logs = run(weekly(1), [], "2026-10-07");
  check("週目標 1：新增一列 count=1，週期是週一", logs.length === 1 && logs[0][1] === "H" && logs[0][2] === "2026-10-05" && logs[0][3] === 1, logs);
  logs = run(weekly(1), logs, "2026-10-09");
  check("同一週再登記：不重複新增、不歸零", logs.length === 1 && logs[0][3] === 1, logs);
  logs = run(weekly(3), [], "2026-10-07");
  logs = run(weekly(3), logs, "2026-10-08");
  logs = run(weekly(3), logs, "2026-10-09");
  logs = run(weekly(3), logs, "2026-10-10");
  check("週目標 3：累計到 3 為止，之後不再增加也不歸零", logs.length === 1 && logs[0][3] === 3, logs);
  logs = run(weekly(3), logs, "2026-10-14");
  check("下一週：另開一列", logs.length === 2 && logs[1][2] === "2026-10-12" && logs[1][3] === 1, logs);
  logs = run(null, [], "2026-10-07");
  check("習慣已被刪除：什麼都不寫", logs.length === 0);
  be.Utilities = realUtilities; be.getSheet = realGetSheet; be.sheetToObjects = realToObjects;
}

console.log(failed ? `\n${failed} 項失敗` : "\n全部通過");
process.exit(failed ? 1 : 0);
