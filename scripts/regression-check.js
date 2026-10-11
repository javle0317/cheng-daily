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

console.log("前端：每種習慣列都能渲染（刪掉變數卻漏改用法會讓登入後整頁讀不出來，畫面顯示成「密碼錯誤」）");
{
  const ids = vm.runInContext("[CHALLENGE_HABIT_ID, PRACTICE_HABIT_ID, LANG_HABIT_ID]", app);
  app.__habits = [
    { id: "plain", name: "一般每日", frequency: "daily", workdaysOnly: false, target: 1 },
    { id: "link", name: "有連結 https://example.com", frequency: "daily", workdaysOnly: false, target: 1 },
    ...ids.map((id, i) => ({ id, name: "特殊習慣" + i, frequency: "daily", workdaysOnly: false, target: 1 })),
    { id: "wk", name: "每週", frequency: "weekly", workdaysOnly: false, target: 3 },
    { id: "mo", name: "每月", frequency: "monthly", workdaysOnly: false, target: 1 },
  ];
  let err = null;
  try {
    vm.runInContext("state.habits = __habits; state.habitLogs = []; state.holidayDates = new Set(); state.selectedDate = toDateStr(new Date()); renderDailyHabits(); renderPeriodHabits();", app);
  } catch (e) { err = String(e); }
  check("日常、週、月習慣（含運動挑戰／練字／語言練習）渲染不丟錯", err === null, err);
}

console.log("前端：食譜頁（標籤、搜尋、排序、貼上匯入、每張卡都能渲染）");
{
  const rec = loadFrontend(["shared.js", "recipes.js"], "// ====== Boot ======");
  const ev = code => vm.runInContext(code, rec);
  rec.__recipes = [
    { id: "a", name: "番茄炒蛋", tags: "家常,蛋", ingredients: "番茄 2 顆\n雞蛋 3 顆", steps: "炒", notes: "", rating: 4, cookCount: 3, lastCookedAt: "2026-10-01" },
    { id: "b", name: "Chicken Soup", tags: "湯,家常", ingredients: "雞腿", steps: "", notes: "n", rating: 5, cookCount: 1, lastCookedAt: "" },
    { id: "c", name: "空白食譜", tags: "", ingredients: "", steps: "", notes: "", rating: "", cookCount: "", lastCookedAt: "" },
  ];
  check("splitTags：全形半形逗號、去空白、去重", JSON.stringify(ev('splitTags(" 主菜，低醣, 主菜 ,,、湯")')) === JSON.stringify(["主菜", "低醣", "湯"]));
  check("allTags：彙整不重複", JSON.stringify(ev("allTags(__recipes)").sort()) === JSON.stringify(["家常", "湯", "蛋"].sort()));
  check("filterRecipes：標籤篩選", ev('filterRecipes(__recipes, "", "湯").map(r => r.id).join()') === "b");
  check("filterRecipes：搜尋比對名稱與食材（不分大小寫）", ev('filterRecipes(__recipes, "番茄", "all").map(r => r.id).join()') === "a" && ev('filterRecipes(__recipes, "chicken", "all").map(r => r.id).join()') === "b" && ev('filterRecipes(__recipes, "雞腿", "all").map(r => r.id).join()') === "b");
  check("sortRecipes：最近新增在前／評分高到低／煮最多次", ev('sortRecipes(__recipes, "new").map(r => r.id).join()') === "c,b,a" && ev('sortRecipes(__recipes, "rating").map(r => r.id).join()') === "b,a,c" && ev('sortRecipes(__recipes, "cooked").map(r => r.id).join()') === "a,b,c");
  const imp = ev('parseRecipeImport(\'{"name":"滷肉飯","tags":["主菜","台式"],"ingredients":["五花肉 600g","醬油 80ml"],"steps":"1. 炒\\\\n2. 滷","notes":"","extra":1}\')');
  check("parseRecipeImport：陣列轉多行、標籤轉逗號、不認得的欄位列出", imp && imp.fields.name === "滷肉飯" && imp.fields.tags === "主菜, 台式" && imp.fields.ingredients === "五花肉 600g\n醬油 80ml" && imp.unknown.join() === "extra" && !("notes" in imp.fields), imp);
  check("parseRecipeImport：壞 JSON／非物件回傳 null", ev('parseRecipeImport("abc")') === null && ev("parseRecipeImport(\"[1]\")") === null);
  let err = null;
  try { ev("state.recipes = __recipes; renderRecipeList(); state.expanded = new Set(['a','b','c']); renderRecipeList(); renderTagFilter(); renderTagOptions();"); } catch (e) { err = String(e); }
  check("每張食譜卡（含空白欄位、展開）渲染不丟錯", err === null, err);
}

