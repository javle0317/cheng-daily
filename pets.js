// ====== 寵物頁 ======
// WEBAPP_URL / api() / 登入流程 / showConfirm / PET_NAMES 等共用邏輯在 shared.js。
// Sheet 分頁 PetLog 由後端 ensureSheet 自動建立；type 與後端 PET_LOG_TYPES 一致。

let state = {
  log: [],
  events: [], // 只用在「整理舊紀錄」
  pet: PET_NAMES[0],
  month: "",
  typeFilter: "all",
  editingId: null,
  labs: [],
  prefs: [],
  skipped: [],
  tab: "log",
};

try {
  const saved = localStorage.getItem("petSel");
  if (PET_NAMES.includes(saved)) state.pet = saved;
  if (localStorage.getItem("petTab") === "labs") state.tab = "labs";
} catch (e) { /* 讀不到就用預設 */ }

function applyPetData(data) {
  state.log = (data && data.log) || [];
  state.labs = (data && data.labs) || [];
  state.prefs = (data && data.prefs) || [];
  state.skipped = (data && data.skipped) || [];
}

// 已經登記過（PetLog 的 sourceEventId）或按過「略過」的事件 id
function petDoneIds() {
  return [...state.log.map(r => r.sourceEventId).filter(Boolean), ...state.skipped.map(r => r.eventId).filter(Boolean)];
}

window.loadPageData = async function () {
  const [petRes, evRes] = await Promise.allSettled([api("getPetData"), api("getData", { keys: "events" })]);
  if (petRes.status === "rejected") throw petRes.reason; // 沒有紀錄資料就整頁不能用
  applyPetData(petRes.value);
  state.events = evRes.status === "fulfilled" ? (evRes.value.events || []) : []; // 讀不到事件只影響「整理舊紀錄」
  renderPetsAll();
};

// ====== 純邏輯（regression-check 會測）======
function dayNum(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) : null;
}

function addDaysStr(dateStr, n) {
  const d = new Date((dayNum(dateStr) + n) * 86400000);
  return d.toISOString().slice(0, 10);
}

// 一個類型的購買／就醫間隔：dates 是 yyyy-MM-dd（可亂序、可重複）；
// 平均間隔＝相鄰兩次日期差的平均，最多取最近 6 個間隔；少於 2 個不同日期就沒有間隔。
function petIntervalStats(dates, today) {
  const days = [...new Set(dates.map(dayNum).filter(n => n !== null))].sort((a, b) => a - b);
  if (!days.length) return { count: 0, last: null, daysSince: null, avgInterval: null, next: null };
  const lastDay = days[days.length - 1];
  const last = new Date(lastDay * 86400000).toISOString().slice(0, 10);
  const t = dayNum(today);
  const stats = { count: days.length, last, daysSince: t === null ? null : t - lastDay, avgInterval: null, next: null };
  if (days.length >= 2) {
    const gaps = [];
    for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
    const recent = gaps.slice(-6);
    stats.avgInterval = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
    stats.next = addDaysStr(last, stats.avgInterval);
  }
  return stats;
}

// 飼料／貓砂的使用狀況：沒有 finishedAt 的算「使用中／未用完」；有的算「用了幾天」（用完日 − 購買日）。
// avgUse 是已用完那些的平均天數，openMax 是未用完的當中最久的已經放了幾天。
function petUsageStats(rows, today) {
  const t = dayNum(today);
  const done = rows.filter(r => r.finishedAt && dayNum(r.finishedAt) !== null && dayNum(r.date) !== null);
  const open = rows.filter(r => !r.finishedAt);
  const uses = done.map(r => dayNum(r.finishedAt) - dayNum(r.date)).filter(n => n >= 0);
  const openAges = open.map(r => (t === null || dayNum(r.date) === null) ? null : t - dayNum(r.date)).filter(n => n !== null);
  return {
    open: open.length,
    openMax: openAges.length ? Math.max(...openAges) : null,
    finished: uses.length,
    avgUse: uses.length ? Math.round(uses.reduce((a, b) => a + b, 0) / uses.length) : null,
  };
}

function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

function formatMonthLabel(m) {
  const [y, mo] = String(m).split("-");
  return `${y}年${mo}月`;
}

function sumAmount(rows) {
  return rows.reduce((s, r) => s + (Number(r.amount) > 0 ? Number(r.amount) : 0), 0);
}

