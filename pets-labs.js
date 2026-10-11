// ====== 寵物頁：驗血分頁 ======
// 共用工具在 health-charts.js（classifyRange、drawTimeChart、renderLabExplain…），狀態在 pets.js（state）。
// 一個項目一列、每筆自帶報告上的參考範圍；分級用那個範圍判斷。
// 個人化設定（PetLabPrefs）：mode=ok「醫師說無妨」→ 超出範圍時不當警示；mode=range 自訂這隻的範圍。

const labState = { key: "" };

// ====== 純邏輯（regression-check 會測）======
function petLabPref(pet, name) {
  return state.prefs.find(p => p.pet === pet && p.name === name) || null;
}

// 某隻寵物某個項目的所有點（含報告範圍 rawLow/rawHigh，與實際用來判斷的 low/high）
function petLabHistory(pet, name) {
  const pref = petLabPref(pet, name);
  const custom = pref && pref.mode === "range";
  return state.labs
    .filter(r => r.pet === pet && r.name === name)
    .map(r => {
      const rawLow = toNum(r.refLow), rawHigh = toNum(r.refHigh);
      return {
        date: String(r.date), value: toNum(r.value), unit: r.unit || "",
        rawLow, rawHigh,
        low: custom ? toNum(pref.refLow) : rawLow,
        high: custom ? toNum(pref.refHigh) : rawHigh,
      };
    })
    .filter(p => p.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 分級：用 low/high（自訂範圍或報告範圍）；mode=ok 時，不在範圍內的改成中性的「醫師說無妨」
function classifyPetLabPoint(p, pref) {
  const c = classifyRange(p.value, p.low, p.high);
  if (pref && pref.mode === "ok" && c && c.level !== "good") return levelResult("ok", `${c.text}（醫師說無妨）`);
  return c;
}

function petLabBands(low, high, pref) {
  const ok = !!(pref && pref.mode === "ok");
  const below = (to) => ({ from: -1e9, to, level: ok ? "ok" : "warning", label: ok ? "偏低（無妨）" : "偏低" });
  const above = (from) => ({ from, to: 1e9, level: ok ? "ok" : "serious", label: ok ? "偏高（無妨）" : "偏高" });
  if (low !== null && high !== null) return [below(low), { from: low, to: high, level: "good", label: "正常" }, above(high)];
  if (high !== null) return [{ from: -1e9, to: high, level: "good", label: "正常" }, above(high)];
  if (low !== null) return [below(low), { from: low, to: 1e9, level: "good", label: "正常" }];
  return [];
}

// 項目介面跟 health-labs.js 的「其他項目」一致（history／classifyPoint／refLabel／bandList），
// 這樣 renderLabExplain、drawTimeChart 可以共用
function petLabItem(pet, name) {
  const pref = petLabPref(pet, name);
  const hist = () => petLabHistory(pet, name);
  const last = () => hist()[hist().length - 1] || {};
  return {
    key: name, label: name, extra: true, dec: 2, better: "range",
    get unit() { return last().unit || ""; },
    desc: pref
      ? (pref.mode === "ok"
        ? `醫師確認這隻的這項偏離範圍無妨：照樣標出偏高／偏低，但不當警示。${pref.note ? "備註：" + pref.note : ""}`
        : `使用這隻的自訂範圍（取代報告上的範圍）。${pref.note ? "備註：" + pref.note : ""}`)
      : "分級依報告上印的參考範圍判斷：落在範圍內最好。",
    history: hist,
    classifyPoint: p => classifyPetLabPoint(p, pref),
    refLabel: () => (pref && pref.mode === "range" ? "個人設定 " : "") + refText(last().low ?? null, last().high ?? null),
    bandList: () => petLabBands(last().low ?? null, last().high ?? null, pref),
  };
}

function petLabNames(pet) {
  return [...new Set(state.labs.filter(r => r.pet === pet).map(r => String(r.name)))];
}

const LAB_RANK = { good: 0, ok: 0, warning: 1, serious: 2, critical: 3 };

// 這隻的所有項目，狀況比較差的排前面（一眼看出哪些高哪些低），同級照名稱排
function petLabItems(pet) {
  return petLabNames(pet)
    .map(name => petLabItem(pet, name))
    .filter(item => item.history().length)
    .map(item => {
      const h = item.history();
      const c = item.classifyPoint(h[h.length - 1]);
      return { item, rank: c ? LAB_RANK[c.level] : 0 };
    })
    .sort((a, b) => b.rank - a.rank || a.item.label.localeCompare(b.item.label))
    .map(x => x.item);
}

// 貼上匯入：{ pet, date, items: [{ name, value, unit, refLow, refHigh }] }
function parsePetLabImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.items)) return null;
  const problems = [];
  const items = [];
  data.items.forEach((it, i) => {
    const name = String((it && it.name) || "").trim();
    const value = parseStrictNumber(it && it.value);
    if (!name) { problems.push(`第 ${i + 1} 項沒有名稱，沒有填入`); return; }
    if (value === null) { problems.push(`${name} 的數值「${it.value}」不是有效數字，沒有填入`); return; }
    const num = (v) => (v === undefined || v === null || v === "" ? "" : parseStrictNumber(v));
    const low = num(it.refLow), high = num(it.refHigh);
    if (low === null || high === null) problems.push(`${name} 的參考範圍不是有效數字，範圍沒有填入`);
    items.push({ name, value, unit: String(it.unit || "").trim(), refLow: low === null ? "" : low, refHigh: high === null ? "" : high });
  });
  const unknown = Object.keys(data).filter(k => !["pet", "date", "items"].includes(k));
  return { pet: data.pet, date: data.date, items, unknown, problems };
}

