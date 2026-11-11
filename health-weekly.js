// ====== 健康頁「今日」分頁：每週回顧 ======
// 週一到週日為一週（跟週期習慣的週一一致）。頁面負責「算數字＋寫出計算依據」，
// 解讀與建議交給 Claude：按「複製本週摘要」把純文字（只有日期與數字）貼給 Claude，
// 分析後把「教練備註」貼回來，存進 Sheet（WeekReview）累積成歷史。
// 缺資料一律是「未記錄」，不當 0；建議只是規則式提醒，不是醫療診斷。
// 依賴 health-charts.js（toNum / roundTo / toDateStr）與 health-today.js（bedtimeStats / mealDayTotals / dateAddDays / HEALTH_GOALS）。

const isTrueVal = (v) => v === true || v === "true" || v === "TRUE";

// 某日期所在那週的週一（yyyy-MM-dd）
function weekStartOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}

function avgOf(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

// data: { sleep, meals, exercise, inbody, bp }（都是 Sheet 讀回來的列）
function buildWeeklySummary(data, weekStart) {
  const end = dateAddDays(weekStart, 6);
  const inWeek = (r) => r.date >= weekStart && r.date <= end;
  const prevStart = dateAddDays(weekStart, -7), prevEnd = dateAddDays(weekStart, -1);
  const inPrev = (r) => r.date >= prevStart && r.date <= prevEnd;

  const wk = (rows) => rows.map(r => toNum(r.weight)).filter(v => v !== null);
  const wNow = wk((data.inbody || []).filter(inWeek)), wPrev = wk((data.inbody || []).filter(inPrev));
  const weight = { n: wNow.length, avg: avgOf(wNow), prevN: wPrev.length, prevAvg: avgOf(wPrev) };
  weight.change = weight.avg !== null && weight.prevAvg !== null ? weight.avg - weight.prevAvg : null;

  const sl = (data.sleep || []).filter(inWeek);
  const hours = sl.map(r => toNum(r.hours)).filter(v => v !== null);
  const bs = bedtimeStats(sl);
  const sleep = {
    n: sl.length, avgHours: avgOf(hours), bedtimeAvg: bs ? bs.avg : null, bedtimeSd: bs ? bs.sd : null,
    napDays: sl.filter(r => isTrueVal(r.nap)).length,
    cpapYes: sl.filter(r => r.cpap === "yes").length, cpapNo: sl.filter(r => r.cpap === "no").length,
    energyAvg: avgOf(sl.map(r => toNum(r.energy)).filter(v => v !== null)),
  };

  const ml = (data.meals || []).filter(inWeek);
  const totals = mealDayTotals(ml);
  const days = Object.keys(totals);
  const full = days.filter(d => totals[d].complete && !totals[d].partial);
  const meals = {
    loggedDays: days.length,
    completeDays: full.length,
    avgKcal: avgOf(full.filter(d => totals[d].hasKcal).map(d => totals[d].kcal)),
    avgProtein: avgOf(full.filter(d => totals[d].hasProtein).map(d => totals[d].protein)),
    eatOut: ml.filter(m => isTrueVal(m.eatOut)).length,
    sugarDrink: ml.filter(m => isTrueVal(m.sugarDrink)).length,
    mealCount: ml.length,
  };

  const ex = (data.exercise || []).filter(inWeek);
  const exercise = {
    sessions: ex.length,
    minutes: ex.reduce((a, x) => a + (toNum(x.minutes) || 0), 0),
    pickleSessions: ex.filter(x => x.type === "pickleball").length,
    pickleMinutes: ex.filter(x => x.type === "pickleball").reduce((a, x) => a + (toNum(x.minutes) || 0), 0),
    otherMinutes: ex.filter(x => x.type !== "pickleball").reduce((a, x) => a + (toNum(x.minutes) || 0), 0),
    rpeAvg: avgOf(ex.map(x => toNum(x.rpe)).filter(v => v !== null)),
  };

  const bpRows = (data.bp || []).filter(inWeek);
  const sys = bpRows.map(r => toNum(r.systolic)).filter(v => v !== null);
  const dia = bpRows.map(r => toNum(r.diastolic)).filter(v => v !== null);
  const bp = {
    n: bpRows.length, avgSys: avgOf(sys), avgDia: avgOf(dia),
    highCount: bpRows.filter(r => toNum(r.systolic) >= 140 || toNum(r.diastolic) >= 90).length,
  };

  return { weekStart, weekEnd: end, weight, sleep, meals, exercise, bp };
}

const fmt1 = (v) => (v === null ? "未記錄" : String(roundTo(v, 1)));
const fmt0 = (v) => (v === null ? "未記錄" : String(Math.round(v)));

// 每一項的文字說明（含計算依據），頁面顯示與複製給 Claude 共用
function weeklyLines(sum) {
  const w = sum.weight, s = sum.sleep, m = sum.meals, e = sum.exercise, b = sum.bp;
  const lines = [];
  lines.push(`體重：本週平均 ${fmt1(w.avg)} kg（量 ${w.n} 次）；上週平均 ${fmt1(w.prevAvg)} kg（量 ${w.prevN} 次）；` +
    (w.change === null ? "變化：無法比較（有一週沒紀錄）" : `變化 ${w.change > 0 ? "+" : ""}${roundTo(w.change, 1)} kg`));
  lines.push(`睡眠：記了 ${s.n} 天；平均 ${fmt1(s.avgHours)} 小時；平均上床 ${s.bedtimeAvg || "未記錄"}` +
    (s.bedtimeSd === null ? "" : `（前後約 ${s.bedtimeSd} 分）`) + `；有打瞌睡 ${s.napDays} 天；CPAP 有戴 ${s.cpapYes} 晚、沒戴 ${s.cpapNo} 晚（其餘未記錄）；白天精神平均 ${fmt1(s.energyAvg)}`);
  lines.push(`飲食：有記餐點 ${m.loggedDays} 天（共 ${m.mealCount} 餐）；標記「記完」且熱量完整的 ${m.completeDays} 天；那些天平均 ${fmt0(m.avgKcal)} kcal（目標約 ${HEALTH_GOALS.kcal}）、蛋白質 ${fmt0(m.avgProtein)} g（目標 ${HEALTH_GOALS.protein[0]}–${HEALTH_GOALS.protein[1]}）；外食 ${m.eatOut} 餐、含糖飲料 ${m.sugarDrink} 次`);
  lines.push(`運動：共 ${e.sessions} 次、${e.minutes} 分鐘（打球 ${e.pickleSessions} 次 ${e.pickleMinutes} 分、其他 ${e.otherMinutes} 分）；平均強度 RPE ${fmt1(e.rpeAvg)}`);
  lines.push(`血壓：量了 ${b.n} 次；平均 ${b.n ? `${fmt0(b.avgSys)}/${fmt0(b.avgDia)}` : "未記錄"}；偏高（收縮壓≥140 或舒張壓≥90）${b.highCount} 次`);
  return lines;
}

// 規則式的簡單提醒（只在資料不夠或明顯偏離時出現，不是醫療建議）
function weeklyHints(sum) {
  const h = [];
  const w = sum.weight, s = sum.sleep, m = sum.meals;
  if (w.n < 3) h.push(`體重這週只量了 ${w.n} 次，建議每週 3 次以上（早上、吃東西前）`);
  if (m.completeDays < 4) h.push(`餐點「記完」的天數只有 ${m.completeDays} 天，先把記錄習慣養起來，平均熱量才有參考價值`);
  if (s.n < 4) h.push(`睡眠只記了 ${s.n} 天，樣本偏少`);
  else if (s.avgHours !== null && s.avgHours < 6) h.push(`平均睡眠 ${fmt1(s.avgHours)} 小時偏少，可優先改善就寢時間`);
  if (w.change !== null && w.change > 0.5) h.push("平均體重比上週高，單週起伏常是水分或鹽分，先看連續 2 週的趨勢");
  return h;
}

// 複製給 Claude 的純文字（只有日期與數字，沒有姓名或其他個人資料）
function weeklySummaryText(sum, extra) {
  extra = extra || {};
  const c = HEALTH_GOALS.cycle;
  const head = [
    `【每週健康摘要】${sum.weekStart} ～ ${sum.weekEnd}（週一到週日）`,
    `計畫：${c.weeks} 週計畫從 ${c.startDate} 開始，起始 ${c.startWeight} kg，目標 ${c.low}–${c.high} kg；終極目標 ${HEALTH_GOALS.finalWeight} kg；每日參考熱量約 ${HEALTH_GOALS.kcal} kcal、蛋白質 ${HEALTH_GOALS.protein[0]}–${HEALTH_GOALS.protein[1]} g。`,
    "說明：熱量與蛋白質是照片／口述的估計值；沒填的項目是「未記錄」不是 0；只有標記「記完」的日子才納入平均。",
  ];
  const body = weeklyLines(sum).map(t => "・" + t);
  const tail = [];
  const hints = weeklyHints(sum);
  if (hints.length) tail.push("頁面規則式提醒：" + hints.join("；"));
  if (extra.prevNote) tail.push(`上週的教練備註：${extra.prevNote}`);
  tail.push("請依 weekly-review 的分析步驟解讀（先看資料夠不夠，兩週以上才反推實際消耗），最多給 2 個建議，並附一段可貼回「教練備註」的文字。");
  return [...head, ...body, ...tail].join("\n");
}

// ====== UI ======
(function () {
  const $ = (id) => document.getElementById(id);
  const st = { data: { sleep: [], meals: [], exercise: [], inbody: [], bp: [] }, reviews: [], weekStart: "", version: 0 };

  function thisMonday() { return weekStartOf(toDateStr(new Date())); }

  function weekOptions() {
    const cur = thisMonday();
    const opts = [];
    for (let i = 0; i < 9; i++) {
      const start = dateAddDays(cur, -7 * i);
      const label = `${start.slice(5).replace("-", "/")}–${dateAddDays(start, 6).slice(5).replace("-", "/")}${i === 0 ? "（本週，進行中）" : i === 1 ? "（上週）" : ""}`;
      opts.push({ start, label });
    }
    return opts;
  }

  function noteFor(weekStart) {
    const r = st.reviews.find(x => x.weekStart === weekStart);
    return r ? r.note : "";
  }

  function render() {
    const sel = $("weekSel");
    if (!sel.options.length) {
      weekOptions().forEach(o => { const el = document.createElement("option"); el.value = o.start; el.textContent = o.label; sel.appendChild(el); });
      st.weekStart = dateAddDays(thisMonday(), -7); // 預設看上週（整週）
    }
    sel.value = st.weekStart;
    const sum = buildWeeklySummary(st.data, st.weekStart);
    const box = $("weeklyBody");
    box.innerHTML = "";
    const ul = document.createElement("ul");
    ul.className = "weekly-lines";
    weeklyLines(sum).forEach(t => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
    box.appendChild(ul);
    const hints = weeklyHints(sum);
    if (hints.length) {
      const p = document.createElement("p");
      p.className = "progress-line";
      p.textContent = "💡 " + hints.join("；");
      box.appendChild(p);
    }
    $("weekNote").value = noteFor(st.weekStart);
    const open = st.weekStart === thisMonday();
    $("weekOpenHint").textContent = open ? "這週還沒結束，數字會隨紀錄變動；建議週日晚上或週一再看完整的一週。" : "";
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 退回舊作法 */ }
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  $("weekSel").addEventListener("change", (e) => { st.weekStart = e.target.value; render(); });

  $("weekCopyBtn").addEventListener("click", async () => {
    const sum = buildWeeklySummary(st.data, st.weekStart);
    const prevNote = noteFor(dateAddDays(st.weekStart, -7));
    const text = weeklySummaryText(sum, { prevNote });
    if (await copyText(text)) showToast("已複製本週摘要，貼給 Claude 分析");
    else showAlert("無法自動複製，請手動選取下面這段：\n\n" + text);
  });

  $("weekNoteSave").addEventListener("click", async () => {
    const note = $("weekNote").value.trim();
    const btn = $("weekNoteSave");
    btn.disabled = true;
    try {
      st.reviews = await api("addWeekReview", { weekStart: st.weekStart, note });
      st.version++;
      render();
      showToast(note ? "已存教練備註" : "已清除這週的教練備註");
    } catch (err) {
      setStatus("儲存失敗：" + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  $("weekInfoBtn").addEventListener("click", () => $("weekInfoBox").classList.toggle("hidden"));

  // 「今日」分頁的資料（睡眠、餐點、運動、體重）有變動就更新
  window.addEventListener("health:data", (e) => {
    Object.assign(st.data, e.detail);
    render();
  });

  window.healthLoaders = window.healthLoaders || [];
  window.healthLoaders.push({ tab: "today", load: async () => {
    const v = st.version;
    const [reviews, bp] = await Promise.all([api("getWeekReviews"), api("getBloodPressureData").catch(() => [])]);
    if (st.version !== v) return;
    st.reviews = reviews || [];
    st.data.bp = bp || [];
    render();
  } });
})();
