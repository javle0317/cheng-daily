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
  let isToday = true;
  for (let i = 0; i < 365; i++) {
    const dateStr = toDateStr(cursor);
    if (workdaysOnly && !isWorkday(dateStr)) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    const done = getHabitLogCount(habit.id, dateStr) >= Number(habit.target || 1);
    if (!done) {
      // 今天還沒做不算斷連續，從昨天開始往回算
      if (isToday) { isToday = false; cursor.setDate(cursor.getDate() - 1); continue; }
      break;
    }
    streak++;
    isToday = false;
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

const openStreakHabitIds = new Set();

// ====== API ======
function applyData(data) {
  state.goals = data.goals || [];
  state.events = data.events || [];
  state.habits = data.habits || [];
  state.habitLogs = data.habitLogs || [];
  state.recurringEvents = data.recurringEvents || [];
  state.recurringExceptions = data.recurringExceptions || [];
  state.shoppingList = data.shoppingList || [];
  state.holidayDates = new Set((data.holidays || []).map(h => h.date));
}

// api() / showLockScreen / showLockLoading / showApp / tryUnlock / lockForm
// 與 logoutBtn 監聽都在 shared.js，這裡只提供 shared.js 需要呼叫的進入點。
window.loadPageData = async function () {
  applyData(await api("getData"));
  renderAll();
};

// ====== Rendering ======
function renderAll() {
  renderHeader();
  renderGoals();
  renderEvents();
  renderDailyHabits();
  renderWeeklyHabits();
  renderMonthlyHabits();
  renderChallenge();
  renderCalendar();
  renderRecurringList();
  renderShoppingList();
  renderPetExpenses();
  const dateInput = document.getElementById("eventDate");
  if (dateInput) dateInput.value = state.selectedDate;
  if (typeof updateEventFormValidity === "function") updateEventFormValidity();
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
          renderGoals();
          renderHeader();
          renderCalendar();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
    });
    list.appendChild(li);
  });
}

function isTruthy(v) {
  return v === true || v === "TRUE";
}

// 「每日運動挑戰」是特殊習慣：不在一般每日習慣清單裡，改由 challengeCard 處理
// （抽卡、完成後回傳給朋友的挑戰站）。id 要跟 apps-script/Code.gs 的 CHALLENGE_HABIT_ID 一致。
const CHALLENGE_HABIT_ID = "85bf9ff2-7233-4b66-a301-f5a0c3ac36a6";

function updateHabitsCardVisibility() {
  const card = document.getElementById("habitsCard");
  const anyVisible = ["dailyHabitSection", "weeklyHabitSection", "monthlyHabitSection"]
    .some(id => !document.getElementById(id).classList.contains("hidden"));
  card.classList.toggle("hidden", !anyVisible);
}