// ====== 渲染 ======
function renderLabsAll() {
  const items = petLabItems(state.pet);
  if (!items.some(i => i.key === labState.key)) labState.key = items[0] ? items[0].key : "";
  renderLabLatest(items);
  renderLabChartOptions(items);
  renderLabChart(items);
  renderLabList();
  renderLabNames();
}

function renderLabLatest(items) {
  const grid = document.getElementById("petLabLatest");
  grid.innerHTML = "";
  if (!items.length) {
    grid.innerHTML = `<p class="empty-hint">${escapeHtml(state.pet)} 還沒有驗血紀錄，按「＋ 新增驗血」（或貼上匯入）</p>`;
    return;
  }
  items.forEach(item => {
    const hist = item.history();
    const last = hist[hist.length - 1];
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    const c = item.classifyPoint(last);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `lab-tile${c ? " lab-tile-" + c.level : ""}` + (item.key === labState.key ? " selected" : "");
    tile.title = "點一下看趨勢圖";
    const name = document.createElement("div");
    name.className = "bp-stat-label";
    name.textContent = item.label;
    const value = document.createElement("div");
    value.className = "bp-stat-value";
    value.textContent = `${roundTo(last.value, item.dec)}`;
    const unit = document.createElement("span");
    unit.className = "lab-unit";
    unit.textContent = item.unit ? ` ${item.unit}` : "";
    value.appendChild(unit);
    tile.append(name, value);
    if (c) tile.appendChild(buildLevelBadge(c.level, c.text));
    const ref = document.createElement("div");
    ref.className = "tile-delta";
    if (prev) {
      const d = roundTo(last.value - prev.value, item.dec);
      ref.textContent = d === 0 ? "與上次持平" : `與上次 ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`;
    } else {
      ref.textContent = "第一筆";
    }
    const when = document.createElement("div");
    when.className = "tile-delta";
    when.textContent = fmtHealthDate(last.date);
    tile.append(ref, when);
    tile.addEventListener("click", () => {
      labState.key = item.key;
      renderLabsAll();
    });
    grid.appendChild(tile);
  });
}

function renderLabChartOptions(items) {
  const select = document.getElementById("petLabItem");
  select.innerHTML = "";
  items.forEach(i => {
    const opt = document.createElement("option");
    opt.value = i.key;
    opt.textContent = i.label;
    select.appendChild(opt);
  });
  select.value = labState.key;
  select.classList.toggle("hidden", !items.length);
}

function renderLabChart(items) {
  const container = document.getElementById("petLabChart");
  const item = items.find(i => i.key === labState.key);
  const prefBtn = document.getElementById("petLabPrefBtn");
  const prefLine = document.getElementById("petLabPrefLine");
  if (!item) {
    container.innerHTML = `<p class="empty-hint">還沒有資料可以畫圖</p>`;
    renderLabExplain(document.getElementById("petLabExplain"), null);
    prefBtn.classList.add("hidden");
    prefLine.textContent = "";
    return;
  }
  const points = item.history().map(p => {
    const c = item.classifyPoint(p);
    return c ? { date: p.date, value: p.value, level: c.level } : { date: p.date, value: p.value };
  });
  drawTimeChart(container, points, { unit: item.unit, decimals: item.dec, bands: item.bandList() });
  renderLabExplain(document.getElementById("petLabExplain"), item);
  const pref = petLabPref(state.pet, item.key);
  prefBtn.classList.remove("hidden");
  prefLine.textContent = !pref ? "使用報告上的參考範圍"
    : pref.mode === "ok" ? "個人化：醫師說無妨" + (pref.note ? `（${pref.note}）` : "")
    : `個人化：自訂範圍 ${refText(toNum(pref.refLow), toNum(pref.refHigh))}` + (pref.note ? `（${pref.note}）` : "");
}

