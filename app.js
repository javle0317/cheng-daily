// ====== 設定 ======
// WEBAPP_URL / PASSWORD_KEY / api() / 登入流程 / 確認彈窗都在 shared.js，
// 跟 health.js 共用。

const OWNER_META = {
  me: { label: "承承", icon: "🧑", color: "#4f6df5" },
  wife: { label: "君君", icon: "👩", color: "#e0699a" },
  "林萌": { label: "林萌", icon: "🐕", color: "#c9852f" },
  "咪嚕": { label: "咪嚕", icon: "🐈", color: "#8a5fd6" },
  shared: { label: "一起", icon: "🤝", color: "#3fa373" },
};

const PET_NAMES = ["林萌", "咪嚕"]; // 之後又養新寵物，這裡跟 Code.gs 的 PET_NAMES 都要加

// ====== State ======
let state = {
  goals: [],
  events: [],
  habits: [],
  habitLogs: [],
  recurringEvents: [],
  recurringExceptions: [],
  shoppingList: [],
  shoppingLoaded: false,
  holidayDates: new Set(),
  selectedDate: toDateStr(new Date()),
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  petExpenseMonth: new Date().getMonth(),
  petExpenseYear: new Date().getFullYear(),
  petExpenseFilter: "all",
};

// ====== Utils ======
// toDateStr / setStatus / showToast / setFormBusy 在 shared.js
function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}`;
}

function splitTextAndLink(text) {
  const urlMatch = text.match(/https?:\/\/\S+/);
  const restText = urlMatch ? text.replace(urlMatch[0], "").trim() : text;
  return { restText, url: urlMatch ? urlMatch[0] : null };
}

// icon 用來區分連結性質（地點用 📍、其他純連結用 🔗），把網址本身藏起來只留 icon 可點
function appendTextAndLink(li, text, { textPrefix = "", linkIcon = "🔗" } = {}) {
  const { restText, url } = splitTextAndLink(text);
  if (restText) {
    const span = document.createElement("span");
    span.className = "item-time";
    span.textContent = textPrefix ? `${textPrefix} ${restText}` : restText;
    li.appendChild(span);
  }
  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = linkIcon;
    link.addEventListener("click", (e) => e.stopPropagation());
    li.appendChild(link);
  }
  return { restText, url };
}

function isWorkday(dateStr) {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day >= 1 && day <= 5 && !state.holidayDates.has(dateStr);
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return toDateStr(d);
}

function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function getPeriodKey(habit, dateStr) {
  if (habit.frequency === "weekly") return getWeekStart(dateStr);
  if (habit.frequency === "monthly") return getMonthKey(dateStr);
  return dateStr;
}

function matchesRecurringRule(rule, dateStr) {
  // 有設截止日：截止日當天（含）之後就不再出現
  if (rule.endDate && dateStr > String(rule.endDate)) return false;
  const d = new Date(dateStr + "T00:00:00");
  if (rule.frequency === "weekly") return d.getDay() === Number(rule.dayOfWeek);
  if (rule.frequency === "monthly") return d.getDate() === Number(rule.dayOfMonth);
  return false;
}

function expandRecurringForDate(dateStr) {
  const skipped = new Set(
    state.recurringExceptions.filter(ex => ex.date === dateStr).map(ex => ex.recurringId)
  );
  return state.recurringEvents
    .filter(r => matchesRecurringRule(r, dateStr) && !skipped.has(r.id))
    .map(r => ({
      id: `rec_${r.id}_${dateStr}`,
      ruleId: r.id,
      date: dateStr,
      owner: r.owner,
      time: r.time,
      endTime: r.endTime,
      title: r.title,
      notes: r.notes,
      recurring: true,
    }));
}

function getHabitLogCount(habitId, periodKey) {
  const log = state.habitLogs.find(l => l.habitId === habitId && String(l.periodKey) === String(periodKey));
  return log ? Number(log.count) || 0 : 0;
}

function computeStreak(habit) {
  let streak = 0;
  const cursor = new Date();
  const workdaysOnly = habit.workdaysOnly === true || habit.workdaysOnly === "TRUE";
  const todayStr = toDateStr(cursor);
  for (let i = 0; i < 365; i++) {
    const dateStr = toDateStr(cursor);
    if (workdaysOnly && !isWorkday(dateStr)) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    const done = getHabitLogCount(habit.id, dateStr) >= Number(habit.target || 1);
    if (!done) {
      // 只有「今天」還沒做不算斷連續，從前一天開始往回算；其他任何一天沒做就是斷了
      // （僅工作日的習慣在週末/假日打開時，今天本身會被跳過，不能把前一個工作日的漏做也當成寬限）
      if (dateStr === todayStr) { cursor.setDate(cursor.getDate() - 1); continue; }
      break;
    }
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// 歷史統計：最長連續天數、本月完成次數。連續天數的規則跟 computeStreak 一致
// （僅工作日的習慣跳過非工作日；今天還沒做不算斷）。紀錄全部保留在 HabitLog，
// 所以從該習慣最早一筆往今天掃一遍就好。
function computeHabitStats(habit) {
  const workdaysOnly = habit.workdaysOnly === true || habit.workdaysOnly === "TRUE";
  const target = Number(habit.target || 1);
  const logs = state.habitLogs.filter(l => l.habitId === habit.id && Number(l.count) >= target);
  const monthKey = getMonthKey(toDateStr(new Date()));
  const monthCount = logs.filter(l => String(l.periodKey).startsWith(monthKey)).length;
  if (!logs.length) return { longest: 0, monthCount };

  const first = logs.map(l => String(l.periodKey)).sort()[0];
  const doneDates = new Set(logs.map(l => String(l.periodKey)));
  const todayStr = toDateStr(new Date());
  const cursor = new Date(first + "T00:00:00");
  let run = 0, longest = 0;
  for (let guard = 0; guard < 3700; guard++) {
    const dateStr = toDateStr(cursor);
    if (dateStr > todayStr) break;
    if (!(workdaysOnly && !isWorkday(dateStr))) {
      if (doneDates.has(dateStr)) {
        run++;
        if (run > longest) longest = run;
      } else if (dateStr !== todayStr) {
        run = 0;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { longest, monthCount };
}

// ====== 每週／每月習慣的連續統計 ======
// 一期 = 一週（key 是週一日期）或一個月（key 是 yyyy-MM）；達標 = 該期完成次數 >= target。
// 規則跟每日一致：「這一期」還沒達標不算斷，從上一期開始往回數。
function previousPeriodKey(habit, key) {
  if (habit.frequency === "weekly") {
    const d = new Date(key + "T00:00:00");
    d.setDate(d.getDate() - 7);
    return toDateStr(d);
  }
  const [y, m] = key.split("-").map(Number); // 月份用年/月算術，不用 Date 加減（避免 31 號溢位）
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function isPeriodDone(habit, key) {
  return getHabitLogCount(habit.id, key) >= Number(habit.target || 1);
}

function computePeriodStreak(habit) {
  let key = getPeriodKey(habit, toDateStr(new Date()));
  if (!isPeriodDone(habit, key)) key = previousPeriodKey(habit, key);
  let streak = 0;
  for (let i = 0; i < 520 && isPeriodDone(habit, key); i++) {
    streak++;
    key = previousPeriodKey(habit, key);
  }
  return streak;
}

// 歷史最長連續期數，以及補充統計：週習慣 = 本月達標週數，月習慣 = 今年達標月數
function computePeriodStats(habit) {
  const nowKey = getPeriodKey(habit, toDateStr(new Date()));
  const doneKeys = state.habitLogs
    .filter(l => l.habitId === habit.id && Number(l.count) >= Number(habit.target || 1))
    .map(l => String(l.periodKey));
  const todayStr = toDateStr(new Date());
  const extraPrefix = habit.frequency === "weekly" ? getMonthKey(todayStr) : todayStr.slice(0, 4);
  const extra = doneKeys.filter(k => k.startsWith(extraPrefix)).length;
  if (!doneKeys.length) return { longest: 0, extra };

  const first = [...doneKeys].sort()[0];
  let key = nowKey, run = 0, longest = 0;
  for (let i = 0; i < 1200 && key >= first; i++) {
    if (isPeriodDone(habit, key)) {
      run++;
      if (run > longest) longest = run;
    } else if (key !== nowKey) {
      run = 0;
    }
    key = previousPeriodKey(habit, key);
  }
  return { longest, extra };
}

// 最近 n 期（含這一期），由舊到新，給長條圖用
function getPeriodHistory(habit, n = 6) {
  const out = [];
  let key = getPeriodKey(habit, toDateStr(new Date()));
  const target = Number(habit.target || 1);
  for (let i = 0; i < n; i++) {
    out.unshift({ key, count: getHabitLogCount(habit.id, key), target, current: i === 0 });
    key = previousPeriodKey(habit, key);
  }
  return out;
}

function periodStreakDetail(habit) {
  const unit = habit.frequency === "weekly" ? "週" : "個月";
  const stats = computePeriodStats(habit);
  const extraText = habit.frequency === "weekly" ? `本月達標 ${stats.extra} 週` : `今年達標 ${stats.extra} 個月`;
  const streak = computePeriodStreak(habit);
  return { streak, show: streak > 0 || stats.longest > 0, detail: `目前連續 ${streak} ${unit} · 歷史最長 ${stats.longest} ${unit} · ${extraText}` };
}

const openStreakHabitIds = new Set();

// ====== API ======
// 寫入動作只會回傳自己動到的集合（後端 getData(keys)），所以只覆蓋回傳裡有的欄位；
// 登入時的 getData 是整包，每個欄位都有。
function applyData(data) {
  if (data.goals) state.goals = data.goals;
  if (data.events) state.events = data.events;
  if (data.habits) state.habits = data.habits;
  if (data.habitLogs) state.habitLogs = data.habitLogs;
  if (data.recurringEvents) state.recurringEvents = data.recurringEvents;
  if (data.recurringExceptions) state.recurringExceptions = data.recurringExceptions;
  if (data.shoppingList) { state.shoppingList = data.shoppingList; state.shoppingLoaded = true; }
  if (data.holidays) state.holidayDates = new Set(data.holidays.map(h => h.date));
}

// api() / showLockScreen / showLockLoading / showApp / tryUnlock / lockForm
// 與 logoutBtn 監聽都在 shared.js，這裡只提供 shared.js 需要呼叫的進入點。
window.loadPageData = async function () {
  // 清單（購物/想法）要打開 📝 才看得到，登入時先不讀，打開時再載入
  applyData(await api("getData", { keys: "goals,events,habits,habitLogs,recurringEvents,recurringExceptions,holidays" }));
  renderAll();
  refreshCalSync(); // Google 行事曆同步狀態（沒設定 CALENDAR_ID 就不顯示），不擋登入
};

// ====== Google 行事曆同步狀態（單向 App → Google，對帳邏輯在 Code.gs）======
// 平常只在行事曆卡片右下角放一個很小的 ☁️；點開才有狀態與「預覽／立即同步」。
// 只有同步失敗時才多一行紅字提醒，其他時候不打擾。
let calSyncTimer = null;
let calSyncStatus = null;

function calSyncSummary(s) {
  if (s.dirty) return "☁️ 等待同步到 Google 行事曆（約 5 分鐘內會自動同步）。";
  if (s.lastError) return "⚠️ 同步失敗：" + s.lastError + "\n\n排程會自動重試，也可以按「立即同步」。";
  if (!s.lastSyncAt) return "☁️ 還沒同步過，可以先按「預覽」看會同步哪些事件。";
  const d = new Date(s.lastSyncAt);
  const same = toDateStr(d) === toDateStr(new Date());
  const hm = d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `☁️ 已同步到 Google 行事曆（${same ? "" : `${d.getMonth() + 1}/${d.getDate()} `}${hm}）。事件新增或刪除後，約 5 分鐘內會自動同步。`;
}

async function refreshCalSync() {
  clearTimeout(calSyncTimer);
  const icon = document.getElementById("calSyncIcon");
  const alertEl = document.getElementById("calSyncAlert");
  try {
    const s = await api("getCalendarSyncStatus");
    calSyncStatus = s;
    if (!s.enabled) { icon.classList.add("hidden"); alertEl.classList.add("hidden"); return; }
    icon.classList.remove("hidden");
    icon.textContent = s.lastError ? "⚠️" : "☁️";
    icon.title = calSyncSummary(s).replace(/\n+/g, " ");
    alertEl.classList.toggle("hidden", !s.lastError);
    alertEl.textContent = s.lastError ? "Google 行事曆同步失敗，點右邊圖示查看" : "";
    document.getElementById("calSyncText").textContent = calSyncSummary(s);
    if (s.dirty) calSyncTimer = setTimeout(refreshCalSync, 60000); // 等排程跑完，一分鐘後再看一次
  } catch (err) {
    icon.classList.add("hidden"); // 後端還沒更新或讀不到，就不顯示，不打擾
    alertEl.classList.add("hidden");
  }
}

const CAL_SYNC_ACTIONS = new Set(["addEvent", "deleteEvent", "addRecurringEvent", "setRecurringEndDate", "deleteRecurringEvent", "addRecurringException", "deleteRecurringException"]);
window.addEventListener("api-write", (e) => { if (CAL_SYNC_ACTIONS.has(e.detail.action)) refreshCalSync(); });

function openCalSyncModal() {
  document.getElementById("calSyncPreview").classList.add("hidden");
  if (calSyncStatus) document.getElementById("calSyncText").textContent = calSyncSummary(calSyncStatus);
  document.getElementById("calSyncModal").classList.remove("hidden");
  refreshCalSync();
}
function closeCalSyncModal() { document.getElementById("calSyncModal").classList.add("hidden"); }

document.getElementById("calSyncIcon").addEventListener("click", openCalSyncModal);
document.getElementById("calSyncCloseBtn").addEventListener("click", closeCalSyncModal);
document.getElementById("calSyncModal").addEventListener("click", (e) => { if (e.target.id === "calSyncModal") closeCalSyncModal(); });

document.getElementById("calSyncBtn").addEventListener("click", async (e) => {
  await withRowLock(e.currentTarget, async () => {
    try {
      const r = await api("syncCalendarNow");
      document.getElementById("calSyncPreview").classList.add("hidden");
      showToast(`已同步：新增 ${r.created}、更新 ${r.updated}、刪除 ${r.deleted}`);
    } catch (err) {
      setStatus("同步失敗：" + err.message, true);
    }
    await refreshCalSync();
  }, [document.getElementById("calPreviewBtn")]);
});

// 預覽直接顯示在同一個視窗裡（不是另外跳一個要你按確定／取消的對話框）
document.getElementById("calPreviewBtn").addEventListener("click", async (e) => {
  await withRowLock(e.currentTarget, async () => {
    try {
      const r = await api("syncCalendarNow", { dryRun: true });
      const lines = [`預覽（還沒真的同步）：新增 ${r.created}、更新 ${r.updated}、刪除 ${r.deleted}、不變 ${r.unchanged}`];
      [["新增", r.preview.create], ["更新", r.preview.update], ["刪除", r.preview.del]].forEach(([label, list]) => {
        if (list.length) lines.push(`\n${label}（前 ${list.length} 筆）：\n` + list.join("\n"));
      });
      const pre = document.getElementById("calSyncPreview");
      pre.textContent = lines.join("\n");
      pre.classList.remove("hidden");
    } catch (err) {
      setStatus("預覽失敗：" + err.message, true);
    }
  }, [document.getElementById("calSyncBtn")]);
});

// ====== Rendering ======
function renderAll() {
  renderHeader();
  renderGoals();
  renderEvents();
  renderDailyHabits();
  renderWeeklyHabits();
  renderMonthlyHabits();
  renderCalendar();
  renderRecurringList();
  renderShoppingList();
  renderPetExpenses();
}

// 換選取日期：所有跟「選取日期」有關的區塊（待辦、事件、習慣、表單日期）一起重畫，
// 畫面顯示的日期跟之後勾選寫入的日期才會一致。新增跟日期有關的區塊時記得加在這裡。
function selectDate(dateStr) {
  state.selectedDate = dateStr;
  renderHeader();
  renderGoals();
  renderEvents();
  renderDailyHabits();
  renderWeeklyHabits();
  renderMonthlyHabits();
  renderCalendar();
}

function renderHeader() {
  const today = new Date();
  document.getElementById("todayDate").textContent = today.toLocaleDateString("zh-TW", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
  const todayStr = toDateStr(today);
  const todaysGoals = state.goals.filter(g => g.date === todayStr);
  const done = todaysGoals.filter(g => g.done === true || g.done === "TRUE").length;
  document.getElementById("progressLine").textContent =
    todaysGoals.length ? `今日待辦完成 ${done} / ${todaysGoals.length}` : "今天還沒有待辦";

  document.getElementById("selectedDateLabel").textContent = `(${formatDateLabel(state.selectedDate)})`;
  document.getElementById("selectedDateLabel2").textContent = `(${formatDateLabel(state.selectedDate)})`;
  document.getElementById("selectedDateLabel3").textContent = `(${formatDateLabel(state.selectedDate)})`;
}

function renderGoals() {
  const list = document.getElementById("goalList");
  list.innerHTML = "";
  const goals = state.goals.filter(g => g.date === state.selectedDate);

  if (!goals.length) {
    list.innerHTML = `<li class="empty-hint">這天還沒有待辦，新增一個吧</li>`;
    return;
  }

  goals.forEach(goal => {
    const isDone = goal.done === true || goal.done === "TRUE";
    const li = document.createElement("li");
    li.className = "item-row" + (isDone ? " done" : "");
    li.innerHTML = `
      <input type="checkbox" ${isDone ? "checked" : ""}>
      <span class="item-text"></span>
      <button class="delete-btn" title="刪除">✕</button>
    `;
    li.querySelector(".item-text").textContent = goal.text;
    li.querySelector('input[type="checkbox"]').addEventListener("change", async () => {
      await withRowLock(li, async () => {
        const box = li.querySelector('input[type="checkbox"]');
        li.classList.toggle("done", box.checked);
        try {
          applyData(await api("toggleGoal", { id: goal.id }));
          releasePending(li);
          renderGoals();
          renderHeader();
          renderCalendar();
        } catch (err) {
          box.checked = !box.checked;
          li.classList.toggle("done", box.checked);
          setStatus("更新失敗：" + err.message, true);
        }
      });
    });
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!(await showConfirm("確定要刪除這個待辦嗎？"))) return;
      await withRowLock(li, async () => {
        try {
          applyData(await api("deleteGoal", { id: goal.id }));
          releasePending(li);
          renderGoals();
          renderHeader();
          renderCalendar();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
    });
    li.dataset.lockKey = `goal:${goal.id}`;
    lockIfPending(li);
    list.appendChild(li);
  });
}

function isTruthy(v) {
  return v === true || v === "TRUE";
}

// 「每日運動挑戰」是特殊習慣：每日習慣清單裡那一列有專屬的抽卡/完成流程
// （完成後回傳給朋友的挑戰站，見 setupChallengeRow）。id 要跟 apps-script/Code.gs 的 CHALLENGE_HABIT_ID 一致。
const CHALLENGE_HABIT_ID = "85bf9ff2-7233-4b66-a301-f5a0c3ac36a6";

// 練字習慣：列上多「中」「英」兩顆按鈕，開 practice.html 產生可列印的描紅字帖（內容在 Sheet 的 Copybook 分頁）。
// 勾選、編輯、刪除都照一般每日習慣。這個 id 是 Habits 分頁裡那一列的 id。
const PRACTICE_HABIT_ID = "d6007d80-d570-4b49-a989-8af89401c395";

function updateHabitsCardVisibility() {
  const card = document.getElementById("habitsCard");
  const anyVisible = ["dailyHabitSection", "weeklyHabitSection", "monthlyHabitSection"]
    .some(id => !document.getElementById(id).classList.contains("hidden"));
  card.classList.toggle("hidden", !anyVisible);
}

// 🔥 連續徽章：點一下展開／收合文字詳情（手機沒有 hover）；每日、每週、每月共用
function appendStreakBadge(li, streakEl, habitId, streak, detail) {
  streakEl.textContent = `🔥 ${streak}`;
  streakEl.classList.add("streak-badge");
  streakEl.title = detail; // 電腦版 hover 看得到
  const pop = document.createElement("div");
  pop.className = "streak-detail" + (openStreakHabitIds.has(habitId) ? "" : " hidden");
  pop.textContent = detail;
  streakEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (openStreakHabitIds.has(habitId)) openStreakHabitIds.delete(habitId);
    else openStreakHabitIds.add(habitId);
    pop.classList.toggle("hidden");
  });
  li.appendChild(pop);
  return pop;
}

function renderDailyHabits() {
  const section = document.getElementById("dailyHabitSection");
  const list = document.getElementById("dailyHabitList");
  list.innerHTML = "";

  const habits = state.habits.filter(h =>
    h.frequency === "daily" &&
    (!isTruthy(h.workdaysOnly) || isWorkday(state.selectedDate))
  );

  section.classList.toggle("hidden", habits.length === 0);
  updateHabitsCardVisibility();

  if (!habits.length) return;

  const rows = habits.map(habit => {
    const periodKey = state.selectedDate;
    const count = getHabitLogCount(habit.id, periodKey);
    const done = count >= Number(habit.target || 1);
    return { habit, periodKey, done };
  }).sort((a, b) => a.done - b.done);

  rows.forEach(({ habit, periodKey, done }) => {
    const li = document.createElement("li");
    li.className = "item-row" + (done ? " done" : "");
    li.innerHTML = `
      <input type="checkbox" ${done ? "checked" : ""}>
      <span class="item-text"></span>
      <span class="item-time"></span>
      <button class="event-shopping-btn habit-edit-btn" title="編輯" type="button">✏️</button>
      <button class="delete-btn" title="刪除">✕</button>
    `;
    const { restText: habitName, url: habitUrl } = splitTextAndLink(habit.name);
    const isChallenge = habit.id === CHALLENGE_HABIT_ID;
    const challengeLog = isChallenge ? getChallengeLog(periodKey) : null;
    // 運動挑戰：抽卡前標題是習慣名稱，抽卡後換成抽到的運動
    li.querySelector(".item-text").textContent = (challengeLog && challengeLog.exercise) ? challengeLog.exercise : habitName;
    li.querySelector(".habit-edit-btn").addEventListener("click", () => openHabitEdit(habit));
    const streak = computeStreak(habit);
    const stats = computeHabitStats(habit);
    const streakEl = li.querySelector(".item-time");
    if (streak > 0 || stats.longest > 0) {
      appendStreakBadge(li, streakEl, habit.id, streak,
        `目前連續 ${streak} 天 · 歷史最長 ${stats.longest} 天 · 本月完成 ${stats.monthCount} 次`);
    }
    if (habit.id === PRACTICE_HABIT_ID) {
      const editBtn = li.querySelector(".habit-edit-btn");
      [["中", "zh", "產生中文描紅字帖"], ["英", "en", "產生英文描紅字帖"]].forEach(([label, lang, title]) => {
        const a = document.createElement("a");
        a.className = "practice-link";
        a.href = `practice.html?lang=${lang}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = title;
        a.textContent = label;
        li.insertBefore(a, editBtn);
      });
    }
    if (isChallenge) {
      li.querySelector(".delete-btn").remove(); // 刪掉這個習慣整個挑戰就沒了，不給刪
      setupChallengeRow(li, periodKey, challengeLog); // 裡面用編輯鈕當插入位置，所以編輯鈕等它跑完再移除
      li.querySelector(".habit-edit-btn").remove(); // 名稱/設定不開放從網頁修改
    } else if (habitUrl) {
      const link = document.createElement("a");
      link.href = habitUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "🔗";
      li.insertBefore(link, li.querySelector(".delete-btn"));
    }
    if (!isChallenge) li.querySelector('input[type="checkbox"]').addEventListener("change", async () => {
      await withRowLock(li, async () => {
        const box = li.querySelector('input[type="checkbox"]');
        li.classList.toggle("done", box.checked);
        try {
          applyData(await api("toggleHabitLog", { habitId: habit.id, periodKey, target: habit.target || 1 }));
          releasePending(li);
          renderDailyHabits();
        } catch (err) {
          box.checked = !box.checked;
          li.classList.toggle("done", box.checked);
          setStatus("更新失敗：" + err.message, true);
        }
      });
    });
    const dailyDeleteBtn = li.querySelector(".delete-btn");
    if (dailyDeleteBtn) dailyDeleteBtn.addEventListener("click", async () => {
      if (!(await showConfirm("確定要刪除這個習慣嗎？"))) return;
      await withRowLock(li, async () => {
        try {
          applyData(await api("deleteHabit", { id: habit.id }));
          releasePending(li);
          renderDailyHabits();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
    });
    li.dataset.lockKey = `habit:${habit.id}|${periodKey}`;
    lockIfPending(li);
    list.appendChild(li);
  });
}