function renderDailyHabits() {
  const section = document.getElementById("dailyHabitSection");
  const list = document.getElementById("dailyHabitList");
  list.innerHTML = "";

  const habits = state.habits.filter(h =>
    h.id !== CHALLENGE_HABIT_ID &&
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
    li.querySelector(".item-text").textContent = habitName;
    li.querySelector(".habit-edit-btn").addEventListener("click", () => openHabitEdit(habit));
    const streak = computeStreak(habit);
    const stats = computeHabitStats(habit);
    const streakEl = li.querySelector(".item-time");
    if (streak > 0 || stats.longest > 0) {
      streakEl.textContent = `🔥 ${streak}`;
      streakEl.classList.add("streak-badge");
      const detail = `目前連續 ${streak} 天 · 歷史最長 ${stats.longest} 天 · 本月完成 ${stats.monthCount} 次`;
      streakEl.title = detail; // 電腦版 hover 看得到
      const pop = document.createElement("div");
      pop.className = "streak-detail" + (openStreakHabitIds.has(habit.id) ? "" : " hidden");
      pop.textContent = detail;
      streakEl.addEventListener("click", () => {
        // 手機沒有 hover，點一下展開/收合
        if (openStreakHabitIds.has(habit.id)) openStreakHabitIds.delete(habit.id);
        else openStreakHabitIds.add(habit.id);
        pop.classList.toggle("hidden");
      });
      li.appendChild(pop);
    }
    if (habitUrl) {
      const link = document.createElement("a");
      link.href = habitUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "🔗";
      li.insertBefore(link, li.querySelector(".delete-btn"));
    }
    li.querySelector('input[type="checkbox"]').addEventListener("change", async () => {
      await withRowLock(li, async () => {
        const box = li.querySelector('input[type="checkbox"]');
        li.classList.toggle("done", box.checked);
        try {
          applyData(await api("toggleHabitLog", { habitId: habit.id, periodKey, target: habit.target || 1 }));
          renderDailyHabits();
        } catch (err) {
          box.checked = !box.checked;
          li.classList.toggle("done", box.checked);
          setStatus("更新失敗：" + err.message, true);
        }
      });
    });
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!(await showConfirm("確定要刪除這個習慣嗎？"))) return;
      await withRowLock(li, async () => {
        try {
          applyData(await api("deleteHabit", { id: habit.id }));
          renderDailyHabits();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
    });
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
    li.className = "item-row clickable" + (done ? " done" : "");
    li.innerHTML = `
      <span class="item-text"></span>
      <span class="item-time"></span>
      <button class="event-shopping-btn habit-edit-btn" title="編輯" type="button">✏️</button>
      <button class="delete-btn" title="刪除">✕</button>
    `;
    const { restText: habitName, url: habitUrl } = splitTextAndLink(habit.name);
    li.querySelector(".item-text").textContent = habitName;
    li.querySelector(".habit-edit-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openHabitEdit(habit);
    });
    li.querySelector(".item-time").textContent = `${count}/${target}`;
    if (habitUrl) {
      const link = document.createElement("a");
      link.href = habitUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "🔗";
      link.addEventListener("click", (e) => e.stopPropagation());
      li.insertBefore(link, li.querySelector(".delete-btn"));
    }
    li.addEventListener("click", async () => {
      await withRowLock(li, async () => {
        try {
          applyData(await api("toggleHabitLog", { habitId: habit.id, periodKey, target }));
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
          renderPeriodHabits(frequency, listId, sectionId);
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
    });
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
    timeSpan.textContent = ev.time || "";

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

    if (!ev.recurring) {
      const amountBtn = document.createElement("button");
      amountBtn.className = "event-shopping-btn";
      amountBtn.title = "填寫/修改花費金額";
      amountBtn.textContent = "💰";
      amountBtn.addEventListener("click", async () => {
        const input = await showPrompt("花費金額（留空清除）：", ev.amount || "");
        if (input === null) return;
        await withRowLock(amountBtn, async () => {
          try {
            applyData(await api("setEventAmount", { id: ev.id, amount: input.trim() }));
            renderEvents();
            renderPetExpenses();
          } catch (err) {
            setStatus("更新失敗：" + err.message, true);
          }
        });
      });
      metaRow.appendChild(amountBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.title = "刪除";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async () => {
        if (!(await showConfirm("確定要刪除這筆事件嗎？"))) return;
        await withRowLock(delBtn, async () => {
          try {
            applyData(await api("deleteEvent", { id: ev.id }));
            renderEvents();
            renderCalendar();
          } catch (err) {
            setStatus("刪除失敗：" + err.message, true);
          }
        });
      });
      metaRow.appendChild(delBtn);
    } else {
      const skipBtn = document.createElement("button");
      skipBtn.className = "event-shopping-btn";
      skipBtn.title = "跳過這一次";
      skipBtn.textContent = "⏭️";
      skipBtn.addEventListener("click", async () => {
        if (!(await showConfirm("確定要跳過這一次嗎？（規則本身不會刪除）"))) return;
        await withRowLock(skipBtn, async () => {
          try {
            applyData(await api("addRecurringException", { recurringId: ev.ruleId, date: ev.date }));
            renderEvents();
            renderCalendar();
          } catch (err) {
            setStatus("更新失敗：" + err.message, true);
          }
        });
      });
      metaRow.appendChild(skipBtn);
    }

    li.appendChild(metaRow);
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
      state.selectedDate = dateStr;
      renderHeader();
      renderGoals();
      renderEvents();
      renderCalendar();
      const dateInput = document.getElementById("eventDate");
      if (dateInput) dateInput.value = state.selectedDate;
      updateEventFormValidity();
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
    timeSpan.textContent = scheduleText + (rule.time ? ` ${rule.time}` : "");

    li.appendChild(textSpan);
    li.appendChild(timeSpan);

    if (rule.notes) {
      appendTextAndLink(li, rule.notes, { textPrefix: "📝", linkIcon: "📍" });
    }

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.title = "刪除";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async () => {
      if (!(await showConfirm("確定要刪除這個循環行程嗎？"))) return;
      await withRowLock(delBtn, async () => {
        try {
          applyData(await api("deleteRecurringEvent", { id: rule.id }));
          renderRecurringList();
          renderEvents();
          renderCalendar();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
    });

    li.appendChild(delBtn);
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

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.title = "刪除";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async () => {
        if (!(await showConfirm("確定要刪除這筆花費紀錄嗎？"))) return;
        await withRowLock(delBtn, async () => {
          try {
            applyData(await api("deleteEvent", { id: ev.id }));
            renderPetExpenses();
            renderEvents();
            renderCalendar();
          } catch (err) {
            setStatus("刪除失敗：" + err.message, true);
          }
        });
      });

      li.appendChild(badge);
      li.appendChild(textSpan);
      li.appendChild(amountSpan);
      li.appendChild(delBtn);
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

function updatePetExpenseFormValidity() {
  const dateInput = document.getElementById("petExpenseDate");
  const ownerSelect = document.getElementById("petExpenseOwner");
  const titleInput = document.getElementById("petExpenseTitle");
  const amountInput = document.getElementById("petExpenseAmount");
  const submitBtn = document.getElementById("petExpenseSubmitBtn");
  const valid = !!dateInput.value && !!ownerSelect.value && !!titleInput.value.trim() && Number(amountInput.value) > 0;
  submitBtn.disabled = !valid;
}

["petExpenseDate", "petExpenseOwner", "petExpenseTitle", "petExpenseAmount"].forEach(id => {
  document.getElementById(id).addEventListener("input", updatePetExpenseFormValidity);
  document.getElementById(id).addEventListener("change", updatePetExpenseFormValidity);
});

document.getElementById("petExpenseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dateInput = document.getElementById("petExpenseDate");
  const ownerSelect = document.getElementById("petExpenseOwner");
  const titleInput = document.getElementById("petExpenseTitle");
  const amountInput = document.getElementById("petExpenseAmount");
  const date = dateInput.value;
  const owner = ownerSelect.value;
  const title = titleInput.value.trim();
  const amount = amountInput.value;
  if (!date || !owner || !title || !(Number(amount) > 0)) return;
  setFormBusy(e.target, true);
  try {
    applyData(await api("addEvent", {
      date,
      time: "",
      title,
      notes: "",
      owner,
      amount,
      hideFromCalendar: "true",
    }));
    titleInput.value = "";
    amountInput.value = "";
    renderPetExpenses();
    showToast("已新增花費");
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updatePetExpenseFormValidity();
  }
});

function updateRecurringFormValidity() {
  const titleInput = document.getElementById("recurringTitle");
  const submitBtn = document.getElementById("recurringSubmitBtn");
  submitBtn.disabled = !titleInput.value.trim();
}

function updateRecurringFrequencyFields() {
  const frequency = document.getElementById("recurringFrequency").value;
  const dayOfWeekSelect = document.getElementById("recurringDayOfWeek");
  const dayOfMonthInput = document.getElementById("recurringDayOfMonth");
  const isWeekly = frequency === "weekly";
  dayOfWeekSelect.style.display = isWeekly ? "" : "none";
  dayOfMonthInput.style.display = isWeekly ? "none" : "";
}

document.getElementById("recurringTitle").addEventListener("input", updateRecurringFormValidity);
document.getElementById("recurringFrequency").addEventListener("change", updateRecurringFrequencyFields);
updateRecurringFrequencyFields();

document.getElementById("recurringForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ownerSelect = document.getElementById("recurringOwner");
  const titleInput = document.getElementById("recurringTitle");
  const frequencySelect = document.getElementById("recurringFrequency");
  const dayOfWeekSelect = document.getElementById("recurringDayOfWeek");
  const dayOfMonthInput = document.getElementById("recurringDayOfMonth");
  const timeInput = document.getElementById("recurringTime");
  const noteInput = document.getElementById("recurringNote");
  const title = titleInput.value.trim();
  if (!title) return;
  if (frequencySelect.value === "monthly" && !dayOfMonthInput.value) return;
  setFormBusy(e.target, true);
  try {
    applyData(await api("addRecurringEvent", {
      owner: ownerSelect.value,
      title,
      time: timeInput.value || "",
      notes: noteInput.value.trim(),
      frequency: frequencySelect.value,
      dayOfWeek: dayOfWeekSelect.value,
      dayOfMonth: dayOfMonthInput.value,
    }));
    titleInput.value = "";
    timeInput.value = "";
    noteInput.value = "";
    dayOfMonthInput.value = "";
    renderRecurringList();
    renderEvents();
    renderCalendar();
    showToast("已新增循環行程");
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updateRecurringFormValidity();
  }
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
          renderShoppingList();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      }, [document.getElementById("clearDoneBtn")]);
    });
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

function openShoppingModal() {
  setListCategory(listCategory);
  document.getElementById("shoppingModal").classList.remove("hidden");
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

function updateEventFormValidity() {
  const dateInput = document.getElementById("eventDate");
  const titleInput = document.getElementById("eventTitle");
  const ownerSelect = document.getElementById("eventOwner");
  const submitBtn = document.getElementById("eventSubmitBtn");
  const valid = !!dateInput.value && !!ownerSelect.value && !!titleInput.value.trim();
  submitBtn.disabled = !valid;
}

["eventDate", "eventOwner", "eventTitle"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateEventFormValidity);
  document.getElementById(id).addEventListener("change", updateEventFormValidity);
});