console.log("前端：寵物頁（間隔統計、舊事件類型猜測、搬移候選、每個類型都能渲染）");
{
  const pets = loadFrontend(["shared.js", "pets.js"], "// ====== Boot ======");
  const ev = code => vm.runInContext(code, pets);
  const st = JSON.parse(ev('JSON.stringify(petIntervalStats(["2026-08-01","2026-09-01","2026-09-01","2026-10-01"], "2026-10-11"))'));
  check("petIntervalStats：同日去重、平均間隔（31 與 30 天 → 31）、上次幾天前、下次日期", st.count === 3 && st.last === "2026-10-01" && st.daysSince === 10 && st.avgInterval === 31 && st.next === "2026-11-01", st);
  const one = JSON.parse(ev('JSON.stringify(petIntervalStats(["2026-10-01"], "2026-10-11"))'));
  check("petIntervalStats：只有 1 筆沒有間隔與下次；0 筆 count 為 0", one.avgInterval === null && one.next === null && one.daysSince === 10 && ev('petIntervalStats([], "2026-10-11").count') === 0);
  const many = JSON.parse(ev('JSON.stringify(petIntervalStats(["2026-01-01","2026-01-11","2026-01-21","2026-01-31","2026-02-10","2026-02-20","2026-03-02","2026-04-01"], "2026-04-02"))'));
  check("petIntervalStats：最多取最近 6 個間隔（前面 10 天、最後 30 天 → 平均 (10*5+30)/6=13）", many.avgInterval === 13, many);
  check("guessPetType：飼料／貓砂／疫苗／看醫生／美容／其他", ev('["買主食罐","貓砂補貨","打疫苗","看醫生 耳朵","洗澡美容","生日"].map(guessPetType).join()') === "food,litter,medicine,vet,grooming,other");
  const evs = '[{id:"a",owner:"咪嚕",title:"買飼料",date:"2026-10-01",amount:500},{id:"b",owner:"me",title:"買飼料",date:"2026-10-02",amount:100},{id:"c",owner:"林萌",title:"散步",date:"2026-10-03",amount:""},{id:"d",owner:"林萌",title:"其他花費",date:"2026-10-04",amount:80},{id:"e",owner:"咪嚕",title:"看醫生",date:"2026-10-05",amount:""},{id:"f",owner:"咪嚕",title:"回診看醫生",date:"2026-10-20",amount:""}]';
  const cands = JSON.parse(ev(`JSON.stringify(migrationCandidates(${evs}, [{sourceEventId:"e"}], {today:"2026-10-11"}).map(c => c.event.id + ":" + c.type))`));
  check("migrationCandidates：只取寵物事件、有花費或看得出類型、已搬過的不再列、還沒到的預約不列", cands.join() === "a:food,d:other", cands);
  const all = JSON.parse(ev(`JSON.stringify(migrationCandidates(${evs}, [{sourceEventId:"e"}], {today:"2026-10-11", all:true}).map(c => c.event.id))`));
  check("migrationCandidates：顯示全部時標題看不出類型的寵物事件也列出（仍不含未來預約與已搬過的）", all.join() === "a,c,d", all);
  const us = JSON.parse(ev('JSON.stringify(petUsageStats([{date:"2026-08-01",finishedAt:"2026-08-21"},{date:"2026-09-01",finishedAt:"2026-09-11"},{date:"2026-10-01",finishedAt:""},{date:"2026-09-20",finishedAt:""}], "2026-10-11"))'));
  check("petUsageStats：已用完的平均天數（20、10 → 15）、未用完件數與最久放了幾天", us.finished === 2 && us.avgUse === 15 && us.open === 2 && us.openMax === 21, us);
  check("petUsageStats：全沒用完／全用完", JSON.parse(ev('JSON.stringify(petUsageStats([{date:"2026-10-01",finishedAt:""}], "2026-10-11"))')).avgUse === null && ev('petUsageStats([{date:"2026-10-01",finishedAt:"2026-10-05"}], "2026-10-11").open') === 0);
  pets.__log = [
    { id: "1", pet: "咪嚕", type: "food", date: "2026-09-01", title: "主食罐", amount: 500, note: "", sourceEventId: "" },
    { id: "2", pet: "咪嚕", type: "food", date: "2026-10-01", title: "主食罐", amount: 520, note: "n", sourceEventId: "a" },
    { id: "3", pet: "咪嚕", type: "vet", date: "2026-10-05", title: "耳朵發炎", amount: "", note: "", sourceEventId: "" },
    { id: "4", pet: "林萌", type: "other", date: "2026-10-06", title: "項圈", amount: 300, note: "", sourceEventId: "" },
  ];
  let err = null;
  try { ev('state.log = __log; state.events = []; ["咪嚕","林萌"].forEach(p => { state.pet = p; state.month = ""; renderSummary(); renderLogList(); }); state.pet = "咪嚕"; state.typeFilter = "vet"; renderLogList();'); } catch (e) { err = String(e); }
  check("兩隻寵物、各類型、空類型的概況與紀錄列表渲染不丟錯", err === null, err);
}

console.log("前端：api() 參數一律被轉成字串，陣列／物件要先 JSON.stringify（寵物搬移曾因直接傳陣列變成 [object Object]）");
{
  const src = read("pets.js");
  check("pets.js 的 importPetEvents 送的是 JSON 字串", /api\("importPetEvents",\s*\{\s*items:\s*JSON\.stringify\(items\)/.test(src));
  const sent = {};
  const fakeFetch = (url, opts) => { Object.assign(sent, JSON.parse(opts.body)); return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }); };
  const f = loadFrontend(["shared.js"]); f.fetch = fakeFetch;
  vm.runInContext("apiRequest('x', { items: JSON.stringify([{a:1}]) })", f);
  check("apiRequest：字串參數原樣送出（後端 JSON.parse 得回陣列）", Array.isArray(JSON.parse(sent.items)));
}

console.log("前端：事件彈窗已拿掉花費／只記帳欄位，編輯舊事件要把原本的 amount、hideFromCalendar 帶回去（不然後端當成清空）");
{
  const a = read("app.js"), h = read("index.html");
  check("index.html 沒有 emAmount／emHide／addExpenseBtn", !/id="emAmount"|id="emHide"|id="addExpenseBtn"/.test(h));
  check("app.js 編輯事件時沿用 editingEvent.amount 與 hideFromCalendar", /params\.amount\s*=\s*editingEvent\.amount/.test(a) && /params\.hideFromCalendar\s*=\s*isTruthy\(editingEvent\.hideFromCalendar\)/.test(a));
}