function renderPeriodHabits(frequency, listId, sectionId) {
  const section = document.getElementById(sectionId);
  const list = document.getElementById(listId);
  list.innerHTML = "";

  const habits = state.habits.filter(h => h.frequency === frequency);

  section.classList.toggle("hidden", habits.length === 0);
  updateHabitsCardVisibility();

  if (!habits.length) return;

  const rows = habits.map(habit => {
    const periodKey = getPeriodKey(habit, state.selectedDate);
    const count = getHabitLogCount(habit.id, periodKey);
    const target = Number(habit.target || 1);
    const done = count >= target;
    return { habit, periodKey, count, target, done };
  }).sort((a, b) => a.done - b.done);

  rows.forEach(({ habit, periodKey, count, target, done }) => {
    const li = document.createElement("li");
    li.className = "item-row period-row" + (done ? " done" : "");
    li.innerHTML = `
      <button class="period-add-btn" type="button"></button>
      <span class="item-text"></span>
      <span class="item-time"></span>
      <button class="event-shopping-btn habit-edit-btn" title="編輯" type="button">✏️</button>
      <button class="delete-btn" title="刪除">✕</button>
      <div class="period-meta"></div>
    `;
    const { restText: habitName, url: habitUrl } = splitTextAndLink(habit.name);
    li.querySelector(".item-text").textContent = habitName;
    li.querySelector(".habit-edit-btn").addEventListener("click", () => openHabitEdit(habit));

    const unitLabel = frequency === "weekly" ? "本週" : "本月";
    const addBtn = li.querySelector(".period-add-btn");
    addBtn.textContent = done ? "✓" : "＋";
    addBtn.classList.toggle("is-done", done);
    addBtn.title = done ? `${unitLabel}已達標，再按一次歸零` : `${unitLabel}完成一次`;
    addBtn.setAttribute("aria-label", addBtn.title);

    // 第二行：本期圓點（做了幾次／目標幾次）+ 最近 6 期長條（最右邊是這一期）
    const meta = li.querySelector(".period-meta");
    if (target <= 10) {
      const pips = document.createElement("div");
      pips.className = "period-pips";
      for (let i = 0; i < target; i++) {
        const pip = document.createElement("span");
        pip.className = "pip" + (i < count ? " on" : "");
        pips.appendChild(pip);
      }
      pips.title = `${unitLabel} ${count}/${target}`;
      meta.appendChild(pips);
    } else {
      const txt = document.createElement("span");
      txt.className = "period-count-text";
      txt.textContent = `${count}/${target}`;
      meta.appendChild(txt);
    }
    const hist = document.createElement("div");
    hist.className = "period-hist";
    getPeriodHistory(habit, 6).forEach(p => {
      const bar = document.createElement("span");
      bar.className = "hb" + (p.current ? " cur" : "") + (p.count >= p.target ? " full" : "");
      const fill = document.createElement("i");
      fill.style.height = Math.min(100, (p.count / p.target) * 100) + "%";
      bar.appendChild(fill);
      bar.title = `${p.key}：${p.count}/${p.target}`;
      hist.appendChild(bar);
    });
    meta.appendChild(hist);

    const info = periodStreakDetail(habit);
    const streakEl = li.querySelector(".item-time");
    if (info.show) {
      appendStreakBadge(li, streakEl, habit.id, info.streak, info.detail);
      hist.addEventListener("click", () => { streakEl.click(); }); // 點長條區也能展開詳情
    } else {
      streakEl.remove();
    }

    if (habitUrl) {
      const link = document.createElement("a");
      link.href = habitUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "🔗";
      li.insertBefore(link, li.querySelector(".delete-btn"));
    }
    addBtn.addEventListener("click", async () => {
      // 已達標再按會歸零（後端「超過 target 歸零」的行為），先確認避免誤觸
      if (done && !(await showConfirm(`確定要把${unitLabel}的完成次數歸零嗎？`))) return;
      await withRowLock(li, async () => {
        try {
          applyData(await api("toggleHabitLog", { habitId: habit.id, periodKey, target }));
          releasePending(li);
          renderPeriodHabits(frequency, listId, sectionId);
        } catch (err) {
          setStatus("更新失敗：" + err.message, true);
        }
      });
    });
    li.querySelector(".delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!(await showConfirm("確定要刪除這個習慣嗎？"))) return;
      await withRowLock(li, async () => {
        try {
          applyData(await api("deleteHabit", { id: habit.id }));
          releasePending(li);
          renderPeriodHabits(frequency, listId, sectionId);
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
    });
    li.dataset.lockKey = `habit:${habit.id}|${periodKey}`;
    lockIfPending(li);
    list.appendChild(li);
  });
}

function renderWeeklyHabits() {
  renderPeriodHabits("weekly", "weeklyHabitList", "weeklyHabitSection");
}

function renderMonthlyHabits() {
  renderPeriodHabits("monthly", "monthlyHabitList", "monthlyHabitSection");
}

function renderEvents() {
  const list = document.getElementById("eventList");
  list.innerHTML = "";
  const events = state.events
    .filter(e => e.date === state.selectedDate && !e.hideFromCalendar)
    .concat(expandRecurringForDate(state.selectedDate))
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  if (!events.length) {
    list.innerHTML = `<li class="empty-hint">這天還沒有事件</li>`;
    return;
  }

  events.forEach(ev => {
    const li = document.createElement("li");
    li.className = "item-row" + (ev.recurring ? " recurring-row" : "");
    const metaRow = document.createElement("div");
    metaRow.className = "item-meta-row";

    if (ev.title && ev.title.includes("購物")) {
      const shopBtn = document.createElement("button");
      shopBtn.className = "event-shopping-btn";
      shopBtn.title = "開啟清單";
      shopBtn.textContent = "📝";
      shopBtn.addEventListener("click", openShoppingModal);
      metaRow.appendChild(shopBtn);
    }

    const timeSpan = document.createElement("span");
    timeSpan.className = "item-time";
    timeSpan.textContent = formatTimeRange(ev.time, ev.endTime);

    const textSpan = document.createElement("span");
    textSpan.className = "item-text";
    textSpan.textContent = ev.title;

    const meta = OWNER_META[ev.owner] || { label: ev.owner || "", icon: "", color: "var(--accent)" };
    const badge = document.createElement("span");
    badge.className = "owner-badge";
    badge.textContent = `${meta.icon} ${meta.label}`.trim();
    badge.style.color = meta.color;
    badge.style.background = meta.color + "22";

    li.appendChild(timeSpan);
    li.appendChild(textSpan);
    li.appendChild(badge);

    if (Number(ev.amount) > 0) {
      const amountSpan = document.createElement("span");
      amountSpan.className = "item-time";
      amountSpan.textContent = `💰 $${Number(ev.amount)}`;
      metaRow.appendChild(amountSpan);
    }

    if (ev.notes) {
      appendTextAndLink(metaRow, ev.notes, { textPrefix: "📝", linkIcon: "📍" });
    }

    // 點一筆事件 = 開編輯視窗（改、刪除都在裡面）；循環行程那一列開的是整條規則的編輯視窗
    li.classList.add("clickable");
    li.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return; // 連結、📝 按鈕照原本的行為
      if (ev.recurring) openRecurringModal({ rule: state.recurringEvents.find(r => r.id === ev.ruleId), occurrenceDate: ev.date });
      else openEventModal({ event: state.events.find(x => x.id === ev.id) || ev });
    });

    li.appendChild(metaRow);
    li.dataset.lockKey = `event:${ev.id}`;
    lockIfPending(li);
    list.appendChild(li);
  });
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

  document.getElementById("monthLabel").textContent =
    `📅 ${state.calendarYear} 年 ${state.calendarMonth + 1} 月`;

  ["日", "一", "二", "三", "四", "五", "六"].forEach(w => {
    const el = document.createElement("div");
    el.className = "calendar-weekday";
    el.textContent = w;
    grid.appendChild(el);
  });

  const firstDay = new Date(state.calendarYear, state.calendarMonth, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();
  const todayStr = toDateStr(new Date());

  const eventColorsByDate = {};
  state.events.filter(ev => !ev.hideFromCalendar).forEach(ev => {
    const color = (OWNER_META[ev.owner] || {}).color || "var(--accent)";
    if (!eventColorsByDate[ev.date]) eventColorsByDate[ev.date] = new Set();
    eventColorsByDate[ev.date].add(color);
  });
  const goalDates = new Set(state.goals.map(g => g.date));

  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement("div");
    el.className = "calendar-cell empty";
    grid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateStr(new Date(state.calendarYear, state.calendarMonth, day));
    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    if (dateStr === todayStr) cell.classList.add("today");
    if (dateStr === state.selectedDate) cell.classList.add("selected");

    const dayLabel = document.createElement("span");
    dayLabel.textContent = day;
    cell.appendChild(dayLabel);

    const solidColors = new Set(eventColorsByDate[dateStr] || []);
    if (goalDates.has(dateStr)) solidColors.add("var(--accent)");

    const recurringColors = new Set();
    expandRecurringForDate(dateStr).forEach(ev => {
      recurringColors.add((OWNER_META[ev.owner] || {}).color || "var(--accent)");
    });

    const allColors = new Set([...solidColors, ...recurringColors]);
    if (allColors.size) {
      const dotsWrap = document.createElement("div");
      dotsWrap.className = "dot-row";
      [...allColors].slice(0, 4).forEach(color => {
        const dot = document.createElement("span");
        const isSolid = solidColors.has(color);
        dot.className = "dot" + (isSolid ? "" : " dot-recurring");
        dot.style.background = isSolid ? color : "transparent";
        dot.style.borderColor = color;
        dotsWrap.appendChild(dot);
      });
      cell.appendChild(dotsWrap);
    }

    cell.addEventListener("click", () => {
      selectDate(dateStr);
      document.querySelector(".notes-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    grid.appendChild(cell);
  }
}

const RECURRING_WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function renderRecurringList() {
  const list = document.getElementById("recurringList");
  list.innerHTML = "";

  if (!state.recurringEvents.length) {
    list.innerHTML = `<li class="empty-hint">還沒有循環行程</li>`;
    return;
  }

  state.recurringEvents.forEach(rule => {
    const li = document.createElement("li");
    li.className = "item-row";

    const scheduleText = rule.frequency === "weekly"
      ? `每週${RECURRING_WEEKDAY_LABELS[Number(rule.dayOfWeek)]}`
      : `每月${rule.dayOfMonth}號`;

    const meta = OWNER_META[rule.owner] || { label: rule.owner || "", icon: "" };
    const textSpan = document.createElement("span");
    textSpan.className = "item-text";
    textSpan.textContent = `${meta.icon} ${rule.title}`.trim();

    const timeSpan = document.createElement("span");
    timeSpan.className = "item-time";
    timeSpan.textContent = scheduleText + (rule.time ? ` ${formatTimeRange(rule.time, rule.endTime)}` : "");

    li.appendChild(textSpan);
    li.appendChild(timeSpan);

    // 截止日：已過期的規則整列變淡並標「已結束」，仍保留在清單裡，可以改截止日恢復
    const endDate = rule.endDate ? String(rule.endDate) : "";
    if (endDate) {
      const ended = endDate < toDateStr(new Date());
      const endSpan = document.createElement("span");
      endSpan.className = "item-time";
      endSpan.textContent = ended ? `已結束（${endDate}）` : `至 ${endDate}`;
      li.appendChild(endSpan);
      li.classList.toggle("recurring-ended", ended);
    }

    if (rule.notes) {
      appendTextAndLink(li, rule.notes, { textPrefix: "📝", linkIcon: "📍" });
    }

    li.classList.add("clickable");
    li.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      openRecurringModal({ rule });
    });

    li.dataset.lockKey = `rule:${rule.id}`;
    lockIfPending(li);
    list.appendChild(li);
  });
}

function expenseCategory(owner) {
  return PET_NAMES.includes(owner) ? owner : "家庭"; // 我/太太/共同都算同一筆家庭花費，不細分是誰花的
}

function renderPetExpenses() {
  const monthLabel = document.getElementById("petExpenseMonthLabel");
  const container = document.getElementById("petExpenseList");
  container.innerHTML = "";

  const monthStr = `${state.petExpenseYear}-${String(state.petExpenseMonth + 1).padStart(2, "0")}`;
  monthLabel.textContent = `💰 ${state.petExpenseYear} 年 ${state.petExpenseMonth + 1} 月`;

  const entries = state.events
    .filter(ev => Number(ev.amount) > 0 && ev.date.startsWith(monthStr))
    .filter(ev => state.petExpenseFilter === "all" || expenseCategory(ev.owner) === state.petExpenseFilter)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!entries.length) {
    container.innerHTML = `<p class="empty-hint">這個月還沒有花費紀錄</p>`;
    return;
  }

  const total = entries.reduce((sum, ev) => sum + Number(ev.amount), 0);
  const totalP = document.createElement("p");
  totalP.className = "sub-heading";
  totalP.textContent = `本月合計 $${total}`;
  container.appendChild(totalP);

  const byDate = {};
  entries.forEach(ev => {
    if (!byDate[ev.date]) byDate[ev.date] = [];
    byDate[ev.date].push(ev);
  });

  Object.keys(byDate).forEach(date => {
    const group = document.createElement("div");
    const dateHeading = document.createElement("h3");
    dateHeading.className = "sub-heading";
    dateHeading.textContent = date;
    group.appendChild(dateHeading);

    const ul = document.createElement("ul");
    ul.className = "item-list";
    byDate[date].forEach(ev => {
      const li = document.createElement("li");
      li.className = "item-row";

      const meta = OWNER_META[ev.owner] || { label: ev.owner || "", icon: "", color: "var(--accent)" };
      const badge = document.createElement("span");
      badge.className = "owner-badge";
      badge.textContent = `${meta.icon} ${meta.label}`.trim();
      badge.style.color = meta.color;
      badge.style.background = meta.color + "22";

      const textSpan = document.createElement("span");
      textSpan.className = "item-text";
      textSpan.textContent = ev.title;

      const amountSpan = document.createElement("span");
      amountSpan.className = "item-time";
      amountSpan.textContent = `$${Number(ev.amount)}`;

      li.classList.add("clickable");
      li.addEventListener("click", () => openEventModal({ event: ev }));

      li.appendChild(badge);
      li.appendChild(textSpan);
      li.appendChild(amountSpan);
      ul.appendChild(li);
    });
    group.appendChild(ul);
    container.appendChild(group);
  });
}