document.getElementById("petLabItem").addEventListener("change", (e) => {
  labState.key = e.target.value;
  renderLabsAll();
});

function renderLabList() {
  const container = document.getElementById("petLabList");
  container.innerHTML = "";
  const rows = state.labs.filter(r => r.pet === state.pet);
  const dates = [...new Set(rows.map(r => String(r.date)))].sort().reverse();
  if (!dates.length) {
    container.innerHTML = `<p class="empty-hint">還沒有驗血紀錄</p>`;
    return;
  }
  dates.forEach(date => {
    const block = document.createElement("div");
    block.className = "lab-block";
    const head = document.createElement("div");
    head.className = "lab-block-head";
    const h = document.createElement("h3");
    h.className = "sub-heading";
    h.textContent = fmtHealthDate(date);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.title = "刪除這一天的驗血紀錄";
    del.textContent = "✕";
    del.addEventListener("click", async () => {
      if (!(await showConfirm(`確定要刪除 ${state.pet} ${fmtHealthDate(date)} 這天的驗血紀錄嗎？`))) return;
      await withRowLock(del, async () => {
        try {
          applyPetData(await api("deletePetLabDay", { pet: state.pet, date }));
          releasePending(del);
          renderPetsAll();
        } catch (err) {
          setStatus("刪除失敗：" + err.message, true);
        }
      });
    });
    del.dataset.lockKey = `petlabday:${state.pet}:${date}`;
    lockIfPending(del);
    head.append(h, del);
    block.appendChild(head);
    const chips = document.createElement("div");
    chips.className = "lab-chips";
    rows.filter(r => String(r.date) === date).forEach(r => {
      const item = petLabItem(state.pet, String(r.name));
      const p = item.history().find(x => x.date === date);
      if (!p) return;
      const c = item.classifyPoint(p);
      const chip = document.createElement("span");
      chip.className = `lab-chip level-text${c ? " level-" + c.level : ""}`;
      chip.textContent = `${r.name} ${roundTo(p.value, 2)}`;
      chip.title = `${c ? c.text + "，" : ""}參考 ${refText(p.low, p.high)}${p.unit ? "，單位 " + p.unit : ""}`;
      chips.appendChild(chip);
    });
    block.appendChild(chips);
    container.appendChild(block);
  });
}

function renderLabNames() {
  const dl = document.getElementById("petLabNames");
  dl.innerHTML = "";
  const names = new Set();
  PET_NAMES.forEach(p => petLabNames(p).forEach(n => names.add(n)));
  [...names].sort().forEach(n => {
    const o = document.createElement("option");
    o.value = n;
    dl.appendChild(o);
  });
}

// ====== 個人化設定 ======
function openPrefModal() {
  const name = labState.key;
  if (!name) return;
  const pref = petLabPref(state.pet, name);
  document.getElementById("petPrefItem").textContent = `${state.pet}　${name}`;
  document.querySelectorAll('input[name="petPrefMode"]').forEach(r => { r.checked = r.value === (pref ? pref.mode : "ok"); });
  document.getElementById("petPrefLow").value = pref && pref.mode === "range" && pref.refLow !== "" ? String(pref.refLow) : "";
  document.getElementById("petPrefHigh").value = pref && pref.mode === "range" && pref.refHigh !== "" ? String(pref.refHigh) : "";
  document.getElementById("petPrefNote").value = pref ? pref.note || "" : "";
  document.getElementById("petPrefHint").textContent = "";
  document.getElementById("petPrefClear").classList.toggle("hidden", !pref);
  document.getElementById("petPrefModal").classList.remove("hidden");
}
function closePrefModal() { document.getElementById("petPrefModal").classList.add("hidden"); }
document.getElementById("petLabPrefBtn").addEventListener("click", openPrefModal);
document.getElementById("petPrefClose").addEventListener("click", closePrefModal);
document.getElementById("petPrefModal").addEventListener("click", (e) => { if (e.target.id === "petPrefModal") closePrefModal(); });