function petRows() {
  return state.log.filter(r => r.pet === state.pet);
}

// ====== 渲染 ======
function renderTabs() {
  document.querySelectorAll("[data-tabbtn]").forEach(b => {
    const on = b.dataset.tabbtn === state.tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("[data-tab]").forEach(el => {
    if (el.dataset.tab !== state.tab) { el.classList.add("hidden"); return; }
    // 「整理舊紀錄」鈕自己決定要不要顯示，這裡只處理分頁容器
    el.classList.remove("hidden");
  });
}

document.querySelectorAll("[data-tabbtn]").forEach(b => b.addEventListener("click", () => {
  state.tab = b.dataset.tabbtn;
  try { localStorage.setItem("petTab", state.tab); } catch (e) { /* 存不了就算了 */ }
  renderTabs();
}));

function renderPetsAll() {
  renderTabs();
  renderPetSwitch();
  renderSummary();
  renderLogList();
  if (typeof renderLabsAll === "function") renderLabsAll();
  const cands = migrationCandidates(state.events, petDoneIds());
  const btn = document.getElementById("openPetMigrate");
  btn.classList.toggle("hidden", !cands.length);
  btn.textContent = `待登記（${cands.length}）`;
  updatePetFormValidity();
}

function renderPetSwitch() {
  const box = document.getElementById("petSwitch");
  box.innerHTML = "";
  PET_NAMES.forEach(name => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pet-tab" + (name === state.pet ? " on" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", name === state.pet ? "true" : "false");
    b.textContent = `${PET_ICON[name] || "🐾"} ${name}`;
    b.addEventListener("click", () => {
      state.pet = name;
      state.month = "";
      state.typeFilter = "all";
      try { localStorage.setItem("petSel", name); } catch (e) { /* 存不了就算了 */ }
      renderPetsAll();
    });
    box.appendChild(b);
  });
}

function renderSummary() {
  const box = document.getElementById("petSummary");
  box.innerHTML = "";
  const rows = petRows();
  const today = toDateStr(new Date());
  const types = PET_TYPES.filter(t => rows.some(r => r.type === t.key));
  if (!types.length) {
    box.innerHTML = `<p class="empty-hint">${escapeHtml(state.pet)} 還沒有紀錄，按「＋ 新增紀錄」開始</p>`;
    return;
  }
  types.forEach(t => {
    const mine = rows.filter(r => r.type === t.key);
    const st = petIntervalStats(mine.map(r => r.date), today);
    const tile = document.createElement("div");
    tile.className = "pet-tile";
    const head = document.createElement("div");
    head.className = "pet-tile-head";
    head.textContent = `${t.icon} ${t.label}`;
    const big = document.createElement("div");
    big.className = "pet-tile-big";
    big.textContent = st.daysSince === null ? st.last : st.daysSince === 0 ? "今天" : `${st.daysSince} 天前`;
    const lines = [`上次 ${st.last}`, `共 ${st.count} 次`];
    if (st.avgInterval !== null) lines.push(`平均每 ${st.avgInterval} 天一次`);
    else lines.push("資料還不夠算間隔");
    if (t.predict && st.next) lines.push(`下次約 ${st.next}`);
    if (t.finishable) {
      const u = petUsageStats(mine, today);
      lines.push(u.open ? `未用完 ${u.open} 件（最久放了 ${u.openMax} 天）` : "目前都用完了");
      if (u.avgUse !== null) lines.push(`平均 ${u.avgUse} 天用完（${u.finished} 筆）`);
    }
    if (t.key === "vet") {
      const lastRow = [...mine].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (lastRow) lines.push(`最近：${lastRow.title}`);
    }
    tile.append(head, big);
    lines.forEach(text => {
      const p = document.createElement("div");
      p.className = "tile-delta";
      p.textContent = text;
      tile.appendChild(p);
    });
    box.appendChild(tile);
  });
}

function renderFilters(rows) {
  const typeSel = document.getElementById("petTypeFilter");
  typeSel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "全部類型";
  typeSel.appendChild(all);
  PET_TYPES.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.key;
    opt.textContent = `${t.icon} ${t.label}`;
    typeSel.appendChild(opt);
  });
  typeSel.value = state.typeFilter;

  const byType = rows.filter(r => state.typeFilter === "all" || r.type === state.typeFilter);
  const months = [...new Set(byType.map(r => monthOf(r.date)))].sort().reverse();
  if (!months.includes(state.month)) state.month = months[0] || "";
  const monthSel = document.getElementById("petMonthFilter");
  monthSel.innerHTML = "";
  months.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = formatMonthLabel(m);
    monthSel.appendChild(opt);
  });
  monthSel.value = state.month;
  monthSel.classList.toggle("hidden", !months.length);
  return byType;
}