document.getElementById("petExpensePrev").addEventListener("click", () => {
  state.petExpenseMonth--;
  if (state.petExpenseMonth < 0) {
    state.petExpenseMonth = 11;
    state.petExpenseYear--;
  }
  renderPetExpenses();
});

document.getElementById("petExpenseNext").addEventListener("click", () => {
  state.petExpenseMonth++;
  if (state.petExpenseMonth > 11) {
    state.petExpenseMonth = 0;
    state.petExpenseYear++;
  }
  renderPetExpenses();
});

document.getElementById("petExpenseFilter").addEventListener("change", (e) => {
  state.petExpenseFilter = e.target.value;
  renderPetExpenses();
});

// ====== 事件／循環行程 編輯視窗（新增與編輯共用同一個）======
// 約定：多欄位的實體（事件、循環行程）用彈窗新增與編輯；單欄快速輸入（待辦、購物清單）留在列表上。
// 錯誤直接顯示在視窗裡（Toast 的層級比視窗低，會被蓋住）。
const $id = (id) => document.getElementById(id);
const openModalEl = (id) => $id(id).classList.remove("hidden");
const closeModalEl = (id) => $id(id).classList.add("hidden");
const modalError = (hintId, msg) => { const el = $id(hintId); el.textContent = msg; el.classList.toggle("modal-error", !!msg); };