document.getElementById("eventForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dateInput = document.getElementById("eventDate");
  const timeInput = document.getElementById("eventTime");
  const titleInput = document.getElementById("eventTitle");
  const noteInput = document.getElementById("eventNote");
  const ownerSelect = document.getElementById("eventOwner");
  const amountInput = document.getElementById("eventAmount");
  const title = titleInput.value.trim();
  const date = dateInput.value || state.selectedDate;
  if (!title || !date || !ownerSelect.value) return;
  setFormBusy(e.target, true);
  try {
    applyData(await api("addEvent", {
      date,
      time: timeInput.value || "",
      title,
      notes: noteInput.value.trim(),
      owner: ownerSelect.value,
      amount: amountInput.value || "",
    }));
    titleInput.value = "";
    timeInput.value = "";
    noteInput.value = "";
    amountInput.value = "";
    renderEvents();
    renderCalendar();
    renderPetExpenses();
    showToast("已新增記事");
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updateEventFormValidity();
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
function getTodayChallengeLog() {
  const today = toDateStr(new Date());
  return state.habitLogs.find(l => l.habitId === CHALLENGE_HABIT_ID && String(l.periodKey) === today) || null;
}

function renderChallenge() {
  const card = document.getElementById("challengeCard");
  const body = document.getElementById("challengeBody");
  const habit = state.habits.find(h => h.id === CHALLENGE_HABIT_ID);
  card.classList.toggle("hidden", !habit);
  if (!habit) return;
  body.innerHTML = "";

  const log = getTodayChallengeLog();
  const exercise = log ? String(log.exercise || "") : "";
  const isDone = log && Number(log.count) >= 1;
  const isSynced = log && isTruthy(log.synced);

  const text = document.createElement("p");
  text.className = "challenge-text";
  const actions = document.createElement("div");
  actions.className = "challenge-actions";

  const addBtn = (label, handler) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", () => withRowLock(card, () => handler()));
    actions.appendChild(btn);
  };

  if (!log) {
    text.textContent = "今天還沒抽運動";
    addBtn("🎲 抽今天的運動", () => runChallengeAction("drawChallenge", "抽卡失敗"));
  } else if (!exercise) {
    text.textContent = "抽卡狀態異常：今天有紀錄但沒有運動內容，請到 HabitLog 檢查";
  } else if (isDone && isSynced) {
    text.textContent = `✅ 今天已完成：${exercise}`;
  } else if (isDone) {
    text.textContent = `${exercise}（已完成，但還沒成功回傳）`;
    addBtn("重新同步", () => runChallengeAction("completeChallenge", "同步失敗"));
  } else {
    text.textContent = `今天的運動：${exercise}`;
    addBtn("✅ 完成打卡", () => runChallengeAction("completeChallenge", "打卡失敗"));
  }
  body.appendChild(text);
  if (actions.children.length) body.appendChild(actions);

  const streak = computeStreak(habit);
  const stats = computeHabitStats(habit);
  if (streak > 0 || stats.longest > 0) {
    const info = document.createElement("p");
    info.className = "streak-detail";
    info.textContent = `🔥 連續 ${streak} 天 · 歷史最長 ${stats.longest} 天 · 本月完成 ${stats.monthCount} 次`;
    body.appendChild(info);
  }
}

async function runChallengeAction(action, failText) {
  try {
    const data = await api(action);
    applyData(data);
    renderChallenge();
    // 後端開了預覽模式（CHALLENGE_DRY_RUN）時，不會真的送出，把「會送出的內容」顯示出來確認
    if (data.dryRunPreview) {
      await showConfirm("【預覽模式，沒有真的送出】\n會送出的內容：\n" + data.dryRunPreview.join("\n"));
    }
  } catch (err) {
    // 失敗時後端已還原，畫面維持原狀可以重按
    setStatus(failText + "：" + err.message, true);
    renderChallenge();
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
  state.selectedDate = toDateStr(today);
  renderHeader();
  renderGoals();
  renderEvents();
  renderCalendar();
  const dateInput = document.getElementById("eventDate");
  if (dateInput) dateInput.value = state.selectedDate;
  updateEventFormValidity();
});

// ====== Boot ======
initAuth();