console.log("前端：寵物驗血（高低標示、個人化設定、貼上匯入、渲染）");
{
  const labs = loadFrontend(["shared.js", "health-charts.js", "pets.js", "pets-labs.js"], "// ====== Boot ======");
  const ev = code => vm.runInContext(code, labs);
  const lv = (v, lo, hi) => JSON.parse(ev(`JSON.stringify(classifyRange(${v}, ${lo}, ${hi}))`));
  check("classifyRange（搬到 health-charts.js）：範圍內正常、超出 15% 以內 warning、50% 以內 serious、更多 critical", lv(50, 10, 100).level === "good" && lv(110, 10, 100).level === "warning" && lv(140, 10, 100).level === "serious" && lv(250, 10, 100).level === "critical" && lv(8, 10, 100).text === "偏低" && lv(5, null, null) === null);
  labs.__labs = [
    { id: "1", pet: "咪嚕", date: "2025-03-01", name: "ALT", value: 60, unit: "U/L", refLow: 10, refHigh: 100 },
    { id: "2", pet: "咪嚕", date: "2026-03-01", name: "ALT", value: 120, unit: "U/L", refLow: 10, refHigh: 100 },
    { id: "3", pet: "咪嚕", date: "2026-03-01", name: "BUN", value: 12, unit: "mg/dL", refLow: 16, refHigh: 36 },
    { id: "4", pet: "林萌", date: "2026-03-01", name: "ALT", value: 30, unit: "U/L", refLow: 10, refHigh: 100 },
  ];
  ev('state.labs = __labs; state.prefs = []; state.pet = "咪嚕"; state.events = []; state.log = [];');
  const it0 = ev('petLabItems("咪嚕").map(i => i.key).join()');
  check("petLabItems：狀況差的排前面（ALT 偏高、BUN 偏低同為 serious，同級照名稱）", it0 === "ALT,BUN", it0);
  const hist = JSON.parse(ev('JSON.stringify(petLabHistory("咪嚕", "ALT"))'));
  check("petLabHistory：只取該寵物該項目、依日期排序", hist.length === 2 && hist[0].date === "2025-03-01" && hist[1].value === 120);
  const raw = ev('(() => { const it = petLabItem("咪嚕", "BUN"); return it.classifyPoint(it.history()[0]); })()');
  check("沒設定：BUN 12（範圍 16–36，低於下限 25%）→ 偏低（serious）", raw.level === "serious" && raw.text === "偏低", raw);
  ev('state.prefs = [{ pet: "咪嚕", name: "BUN", mode: "ok", refLow: "", refHigh: "", note: "醫師說無妨" }];');
  const okc = ev('(() => { const it = petLabItem("咪嚕", "BUN"); return it.classifyPoint(it.history()[0]); })()');
  check("醫師說無妨：仍標偏低，但等級是中性的 ok、文字有「醫師說無妨」；不影響範圍內的點", okc.level === "ok" && okc.text.includes("醫師說無妨") && ev('classifyPetLabPoint({ value: 20, low: 16, high: 36 }, { mode: "ok" }).level') === "good");
  ev('state.prefs = [{ pet: "咪嚕", name: "BUN", mode: "range", refLow: 10, refHigh: 30, note: "" }];');
  const rc = ev('(() => { const it = petLabItem("咪嚕", "BUN"); return { c: it.classifyPoint(it.history()[0]), ref: it.refLabel() }; })()');
  check("自訂範圍：BUN 12 在 10–30 內 → 正常，參考範圍文字標示個人設定", rc.c.level === "good" && rc.ref.startsWith("個人設定"), rc);
  check("設定只套用在這隻：林萌的 BUN 設定不影響咪嚕的 ALT", ev('petLabPref("咪嚕", "ALT")') === null);
  const lvl = ev('Object.keys(LEVEL_RANK).sort().join()');
  check("health-charts 的 LEVEL_RANK 含 ok", lvl.includes("ok"));
  const impP = JSON.parse(ev('JSON.stringify(parsePetLabImport(\'{"pet":"咪嚕","date":"2026-03-01","items":[{"name":"ALT","value":"45","unit":"U/L","refLow":10,"refHigh":100},{"name":"BAD","value":"x"},{"value":5}],"extra":1}\'))'));
  check("parsePetLabImport：數字解析、壞項目列入 problems、不認得的欄位列出", impP.items.length === 1 && impP.items[0].value === 45 && impP.problems.length === 2 && impP.unknown.join() === "extra", impP);
  check("parsePetLabImport：壞 JSON／沒有 items 回傳 null", ev('parsePetLabImport("abc")') === null && ev('parsePetLabImport(\'{"pet":"咪嚕"}\')') === null);
  let err = null;
  try { ev('state.prefs = [{ pet: "咪嚕", name: "ALT", mode: "ok", refLow: "", refHigh: "", note: "n" }]; ["咪嚕","林萌"].forEach(p => { state.pet = p; labState.key = ""; renderLabsAll(); }); state.pet = "咪嚕"; state.labs = []; renderLabsAll();'); } catch (e) { err = String(e); }
  check("兩隻寵物（含有／沒有驗血紀錄、有個人化設定）渲染不丟錯", err === null, err);
}