let editingEvent = null;

function openEventModal({ event = null, date = null, hide = false } = {}) {
  editingEvent = event;
  $id("emHeading").textContent = event ? "編輯事件" : (hide ? "記一筆花費" : "新增事件");
  $id("emTitle").value = event ? (event.title || "") : "";
  $id("emDate").value = event ? String(event.date) : (date || state.selectedDate);
  $id("emOwner").value = (event && event.owner) || "shared";
  if (!$id("emOwner").value) $id("emOwner").value = "shared";
  $id("emTime").value = event && event.time ? String(event.time) : "";
  $id("emEndTime").value = event && event.endTime ? String(event.endTime) : "";
  $id("emNote").value = event ? (event.notes || "") : "";
  $id("emAmount").value = event && event.amount !== "" && event.amount != null ? String(event.amount) : "";
  $id("emHide").checked = event ? isTruthy(event.hideFromCalendar) : !!hide;
  modalError("emHint", "");
  $id("emDeleteBtn").classList.toggle("hidden", !event);
  openModalEl("eventModal");
  if (!event) setTimeout(() => $id("emTitle").focus(), 0);
}

function closeEventModal() { closeModalEl("eventModal"); editingEvent = null; }

$id("emCloseBtn").addEventListener("click", closeEventModal);
$id("emCancelBtn").addEventListener("click", closeEventModal);
$id("eventModal").addEventListener("click", (e) => { if (e.target.id === "eventModal") closeEventModal(); });
$id("addEventBtn").addEventListener("click", () => openEventModal({ date: state.selectedDate }));
$id("addExpenseBtn").addEventListener("click", () => openEventModal({ date: toDateStr(new Date()), hide: true }));

