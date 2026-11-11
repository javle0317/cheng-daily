// ====== 健康頁：「今日」分頁（睡眠＋體重＋餐點，單一入口）======
// 早上記睡眠與體重、晚上記餐點，都在同一張表單，送一個 action（addDailyHealth）。
// 體重寫進既有的 InBody（同天合併），登記後用 "health:inbody" 事件通知體組成分頁更新。
// 缺資料一律是「未記錄」，不當 0。熱量、蛋白質是估計值。共用工具在 health-charts.js / shared.js。

const MEAL_LABELS = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "點心" };
const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];
const EX_LABELS = { pickleball: "打球", lowimpact: "低衝擊", strength: "肌力", walk: "走路", other: "其他運動" };

// ---- 純邏輯（回歸檢查會單獨載入這一段）----
function hhmmToMin(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// 從 start 到 wake 的睡眠時數（跨午夜 +24h；後端 sleepHours_ 是同一套規則，後端的值才是存進 Sheet 的）
function sleepHoursOf(start, wake) {
  const a = hhmmToMin(start), b = hhmmToMin(wake);
  if (a === null || b === null) return null;
  let diff = b - a;
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

// 上床時間換成「從傍晚 18:00 起算的分鐘數」，23:30 與 01:00 才會是相鄰的兩個值，平均、標準差才不會被午夜切斷
function eveningMinutes(hhmm) {
  const m = hhmmToMin(hhmm);
  if (m === null) return null;
  return m < 18 * 60 ? m + 24 * 60 - 18 * 60 : m - 18 * 60;
}

function eveningMinutesToHHmm(min) {
  const total = Math.round(min + 18 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// 上床時間的平均與標準差（分鐘）；至少 2 筆才算規律度
function bedtimeStats(records) {
  const mins = records.map(r => eveningMinutes(r.bedtime)).filter(v => v !== null);
  if (!mins.length) return null;
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  const sd = mins.length > 1 ? Math.sqrt(mins.reduce((a, b) => a + (b - mean) * (b - mean), 0) / mins.length) : null;
  return { avg: eveningMinutesToHHmm(mean), sd: sd === null ? null : Math.round(sd), n: mins.length };
}

// 某日期往前 days 天（含當天）內的平均體重；沒有任何紀錄回傳 null（不是 0）
function avgWeightIn(readings, endDate, days) {
  const end = new Date(endDate + "T00:00:00");
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const startStr = toDateStr(start);
  const vals = readings.filter(r => r.date >= startStr && r.date <= endDate).map(r => toNum(r.weight)).filter(v => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// 每天的餐點合計：只加有填的數字；有餐點沒估熱量就標 partial（合計只是下限，不是完整的一天）；
// complete＝使用者勾了「這天的餐都記完了」，沒勾的日子不能當成完整的一天（少拍一餐會讓平均偏低）
function mealDayTotals(meals) {
  const byDate = {};
  meals.forEach(m => {
    const d = byDate[m.date] || (byDate[m.date] = { kcal: 0, protein: 0, hasKcal: false, hasProtein: false, partial: false, complete: false, count: 0 });
    d.count++;
    if (m.complete === true || m.complete === "true" || m.complete === "TRUE") d.complete = true;
    const k = toNum(m.kcal), p = toNum(m.protein);
    if (k === null) d.partial = true; else { d.kcal += k; d.hasKcal = true; }
    if (p !== null) { d.protein += p; d.hasProtein = true; }
  });
  return byDate;
}

// 打球消耗的粗估（kcal）：6 人一面場輪替，實際跑動約一半時間；以 110 kg 估約每分鐘 3.75 kcal（2 小時 ≈ 450）。只是參考，可手改
function pickleKcalEstimate(minutes) {
  const m = Number(minutes);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 3.75) : null;
}

function dateAddDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// ====== UI ======
(function () {
  const state = { sleep: [], meals: [], exercise: [], inbody: [], range: 7, chartKey: "sleep", version: 0, loadedDate: "" };
  const $ = (id) => document.getElementById(id);

  function today() { return toDateStr(new Date()); }
  function fmtMD(d) { return d.slice(5).replace("-", "/"); }
  function fmtNum(n, dec = 0) { return n.toLocaleString("en-US", { maximumFractionDigits: dec, minimumFractionDigits: dec }); }

  function apply(data, fromLoader) {
    if (!fromLoader) state.version++;
    state.sleep = data.sleep || state.sleep;
    state.meals = data.meals || state.meals;
    state.exercise = data.exercise || state.exercise;
    if (data.inbody) {
      state.inbody = data.inbody;
      window.dispatchEvent(new CustomEvent("health:inbody", { detail: data.inbody }));
    }
  }

  // ---- 餐點輸入列 ----
  function buildMealRows() {
    const box = $("dayMeals");
    box.innerHTML = "";
    MEAL_ORDER.forEach(key => {
      const row = document.createElement("div");
      row.className = "meal-row";
      row.dataset.meal = key;
      row.innerHTML = `
        <div class="form-row">
          <input type="text" class="meal-desc" maxlength="300" placeholder="${MEAL_LABELS[key]}吃了什麼" autocomplete="off">
        </div>
        <div class="form-row">
          <input type="number" class="meal-kcal" step="any" min="0" inputmode="decimal" placeholder="熱量 kcal">
          <input type="number" class="meal-protein" step="any" min="0" inputmode="decimal" placeholder="蛋白質 g">
        </div>
        <div class="form-row meal-flags">
          <label class="check-field"><input type="checkbox" class="meal-eatout"> 外食</label>
          <label class="check-field"><input type="checkbox" class="meal-sugar"> 含糖飲料</label>
        </div>`;
      box.appendChild(row);
    });
  }

  function mealRow(key) { return $("dayMeals").querySelector(`.meal-row[data-meal="${key}"]`); }

  function setMealRow(key, m) {
    const row = mealRow(key);
    row.querySelector(".meal-desc").value = m ? m.desc : "";
    row.querySelector(".meal-kcal").value = m && m.kcal !== null && m.kcal !== undefined ? m.kcal : "";
    row.querySelector(".meal-protein").value = m && m.protein !== null && m.protein !== undefined ? m.protein : "";
    row.querySelector(".meal-eatout").checked = !!(m && m.eatOut);
    row.querySelector(".meal-sugar").checked = !!(m && m.sugarDrink);
  }

  const truthy = (v) => v === true || v === "true" || v === "TRUE";

  // 把某一天已有的紀錄填進表單（沒有就清空）；同一天有多筆點心時合併成一列
  function loadDate(date) {
    state.loadedDate = date;
    $("dayDate").value = date;
    const w = state.inbody.find(r => r.date === date);
    $("dayWeight").value = w && toNum(w.weight) !== null ? w.weight : "";
    const s = state.sleep.find(r => r.date === date);
    $("dayBed").value = s ? s.bedtime : "";
    $("dayWake").value = s ? s.wakeTime : "";
    $("daySleepTime").value = s ? s.sleepTime : "";
    $("dayQuality").value = s ? String(s.quality) : "";
    $("dayEnergy").value = s ? String(s.energy) : "";
    $("dayCpap").value = s ? s.cpap : "";
    $("dayNap").checked = !!(s && truthy(s.nap));
    $("daySleepNote").value = s ? s.note : "";
    const dayMeals = state.meals.filter(m => m.date === date);
    MEAL_ORDER.forEach(key => {
      const ms = dayMeals.filter(m => m.meal === key);
      if (!ms.length) { setMealRow(key, null); return; }
      if (ms.length === 1) { setMealRow(key, { ...ms[0], eatOut: truthy(ms[0].eatOut), sugarDrink: truthy(ms[0].sugarDrink) }); return; }
      const kc = ms.map(m => toNum(m.kcal)).filter(v => v !== null);
      const pr = ms.map(m => toNum(m.protein)).filter(v => v !== null);
      setMealRow(key, {
        desc: ms.map(m => m.desc).join("；"),
        kcal: kc.length ? kc.reduce((a, b) => a + b, 0) : null,
        protein: pr.length ? pr.reduce((a, b) => a + b, 0) : null,
        eatOut: ms.some(m => truthy(m.eatOut)),
        sugarDrink: ms.some(m => truthy(m.sugarDrink)),
      });
    });
    $("dayMealsDone").checked = dayMeals.some(m => truthy(m.complete));
    const dayEx = state.exercise.filter(x => x.date === date);
    const pk = dayEx.find(x => x.type === "pickleball");
    $("exPickleMin").value = pk ? pk.minutes : "";
    $("exPickleRpe").value = pk ? String(pk.rpe) : "";
    $("exPickleKcal").value = pk && pk.kcal !== "" ? pk.kcal : "";
    const ot = dayEx.find(x => x.type !== "pickleball");
    $("exOtherType").value = ot ? ot.type : "lowimpact";
    $("exOtherMin").value = ot ? ot.minutes : "";
    $("exOtherRpe").value = ot ? String(ot.rpe) : "";
    $("exNote").value = (pk && pk.note) || (ot && ot.note) || "";
    updatePreview();
  }

  function updatePickleHint() {
    const el = $("exPicklePreview");
    const est = pickleKcalEstimate($("exPickleMin").value);
    el.textContent = est === null ? "" : `打球約 ${$("exPickleMin").value} 分鐘，粗估消耗約 ${est} kcal（輪替休息已扣；沒填消耗會自動帶入這個估計值）`;
  }

  function updatePreview() {
    updatePickleHint();
    const bed = $("dayBed").value, wake = $("dayWake").value, asleep = $("daySleepTime").value;
    const el = $("daySleepPreview");
    if (!bed || !wake) { el.textContent = ""; return; }
    const h = sleepHoursOf(asleep || bed, wake);
    el.textContent = h > 16 ? "⚠️ 睡眠超過 16 小時，請確認上床與起床時間" : `睡眠約 ${h} 小時（${asleep ? "從入睡算起" : "從上床算起，沒填入睡時間"}）`;
  }

  // ---- 送出 ----
  function collectForm() {
    const date = $("dayDate").value;
    const params = { date };
    const bad = [];
    const wRaw = $("dayWeight").value;
    if (wRaw !== "") {
      const n = parseStrictNumber(wRaw);
      if (n === null) bad.push("體重"); else params.weight = n;
    }
    const bed = $("dayBed").value, wake = $("dayWake").value;
    if ((bed && !wake) || (!bed && wake)) return { error: "睡眠要同時填上床與起床時間" };
    if (bed && wake) {
      params.sleep = {
        bedtime: bed, wakeTime: wake, sleepTime: $("daySleepTime").value,
        quality: $("dayQuality").value, energy: $("dayEnergy").value, cpap: $("dayCpap").value,
        nap: $("dayNap").checked, note: $("daySleepNote").value.trim(),
      };
    }
    const meals = [];
    MEAL_ORDER.forEach(key => {
      const row = mealRow(key);
      const desc = row.querySelector(".meal-desc").value.trim();
      const kcalRaw = row.querySelector(".meal-kcal").value, protRaw = row.querySelector(".meal-protein").value;
      if (!desc && (kcalRaw !== "" || protRaw !== "")) { bad.push(`${MEAL_LABELS[key]}的描述（有填熱量或蛋白質就要寫吃了什麼）`); return; }
      if (!desc) return;
      const kcal = kcalRaw === "" ? "" : parseStrictNumber(kcalRaw);
      const protein = protRaw === "" ? "" : parseStrictNumber(protRaw);
      if (kcal === null) bad.push(`${MEAL_LABELS[key]}的熱量`);
      if (protein === null) bad.push(`${MEAL_LABELS[key]}的蛋白質`);
      meals.push({ meal: key, desc, kcal, protein, eatOut: row.querySelector(".meal-eatout").checked, sugarDrink: row.querySelector(".meal-sugar").checked });
    });
    const exercise = [];
    const exNote = $("exNote").value.trim();
    const pkMin = $("exPickleMin").value;
    if (pkMin !== "") {
      const mins = parseStrictNumber(pkMin);
      if (mins === null) bad.push("打球分鐘");
      const kRaw = $("exPickleKcal").value;
      const kcal = kRaw === "" ? pickleKcalEstimate(pkMin) : parseStrictNumber(kRaw);
      if (kRaw !== "" && kcal === null) bad.push("打球消耗");
      exercise.push({ type: "pickleball", minutes: mins, rpe: $("exPickleRpe").value, kcal: kcal === null ? "" : kcal, note: exNote });
    }
    const otMin = $("exOtherMin").value;
    if (otMin !== "") {
      const mins = parseStrictNumber(otMin);
      if (mins === null) bad.push("運動分鐘");
      exercise.push({ type: $("exOtherType").value, minutes: mins, rpe: $("exOtherRpe").value, kcal: "", note: exNote });
    }
    if (bad.length) return { error: "這些欄位不是有效數字或不完整：" + bad.join("、") };
    if (meals.length) params.meals = meals;
    if (exercise.length) params.exercise = exercise;
    params.mealsComplete = $("dayMealsDone").checked;
    if (!date) return { error: "請選日期" };
    if (params.weight === undefined && !params.sleep && !params.meals && !params.exercise) return { error: "睡眠、體重、餐點、運動至少要填一項" };
    return { params };
  }

  $("dayForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { params, error } = collectForm();
    if (error) { setStatus(error, true); return; }
    const body = { date: params.date };
    if (params.weight !== undefined) body.weight = params.weight;
    if (params.sleep) body.sleep = JSON.stringify(params.sleep);
    if (params.meals) body.meals = JSON.stringify(params.meals);
    if (params.exercise) body.exercise = JSON.stringify(params.exercise);
    body.mealsComplete = params.mealsComplete;
    setFormBusy(e.target, true);
    try {
      apply(await api("addDailyHealth", body));
      loadDate(params.date);
      renderAll();
      showToast("已儲存");
    } catch (err) {
      setStatus("儲存失敗：" + err.message, true);
    } finally {
      setFormBusy(e.target, false);
    }
  });

  $("dayDate").addEventListener("change", () => { if ($("dayDate").value) loadDate($("dayDate").value); });
  ["dayBed", "dayWake", "daySleepTime", "exPickleMin"].forEach(id => $(id).addEventListener("input", updatePreview));
  $("dayInfoBtn").addEventListener("click", () => $("dayInfoBox").classList.toggle("hidden"));

  // ---- 貼上匯入：{ date, weight, sleep:{bedtime,wakeTime,...}, meals:[{meal,desc,kcal,protein,eatOut,sugarDrink,note}] } ----
  $("dayImportBtn").addEventListener("click", () => {
    const msg = $("dayImportMsg");
    let data;
    try { data = JSON.parse($("dayImportText").value); } catch (e) { msg.textContent = "格式不對，請整段貼上對話裡給你的資料"; return; }
    const problems = [];
    const date = data.date && /^\d{4}-\d{2}-\d{2}$/.test(String(data.date)) ? data.date : null;
    if (data.date && !date) problems.push(`日期「${data.date}」格式不對（要 yyyy-MM-dd），沿用目前選的日期`);
    loadDate(date || $("dayDate").value || today());
    // 先清乾淨再填：匯入的是「這一天的完整資料」，不能殘留表單原本的值
    $("dayWeight").value = "";
    ["dayBed", "dayWake", "daySleepTime", "dayQuality", "dayEnergy", "dayCpap", "daySleepNote"].forEach(id => { $(id).value = ""; });
    $("dayNap").checked = false;
    MEAL_ORDER.forEach(k => setMealRow(k, null));
    $("dayMealsDone").checked = truthy(data.mealsComplete);
    ["exPickleMin", "exPickleRpe", "exPickleKcal", "exOtherMin", "exOtherRpe", "exNote"].forEach(id => { $(id).value = ""; });
    let filled = 0;
    if (data.weight !== undefined && data.weight !== null && data.weight !== "") {
      const n = parseStrictNumber(data.weight);
      if (n === null) problems.push(`體重「${data.weight}」不是有效數字`); else { $("dayWeight").value = n; filled++; }
    }
    const s = data.sleep;
    if (s) {
      const t = (v, label) => {
        if (v === undefined || v === null || v === "") return "";
        if (!/^\d{2}:\d{2}$/.test(String(v))) { problems.push(`${label}「${v}」格式不對（要 HH:mm）`); return ""; }
        return v;
      };
      $("dayBed").value = t(s.bedtime, "上床");
      $("dayWake").value = t(s.wakeTime, "起床");
      $("daySleepTime").value = t(s.sleepTime, "入睡");
      if (s.quality) $("dayQuality").value = String(s.quality);
      if (s.energy) $("dayEnergy").value = String(s.energy);
      if (s.cpap === "yes" || s.cpap === "no") $("dayCpap").value = s.cpap;
      $("dayNap").checked = truthy(s.nap);
      $("daySleepNote").value = s.note || "";
      filled++;
    }
    const grouped = {};
    (data.meals || []).forEach(m => {
      if (!MEAL_ORDER.includes(m.meal)) { problems.push(`餐別「${m.meal}」不認得（要 breakfast／lunch／dinner／snack）`); return; }
      (grouped[m.meal] = grouped[m.meal] || []).push(m);
    });
    Object.entries(grouped).forEach(([key, ms]) => {
      const kc = ms.map(m => toNum(m.kcal)).filter(v => v !== null);
      const pr = ms.map(m => toNum(m.protein)).filter(v => v !== null);
      setMealRow(key, {
        desc: ms.map(m => m.desc || "").filter(Boolean).join("；"),
        kcal: kc.length ? kc.reduce((a, b) => a + b, 0) : null,
        protein: pr.length ? pr.reduce((a, b) => a + b, 0) : null,
        eatOut: ms.some(m => truthy(m.eatOut)),
        sugarDrink: ms.some(m => truthy(m.sugarDrink)),
      });
      filled++;
    });
    const exs = Array.isArray(data.exercise) ? data.exercise : [];
    let otherUsed = false;
    exs.forEach(x => {
      const mins = parseStrictNumber(x.minutes);
      if (mins === null) { problems.push(`運動時間「${x.minutes}」不是有效數字`); return; }
      if (x.type === "pickleball") {
        $("exPickleMin").value = mins;
        $("exPickleRpe").value = x.rpe ? String(x.rpe) : "";
        $("exPickleKcal").value = x.kcal === undefined || x.kcal === "" ? "" : x.kcal;
      } else if (["lowimpact", "strength", "walk", "other"].includes(x.type)) {
        if (otherUsed) { problems.push("表單一天只放得下一筆非打球運動，其餘沒填入"); return; }
        otherUsed = true;
        $("exOtherType").value = x.type;
        $("exOtherMin").value = mins;
        $("exOtherRpe").value = x.rpe ? String(x.rpe) : "";
      } else { problems.push(`運動類型「${x.type}」不認得`); return; }
      if (x.note) $("exNote").value = x.note;
      filled++;
    });
    updatePreview();
    const notes = [`已填入 ${filled} 項，請核對後按「儲存」（熱量、蛋白質是估計值）`];
    problems.forEach(t => notes.push("⚠️ " + t));
    const d = $("dayDate").value;
    if (state.sleep.some(r => r.date === d) || state.meals.some(r => r.date === d) || state.exercise.some(r => r.date === d)) notes.push("⚠️ 這一天已經有紀錄，儲存會覆蓋有送出的睡眠與餐別");
    msg.textContent = notes.join("；");
  });

  // ---- 統計與目標 ----
  function rangeDates() {
    const end = today();
    return { start: dateAddDays(end, -(state.range - 1)), end };
  }

  function makeTile(label, valueText, badge, sub) {
    const tile = document.createElement("div");
    tile.className = "bp-stat-tile";
    const v = document.createElement("div");
    v.className = "bp-stat-value";
    v.textContent = valueText;
    const l = document.createElement("div");
    l.className = "bp-stat-label";
    l.textContent = label;
    tile.append(v, l);
    if (sub) {
      const d = document.createElement("div");
      d.className = "tile-delta";
      d.textContent = sub;
      tile.appendChild(d);
    }
    if (badge) tile.appendChild(buildLevelBadge(badge.level, badge.text));
    return tile;
  }

  function sleepInRange() {
    const { start, end } = rangeDates();
    return state.sleep.filter(r => r.date >= start && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  }

  function renderStats() {
    const row = $("dayStatsRow");
    row.innerHTML = "";
    const { start, end } = rangeDates();
    const sl = sleepInRange();
    const hours = sl.map(r => toNum(r.hours)).filter(v => v !== null);
    if (hours.length) {
      const avgH = hours.reduce((a, b) => a + b, 0) / hours.length;
      const last = sl[sl.length - 1];
      row.appendChild(makeTile("最近一晚睡眠 h", String(roundTo(toNum(last.hours), 1)), null, fmtMD(last.date)));
      const lv = avgH >= 7 ? { level: "good", text: "足夠" } : avgH >= 6 ? { level: "warning", text: "略少" } : { level: "serious", text: "偏少" };
      row.appendChild(makeTile(`平均睡眠 h（${hours.length} 天）`, String(roundTo(avgH, 1)), lv));
      const bs = bedtimeStats(sl);
      if (bs) {
        let badge = null;
        if (bs.sd !== null) badge = bs.sd <= 30 ? { level: "good", text: "規律" } : bs.sd <= 60 ? { level: "warning", text: "略不規律" } : { level: "serious", text: "不規律" };
        row.appendChild(makeTile("平均上床", bs.avg, badge, bs.sd === null ? "" : `前後約 ${bs.sd} 分`));
      }
      const en = sl.map(r => toNum(r.energy)).filter(v => v !== null);
      if (en.length) row.appendChild(makeTile("白天精神（1–10）", String(roundTo(en.reduce((a, b) => a + b, 0) / en.length, 1))));
    }
    const wNow = avgWeightIn(state.inbody, end, 7);
    if (wNow !== null) {
      const wPrev = avgWeightIn(state.inbody, dateAddDays(end, -7), 7);
      const delta = wPrev === null ? "" : (wNow - wPrev === 0 ? "與前 7 天持平" : `${wNow > wPrev ? "▲" : "▼"} ${roundTo(Math.abs(wNow - wPrev), 1)} kg（比前 7 天）`);
      row.appendChild(makeTile("體重 7 日平均 kg", String(roundTo(wNow, 1)), null, delta));
    }
    const totals = mealDayTotals(state.meals.filter(m => m.date >= start && m.date <= end));
    const days = Object.keys(totals);
    if (days.length) {
      const kd = days.filter(d => totals[d].hasKcal && !totals[d].partial && totals[d].complete);
      row.appendChild(makeTile(`飲食紀錄天數`, `${days.length}/${state.range}`));
      if (kd.length) row.appendChild(makeTile(`平均熱量 kcal（${kd.length} 天完整）`, fmtNum(kd.reduce((a, d) => a + totals[d].kcal, 0) / kd.length), null, `目標 ${fmtNum(HEALTH_GOALS.kcal)}`));
      const pd = days.filter(d => totals[d].hasProtein && !totals[d].partial && totals[d].complete);
      if (pd.length) row.appendChild(makeTile(`平均蛋白質 g（${pd.length} 天）`, fmtNum(pd.reduce((a, d) => a + totals[d].protein, 0) / pd.length), null, `目標 ${HEALTH_GOALS.protein[0]}–${HEALTH_GOALS.protein[1]}`));
    }
    const exIn = state.exercise.filter(x => x.date >= start && x.date <= end);
    if (exIn.length) {
      const mins = exIn.reduce((a, x) => a + (toNum(x.minutes) || 0), 0);
      const pk = exIn.filter(x => x.type === "pickleball").length;
      row.appendChild(makeTile("運動分鐘", fmtNum(mins), null, `${exIn.length} 次${pk ? `（打球 ${pk} 次）` : ""}`));
    }
    if (!row.children.length) row.innerHTML = `<p class="empty-hint">這段期間還沒有紀錄（沒記的日子就是「未記錄」，不算失敗）</p>`;
    $("dayStatsMeta").textContent = "熱量與蛋白質平均只統計「勾了『這天的餐都記完了』且每餐都有估計值」的日子；少記的日子不計入，避免平均被低估。";
  }

  function renderGoals() {
    const box = $("goalBox");
    box.innerHTML = "";
    const c = HEALTH_GOALS.cycle;
    const end = today();
    const sorted = [...state.inbody].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted.length ? sorted[sorted.length - 1] : null;
    const cur = avgWeightIn(state.inbody, end, 7) ?? (latest ? toNum(latest.weight) : null);
    const weekNo = Math.min(c.weeks, Math.max(1, Math.floor((new Date(end + "T00:00:00") - new Date(c.startDate + "T00:00:00")) / (7 * 86400000)) + 1));
    const before = end < c.startDate;
    const line = (text) => { const p = document.createElement("p"); p.className = "progress-text"; p.textContent = text; box.appendChild(p); };
    const bar = (pct) => {
      const b = document.createElement("div"); b.className = "progress-bar";
      const f = document.createElement("div"); f.className = "progress-fill"; f.style.width = pct + "%";
      b.appendChild(f); box.appendChild(b);
    };
    if (cur === null) { box.innerHTML = `<p class="empty-hint">還沒有體重紀錄</p>`; return; }
    const curR = roundTo(cur, 1);
    const lost = roundTo(c.startWeight - cur, 1);
    const need = roundTo(c.startWeight - c.high, 1), full = roundTo(c.startWeight - c.low, 1);
    line(before
      ? `${c.weeks} 週計畫從 ${fmtMD(c.startDate)} 開始（起始 ${c.startWeight} kg，目標 ${c.low}–${c.high} kg）`
      : `${c.weeks} 週計畫・第 ${weekNo} 週：目前 ${curR} kg（7 日平均），已減 ${lost} kg；目標減 ${need}–${full} kg（${c.low}–${c.high} kg）`);
    if (!before) {
      bar(Math.min(100, Math.max(0, (lost / full) * 100)));
      line(`依每週 0.25–0.5 kg，第 ${weekNo} 週結束時大約會減 ${roundTo(0.25 * weekNo, 2)}–${roundTo(0.5 * weekNo, 2)} kg；單日起伏不代表失敗，看 7 日平均。`);
    }
    const finalRemain = roundTo(cur - HEALTH_GOALS.finalWeight, 1);
    line(finalRemain > 0 ? `終極目標 ${HEALTH_GOALS.finalWeight} kg：還差 ${finalRemain} kg` : `已達成終極目標 ${HEALTH_GOALS.finalWeight} kg 🎉`);
    bar(Math.min(100, Math.max(0, ((c.startWeight - cur) / (c.startWeight - HEALTH_GOALS.finalWeight)) * 100)));
    line(`每日參考：熱量約 ${fmtNum(HEALTH_GOALS.kcal)} kcal、蛋白質 ${HEALTH_GOALS.protein[0]}–${HEALTH_GOALS.protein[1]} g（估計目標，不是醫療處方）`);
  }

  // ---- 圖表 ----
  function chartPoints() {
    const { start, end } = rangeDates();
    if (state.chartKey === "sleep") {
      return sleepInRange().map(r => ({ date: r.date, value: toNum(r.hours) })).filter(p => p.value !== null);
    }
    const totals = mealDayTotals(state.meals.filter(m => m.date >= start && m.date <= end));
    const key = state.chartKey;
    return Object.keys(totals)
      .filter(d => (key === "kcal" ? totals[d].hasKcal : totals[d].hasProtein) && !totals[d].partial && totals[d].complete)
      .map(d => ({ date: d, value: key === "kcal" ? totals[d].kcal : totals[d].protein }));
  }

  function renderChart() {
    const k = state.chartKey;
    const opts = {
      sleep: { unit: "小時", color: "var(--series-pulse)", bands: [{ from: 7, to: 9, level: "good", label: "參考 7–9 小時" }] },
      kcal: { unit: "kcal", decimals: 0, color: "var(--series-diastolic)", bands: [{ from: HEALTH_GOALS.kcal - 100, to: HEALTH_GOALS.kcal + 100, level: "good", label: `目標 ${HEALTH_GOALS.kcal}` }] },
      protein: { unit: "g", decimals: 0, color: "var(--series-systolic)", bands: [{ from: HEALTH_GOALS.protein[0], to: HEALTH_GOALS.protein[1], level: "good", label: `目標 ${HEALTH_GOALS.protein[0]}–${HEALTH_GOALS.protein[1]} g` }] },
    }[k];
    drawTimeChart($("dayChart"), chartPoints(), { ...opts, highlightLast: true });
  }

  // ---- 每日紀錄列表 ----
  function renderList() {
    const box = $("dayList");
    box.innerHTML = "";
    const totals = mealDayTotals(state.meals);
    const dates = new Set([...state.sleep.map(r => r.date), ...state.meals.map(r => r.date), ...state.exercise.map(r => r.date), ...state.inbody.map(r => r.date)]);
    const sorted = [...dates].sort().reverse().slice(0, 30);
    if (!sorted.length) { box.innerHTML = `<p class="empty-hint">還沒有紀錄</p>`; return; }
    const ul = document.createElement("ul");
    ul.className = "item-list";
    sorted.forEach(date => {
      const li = document.createElement("li");
      li.className = "item-row health-record-row";
      const badge = document.createElement("span");
      badge.className = "owner-badge";
      badge.textContent = fmtHealthDate(date);
      const parts = [];
      const s = state.sleep.find(r => r.date === date);
      if (s) parts.push(`睡 ${roundTo(toNum(s.hours), 1)} h（${s.bedtime}→${s.wakeTime}）`);
      const w = state.inbody.find(r => r.date === date);
      if (w && toNum(w.weight) !== null) parts.push(`${w.weight} kg`);
      const t = totals[date];
      if (t) {
        const k = t.hasKcal ? `${fmtNum(t.kcal)} kcal${t.partial ? "+" : ""}` : "熱量未估計";
        parts.push(`${t.count} 餐・${k}${t.hasProtein ? `・蛋白 ${fmtNum(t.protein)} g` : ""}${t.complete ? "" : "（未標記記完）"}`);
      }
      const dayEx = state.exercise.filter(x => x.date === date);
      if (dayEx.length) parts.push(dayEx.map(x => `${EX_LABELS[x.type] || x.type} ${x.minutes} 分`).join("、"));
      const main = document.createElement("span");
      main.className = "item-text";
      main.textContent = parts.join("　");
      main.title = "點一下載入這天到上面的表單";
      main.style.cursor = "pointer";
      main.addEventListener("click", () => { loadDate(date); $("dayForm").scrollIntoView({ behavior: "smooth", block: "start" }); });
      li.append(badge, main);
      if (s) li.appendChild(delBtn("睡眠", li, () => api("deleteSleep", { id: s.id }), (d) => { state.sleep = d; }));
      const dayMeals = state.meals.filter(m => m.date === date);
      if (dayMeals.length) li.appendChild(delBtn("餐點", li, async () => {
        let last = null;
        for (const m of dayMeals) last = await api("deleteMeal", { id: m.id });
        return last;
      }, (d) => { state.meals = d; }));
      const dayEx2 = state.exercise.filter(x => x.date === date);
      if (dayEx2.length) li.appendChild(delBtn("運動", li, async () => {
        let last = null;
        for (const x of dayEx2) last = await api("deleteExercise", { id: x.id });
        return last;
      }, (d) => { state.exercise = d; }));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    if (totals && Object.values(totals).some(t => t.partial)) {
      const p = document.createElement("p");
      p.className = "progress-line";
      p.textContent = "熱量後面的「+」代表當天有餐點沒估熱量，實際比顯示的多。";
      box.appendChild(p);
    }
  }

  function delBtn(label, li, call, applyFn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "delete-btn";
    b.textContent = `刪${label}`;
    b.title = `刪除這天的${label}紀錄`;
    b.addEventListener("click", () => withRowLock(b, async () => {
      if (!(await showConfirm(`確定刪除這天的${label}紀錄？（體重請到「體組成」分頁刪）`))) return;
      try {
        applyFn(await call());
        state.version++;
        renderAll();
        loadDate($("dayDate").value || today());
        showToast(`已刪除${label}紀錄`);
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    }));
    return b;
  }

  function renderAll() {
    renderGoals();
    renderStats();
    renderChart();
    renderList();
  }

  $("dayRange").addEventListener("change", (e) => { state.range = Number(e.target.value); renderStats(); renderChart(); });
  $("dayChartItem").addEventListener("change", (e) => { state.chartKey = e.target.value; renderChart(); });

  // 體組成分頁登記體重後，這邊也要跟著更新
  window.addEventListener("health:inbody", (e) => {
    if (e.detail === state.inbody) return;
    state.inbody = e.detail;
    renderAll();
  });

  // 初始化
  const energy = $("dayEnergy");
  for (let i = 1; i <= 10; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = String(i); energy.appendChild(o); }
  ["exPickleRpe", "exOtherRpe"].forEach(id => { for (let i = 1; i <= 10; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = `RPE ${i}`; $(id).appendChild(o); } });
  buildMealRows();
  $("dayDate").value = today();

  window.healthLoaders = window.healthLoaders || [];
  window.healthLoaders.push({ tab: "today", load: async () => {
    const v = state.version;
    const [daily, inbody] = await Promise.all([api("getDailyHealth"), api("getInBodyData")]);
    if (state.version !== v) return;
    state.sleep = daily.sleep || [];
    state.meals = daily.meals || [];
    state.exercise = daily.exercise || [];
    state.inbody = inbody || [];
    if (!state.loadedDate) loadDate(today());
    renderAll();
  } });
})();