console.log("頁面載入的 script：pets.html 要載入 pets-labs.js 與 health-charts.js（漏載入時驗血分頁整個是空的，語法檢查看不出來）");
{
  const html = read("pets.html");
  ["shared.js", "health-charts.js", "pets.js", "pets-labs.js"].forEach(f => check("pets.html 載入 " + f, new RegExp('<script src="' + f.replace(".", "\\.") + '\\?v=').test(html)));
  const order = ["shared.js", "health-charts.js", "pets.js", "pets-labs.js"].map(f => html.indexOf('src="' + f));
  check("pets.html script 順序：shared → health-charts → pets → pets-labs", order.every((n, i) => n > -1 && (i === 0 || n > order[i - 1])), order);
}

console.log("前端：水電瓦斯（每月均攤、趨勢點、摘要、渲染）與 bills.html 的 script");
{
  const u = loadFrontend(["shared.js", "health-charts.js", "utilities.js"]);
  const ev = code => vm.runInContext(code, u);
  u.__bills = [
    { id: "1", type: "electric", billingMonth: "2025-08", months: 2, amount: 3000 },
    { id: "2", type: "electric", billingMonth: "2026-06", months: 2, amount: 2400 },
    { id: "3", type: "electric", billingMonth: "2026-08", months: 2, amount: 3600 },
    { id: "4", type: "gas", billingMonth: "2026-08", months: 1, amount: 450 },
    { id: "5", type: "water", billingMonth: "2026-08", months: "", amount: 500 },
  ];
  const pts = JSON.parse(ev('JSON.stringify(utilPoints(__bills, "electric"))'));
  check("utilPoints：每月均攤（金額÷計費月數）、依月份排序、label 帶原金額與月數", pts.map(p => p.value).join() === "1500,1200,1800" && pts[0].date === "2025-08-01" && pts[2].label.includes("$3,600") && pts[2].label.includes("2 個月"), pts);
  check("utilMonthlyAvg：月數缺漏當 1 個月；utilMoney 千分位", ev('utilMonthlyAvg(__bills[4])') === 500 && ev('utilMoney(12345.6)') === "$12,346");
  const sm = JSON.parse(ev('JSON.stringify(utilSummary(utilPoints(__bills, "electric")))'));
  check("utilSummary：最近一期、前一期、去年同月、最近平均", sm.last.value === 1800 && sm.prev.value === 1200 && sm.lastYear.value === 1500 && sm.avg6 === 1500, sm);
  check("utilSummary：沒資料回傳 null；只有一筆沒有前一期", ev('utilSummary([])') === null && ev('utilSummary(utilPoints(__bills, "gas")).prev') === null);
  let err = null;
  try { ev('util.bills = __bills; ["water","electric","gas"].forEach(t => { util.type = t; renderUtilities(); }); util.bills = []; renderUtilities();'); } catch (e) { err = String(e); }
  check("三種類型（含沒有資料）渲染不丟錯", err === null, err);
  const html = read("bills.html");
  const order = ["shared.js", "health-charts.js", "bills.js", "utilities.js"].map(f => html.indexOf('src="' + f));
  check("bills.html 依序載入 shared → health-charts → bills → utilities", order.every((n, i) => n > -1 && (i === 0 || n > order[i - 1])), order);
}