$id("eventModalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $id("emTitle").value.trim();
  const date = $id("emDate").value;
  const time = $id("emTime").value;
  const endTime = $id("emEndTime").value;
  const amountRaw = $id("emAmount").value.trim();
  const amount = amountRaw === "" ? "" : parseStrictNumber(amountRaw);
  const hide = $id("emHide").checked;
  const problem = !title ? "請填標題"
    : !date ? "請選日期"
    : amount === null ? `花費金額「${amountRaw}」不是有效數字`
    : (amount !== "" && amount < 0) ? "花費不能是負數"
    : (hide && !(amount > 0)) ? "「只記帳」的事件要填花費金額"
    : checkTimeRange(time, endTime);
  if (problem) { modalError("emHint", problem); return; }
  const params = { date, time, endTime, title, notes: $id("emNote").value.trim(), owner: $id("emOwner").value, amount, hideFromCalendar: hide ? "true" : "false" };
  if (editingEvent) params.id = editingEvent.id;
  const wasEdit = !!editingEvent;
  setFormBusy(e.target, true);
  try {
    applyData(await api(wasEdit ? "updateEvent" : "addEvent", params));
    closeEventModal();
    renderEvents();
    renderCalendar();
    renderPetExpenses();
    showToast(wasEdit ? "已儲存" : "已新增");
  } catch (err) {
    modalError("emHint", (wasEdit ? "儲存失敗：" : "新增失敗：") + err.message);
  } finally {
    setFormBusy(e.target, false);
  }
});