document.getElementById("petPrefForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const hint = document.getElementById("petPrefHint");
  const mode = document.querySelector('input[name="petPrefMode"]:checked').value;
  const lowRaw = document.getElementById("petPrefLow").value.trim();
  const highRaw = document.getElementById("petPrefHigh").value.trim();
  const low = lowRaw === "" ? "" : parseStrictNumber(lowRaw);
  const high = highRaw === "" ? "" : parseStrictNumber(highRaw);
  if (mode === "range") {
    if (low === null || high === null) { hint.textContent = "範圍要填數字"; return; }
    if (low === "" && high === "") { hint.textContent = "自訂範圍至少要填下限或上限"; return; }
    if (low !== "" && high !== "" && low > high) { hint.textContent = "下限不能大於上限"; return; }
  }
  setFormBusy(e.target, true);
  try {
    applyPetData(await api("setPetLabPref", {
      pet: state.pet, name: labState.key, mode,
      refLow: mode === "range" ? low : "", refHigh: mode === "range" ? high : "",
      note: document.getElementById("petPrefNote").value,
    }));
    renderPetsAll();
    closePrefModal();
    showToast("已儲存個人化設定");
  } catch (err) {
    hint.textContent = "儲存失敗：" + err.message;
  } finally {
    setFormBusy(e.target, false);
  }
});

document.getElementById("petPrefClear").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    applyPetData(await api("clearPetLabPref", { pet: state.pet, name: labState.key }));
    renderPetsAll();
    closePrefModal();
    showToast("已取消個人化設定，改回報告上的範圍");
  } catch (err) {
    document.getElementById("petPrefHint").textContent = "取消失敗：" + err.message;
  } finally {
    btn.disabled = false;
  }
});

// ====== 新增驗血 ======
function addLabRow(v) {
  v = v || {};
  const host = document.getElementById("petLabRows");
  const row = document.createElement("div");
  row.className = "pet-lab-row";
  const mk = (cls, ph, val, extra) => {
    const input = document.createElement("input");
    input.className = cls;
    input.placeholder = ph;
    input.value = val === undefined || val === null ? "" : String(val);
    input.autocomplete = "off";
    Object.assign(input, extra || {});
    input.addEventListener("input", updateLabFormValidity);
    return input;
  };
  const name = mk("x-name", "項目名稱（例如 ALT）", v.name, { maxLength: 40 });
  name.setAttribute("list", "petLabNames");
  const value = mk("x-value", "數值", v.value, { inputMode: "decimal" });
  const unit = mk("x-unit", "單位", v.unit, { maxLength: 20 });
  const low = mk("x-low", "範圍下限", v.refLow, { inputMode: "decimal" });
  const high = mk("x-high", "範圍上限", v.refHigh, { inputMode: "decimal" });
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "delete-btn x-remove";
  rm.textContent = "✕";
  rm.title = "移除這一項";
  rm.addEventListener("click", () => { row.remove(); updateLabFormValidity(); });
  row.append(name, value, unit, low, high, rm);
  host.appendChild(row);
  updateLabFormValidity();
}

function collectLabRows() {
  return [...document.querySelectorAll("#petLabRows .pet-lab-row")].map(r => ({
    name: r.querySelector(".x-name").value.trim(),
    value: r.querySelector(".x-value").value.trim(),
    unit: r.querySelector(".x-unit").value.trim(),
    refLow: r.querySelector(".x-low").value.trim(),
    refHigh: r.querySelector(".x-high").value.trim(),
  })).filter(r => r.name || r.value);
}

function updateLabFormValidity() {
  const rows = collectLabRows();
  document.getElementById("petLabSubmit").disabled = !(document.getElementById("petLabDate").value && rows.length && rows.every(r => r.name && r.value));
}
document.getElementById("petLabDate").addEventListener("input", updateLabFormValidity);
document.getElementById("petLabAddRow").addEventListener("click", () => addLabRow());