console.log("前端：事件彈窗的「登記到寵物紀錄」與循環行程「記到寵物紀錄」");
{
  const h = read("index.html"), a = read("app.js");
  check("index.html 有 emPetLog／emPetType／emPetAmount／petQuickModal", ["emPetLog", "emPetType", "emPetAmount", "petQuickModal", "pqType"].every(id => h.includes(`id="${id}"`)));
  check("app.js 送出事件時帶 petLogType／petLogAmount，且只有寵物對象且勾選時才帶", /params\.petLogType\s*=/.test(a) && /const petLog = !\$id\("emPetBox"\)\.classList\.contains\("hidden"\) && \$id\("emPetLog"\)\.checked/.test(a));
  check("循環行程的那一次記進寵物紀錄時帶 sourceEventId（rec_規則id_日期）", /sourceEventId: `rec_\$\{petQuickEv\.ruleId\}_\$\{petQuickEv\.date\}`/.test(a));
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

console.log("後端：欄位型別驗證（文字／日期／時間／列舉）");
check("dateArg_：2026-02-30 無效、2026-02-28 有效", throws(() => be.dateArg_("2026-02-30", "x")) && be.dateArg_("2026-02-28", "x") === "2026-02-28");
check("dateArg_：optional 空白通過，必填空白丟錯", be.dateArg_("", "x", { optional: true }) === "" && throws(() => be.dateArg_("", "x")));
check("monthArg_ / timeArg_", be.monthArg_("2026-10", "x") === "2026-10" && throws(() => be.monthArg_("2026-13", "x")) && be.timeArg_("", "x") === "" && be.timeArg_("08:30", "x") === "08:30" && throws(() => be.timeArg_("25:00", "x")));
check("tagsArg_：全形逗號、去重、上限；addRecipe 名稱必填", be.tagsArg_("主菜，低醣, 主菜") === "主菜,低醣" && throws(() => be.tagsArg_("a".repeat(21))) && throws(() => be.tagsArg_("1,2,3,4,5,6,7,8,9,10,11")) && throws(() => be.addRecipe({ name: " " })));
{
  const mk = (headers) => { const rows = []; return { rows, getLastColumn: () => headers.length, getLastRow: () => 1 + rows.length, getDataRange: () => ({ getValues: () => [headers, ...rows] }),
    getRange: (r, c) => ({ getValues: () => [headers], setNumberFormat() { return this; }, setValue(v) { if (rows[r - 2]) rows[r - 2][c - 1] = v; }, setValues: v => rows.push(v[0]) }), deleteRow: (n) => { rows.splice(n - 2, 1); } }; };
  const EV = ["id", "date", "owner", "time", "title", "notes", "createdAt", "amount", "hideFromCalendar", "endTime"];
  const sheets = { Events: mk(EV), PetLog: mk(be.PET_LOG_HEADERS), PetLabs: mk(be.PET_LAB_HEADERS), PetLabPrefs: mk(be.PET_LAB_PREF_HEADERS) };
  const realUuid = be.Utilities.getUuid; let uc = 0; be.Utilities.getUuid = () => "ev-" + (++uc);
  const realToday = be.todayStr_, realDirty = be.markCalendarDirty_; be.todayStr_ = () => "2026-10-11"; be.markCalendarDirty_ = () => {};
  const old = be.SpreadsheetApp.getActiveSpreadsheet; be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: n => sheets[n] });
  try {
    const base = { date: "2026-10-10", time: "", endTime: "", title: "買飼料", notes: "主食罐", owner: "咪嚕", amount: "", hideFromCalendar: "false", petLogType: "food", petLogAmount: "520" };
    const res = be.addEventWithPetLog_(base);
    check("addEventWithPetLog_：事件與寵物紀錄一起寫入，寵物紀錄的 sourceEventId＝事件 id、金額／備註／日期帶過去",
      sheets.Events.rows.length === 1 && sheets.PetLog.rows.length === 1 && sheets.PetLog.rows[0][7] === sheets.Events.rows[0][0] && sheets.PetLog.rows[0][1] === "咪嚕" && sheets.PetLog.rows[0][2] === "food" && sheets.PetLog.rows[0][5] === 520 && sheets.PetLog.rows[0][6] === "主食罐" && res.petLogged === "created", { ev: sheets.Events.rows, pl: sheets.PetLog.rows });
    const nE = sheets.Events.rows.length, nP = sheets.PetLog.rows.length;
    check("addEventWithPetLog_：還沒到的預約、不是寵物、不認得的類型、壞金額都丟錯，事件也不會寫（驗證在寫入之前）",
      [{ date: "2026-10-12" }, { owner: "me" }, { petLogType: "xx" }, { petLogAmount: "abc" }].every(o => throws(() => be.addEventWithPetLog_(Object.assign({}, base, o)))) && sheets.Events.rows.length === nE && sheets.PetLog.rows.length === nP);
    be.addEvent("2026-10-09", "", "看醫生", "", "林萌", "", "false", "");
    const plainId = sheets.Events.rows[sheets.Events.rows.length - 1][0];
    const up1 = be.updateEventWithPetLog_(Object.assign({}, base, { id: plainId, date: "2026-10-09", title: "看醫生", owner: "林萌", petLogType: "vet", petLogAmount: "" }));
    const up2 = be.updateEventWithPetLog_(Object.assign({}, base, { id: plainId, date: "2026-10-09", title: "看醫生", owner: "林萌", petLogType: "vet", petLogAmount: "" }));
    check("updateEventWithPetLog_：編輯舊事件時登記（created），同一個事件再登記不會重複（exists）", up1.petLogged === "created" && up2.petLogged === "exists" && sheets.PetLog.rows.filter(r => r[7] === plainId).length === 1);
    be.addPetLog(Object.assign({}, { pet: "咪嚕", type: "medicine", date: "2026-10-10", title: "點藥", amount: "", note: "", sourceEventId: "rec_r1_2026-10-10" }));
    check("addPetLog：帶 sourceEventId（循環行程某一次）同一次不能記兩遍", throws(() => be.addPetLog({ pet: "咪嚕", type: "medicine", date: "2026-10-10", title: "點藥", amount: "", note: "", sourceEventId: "rec_r1_2026-10-10" })));
  } finally { be.SpreadsheetApp.getActiveSpreadsheet = old; be.Utilities.getUuid = realUuid; be.todayStr_ = realToday; be.markCalendarDirty_ = realDirty; }
}
{
  const mk = (headers) => { const rows = []; return { rows, getLastColumn: () => headers.length, getLastRow: () => 1 + rows.length, getDataRange: () => ({ getValues: () => [headers, ...rows] }),
    getRange: (r, c) => ({ getValues: () => [headers], setNumberFormat() { return this; }, setValue(v) { if (rows[r - 2]) rows[r - 2][c - 1] = v; }, setValues: v => rows.push(v[0]) }), deleteRow: (n) => { rows.splice(n - 2, 1); } }; };
  const sh = mk(be.UTILITY_HEADERS);
  const realUuid = be.Utilities.getUuid; let uc = 0; be.Utilities.getUuid = () => "util-" + (++uc); // 其他測試的假 uuid 是固定字串，這裡要每筆不同
  const old = be.SpreadsheetApp.getActiveSpreadsheet; be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sh });
  try {
    be.addUtilityBill({ type: "electric", billingMonth: "2026-08", months: "2", amount: "3,600", note: "夏天" });
    check("addUtilityBill：依欄位寫入（金額 3,600 → 3600、月數轉數字）", sh.rows.length === 1 && sh.rows[0][1] === "electric" && sh.rows[0][3] === 2 && sh.rows[0][4] === 3600 && sh.rows[0][5] === "夏天", sh.rows);
    be.addUtilityBill({ type: "electric", billingMonth: "2026-08", months: "2", amount: "3800", note: "" });
    check("addUtilityBill：同類型同月份＝更新那一筆，不重複新增", sh.rows.length === 1 && sh.rows[0][4] === 3800, sh.rows);
    be.addUtilityBill({ type: "gas", billingMonth: "2026-08", months: "1", amount: "450" });
    check("同月份不同類型是兩筆", sh.rows.length === 2);
    const n = sh.rows.length;
    check("addUtilityBill：不認得的類型／壞月份／壞金額／月數 0 或 13／負金額都丟錯且不寫入",
      [{ type: "net" }, { billingMonth: "2026-13" }, { amount: "abc" }, { months: "0" }, { months: "13" }, { amount: "-1" }].every(o => throws(() => be.addUtilityBill(Object.assign({ type: "water", billingMonth: "2026-09", months: "2", amount: "100" }, o)))) && sh.rows.length === n);
    const gasId = sh.rows[1][0];
    check("updateUtilityBill：改成跟同類型別筆相同月份要丟錯；改自己的月份沒事", throws(() => be.updateUtilityBill({ id: gasId, type: "electric", billingMonth: "2026-08", months: "1", amount: "1" })) && (be.updateUtilityBill({ id: gasId, type: "gas", billingMonth: "2026-09", months: "1", amount: "500" }), sh.rows[1][4] === 500));
    be.deleteUtilityBill(gasId);
    check("deleteUtilityBill：刪掉那一筆", sh.rows.length === 1 && sh.rows[0][1] === "electric");
  } finally { be.SpreadsheetApp.getActiveSpreadsheet = old; be.Utilities.getUuid = realUuid; }
}
{
  const mk = (headers) => { const rows = []; return { rows, getLastColumn: () => headers.length, getLastRow: () => 1 + rows.length, getDataRange: () => ({ getValues: () => [headers, ...rows] }),
    getRange: (r, c) => ({ getValues: () => [headers], setNumberFormat() { return this; }, setValue(v) { if (rows[r - 2]) rows[r - 2][c - 1] = v; }, setValues: v => rows.push(v[0]) }), deleteRow: (n) => { rows.splice(n - 2, 1); } }; };
  const sheets = { PetLabs: mk(be.PET_LAB_HEADERS), PetLabPrefs: mk(be.PET_LAB_PREF_HEADERS), PetLog: mk(be.PET_LOG_HEADERS) };
  const old = be.SpreadsheetApp.getActiveSpreadsheet; be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: n => sheets[n] });
  try {
    const items = [{ name: "ALT", value: "45", unit: "U/L", refLow: "10", refHigh: "100" }, { name: "BUN", value: "12", unit: "mg/dL", refLow: "", refHigh: "" }];
    be.addPetLabEntry({ pet: "咪嚕", date: "2026-03-01", items: JSON.stringify(items) });
    check("addPetLabEntry：一個項目一列，依欄位寫入（數值轉數字、範圍空白留空）", sheets.PetLabs.rows.length === 2 && sheets.PetLabs.rows[0][3] === "ALT" && sheets.PetLabs.rows[0][4] === 45 && sheets.PetLabs.rows[0][6] === 10 && sheets.PetLabs.rows[1][6] === "", sheets.PetLabs.rows);
    be.addPetLabEntry({ pet: "咪嚕", date: "2026-03-01", items: [{ name: "ALT", value: 50, unit: "U/L", refLow: 10, refHigh: 100 }] });
    check("addPetLabEntry：同寵物同日同名稱更新那一列，不重複新增", sheets.PetLabs.rows.length === 2 && sheets.PetLabs.rows[0][4] === 50);
    const n = sheets.PetLabs.rows.length;
    check("addPetLabEntry：壞寵物／壞日期／空名稱／重複名稱／壞數字／下限大於上限／空陣列都丟錯且不寫入",
      [{ pet: "旺財" }, { date: "2026/03/01" }, { items: [{ name: " ", value: 1 }] }, { items: [{ name: "A", value: 1 }, { name: "A", value: 2 }] }, { items: [{ name: "A", value: "x" }] }, { items: [{ name: "A", value: 1, refLow: 10, refHigh: 5 }] }, { items: [] }]
        .every(o => throws(() => be.addPetLabEntry(Object.assign({ pet: "咪嚕", date: "2026-03-02", items: [{ name: "ok", value: 1 }] }, o)))) && sheets.PetLabs.rows.length === n);
    be.addPetLabEntry({ pet: "林萌", date: "2026-03-01", items: [{ name: "ALT", value: 30 }] });
    be.deletePetLabDay("咪嚕", "2026-03-01");
    check("deletePetLabDay：只刪該寵物該天，不動別隻", sheets.PetLabs.rows.length === 1 && sheets.PetLabs.rows[0][1] === "林萌");
    be.setPetLabPref({ pet: "咪嚕", name: "BUN", mode: "ok", refLow: "5", refHigh: "", note: "醫師說無妨" });
    check("setPetLabPref：ok 模式範圍清空、備註寫入", sheets.PetLabPrefs.rows.length === 1 && sheets.PetLabPrefs.rows[0][3] === "ok" && sheets.PetLabPrefs.rows[0][4] === "" && sheets.PetLabPrefs.rows[0][6] === "醫師說無妨", sheets.PetLabPrefs.rows);
    be.setPetLabPref({ pet: "咪嚕", name: "BUN", mode: "range", refLow: "10", refHigh: "30", note: "" });
    check("setPetLabPref：同寵物同項目只有一筆，重設是更新", sheets.PetLabPrefs.rows.length === 1 && sheets.PetLabPrefs.rows[0][3] === "range" && sheets.PetLabPrefs.rows[0][4] === 10 && sheets.PetLabPrefs.rows[0][5] === 30);
    check("setPetLabPref：range 沒填任何範圍／下限大於上限／壞 mode 丟錯", throws(() => be.setPetLabPref({ pet: "咪嚕", name: "X", mode: "range", refLow: "", refHigh: "" })) && throws(() => be.setPetLabPref({ pet: "咪嚕", name: "X", mode: "range", refLow: "9", refHigh: "3" })) && throws(() => be.setPetLabPref({ pet: "咪嚕", name: "X", mode: "zzz" })));
    be.clearPetLabPref("咪嚕", "BUN");
    check("clearPetLabPref：刪掉設定", sheets.PetLabPrefs.rows.length === 0);
  } finally { be.SpreadsheetApp.getActiveSpreadsheet = old; }
}
{
  const mk = (headers, rows) => ({ rows, getLastColumn: () => headers.length, getLastRow: () => 1 + rows.length, getDataRange: () => ({ getValues: () => [headers, ...rows] }),
    getRange: (r, c) => ({ getValues: () => [headers], setNumberFormat() { return this; }, setValue(v) { rows[r - 2][c - 1] = v; }, setValues: v => rows.push(v[0]) }) });
  const withSheet = (sh, fn) => { const old = be.SpreadsheetApp.getActiveSpreadsheet; be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sh }); try { return fn(); } finally { be.SpreadsheetApp.getActiveSpreadsheet = old; } };
  const legacy = mk(be.PET_LOG_HEADERS.slice(0, 9), []);
  withSheet(legacy, () => be.addPetLog({ pet: "咪嚕", type: "food", date: "2026-10-01", title: "罐", amount: "", note: "到期 2027/03" }));
  check("PetLog 還沒有 finishedAt 欄（9 欄）也能照常新增，依表頭名稱寫入", legacy.rows[0] && legacy.rows[0].length === 9 && legacy.rows[0][6] === "到期 2027/03", legacy.rows[0]);
  check("setPetLogFinished：還沒有 finishedAt 欄 → 丟錯要求補欄位", withSheet(legacy, () => throws(() => be.setPetLogFinished(legacy.rows[0][0], "2026-10-10"))));
  const full = mk(be.PET_LOG_HEADERS, []);
  withSheet(full, () => be.addPetLog({ pet: "咪嚕", type: "food", date: "2026-10-01", title: "罐", amount: "", note: "" }));
  const id = full.rows[0][0];
  withSheet(full, () => be.setPetLogFinished(id, "2026-10-20"));
  check("setPetLogFinished：寫進 finishedAt 欄；空白清除", full.rows[0][9] === "2026-10-20" && (withSheet(full, () => be.setPetLogFinished(id, "")), full.rows[0][9] === ""), full.rows[0]);
  check("setPetLogFinished：早於購買日、壞日期、找不到的 id 都丟錯", withSheet(full, () => throws(() => be.setPetLogFinished(id, "2026-09-30")) && throws(() => be.setPetLogFinished(id, "2026/10/20")) && throws(() => be.setPetLogFinished("nope", "2026-10-20"))));
}
{
  check("後端 importPetEvents 吃 JSON 字串", (() => { const rows = []; const sh = { getLastColumn: () => 9, getLastRow: () => 1 + rows.length, getDataRange: () => ({ getValues: () => [be.PET_LOG_HEADERS, ...rows] }), getRange: () => ({ getValues: () => [be.PET_LOG_HEADERS], setNumberFormat() {}, setValues: v => rows.push(v[0]) }) }; const old = be.SpreadsheetApp.getActiveSpreadsheet; be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sh }); try { be.importPetEvents(JSON.stringify([{ eventId: "e1", pet: "林萌", type: "grooming", date: "2025-05-17", title: "肚肚洗澡", amount: "", note: "" }])); return rows.length === 1; } finally { be.SpreadsheetApp.getActiveSpreadsheet = old; } })());
}
{
  const mkSheet = (headers) => { const rows = []; return { rows, getLastColumn: () => headers.length, getLastRow: () => 1 + rows.length, getDataRange: () => ({ getValues: () => [headers, ...rows] }), getRange: () => ({ getValues: () => [headers], setNumberFormat() {}, setValues: v => rows.push(v[0]) }) }; };
  const withSheet = (sh, fn) => { const old = be.SpreadsheetApp.getActiveSpreadsheet; be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sh }); try { return fn(); } finally { be.SpreadsheetApp.getActiveSpreadsheet = old; } };
  const good = { pet: "咪嚕", type: "food", date: "2026-10-10", title: "主食罐", amount: "520", note: "" };
  const sh = mkSheet(be.PET_LOG_HEADERS);
  withSheet(sh, () => { be.addPetLog(good); });
  check("addPetLog：依欄位寫入（寵物、類型、金額轉數字、sourceEventId 空）", sh.rows[0] && sh.rows[0][1] === "咪嚕" && sh.rows[0][2] === "food" && sh.rows[0][5] === 520 && sh.rows[0][7] === "", sh.rows[0]);
  check("addPetLog：不認得的寵物／類型、壞日期、空品項、負金額都丟錯且不寫入",
    withSheet(sh, () => { const n = sh.rows.length; return [{ pet: "旺財" }, { type: "xx" }, { date: "2026/10/10" }, { title: " " }, { amount: "-5" }].every(o => throws(() => be.addPetLog(Object.assign({}, good, o)))) && sh.rows.length === n; }));
  const sh2 = mkSheet(be.PET_LOG_HEADERS);
  withSheet(sh2, () => {
    be.importPetEvents([{ eventId: "e1", pet: "林萌", type: "vet", date: "2026-09-01", title: "洗牙", amount: 3000, note: "" }, { eventId: "e2", pet: "咪嚕", type: "litter", date: "2026-09-02", title: "貓砂", amount: "", note: "" }]);
    be.importPetEvents([{ eventId: "e1", pet: "林萌", type: "vet", date: "2026-09-01", title: "洗牙", amount: 3000, note: "" }]);
  });
  check("importPetEvents：寫入 sourceEventId、重複的來源事件不重複搬", sh2.rows.length === 2 && sh2.rows[0][7] === "e1" && sh2.rows[1][7] === "e2", sh2.rows);
  check("importPetEvents：有一筆壞整批不寫", withSheet(sh2, () => { const n = sh2.rows.length; return throws(() => be.importPetEvents([{ eventId: "e3", pet: "咪嚕", type: "food", date: "2026-09-03", title: "ok", amount: "", note: "" }, { eventId: "e4", pet: "咪嚕", type: "bad", date: "2026-09-03", title: "x", amount: "", note: "" }])) && sh2.rows.length === n; }));
}
{
  const E = (title, time, owner = "me") => ({ title, time, owner });
  const sorted = be.sortEventsByTime_([E("晚", "19:00"), E("全天", ""), E("早", "08:30"), E("同時間 A", "10:00"), E("同時間 B", "10:00"), E("午", "12:00")]).map(e => e.title).join();
  check("sortEventsByTime_：全天排最前、其餘由早到晚、同時間保持原順序", sorted === "全天,早,同時間 A,同時間 B,午,晚", sorted);
  const src = [E("b", "09:00"), E("a", "08:00")];
  check("sortEventsByTime_：不改動傳入的陣列", (be.sortEventsByTime_(src), src[0].title === "b"));
}
{
  const mkSheet = (headers) => { const rows = []; return { rows, getLastColumn: () => headers.length, getLastRow: () => 1, getDataRange: () => ({ getValues: () => [headers] }), getRange: (r, c, nr, nc) => ({ getValues: () => [headers], setNumberFormat() {}, setValues: v => rows.push(v[0]) }) }; };
  const withSheet = (sh, fn) => { const old = be.SpreadsheetApp.getActiveSpreadsheet; be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sh }); try { return fn(); } finally { be.SpreadsheetApp.getActiveSpreadsheet = old; } };
  const H = ["id", "date", "period", "systolic", "diastolic", "pulse", "createdAt", "note"];
  const sh = mkSheet(H);
  withSheet(sh, () => { try { be.addBloodPressureReading("2026-10-10", "evening", "135", "88", "70", "晚餐吃火鍋"); } catch (e) {} });
  check("addBloodPressureReading：備註依表頭名稱寫進 note 欄", sh.rows[0] && sh.rows[0][2] === "evening" && sh.rows[0][5] === 70 && sh.rows[0][7] === "晚餐吃火鍋", sh.rows[0]);
  const old7 = mkSheet(H.slice(0, 7));
  check("BloodPressure 還沒有 note 欄：有填備註丟錯且不寫入；沒填備註照常寫入",
    withSheet(old7, () => throws(() => be.addBloodPressureReading("2026-10-10", "evening", "135", "88", "70", "x")) && old7.rows.length === 0 && (be.addBloodPressureReading("2026-10-10", "evening", "135", "88", "70", ""), old7.rows.length === 1 && old7.rows[0].length === 7)));
}
check("setRecipeRating：評分要 0–5 整數", throws(() => be.setRecipeRating("x", "6")) && throws(() => be.setRecipeRating("x", "2.5")) && throws(() => be.setRecipeRating("x", "abc")));
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
  check("已確認讀取正常（verified）、資料表真的沒事件了 → 放行刪除（刪掉最後一條循環行程）", (() => { const live = calEvents.filter(e => !e.deleted).length; const res = be.reconcileWith_(fakeCal, { events: [], rules: [], exceptions: [], verified: true }, today, false); return res.deleted >= 6 && calEvents.filter(e => !e.deleted && e.tag).length === 0 && !manual.deleted && live >= 6; })());
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
  check("寫入 Events／循環行程／跳過日的 7 個函式都會標記待同步（addEvent 走 addEventRow_；改花費金額不用）", ["addEventRow_", "deleteEvent", "addRecurringEvent", "setRecurringEndDate", "deleteRecurringEvent", "addRecurringException", "deleteRecurringException"].every(fn => bodyOf(fn).includes("markCalendarDirty_();")) && !bodyOf("setEventAmount").includes("markCalendarDirty_"));
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

console.log("後端：新分頁自動建立（ensureSheet）與既有分頁防護（getSheet）");
{
  const made = []; let frozen = 0; const store = {};
  const mkSheet = (name) => ({ name, getRange: () => ({ setValues: v => made.push({ name, headers: v[0] }) }), setFrozenRows: n => { frozen = n; } });
  be.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: n => store[n] || null, insertSheet: n => (store[n] = mkSheet(n)) });
  const sh = be.ensureSheet("Recipes", ["id", "name"]);
  check("ensureSheet：沒有這個分頁 → 建立、寫入表頭、凍結第一列", sh.name === "Recipes" && made.length === 1 && made[0].headers.join() === "id,name" && frozen === 1, made);
  be.ensureSheet("Recipes", ["id", "name", "extra"]);
  check("ensureSheet：分頁已存在 → 不動（不重寫表頭、不補欄位）", made.length === 1);
  check("getSheet：既有分頁缺少時仍然丟錯（不會自動建立）", throws(() => be.getSheet("Events")) && !store.Events);
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