$id("emDeleteBtn").addEventListener("click", async () => {
  if (!editingEvent) return;
  if (!(await showConfirm("確定要刪除這筆事件嗎？"))) return;
  const id = editingEvent.id;
  setFormBusy($id("eventModalForm"), true);
  try {
    applyData(await api("deleteEvent", { id }));
    closeEventModal();
    renderEvents();
    renderCalendar();
    renderPetExpenses();
    showToast("已刪除");
  } catch (err) {
    modalError("emHint", "刪除失敗：" + err.message);
  } finally {
    setFormBusy($id("eventModalForm"), false);
  }
});

let editingRule = null;
let skipDate = null;

function syncRecurringFrequency() {
  const monthly = $id("rmFrequency").value === "monthly";
  $id("rmWeekWrap").classList.toggle("hidden", monthly);
  $id("rmMonthWrap").classList.toggle("hidden", !monthly);
}
$id("rmFrequency").addEventListener("change", syncRecurringFrequency);

function openRecurringModal({ rule = null, occurrenceDate = null } = {}) {
  if (!rule && occurrenceDate) return; // 規則找不到（剛被刪掉），不開
  editingRule = rule;
  skipDate = occurrenceDate;
  const base = new Date((occurrenceDate || state.selectedDate) + "T00:00:00");
  $id("rmHeading").textContent = rule ? "編輯循環行程" : "新增循環行程";
  $id("rmNotice").classList.toggle("hidden", !rule);
  modalError("rmHint", "");
  $id("rmTitle").value = rule ? (rule.title || "") : "";
  $id("rmOwner").value = (rule && rule.owner) || "shared";
  if (!$id("rmOwner").value) $id("rmOwner").value = "shared";
  $id("rmFrequency").value = rule ? rule.frequency : "weekly";
  $id("rmDayOfWeek").value = String(rule && rule.dayOfWeek !== "" && rule.dayOfWeek != null ? Number(rule.dayOfWeek) : base.getDay());
  $id("rmDayOfMonth").value = rule && rule.dayOfMonth !== "" && rule.dayOfMonth != null ? String(rule.dayOfMonth) : String(base.getDate());
  $id("rmTime").value = rule && rule.time ? String(rule.time) : "";
  $id("rmEndTime").value = rule && rule.endTime ? String(rule.endTime) : "";
  $id("rmEndDate").value = rule && rule.endDate ? String(rule.endDate) : "";
  $id("rmNote").value = rule ? (rule.notes || "") : "";
  syncRecurringFrequency();
  const skipBtn = $id("rmSkipBtn");
  skipBtn.classList.toggle("hidden", !(rule && occurrenceDate));
  skipBtn.textContent = occurrenceDate ? `只跳過 ${occurrenceDate} 這一次（規則不變）` : "";
  $id("rmDeleteBtn").classList.toggle("hidden", !rule);
  openModalEl("recurringModal");
  if (!rule) setTimeout(() => $id("rmTitle").focus(), 0);
}

function closeRecurringModal() { closeModalEl("recurringModal"); editingRule = null; skipDate = null; }
function renderAfterRecurringChange() { renderRecurringList(); renderEvents(); renderCalendar(); }

$id("rmCloseBtn").addEventListener("click", closeRecurringModal);
$id("rmCancelBtn").addEventListener("click", closeRecurringModal);
$id("recurringModal").addEventListener("click", (e) => { if (e.target.id === "recurringModal") closeRecurringModal(); });
$id("addRecurringBtn").addEventListener("click", () => openRecurringModal());

