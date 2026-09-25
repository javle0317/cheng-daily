// ====== 設定 ======
// 部署 Apps Script Web App 後，把網址貼在這裡（見 README.md 的步驟說明）
const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw-_yrxEFqaCI8WIKAPKgMnHW0qUKhQxIw9on9_dwZeeeSznsKdPypk_XjWESKuLvem/exec";

const PASSWORD_KEY = "dailyhub_password";

// ====== State ======
let state = {
  goals: [],
  events: [],
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
  renderCalendar();
  const dateInput = document.getElementById("eventDate");
  if (dateInput) dateInput.value = state.selectedDate;
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

  const ownerLabels = { me: "承承", wife: "君君", shared: "一起" };

  events.forEach(ev => {
    const li = document.createElement("li");
    li.className = "item-row";

    const timeSpan = document.createElement("span");
    timeSpan.className = "item-time";
    timeSpan.textContent = ev.time || "";

    const textSpan = document.createElement("span");
    textSpan.className = "item-text";
    textSpan.textContent = ev.title;

    const badge = document.createElement("span");
    badge.className = "owner-badge";
    badge.textContent = ownerLabels[ev.owner] || ev.owner || "";

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
      noteSpan.textContent = ev.notes;
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

  const datesWithData = new Set([
    ...state.goals.map(g => g.date),
    ...state.events.map(e => e.date),
  ]);

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

    cell.innerHTML = `<span>${day}</span>`;
    if (datesWithData.has(dateStr)) {
      cell.innerHTML += `<span class="dot"></span>`;
    }
    cell.addEventListener("click", () => {
      state.selectedDate = dateStr;
      renderHeader();
      renderGoals();
      renderEvents();
      renderCalendar();
      const dateInput = document.getElementById("eventDate");
      if (dateInput) dateInput.value = state.selectedDate;
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

document.getElementById("eventForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dateInput = document.getElementById("eventDate");
  const timeInput = document.getElementById("eventTime");
  const titleInput = document.getElementById("eventTitle");
  const noteInput = document.getElementById("eventNote");
  const ownerSelect = document.getElementById("eventOwner");
  const title = titleInput.value.trim();
  const date = dateInput.value || state.selectedDate;
  if (!title || !date) return;
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
    renderEvents();
    renderCalendar();
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