function openLabForm() {
  const sel = document.getElementById("petLabPet");
  if (!sel.options.length) PET_NAMES.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = `${PET_ICON[n] || "🐾"} ${n}`; sel.appendChild(o); });
  sel.value = state.pet;
  document.getElementById("petLabDate").value = toDateStr(new Date());
  document.getElementById("petLabRows").innerHTML = "";
  document.getElementById("petLabImportText").value = "";
  document.getElementById("petLabImportMsg").textContent = "";
  addLabRow();
  document.getElementById("petLabModal").classList.remove("hidden");
}
function closeLabForm() { document.getElementById("petLabModal").classList.add("hidden"); }
document.getElementById("openPetLabForm").addEventListener("click", openLabForm);
document.getElementById("petLabClose").addEventListener("click", closeLabForm);
document.getElementById("petLabModal").addEventListener("click", (e) => { if (e.target.id === "petLabModal") closeLabForm(); });

// 貼上匯入：把 JSON 填進表單（不送出，核對後再按「新增」）
document.getElementById("petLabImportBtn").addEventListener("click", () => {
  const msg = document.getElementById("petLabImportMsg");
  const parsed = parsePetLabImport(document.getElementById("petLabImportText").value);
  if (!parsed) { msg.textContent = "格式不對，請整段貼上對話裡給你的資料（要有 items 陣列）"; return; }
  const notes = [];
  if (PET_NAMES.includes(parsed.pet)) document.getElementById("petLabPet").value = parsed.pet;
  else notes.push(`⚠️ 寵物「${parsed.pet || ""}」不認得，沒有填入（請自己選）`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || ""))) document.getElementById("petLabDate").value = parsed.date;
  else notes.push(`⚠️ 日期「${parsed.date || ""}」格式不對（要 yyyy-MM-dd），沒有填入`);
  document.getElementById("petLabRows").innerHTML = "";
  parsed.items.forEach(it => addLabRow(it));
  if (!parsed.items.length) addLabRow();
  const dup = parsed.items.map(i => i.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length) notes.push(`⚠️ 項目重複：${[...new Set(dup)].join("、")}（送出前要刪掉重複的）`);
  notes.unshift(`已填入 ${parsed.items.length} 個項目，請核對後按「新增」`);
  if (parsed.unknown.length) notes.push(`有 ${parsed.unknown.length} 個不認得的欄位沒填入：${parsed.unknown.join("、")}`);
  parsed.problems.forEach(t => notes.push("⚠️ " + t));
  const pet = document.getElementById("petLabPet").value, date = document.getElementById("petLabDate").value;
  if (state.labs.some(r => r.pet === pet && String(r.date) === date)) notes.push("⚠️ 這隻這一天已經有驗血紀錄，按「新增」會更新同名項目");
  msg.textContent = notes.join("；");
  updateLabFormValidity();
});

document.getElementById("petLabForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pet = document.getElementById("petLabPet").value;
  const date = document.getElementById("petLabDate").value;
  const rows = collectLabRows();
  const bad = [];
  const items = rows.map(r => {
    const value = parseStrictNumber(r.value);
    const low = r.refLow === "" ? "" : parseStrictNumber(r.refLow);
    const high = r.refHigh === "" ? "" : parseStrictNumber(r.refHigh);
    if (value === null) bad.push(`${r.name} 的數值`);
    if (low === null) bad.push(`${r.name} 的範圍下限`);
    if (high === null) bad.push(`${r.name} 的範圍上限`);
    return { name: r.name, value, unit: r.unit, refLow: low, refHigh: high };
  });
  if (bad.length) { setStatus("這些不是有效數字：" + bad.join("、"), true); return; }
  const names = items.map(i => i.name);
  if (new Set(names).size !== names.length) { setStatus("項目名稱有重複，請刪掉重複的", true); return; }
  if (state.labs.some(r => r.pet === pet && String(r.date) === date)
    && !(await showConfirm(`${pet} ${fmtHealthDate(date)} 已經有驗血紀錄。\n同名的項目會被更新，其他項目保留。確定嗎？`))) return;
  setFormBusy(e.target, true);
  try {
    applyPetData(await api("addPetLabEntry", { pet, date, items: JSON.stringify(items) })); // api() 會把參數轉成字串，陣列要先轉成 JSON
    state.pet = pet;
    state.tab = "labs";
    try { localStorage.setItem("petSel", pet); localStorage.setItem("petTab", "labs"); } catch (err) { /* 存不了就算了 */ }
    renderPetsAll();
    closeLabForm();
    showToast(`已新增 ${items.length} 個項目`);
  } catch (err) {
    setStatus("新增失敗：" + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updateLabFormValidity();
  }
});