$id("recurringModalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $id("rmTitle").value.trim();
  const frequency = $id("rmFrequency").value;
  const dayOfMonth = $id("rmDayOfMonth").value.trim();
  const time = $id("rmTime").value;
  const endTime = $id("rmEndTime").value;
  const problem = !title ? "請填標題"
    : (frequency === "monthly" && !(Number.isInteger(Number(dayOfMonth)) && Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 31)) ? "請填 1–31 的日期"
    : checkTimeRange(time, endTime);
  if (problem) { modalError("rmHint", problem); return; }
  const params = {
    owner: $id("rmOwner").value, title, time, endTime, notes: $id("rmNote").value.trim(), frequency,
    dayOfWeek: $id("rmDayOfWeek").value, dayOfMonth, endDate: $id("rmEndDate").value || "",
  };
  const wasEdit = !!editingRule;
  if (wasEdit) params.id = editingRule.id;
  setFormBusy(e.target, true);
  try {
    applyData(await api(wasEdit ? "updateRecurringEvent" : "addRecurringEvent", params));
    closeRecurringModal();
    renderAfterRecurringChange();
    showToast(wasEdit ? "已儲存" : "已新增循環行程");
  } catch (err) {
    modalError("rmHint", (wasEdit ? "儲存失敗：" : "新增失敗：") + err.message);
  } finally {
    setFormBusy(e.target, false);
  }
});

$id("rmDeleteBtn").addEventListener("click", async () => {
  if (!editingRule) return;
  if (!(await showConfirm("確定要刪除這個循環行程嗎？（之後每一次都會消失）"))) return;
  setFormBusy($id("recurringModalForm"), true);
  try {
    applyData(await api("deleteRecurringEvent", { id: editingRule.id }));
    closeRecurringModal();
    renderAfterRecurringChange();
    showToast("已刪除");
  } catch (err) {
    modalError("rmHint", "刪除失敗：" + err.message);
  } finally {
    setFormBusy($id("recurringModalForm"), false);
  }
});

$id("rmSkipBtn").addEventListener("click", async () => {
  if (!editingRule || !skipDate) return;
  if (!(await showConfirm(`確定要跳過 ${skipDate} 這一次嗎？（規則本身不會刪除）`))) return;
  setFormBusy($id("recurringModalForm"), true);
  try {
    applyData(await api("addRecurringException", { recurringId: editingRule.id, date: skipDate }));
    closeRecurringModal();
    renderAfterRecurringChange();
    showToast("已跳過這一次");
  } catch (err) {
    modalError("rmHint", "更新失敗：" + err.message);
  } finally {
    setFormBusy($id("recurringModalForm"), false);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !$id("dialogModal").classList.contains("hidden")) return;
  if (!$id("eventModal").classList.contains("hidden")) closeEventModal();
  else if (!$id("recurringModal").classList.contains("hidden")) closeRecurringModal();
});

// ====== 購物清單 ======
// 「清單」彈窗分兩個分類：shopping（購物）、idea（想法），同一張 ShoppingList 表用
// category 欄位區分；舊資料沒有 category，一律當 shopping。
const LIST_TAB_KEY = "listTab";
const LIST_META = {
  shopping: { placeholder: "新增購買項目…", rows: 1, emptyText: "購物清單是空的", addedToast: "已新增購物項目" },
  idea: { placeholder: "記下一個想法…（可換行）", rows: 3, emptyText: "還沒有想法", addedToast: "已新增想法" },
};
let listCategory = "shopping";
try {
  const saved = localStorage.getItem(LIST_TAB_KEY);
  if (saved === "idea") listCategory = "idea";
} catch (e) { /* 讀不到就用預設 */ }

function getItemCategory(item) {
  return item.category === "idea" ? "idea" : "shopping";
}

function setListCategory(category) {
  listCategory = category;
  try { localStorage.setItem(LIST_TAB_KEY, category); } catch (e) { /* ignore */ }
  document.querySelectorAll(".list-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.category === category);
  });
  const input = document.getElementById("shoppingInput");
  input.placeholder = LIST_META[category].placeholder;
  input.rows = LIST_META[category].rows;
  renderShoppingList();
}

function renderShoppingList() {
  const list = document.getElementById("shoppingList");
  list.innerHTML = "";

  const items = state.shoppingList.filter(i => getItemCategory(i) === listCategory);
  const doneCount = items.filter(i => isTruthy(i.done)).length;
  const clearBtn = document.getElementById("clearDoneBtn");
  clearBtn.classList.toggle("hidden", doneCount === 0);
  clearBtn.textContent = `清除已完成（${doneCount}）`;

  if (!items.length) {
    list.innerHTML = `<li class="empty-hint">${LIST_META[listCategory].emptyText}</li>`;
    return;
  }

  const rows = [...items].sort((a, b) => isTruthy(a.done) - isTruthy(b.done));

  rows.forEach(item => {
    const done = isTruthy(item.done);
    const li = document.createElement("li");
    li.className = "item-row" + (done ? " done" : "");
    li.innerHTML = `
      <input type="checkbox" ${done ? "checked" : ""}>
      <span class="item-text"></span>
      <button class="delete-btn" title="刪除">✕</button>
    `;
    const textEl = li.querySelector(".item-text");
    textEl.textContent = item.item;
    if (listCategory === "idea") {
      textEl.classList.add("clamp");
      textEl.addEventListener("click", () => textEl.classList.toggle("clamp"));
    }
    li.querySelector('input[type="checkbox"]').addEventListener("change", async () => {
      await withRowLock(li, async () => {
        const box = li.querySelector('input[type="checkbox"]');
        li.classList.toggle("done", box.checked);
        try {
          applyData(await api("toggleShoppingItem", { id: item.id }));
          releasePending(li);
          renderShoppingList();
        } catch (err) {
          box.checked = !box.checked;
          li.classList.toggle("done", box.checked);
          setStatus("更新失敗：" + err.message, true);
        }
      }, [document.getElementById("clearDoneBtn")]);
    });
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!(await showConfirm("確定要刪除這個項目嗎？"))) return;
      await withRowLock(li, async () => {
        try {
          applyData(await api("deleteShoppingItem", { id: item.id }));
          releasePending(li);
          renderShoppingList();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      }, [document.getElementById("clearDoneBtn")]);
    });
    li.dataset.lockKey = `item:${item.id}`;
    lockIfPending(li);
    list.appendChild(li);
  });
}

document.querySelectorAll(".list-tab").forEach(btn => {
  btn.addEventListener("click", () => setListCategory(btn.dataset.category));
});

document.getElementById("clearDoneBtn").addEventListener("click", async (e) => {
  const doneCount = state.shoppingList.filter(i => getItemCategory(i) === listCategory && isTruthy(i.done)).length;
  if (!doneCount) return;
  if (!(await showConfirm(`確定要清除 ${doneCount} 個已完成的項目嗎？`))) return;
  // 清除期間整個清單彈窗（項目、分頁、輸入框、按鈕）都鎖住
  await withRowLock(document.querySelector("#shoppingModal .modal-card"), async () => {
    try {
      applyData(await api("clearDoneShoppingItems", { category: listCategory }));
      renderShoppingList();
    } catch (err) {
      setStatus("清除失敗：" + err.message, true);
    }
  });
});

// showConfirm / showPrompt 在 shared.js

async function openShoppingModal() {
  setListCategory(listCategory);
  document.getElementById("shoppingModal").classList.remove("hidden");
  if (state.shoppingLoaded) return;
  const list = document.getElementById("shoppingList");
  list.innerHTML = `<li class="empty-hint">載入中…</li>`;
  try {
    const data = await api("getData", { keys: "shoppingList" });
    // 載入期間如果已經有寫入回應帶回完整清單，就用那份，不要拿比較舊的蓋掉
    if (!state.shoppingLoaded) applyData(data);
    renderShoppingList();
  } catch (err) {
    list.innerHTML = `<li class="empty-hint">載入失敗：${escapeHtml(err.message)}</li>`;
  }
}

function closeShoppingModal() {
  document.getElementById("shoppingModal").classList.add("hidden");
}

document.getElementById("shoppingBtn").addEventListener("click", openShoppingModal);
document.getElementById("shoppingCloseBtn").addEventListener("click", closeShoppingModal);
document.getElementById("shoppingModal").addEventListener("click", (e) => {
  if (e.target.id === "shoppingModal") closeShoppingModal();
});

// 購物是單行輸入，Enter 直接送出；想法可以換行，用按鈕送出
document.getElementById("shoppingInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && listCategory === "shopping") {
    e.preventDefault();
    document.getElementById("shoppingForm").requestSubmit();
  }
});