function renderLogList() {
  const container = document.getElementById("petLogList");
  const totalEl = document.getElementById("petMonthTotal");
  const rows = petRows();
  const byType = renderFilters(rows);
  const shown = byType
    .filter(r => monthOf(r.date) === state.month)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  container.innerHTML = "";
  if (!shown.length) {
    totalEl.textContent = "";
    container.innerHTML = `<p class="empty-hint">還沒有紀錄</p>`;
    return;
  }
  const monthTotal = sumAmount(shown);
  const year = state.month.slice(0, 4);
  const yearTotal = sumAmount(byType.filter(r => String(r.date).startsWith(year)));
  totalEl.textContent = `${formatMonthLabel(state.month)}合計 $${monthTotal}　·　${year} 年合計 $${yearTotal}`;

  const ul = document.createElement("ul");
  ul.className = "item-list";
  shown.forEach(r => ul.appendChild(buildLogRow(r)));
  container.appendChild(ul);
}

// 飼料／貓砂：「用完了」記用完日；已用完的顯示「✅ 用完於 … （用了 N 天）」，點了可以改日期或清除
function buildFinishBtn(r) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pay-btn";
  if (r.finishedAt) {
    const days = dayNum(r.finishedAt) - dayNum(r.date);
    btn.textContent = `✅ 用完於 ${String(r.finishedAt).slice(5).replace("-", "/")}（用了 ${days} 天）`;
    btn.title = "點一下修改用完日；清空日期＝改回還沒用完";
  } else {
    btn.textContent = "用完了";
    btn.title = "記下用完的日期";
  }
  btn.addEventListener("click", async () => {
    const input = await showPrompt(r.finishedAt ? "用完日（yyyy-MM-dd，留空＝改回還沒用完）：" : "用完日（yyyy-MM-dd）：", r.finishedAt || toDateStr(new Date()));
    if (input === null) return;
    const day = input.trim();
    if (day !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(day)) { setStatus("日期格式要 yyyy-MM-dd", true); return; }
    if (day !== "" && day < String(r.date)) { setStatus(`用完日不能早於購買日（${r.date}）`, true); return; }
    await withRowLock(btn, async () => {
      try {
        applyPetData(await api("setPetLogFinished", { id: r.id, finishedAt: day }));
        releasePending(btn);
        renderPetsAll();
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
  });
  return btn;
}

function buildLogRow(r) {
  const meta = typeMeta(r.type);
  const li = document.createElement("li");
  li.className = "item-row pet-log-row";
  li.dataset.lockKey = `petlog:${r.id}`;

  const badge = document.createElement("span");
  badge.className = "owner-badge";
  badge.textContent = `${meta.icon} ${meta.label}`;
  const title = document.createElement("span");
  title.className = "item-text";
  title.textContent = r.title;
  const date = document.createElement("span");
  date.className = "item-time";
  date.textContent = String(r.date).slice(5).replace("-", "/");
  li.append(badge, title, date);
  if (Number(r.amount) > 0) {
    const amt = document.createElement("span");
    amt.className = "item-time";
    amt.textContent = `$${Number(r.amount)}`;
    li.appendChild(amt);
  }

  const row2 = document.createElement("div");
  row2.className = "item-meta-row";
  if (r.note) {
    const note = document.createElement("span");
    note.className = "item-time pet-note";
    note.textContent = "📝 " + r.note;
    row2.appendChild(note);
  }
  if (meta.finishable) row2.appendChild(buildFinishBtn(r));
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "ghost-btn";
  editBtn.title = "編輯";
  editBtn.textContent = "✏️";
  editBtn.addEventListener("click", () => openPetLogForm(r));
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "delete-btn";
  delBtn.title = "刪除";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async () => {
    if (!(await showConfirm(`確定要刪除「${r.title}」這筆紀錄嗎？`))) return;
    await withRowLock(delBtn, async () => {
      try {
        applyPetData(await api("deletePetLog", { id: r.id }));
        releasePending(delBtn);
        renderPetsAll();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    });
  });
  row2.append(spacer, editBtn, delBtn);
  li.appendChild(row2);
  lockIfPending(li);
  return li;
}

document.getElementById("petTypeFilter").addEventListener("change", (e) => {
  state.typeFilter = e.target.value;
  renderLogList();
});
document.getElementById("petMonthFilter").addEventListener("change", (e) => {
  state.month = e.target.value;
  renderLogList();
});

// ====== 新增／編輯彈窗 ======
function updatePetFormValidity() {
  document.getElementById("petLogSubmit").disabled = !(
    document.getElementById("petLogItem").value.trim() && document.getElementById("petLogDate").value
  );
}
["petLogItem", "petLogDate"].forEach(id => document.getElementById(id).addEventListener("input", updatePetFormValidity));

function initPetFormOptions() {
  const petSel = document.getElementById("petLogPet");
  PET_NAMES.forEach(n => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = `${PET_ICON[n] || "🐾"} ${n}`;
    petSel.appendChild(o);
  });
  const typeSel = document.getElementById("petLogType");
  PET_TYPES.forEach(t => {
    const o = document.createElement("option");
    o.value = t.key;
    o.textContent = `${t.icon} ${t.label}`;
    typeSel.appendChild(o);
  });
}
initPetFormOptions();
document.getElementById("petLogType").addEventListener("change", (e) => {
  syncTypeLabels(e.target.value);
});

function syncTypeLabels(type) {
  const meta = typeMeta(type);
  document.getElementById("petLogTitleLabel").textContent = meta.titleLabel;
  document.getElementById("petLogNoteLabel").textContent = meta.noteLabel;
}

// r 有值＝編輯，沒有＝新增（預設目前選的寵物、今天）
function openPetLogForm(r) {
  state.editingId = r ? r.id : null;
  document.getElementById("petLogTitle").textContent = r ? "編輯紀錄" : "新增紀錄";
  document.getElementById("petLogSubmit").textContent = r ? "儲存" : "新增";
  document.getElementById("petLogPet").value = r ? r.pet : state.pet;
  document.getElementById("petLogType").value = r ? r.type : "food";
  document.getElementById("petLogDate").value = r ? r.date : toDateStr(new Date());
  document.getElementById("petLogItem").value = r ? r.title : "";
  document.getElementById("petLogAmount").value = r && r.amount !== "" && r.amount != null ? String(r.amount) : "";
  document.getElementById("petLogNote").value = r ? r.note || "" : "";
  syncTypeLabels(document.getElementById("petLogType").value);
  updatePetFormValidity();
  document.getElementById("petLogModal").classList.remove("hidden");
}
function closePetLogForm() { document.getElementById("petLogModal").classList.add("hidden"); }
document.getElementById("openPetLogForm").addEventListener("click", () => openPetLogForm(null));
document.getElementById("petLogClose").addEventListener("click", closePetLogForm);
document.getElementById("petLogModal").addEventListener("click", (e) => { if (e.target.id === "petLogModal") closePetLogForm(); });

document.getElementById("petLogForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amountRaw = document.getElementById("petLogAmount").value.trim();
  const amount = amountRaw === "" ? "" : parseStrictNumber(amountRaw);
  if (amountRaw !== "" && (amount === null || amount < 0)) { setStatus(`金額「${amountRaw}」不是有效數字`, true); return; }
  const params = {
    pet: document.getElementById("petLogPet").value,
    type: document.getElementById("petLogType").value,
    date: document.getElementById("petLogDate").value,
    title: document.getElementById("petLogItem").value,
    amount,
    note: document.getElementById("petLogNote").value,
  };
  const editing = state.editingId;
  if (editing) params.id = editing;
  setFormBusy(e.target, true);
  try {
    applyPetData(await api(editing ? "updatePetLog" : "addPetLog", params));
    state.pet = params.pet; // 切到剛記的那隻，才看得到新紀錄
    state.month = monthOf(params.date);
    renderPetsAll();
    closePetLogForm();
    showToast(editing ? "已儲存" : "已新增紀錄");
  } catch (err) {
    setStatus((editing ? "儲存失敗：" : "新增失敗：") + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updatePetFormValidity();
  }
});

// ====== 整理舊紀錄（把行事曆裡的寵物舊事件搬進 PetLog）======
let migrateRows = []; // { cand, li, check, typeSel }

function updateMigrateCount() {
  const n = migrateRows.filter(r => r.check.checked).length;
  document.getElementById("petMigrateCount").textContent = `已選 ${n} / ${migrateRows.length} 筆`;
  document.getElementById("petMigrateSubmit").disabled = n === 0;
  document.getElementById("petMigrateSkip").disabled = n === 0;
}

function openPetMigrate() {
  const list = document.getElementById("petMigrateList");
  list.innerHTML = "";
  migrateRows = [];
  migrationCandidates(state.events, petDoneIds(), { all: document.getElementById("petMigrateAll").checked }).forEach(cand => {
    const e = cand.event;
    const li = document.createElement("li");
    li.className = "item-row pet-migrate-row";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = true;
    check.addEventListener("change", updateMigrateCount);
    const info = document.createElement("span");
    info.className = "item-text";
    info.textContent = `${e.date}　${PET_ICON[e.owner] || ""}${e.owner}　${e.title}${Number(e.amount) > 0 ? `　$${Number(e.amount)}` : ""}`;
    const typeSel = document.createElement("select");
    PET_TYPES.forEach(t => {
      const o = document.createElement("option");
      o.value = t.key;
      o.textContent = `${t.icon} ${t.label}`;
      typeSel.appendChild(o);
    });
    typeSel.value = cand.type;
    li.append(check, info, typeSel);
    list.appendChild(li);
    migrateRows.push({ cand, li, check, typeSel });
  });
  updateMigrateCount();
  document.getElementById("petMigrateModal").classList.remove("hidden");
}
function closePetMigrate() { document.getElementById("petMigrateModal").classList.add("hidden"); }
document.getElementById("openPetMigrate").addEventListener("click", () => { document.getElementById("petMigrateAll").checked = false; openPetMigrate(); });
document.getElementById("petMigrateAll").addEventListener("change", openPetMigrate); // 切換「顯示全部」就重新列
document.getElementById("petMigrateClose").addEventListener("click", closePetMigrate);
document.getElementById("petMigrateModal").addEventListener("click", (e) => { if (e.target.id === "petMigrateModal") closePetMigrate(); });

document.getElementById("petMigrateSubmit").addEventListener("click", async (e) => {
  const picked = migrateRows.filter(r => r.check.checked);
  if (!picked.length) return;
  const items = picked.map(r => {
    const ev = r.cand.event;
    return {
      eventId: ev.id, pet: ev.owner, type: r.typeSel.value, date: ev.date,
      title: ev.title, amount: Number(ev.amount) > 0 ? Number(ev.amount) : "", note: ev.notes || "",
    };
  });
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    applyPetData(await api("importPetEvents", { items: JSON.stringify(items) })); // api() 會把每個參數轉成字串，陣列要先自己轉成 JSON
    renderPetsAll();
    closePetMigrate();
    showToast(`已搬進 ${items.length} 筆`);
  } catch (err) {
    setStatus("搬移失敗：" + err.message, true);
  } finally {
    updateMigrateCount();
  }
});

// 不用登記的（例如已經自己手動記過、或只是提醒）：略過後不再出現在待登記
document.getElementById("petMigrateSkip").addEventListener("click", async (e) => {
  const btn = e.currentTarget; // 要在第一個 await 之前取：await 之後事件已經結束，currentTarget 會變成 null
  const picked = migrateRows.filter(r => r.check.checked);
  if (!picked.length) return;
  if (!(await showConfirm(`確定這 ${picked.length} 筆不用登記到寵物紀錄嗎？略過後就不會再出現在待登記（原事件不受影響）。`))) return;
  btn.disabled = true;
  try {
    applyPetData(await api("skipPetEvents", { ids: JSON.stringify(picked.map(r => r.cand.event.id)) })); // api() 會把參數轉成字串，陣列要先轉成 JSON
    renderPetsAll();
    if (!migrationCandidates(state.events, petDoneIds(), { all: document.getElementById("petMigrateAll").checked }).length) closePetMigrate(); else openPetMigrate();
    showToast(`已略過 ${picked.length} 筆`);
  } catch (err) {
    setStatus("略過失敗：" + err.message, true);
  } finally {
    updateMigrateCount();
  }
});

// ====== Boot ======
initAuth();
