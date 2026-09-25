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

// ====== State ======
let state = {
  goals: [],
  events: [],
  habits: [],
  habitLogs: [],
  selectedDate: toDateStr(new Date()),
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
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
  document.getElementById("lockError").textContent = errorMsg || "";
}

function showApp() {
  document.getElementById("lockScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

async function tryUnlock(password) {
  localStorage.setItem(PASSWORD_KEY, password);
  try {
    const data = await api("getData");
    state.goals = data.goals || [];
    state.events = data.events || [];
    state.habits = data.habits || [];
    state.habitLogs = data.habitLogs || [];
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
    todaysGoals.length ? `今日完成 ${done} / ${todaysGoals.length}` : "今天還沒有目標";

  document.getElementById("selectedDateLabel").textContent = `(${formatDateLabel(state.selectedDate)})`;
  document.getElementById("selectedDateLabel2").textContent = `(${formatDateLabel(state.selectedDate)})`;
}

function renderGoals() {
  const list = document.getElementById("goalList");
  list.innerHTML = "";
  const goals = state.goals.filter(g => g.date === state.selectedDate);

  if (!goals.length) {
    list.innerHTML = `<li class="empty-hint">這天還沒有目標，新增一個吧</li>`;
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
        state.goals = await api("toggleGoal", { id: goal.id });
        renderGoals();
        renderHeader();
        renderCalendar();
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      try {
        const data = await api("deleteGoal", { id: goal.id });
        state.goals = data;
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

function renderDailyHabits() {
  const list = document.getElementById("dailyHabitList");
  list.innerHTML = "";

  const habits = state.habits.filter(h =>
    h.frequency === "daily" &&
    isTruthy(h.active) &&
    (!isTruthy(h.workdaysOnly) || isWorkday(state.selectedDate))
  );

  if (!habits.length) {
    list.innerHTML = `<li class="empty-hint">這天沒有適用的每日習慣</li>`;
    return;
  }

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
    `;
    li.querySelector(".item-text").textContent = habit.name;
    const streak = computeStreak(habit);
    if (streak > 0) li.querySelector(".item-time").textContent = `🔥 ${streak}`;
    li.querySelector('input[type="checkbox"]').addEventListener("change", async () => {
      try {
        const data = await api("toggleHabitLog", { habitId: habit.id, periodKey, target: habit.target || 1 });
        state.habits = data.habits;
        state.habitLogs = data.habitLogs;
        renderDailyHabits();
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
    list.appendChild(li);
  });
}

function renderPeriodHabits(frequency, listId) {
  const list = document.getElementById(listId);
  list.innerHTML = "";

  const habits = state.habits.filter(h => h.frequency === frequency && isTruthy(h.active));

  if (!habits.length) {
    list.innerHTML = `<li class="empty-hint">還沒有${frequency === "weekly" ? "每週" : "每月"}目標</li>`;
    return;
  }

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
    `;
    li.querySelector(".item-text").textContent = habit.name;
    li.querySelector(".item-time").textContent = `${count}/${target}`;
    li.addEventListener("click", async () => {
      try {
        const data = await api("toggleHabitLog", { habitId: habit.id, periodKey, target });
        state.habits = data.habits;
        state.habitLogs = data.habitLogs;
        renderPeriodHabits(frequency, listId);
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
    list.appendChild(li);
  });
}

function renderWeeklyHabits() {
  renderPeriodHabits("weekly", "weeklyHabitList");
}

function renderMonthlyHabits() {
  renderPeriodHabits("monthly", "monthlyHabitList");
}

function renderEvents() {
  const list = document.getElementById("eventList");
  list.innerHTML = "";
  const events = state.events
    .filter(e => e.date === state.selectedDate)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  if (!events.length) {
    list.innerHTML = `<li class="empty-hint">這天還沒有事件</li>`;
    return;
  }

  events.forEach(ev => {
    const li = document.createElement("li");
    li.className = "item-row";

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

    if (ev.notes && /^https?:\/\//.test(ev.notes)) {
      const link = document.createElement("a");
      link.href = ev.notes;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "📍";
      li.appendChild(link);
    } else if (ev.notes) {
      const noteSpan = document.createElement("span");
      noteSpan.className = "item-time";
      noteSpan.textContent = `📝 ${ev.notes}`;
      li.appendChild(noteSpan);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.title = "刪除";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async () => {
      try {
        state.events = await api("deleteEvent", { id: ev.id });
        renderEvents();
        renderCalendar();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    });
    li.appendChild(delBtn);

    list.appendChild(li);
  });
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

  document.getElementById("monthLabel").textContent =
    `${state.calendarYear} 年 ${state.calendarMonth + 1} 月`;

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
  state.events.forEach(ev => {
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

// ====== Form handlers ======
document.getElementById("goalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("goalInput");
  const text = input.value.trim();
  if (!text) return;
  try {
    state.goals = await api("addGoal", { date: state.selectedDate, text });
    input.value = "";
    renderGoals();
    renderHeader();
    renderCalendar();
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
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
  const title = titleInput.value.trim();
  const date = dateInput.value || state.selectedDate;
  if (!title || !date || !ownerSelect.value) return;
  try {
    state.events = await api("addEvent", {
      date,
      time: timeInput.value || "",
      title,
      notes: noteInput.value.trim(),
      owner: ownerSelect.value,
    });
    titleInput.value = "";
    timeInput.value = "";
    noteInput.value = "";
    updateEventFormValidity();
    renderEvents();
    renderCalendar();
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
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
  try {
    const data = await api("addHabit", {
      name,
      frequency: frequencySelect.value,
      workdaysOnly: workdaysCheckbox.checked,
      target: targetInput.value || 1,
    });
    state.habits = data.habits;
    state.habitLogs = data.habitLogs;
    nameInput.value = "";
    targetInput.value = "1";
    workdaysCheckbox.checked = false;
    updateHabitFormValidity();
    renderDailyHabits();
    renderWeeklyHabits();
    renderMonthlyHabits();
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
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
    tryUnlock(savedPassword);
  } else {
    showLockScreen();
  }
})();