document.getElementById("shoppingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("shoppingInput");
  const item = input.value.trim();
  if (!item) return;
  const category = listCategory;
  setFormBusy(e.target, true);
  try {
    applyData(await api("addShoppingItem", { item, category }));
    input.value = "";
    renderShoppingList();
    showToast(LIST_META[category].addedToast);
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
  }
});

// ====== Form handlers ======
document.getElementById("goalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("goalInput");
  const text = input.value.trim();
  if (!text) return;
  setFormBusy(e.target, true);
  try {
    applyData(await api("addGoal", { date: state.selectedDate, text }));
    input.value = "";
    renderGoals();
    renderHeader();
    renderCalendar();
    showToast("已新增待辦");
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
  }
});

function updateHabitFormValidity() {
  const nameInput = document.getElementById("habitName");
  const submitBtn = document.getElementById("habitSubmitBtn");
  submitBtn.disabled = !nameInput.value.trim();
}

function updateHabitFrequencyFields() {
  const frequency = document.getElementById("habitFrequency").value;
  const targetInput = document.getElementById("habitTarget");
  const workdaysLabel = document.getElementById("habitWorkdaysLabel");
  const isDaily = frequency === "daily";
  targetInput.style.display = isDaily ? "none" : "";
  workdaysLabel.style.display = isDaily ? "" : "none";
}

document.getElementById("habitName").addEventListener("input", updateHabitFormValidity);
document.getElementById("habitFrequency").addEventListener("change", updateHabitFrequencyFields);
updateHabitFrequencyFields();

document.getElementById("habitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("habitName");
  const frequencySelect = document.getElementById("habitFrequency");
  const targetInput = document.getElementById("habitTarget");
  const workdaysCheckbox = document.getElementById("habitWorkdaysOnly");
  const name = nameInput.value.trim();
  if (!name) return;
  setFormBusy(e.target, true);
  try {
    applyData(await api("addHabit", {
      name,
      frequency: frequencySelect.value,
      workdaysOnly: workdaysCheckbox.checked,
      target: targetInput.value || 1,
    }));
    nameInput.value = "";
    targetInput.value = "1";
    workdaysCheckbox.checked = false;
    renderDailyHabits();
    renderWeeklyHabits();
    renderMonthlyHabits();
    showToast("已新增習慣");
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updateHabitFormValidity();
  }
});

// ====== 每日運動挑戰 ======
// 挑戰是特殊習慣，直接顯示在每日習慣清單裡：抽卡前標題是習慣名稱、右邊是 🎲 抽卡鈕；
// 抽卡後標題換成抽到的運動（HabitLog 的 exercise），勾選 = 完成打卡並回傳給朋友的
// 挑戰站；回傳成功後鎖死不能取消。抽卡/完成只能在「今天」做。
function getChallengeLog(dateStr) {
  return state.habitLogs.find(l => l.habitId === CHALLENGE_HABIT_ID && String(l.periodKey) === dateStr) || null;
}

function setupChallengeRow(li, periodKey, log) {
  const box = li.querySelector('input[type="checkbox"]');
  const isToday = periodKey === toDateStr(new Date());
  const exercise = log ? String(log.exercise || "") : "";
  const isDone = !!log && Number(log.count) >= 1;
  const isSynced = !!log && isTruthy(log.synced);

  const addBtn = (label, title, handler) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "event-shopping-btn";
    btn.title = title;
    btn.textContent = label;
    btn.addEventListener("click", () => withRowLock(li, handler));
    li.insertBefore(btn, li.querySelector(".habit-edit-btn"));
  };

  // 預設不能勾：沒抽卡、已完成並同步、或不是今天
  box.disabled = true;
  if (!isToday) return;
  if (!log) {
    addBtn("🎲", "抽今天的運動", () => runChallengeAction("drawChallenge", "抽卡失敗"));
  } else if (!exercise) {
    li.querySelector(".item-text").textContent += "（抽卡狀態異常，請檢查 HabitLog）";
  } else if (isDone && !isSynced) {
    addBtn("🔄", "已完成但還沒成功回傳，點一下重新同步", () => runChallengeAction("completeChallenge", "同步失敗"));
  } else if (!isDone) {
    box.disabled = false;
    box.addEventListener("change", () => withRowLock(li, async () => {
      li.classList.toggle("done", box.checked);
      await runChallengeAction("completeChallenge", "打卡失敗");
    }));
  }
}

async function runChallengeAction(action, failText) {
  try {
    const data = await api(action);
    applyData(data);
    renderDailyHabits();
  } catch (err) {
    // 失敗時後端已還原，重畫一次讓畫面回到真實狀態、可以重按
    setStatus(failText + "：" + err.message, true);
    renderDailyHabits();
    // 狀態列在頁面最下面容易沒看到，失敗時再跳彈窗確保看得到原因
    await showConfirm(failText + "：" + err.message);
  }
}

// ====== 編輯習慣 ======
let editingHabit = null;

function openHabitEdit(habit) {
  editingHabit = habit;
  const isDaily = habit.frequency === "daily";
  document.getElementById("habitEditName").value = habit.name;
  document.getElementById("habitEditTarget").value = habit.target || 1;
  document.getElementById("habitEditWorkdaysOnly").checked = habit.workdaysOnly === true || habit.workdaysOnly === "TRUE";
  document.getElementById("habitEditTargetLabel").style.display = isDaily ? "none" : "";
  document.getElementById("habitEditWorkdaysLabel").style.display = isDaily ? "" : "none";
  document.getElementById("habitEditModal").classList.remove("hidden");
}

function closeHabitEdit() {
  document.getElementById("habitEditModal").classList.add("hidden");
  editingHabit = null;
}

document.getElementById("habitEditCloseBtn").addEventListener("click", closeHabitEdit);
document.getElementById("habitEditModal").addEventListener("click", (e) => {
  if (e.target.id === "habitEditModal") closeHabitEdit();
});

document.getElementById("habitEditForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingHabit) return;
  const name = document.getElementById("habitEditName").value.trim();
  if (!name) return;
  const target = document.getElementById("habitEditTarget").value || 1;
  const workdaysOnly = document.getElementById("habitEditWorkdaysOnly").checked;
  setFormBusy(e.target, true);
  try {
    applyData(await api("updateHabit", { id: editingHabit.id, name, workdaysOnly, target }));
    closeHabitEdit();
    renderDailyHabits();
    renderWeeklyHabits();
    renderMonthlyHabits();
    showToast("已更新習慣");
  } catch (err) {
    setStatus("更新失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
  }
});

document.getElementById("prevMonth").addEventListener("click", () => {
  state.calendarMonth -= 1;
  if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
  renderCalendar();
});

document.getElementById("nextMonth").addEventListener("click", () => {
  state.calendarMonth += 1;
  if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
  renderCalendar();
});

document.getElementById("todayBtn").addEventListener("click", () => {
  const today = new Date();
  state.calendarMonth = today.getMonth();
  state.calendarYear = today.getFullYear();
  selectDate(toDateStr(today));
});

// 頂端「今日待辦完成 x / y」：點一下回到今天並捲到待辦卡片（待辦卡片在頁面中段，第一屏看不到）
function jumpToGoals() {
  const today = toDateStr(new Date());
  if (state.selectedDate !== today) selectDate(today);
  const card = document.querySelector(".goals-card");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1200);
}
document.getElementById("progressLine").addEventListener("click", jumpToGoals);
document.getElementById("progressLine").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jumpToGoals(); }
});

// 事件的時間顯示：11:00–12:30（沒填結束時間就只顯示開始）
function formatTimeRange(time, endTime) {
  return time ? (endTime ? `${time}–${endTime}` : time) : "";
}

// 送出前檢查開始／結束時間（後端也會驗證，這裡是為了立刻看到提示）
function checkTimeRange(time, endTime) {
  if (endTime && !time) return "請先填開始時間，才能填結束時間";
  if (endTime && endTime <= time) return "結束時間要晚於開始時間";
  return "";
}

initTimeSelects();

// ====== Boot ======
initAuth();
