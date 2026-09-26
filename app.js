// ====== 設定 ======
// 部署 Apps Script Web App 後，把網址貼在這裡（見 README.md 的步驟說明）
const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw-_yrxEFqaCI8WIKAPKgMnHW0qUKhQxIw9on9_dwZeeeSznsKdPypk_XjWESKuLvem/exec";

const PASSWORD_KEY = "dailyhub_password";

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
  shoppingList: [],
  selectedDate: toDateStr(new Date()),
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  petExpenseMonth: new Date().getMonth(),
  petExpenseYear: new Date().getFullYear(),
  petExpenseFilter: "all",
};

// ====== Utils ======
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}`;
}

function setStatus(msg, isError) {
  const el = document.getElementById("statusLine");
  el.textContent = msg || "";
  el.style.color = isError ? "var(--danger)" : "var(--text-dim)";
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 1800);
}

function setFormBusy(form, busy) {
  const btn = form.querySelector('button[type="submit"]');
  if (!btn) return;
  if (busy) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = "處理中…";
    btn.disabled = true;
  } else {
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
    btn.disabled = false;
  }
}

function isWorkday(dateStr) {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day >= 1 && day <= 5;
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
  return state.recurringEvents
    .filter(r => isTruthy(r.active) && matchesRecurringRule(r, dateStr))
    .map(r => ({
      id: `rec_${r.id}_${dateStr}`,
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

// ====== API ======
function applyData(data) {
  state.goals = data.goals || [];
  state.events = data.events || [];
  state.habits = data.habits || [];
  state.habitLogs = data.habitLogs || [];
  state.recurringEvents = data.recurringEvents || [];
  state.shoppingList = data.shoppingList || [];
}

async function api(action, params = {}) {
  const password = localStorage.getItem(PASSWORD_KEY);
  const url = new URL(WEBAPP_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("password", password || "");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "unknown error");
  return json.data;
}

// ====== Auth flow ======
function showLockScreen(errorMsg) {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("lockScreen").classList.remove("hidden");
  document.getElementById("lockLoading").classList.add("hidden");
  document.getElementById("lockForm").classList.remove("hidden");
  document.getElementById("lockError").textContent = errorMsg || "";
}

function showLockLoading() {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("lockScreen").classList.remove("hidden");
  document.getElementById("lockForm").classList.add("hidden");
  document.getElementById("lockLoading").classList.remove("hidden");
}

function showApp() {
  document.getElementById("lockScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

async function tryUnlock(password) {
  localStorage.setItem(PASSWORD_KEY, password);
  try {
    applyData(await api("getData"));
    showApp();
    renderAll();
    setStatus("已連上 Google Sheet");
  } catch (err) {
    localStorage.removeItem(PASSWORD_KEY);
    showLockScreen("密碼錯誤，或無法連線，請再試一次");
  }
}

document.getElementById("lockForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const pw = document.getElementById("passwordInput").value;
  tryUnlock(pw);
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(PASSWORD_KEY);
  document.getElementById("passwordInput").value = "";
  showLockScreen();
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
      try {
        applyData(await api("toggleGoal", { id: goal.id }));
        renderGoals();
        renderHeader();
        renderCalendar();
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!confirm("確定要刪除這個待辦嗎？")) return;
      try {
        applyData(await api("deleteGoal", { id: goal.id }));
        renderGoals();
        renderHeader();
        renderCalendar();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    });
    list.appendChild(li);
  });
}

function isTruthy(v) {
  return v === true || v === "TRUE";
}

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
      <button class="delete-btn" title="刪除">✕</button>
    `;
    li.querySelector(".item-text").textContent = habit.name;
    const streak = computeStreak(habit);
    if (streak > 0) li.querySelector(".item-time").textContent = `🔥 ${streak}`;
    li.querySelector('input[type="checkbox"]').addEventListener("change", async () => {
      try {
        applyData(await api("toggleHabitLog", { habitId: habit.id, periodKey, target: habit.target || 1 }));
        renderDailyHabits();
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!confirm("確定要刪除這個習慣嗎？")) return;
      try {
        applyData(await api("deleteHabit", { id: habit.id }));
        renderDailyHabits();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
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
      <button class="delete-btn" title="刪除">✕</button>
    `;
    li.querySelector(".item-text").textContent = habit.name;
    li.querySelector(".item-time").textContent = `${count}/${target}`;
    li.addEventListener("click", async () => {
      try {
        applyData(await api("toggleHabitLog", { habitId: habit.id, periodKey, target }));
        renderPeriodHabits(frequency, listId, sectionId);
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
    li.querySelector(".delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("確定要刪除這個習慣嗎？")) return;
      try {
        applyData(await api("deleteHabit", { id: habit.id }));
        renderPeriodHabits(frequency, listId, sectionId);
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
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

    if (ev.title && ev.title.includes("購物")) {
      const shopBtn = document.createElement("button");
      shopBtn.className = "event-shopping-btn";
      shopBtn.title = "開啟購物清單";
      shopBtn.textContent = "🛒";
      shopBtn.addEventListener("click", openShoppingModal);
      li.appendChild(shopBtn);
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
      li.appendChild(amountSpan);
    }

    if (ev.notes) {
      const urlMatch = ev.notes.match(/https?:\/\/\S+/);
      const restText = urlMatch ? ev.notes.replace(urlMatch[0], "").trim() : ev.notes;

      if (restText) {
        const noteSpan = document.createElement("span");
        noteSpan.className = "item-time";
        noteSpan.textContent = `📝 ${restText}`;
        li.appendChild(noteSpan);
      }

      if (urlMatch) {
        const link = document.createElement("a");
        link.href = urlMatch[0];
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "📍";
        li.appendChild(link);
      }
    }

    if (!ev.recurring) {
      const amountBtn = document.createElement("button");
      amountBtn.className = "event-shopping-btn";
      amountBtn.title = "填寫/修改花費金額";
      amountBtn.textContent = "💰";
      amountBtn.addEventListener("click", async () => {
        const input = prompt("花費金額（留空清除）：", ev.amount || "");
        if (input === null) return;
        try {
          applyData(await api("setEventAmount", { id: ev.id, amount: input.trim() }));
          renderEvents();
          renderPetExpenses();
        } catch (err) {
          setStatus("更新失敗：" + err.message, true);
        }
      });
      li.appendChild(amountBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.title = "刪除";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async () => {
        if (!confirm("確定要刪除這筆事件嗎？")) return;
        try {
          applyData(await api("deleteEvent", { id: ev.id }));
          renderEvents();
          renderCalendar();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
      li.appendChild(delBtn);
    }

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

    const colors = new Set(eventColorsByDate[dateStr] || []);
    expandRecurringForDate(dateStr).forEach(ev => {
      colors.add((OWNER_META[ev.owner] || {}).color || "var(--accent)");
    });
    if (goalDates.has(dateStr)) colors.add("var(--accent)");
    if (colors.size) {
      const dotsWrap = document.createElement("div");
      dotsWrap.className = "dot-row";
      [...colors].slice(0, 4).forEach(color => {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = color;
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

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.title = "刪除";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async () => {
      if (!confirm("確定要刪除這個循環行程嗎？")) return;
      try {
        applyData(await api("deleteRecurringEvent", { id: rule.id }));
        renderRecurringList();
        renderEvents();
        renderCalendar();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    });

    li.appendChild(textSpan);
    li.appendChild(timeSpan);
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
        if (!confirm("確定要刪除這筆花費紀錄嗎？")) return;
        try {
          applyData(await api("deleteEvent", { id: ev.id }));
          renderPetExpenses();
          renderEvents();
          renderCalendar();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
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
function renderShoppingList() {
  const list = document.getElementById("shoppingList");
  list.innerHTML = "";

  if (!state.shoppingList.length) {
    list.innerHTML = `<li class="empty-hint">清單是空的</li>`;
    return;
  }

  const rows = [...state.shoppingList].sort((a, b) => isTruthy(a.done) - isTruthy(b.done));

  rows.forEach(item => {
    const done = isTruthy(item.done);
    const li = document.createElement("li");
    li.className = "item-row" + (done ? " done" : "");
    li.innerHTML = `
      <input type="checkbox" ${done ? "checked" : ""}>
      <span class="item-text"></span>
      <button class="delete-btn" title="刪除">✕</button>
    `;
    li.querySelector(".item-text").textContent = item.item;
    li.querySelector('input[type="checkbox"]').addEventListener("change", async () => {
      try {
        applyData(await api("toggleShoppingItem", { id: item.id }));
        renderShoppingList();
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!confirm("確定要刪除這個購物項目嗎？")) return;
      try {
        applyData(await api("deleteShoppingItem", { id: item.id }));
        renderShoppingList();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    });
    list.appendChild(li);
  });
}

function openShoppingModal() {
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

document.getElementById("shoppingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("shoppingInput");
  const item = input.value.trim();
  if (!item) return;
  setFormBusy(e.target, true);
  try {
    applyData(await api("addShoppingItem", { item }));
    input.value = "";
    renderShoppingList();
    showToast("已新增購物項目");
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

// ====== Boot ======
(function init() {
  const savedPassword = localStorage.getItem(PASSWORD_KEY);
  if (savedPassword) {
    showLockLoading();
    tryUnlock(savedPassword);
  } else {
    showLockScreen();
  }
})();
