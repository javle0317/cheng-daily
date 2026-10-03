// ====== 健康頁：驗血分頁 ======
// 共用工具在 health-charts.js。參考範圍採 Dean 自己驗血報告上的範圍；分級（正常/注意/
// 偏高/嚴重）另外參考常見指引（ADA 血糖與 HbA1c、台灣血脂指引、KDIGO eGFR 等），
// 依男性（42 歲）。各檢驗所上限略有不同，以報告上標示為準。
(function () {
  const R = (level, text) => ({ level, text });

  const ITEMS = [
    { key: "glucose", label: "空腹血糖", unit: "mg/dL", ref: "<100", dec: 0, group: "血糖",
      classify: v => v < 70 ? R("warning", "偏低") : v < 100 ? R("good", "正常") : v < 126 ? R("warning", "糖尿病前期範圍") : R("serious", "達糖尿病標準"),
      bands: [[0, 70, "warning", "偏低"], [70, 100, "good", "正常"], [100, 126, "warning", "前期"], [126, 600, "serious", "糖尿病"]] },
    { key: "hba1c", label: "醣化血色素 HbA1c", unit: "%", ref: "<5.7（ADA；報告 4-6）", dec: 1, group: "血糖",
      classify: v => v < 5.7 ? R("good", "正常") : v < 6.5 ? R("warning", "糖尿病前期範圍") : R("serious", "達糖尿病標準"),
      bands: [[0, 5.7, "good", "正常"], [5.7, 6.5, "warning", "前期"], [6.5, 20, "serious", "糖尿病"]] },
    { key: "cholesterol", label: "總膽固醇", unit: "mg/dL", ref: "<200", dec: 0, group: "血脂",
      classify: v => v < 200 ? R("good", "正常") : v < 240 ? R("warning", "邊緣偏高") : R("serious", "偏高"),
      bands: [[0, 200, "good", "正常"], [200, 240, "warning", "邊緣"], [240, 600, "serious", "偏高"]] },
    { key: "ldl", label: "LDL 壞膽固醇", unit: "mg/dL", ref: "<130", dec: 0, group: "血脂",
      classify: v => v < 130 ? R("good", "正常") : v < 160 ? R("warning", "邊緣偏高") : v < 190 ? R("serious", "偏高") : R("critical", "很高"),
      bands: [[0, 130, "good", "正常"], [130, 160, "warning", "邊緣"], [160, 190, "serious", "偏高"], [190, 600, "critical", "很高"]] },
    { key: "hdl", label: "HDL 好膽固醇", unit: "mg/dL", ref: ">40", dec: 0, group: "血脂",
      classify: v => v > 40 ? R("good", "正常") : v >= 35 ? R("warning", "偏低") : R("serious", "過低"),
      bands: [[0, 35, "serious", "過低"], [35, 40, "warning", "偏低"], [40, 200, "good", "正常"]] },
    { key: "triglyceride", label: "三酸甘油酯（中性脂肪）", unit: "mg/dL", ref: "<150", dec: 0, group: "血脂",
      classify: v => v < 150 ? R("good", "正常") : v < 200 ? R("warning", "邊緣偏高") : v < 500 ? R("serious", "偏高") : R("critical", "很高"),
      bands: [[0, 150, "good", "正常"], [150, 200, "warning", "邊緣"], [200, 500, "serious", "偏高"], [500, 3000, "critical", "很高"]] },
    { key: "ast", label: "AST/GOT", unit: "U/L", ref: "<40", dec: 0, group: "肝功能",
      classify: v => v < 40 ? R("good", "正常") : v < 80 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 40, "good", "正常"], [40, 80, "warning", "偏高"], [80, 1000, "serious", "明顯偏高"]] },
    { key: "alt", label: "ALT/GPT", unit: "U/L", ref: "7-52", dec: 0, group: "肝功能",
      classify: v => v <= 52 ? R("good", "正常") : v <= 104 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 52, "good", "正常"], [52, 104, "warning", "偏高"], [104, 1000, "serious", "明顯偏高"]] },
    { key: "creatinine", label: "肌酸酐 Creatinine", unit: "mg/dL", ref: "0.7-1.3", dec: 2, group: "腎功能與尿酸",
      classify: v => v < 0.7 ? R("warning", "偏低") : v <= 1.3 ? R("good", "正常") : v <= 1.5 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 0.7, "warning", "偏低"], [0.7, 1.3, "good", "正常"], [1.3, 1.5, "warning", "偏高"], [1.5, 20, "serious", "明顯偏高"]] },
    { key: "egfr", label: "eGFR 腎絲球過濾率", unit: "", ref: ">90", dec: 1, group: "腎功能與尿酸",
      classify: v => v >= 90 ? R("good", "正常") : v >= 60 ? R("warning", "輕度下降") : v >= 30 ? R("serious", "中度下降") : R("critical", "重度下降"),
      bands: [[0, 30, "critical", "重度"], [30, 60, "serious", "中度"], [60, 90, "warning", "輕度"], [90, 300, "good", "正常"]] },
    { key: "bun", label: "尿素氮 BUN", unit: "mg/dL", ref: "7-25", dec: 0, group: "腎功能與尿酸",
      classify: v => v < 7 ? R("warning", "偏低") : v <= 25 ? R("good", "正常") : v <= 40 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 7, "warning", "偏低"], [7, 25, "good", "正常"], [25, 40, "warning", "偏高"], [40, 300, "serious", "明顯偏高"]] },
    { key: "uricAcid", label: "尿酸 Uric acid", unit: "mg/dL", ref: "4.4-7.6", dec: 1, group: "腎功能與尿酸",
      classify: v => v < 4.4 ? R("warning", "偏低") : v <= 7.6 ? R("good", "正常") : v < 9 ? R("warning", "偏高（高尿酸）") : R("serious", "明顯偏高"),
      bands: [[0, 4.4, "warning", "偏低"], [4.4, 7.6, "good", "正常"], [7.6, 9, "warning", "偏高"], [9, 30, "serious", "明顯偏高"]] },
    { key: "sodium", label: "鈉 Na", unit: "mmol/L", ref: "136-145", dec: 1, group: "電解質",
      classify: v => v >= 136 && v <= 145 ? R("good", "正常") : (v >= 130 && v < 136) || (v > 145 && v <= 150) ? R("warning", v < 136 ? "偏低" : "偏高") : R("serious", v < 130 ? "明顯偏低" : "明顯偏高"),
      bands: [[0, 130, "serious", "明顯偏低"], [130, 136, "warning", "偏低"], [136, 145, "good", "正常"], [145, 150, "warning", "偏高"], [150, 200, "serious", "明顯偏高"]] },
    { key: "potassium", label: "鉀 K", unit: "mmol/L", ref: "3.5-5.1", dec: 1, group: "電解質",
      classify: v => v >= 3.5 && v <= 5.1 ? R("good", "正常") : (v >= 3.0 && v < 3.5) || (v > 5.1 && v <= 5.5) ? R("warning", v < 3.5 ? "偏低" : "偏高") : R("serious", v < 3.0 ? "明顯偏低" : "明顯偏高"),
      bands: [[0, 3.0, "serious", "明顯偏低"], [3.0, 3.5, "warning", "偏低"], [3.5, 5.1, "good", "正常"], [5.1, 5.5, "warning", "偏高"], [5.5, 10, "serious", "明顯偏高"]] },
    { key: "tsh", label: "甲狀腺 TSH", unit: "", ref: "0.4-4.0", dec: 2, group: "其他",
      classify: v => v < 0.4 ? R("warning", "偏低") : v <= 4.0 ? R("good", "正常") : v <= 10 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 0.4, "warning", "偏低"], [0.4, 4, "good", "正常"], [4, 10, "warning", "偏高"], [10, 100, "serious", "明顯偏高"]] },
    { key: "ck", label: "肌酸激酶 CK", unit: "U/L", ref: "30-223", dec: 0, group: "其他",
      classify: v => v < 30 ? R("warning", "偏低") : v <= 223 ? R("good", "正常") : v <= 1000 ? R("warning", "偏高（劇烈運動後常見）") : R("serious", "明顯偏高"),
      bands: [[0, 30, "warning", "偏低"], [30, 223, "good", "正常"], [223, 1000, "warning", "偏高"], [1000, 20000, "serious", "明顯偏高"]] },
  ];

  // 「其他項目」：報告上有、ITEMS 沒列的項目，存在 LabExtra（一個項目一列），
  // 每筆自帶報告上的參考範圍；分級就用那個範圍判斷（醫學意義不用我們懂，報告怎麼標就怎麼標）。
  const state = { results: [], extras: [], chartKey: "glucose" };

  function classifyRange(v, low, high) {
    let over = 0;
    let dir = "";
    if (high !== null && v > high) { over = high === 0 ? 1 : (v - high) / Math.abs(high); dir = "偏高"; }
    else if (low !== null && v < low) { over = low === 0 ? 1 : (low - v) / Math.abs(low); dir = "偏低"; }
    if (!dir) return (low === null && high === null) ? null : R("good", "正常");
    if (over <= 0.15) return R("warning", dir);
    if (over <= 0.5) return R("serious", dir);
    return R("critical", "明顯" + dir);
  }

  function refText(low, high) {
    if (low !== null && high !== null) return `${low}-${high}`;
    if (high !== null) return `<${high}`;
    if (low !== null) return `>${low}`;
    return "未填";
  }

  function extraHistory(name) {
    return state.extras
      .filter(e => e.name === name)
      .map(e => ({ date: e.date, value: toNum(e.value), low: toNum(e.refLow), high: toNum(e.refHigh), unit: e.unit || "" }))
      .filter(p => p.value !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ITEMS（固定項目）+ 其他項目（依名稱分組）統一成同一種 item 介面
  function allItems() {
    const known = ITEMS.map(item => ({
      ...item,
      history: () => sortedResults()
        .map(r => ({ date: r.date, value: toNum(r[item.key]) }))
        .filter(p => p.value !== null),
      classifyPoint: p => item.classify(p.value),
      refLabel: () => item.ref,
      bandList: () => item.bands.map(([from, to, level, label]) => ({ from, to, level, label })),
    }));
    const names = [...new Set(state.extras.map(e => e.name))].sort();
    const extra = names.map(name => {
      const hist = () => extraHistory(name);
      const last = () => { const h = hist(); return h[h.length - 1] || {}; };
      return {
        key: "x:" + name,
        label: name,
        get unit() { return last().unit || ""; },
        dec: 2,
        extra: true,
        history: hist,
        classifyPoint: p => classifyRange(p.value, p.low, p.high),
        refLabel: () => refText(last().low ?? null, last().high ?? null),
        bandList: () => {
          const { low = null, high = null } = last();
          if (low !== null && high !== null) {
            return [{ from: -1e9, to: low, level: "warning", label: "偏低" }, { from: low, to: high, level: "good", label: "正常" }, { from: high, to: 1e9, level: "serious", label: "偏高" }];
          }
          if (high !== null) return [{ from: -1e9, to: high, level: "good", label: "正常" }, { from: high, to: 1e9, level: "warning", label: "偏高" }];
          if (low !== null) return [{ from: -1e9, to: low, level: "warning", label: "偏低" }, { from: low, to: 1e9, level: "good", label: "正常" }];
          return [];
        },
      };
    });
    return [...known, ...extra].filter(i => i.history().length);
  }

  function sortedResults() {
    return [...state.results].sort((a, b) => a.date.localeCompare(b.date));
  }

  // ====== 各項目最近一次 ======
  function renderLatest() {
    const grid = document.getElementById("labLatest");
    grid.innerHTML = "";
    const items = allItems();
    if (!items.length) {
      grid.innerHTML = `<p class="empty-hint">還沒有驗血紀錄</p>`;
      return;
    }
    items.forEach(item => {
      const hist = item.history();
      const last = hist[hist.length - 1];
      const prev = hist.length > 1 ? hist[hist.length - 2] : null;
      const c = item.classifyPoint(last);
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `lab-tile${c ? " lab-tile-" + c.level : ""}` + (item.key === state.chartKey ? " selected" : "");
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
      let text = `參考 ${item.refLabel()}`;
      if (prev) {
        const d = roundTo(last.value - prev.value, item.dec);
        text += d === 0 ? " · 與上次持平" : ` · ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`;
      }
      ref.textContent = text;
      const when = document.createElement("div");
      when.className = "tile-delta";
      when.textContent = fmtHealthDate(last.date);
      tile.append(ref, when);

      tile.addEventListener("click", () => {
        state.chartKey = item.key;
        document.getElementById("labChartItem").value = item.key;
        renderLatest();
        renderChart();
      });
      grid.appendChild(tile);
    });
  }

  // ====== 趨勢圖 ======
  function renderChartOptions() {
    const select = document.getElementById("labChartItem");
    const prev = select.value || state.chartKey;
    select.innerHTML = "";
    const items = allItems();
    items.forEach(i => {
      const opt = document.createElement("option");
      opt.value = i.key;
      opt.textContent = i.label;
      select.appendChild(opt);
    });
    if (items.some(i => i.key === prev)) select.value = prev;
    state.chartKey = select.value || state.chartKey;
  }

  function renderChart() {
    const container = document.getElementById("labChart");
    const item = allItems().find(i => i.key === state.chartKey);
    if (!item) {
      container.innerHTML = `<p class="empty-hint">還沒有資料可以畫圖</p>`;
      return;
    }
    const points = item.history().map(p => {
      const c = item.classifyPoint(p);
      return c ? { date: p.date, value: p.value, level: c.level } : { date: p.date, value: p.value };
    });
    drawTimeChart(container, points, { unit: item.unit, decimals: item.dec, bands: item.bandList() });
  }

  // ====== 歷史列表（一天一塊，固定項目 + 其他項目都顯示）======
  function addChip(chips, label, v, dec, c, title) {
    const chip = document.createElement("span");
    chip.className = `lab-chip level-text${c ? " level-" + c.level : ""}`;
    chip.textContent = `${label} ${roundTo(v, dec)}`;
    chip.title = title;
    chips.appendChild(chip);
  }

  function renderList() {
    const container = document.getElementById("labList");
    container.innerHTML = "";
    const dates = [...new Set([...state.results.map(r => r.date), ...state.extras.map(e => e.date)])].sort().reverse();
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
      del.className = "delete-btn";
      del.title = "刪除這一天的驗血紀錄";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        if (!(await showConfirm(`確定要刪除 ${fmtHealthDate(date)} 這天的驗血紀錄嗎？（包含其他項目）`))) return;
        await withRowLock(del, async () => {
          try {
            apply(await api("deleteLabDay", { date }));
            renderAll();
          } catch (err) {
            setStatus("刪除失敗：" + err.message, true);
          }
        });
      });
      head.append(h, del);
      block.appendChild(head);

      const chips = document.createElement("div");
      chips.className = "lab-chips";
      state.results.filter(r => r.date === date).forEach(r => {
        ITEMS.forEach(item => {
          const v = toNum(r[item.key]);
          if (v === null) return;
          const c = item.classify(v);
          addChip(chips, item.label.split(" ")[0], v, item.dec, c, `${c.text}（參考 ${item.ref}）`);
        });
      });
      state.extras.filter(e => e.date === date).forEach(e => {
        const v = toNum(e.value);
        if (v === null) return;
        const low = toNum(e.refLow), high = toNum(e.refHigh);
        const c = classifyRange(v, low, high);
        addChip(chips, e.name, v, 2, c, `${c ? c.text + "，" : ""}參考 ${refText(low, high)}${e.unit ? "，單位 " + e.unit : ""}`);
      });
      block.appendChild(chips);
      container.appendChild(block);
    });
  }

  // ====== 新增 ======
  function buildForm() {
    const host = document.getElementById("labFormFields");
    const groups = [];
    ITEMS.forEach(item => {
      let g = groups.find(x => x.name === item.group);
      if (!g) { g = { name: item.group, items: [] }; groups.push(g); }
      g.items.push(item);
    });
    host.innerHTML = "";
    groups.forEach(g => {
      const title = document.createElement("div");
      title.className = "lab-group-title";
      title.textContent = g.name;
      host.appendChild(title);
      const grid = document.createElement("div");
      grid.className = "lab-form-grid";
      g.items.forEach(item => {
        const label = document.createElement("label");
        label.className = "lab-field";
        const span = document.createElement("span");
        span.textContent = `${item.label}${item.unit ? "（" + item.unit + "）" : ""}`;
        const input = document.createElement("input");
        input.type = "number";
        input.step = "any";
        input.inputMode = "decimal";
        input.id = "lab_" + item.key;
        input.placeholder = `參考 ${item.ref}`;
        input.addEventListener("input", updateForm);
        label.append(span, input);
        grid.appendChild(label);
      });
      host.appendChild(grid);
    });
  }

  // 其他項目的輸入列：名稱（可從以前用過的挑，會自動帶入單位跟參考範圍）、數值、單位、參考低、參考高
  function addExtraRow() {
    const rows = document.getElementById("labExtraRows");
    const row = document.createElement("div");
    row.className = "lab-extra-row";
    row.innerHTML = `
      <input class="x-name" type="text" list="labExtraNames" placeholder="項目名稱（如 鉀 K）">
      <input class="x-value" type="number" step="any" inputmode="decimal" placeholder="數值">
      <input class="x-unit" type="text" placeholder="單位">
      <input class="x-low" type="number" step="any" inputmode="decimal" placeholder="參考下限">
      <input class="x-high" type="number" step="any" inputmode="decimal" placeholder="參考上限">
      <button type="button" class="delete-btn x-remove" title="移除這一列">✕</button>
    `;
    const name = row.querySelector(".x-name");
    name.addEventListener("change", () => {
      const hist = extraHistory(name.value.trim());
      const last = hist[hist.length - 1];
      if (!last) return;
      if (!row.querySelector(".x-unit").value) row.querySelector(".x-unit").value = last.unit;
      if (row.querySelector(".x-low").value === "" && last.low !== null) row.querySelector(".x-low").value = last.low;
      if (row.querySelector(".x-high").value === "" && last.high !== null) row.querySelector(".x-high").value = last.high;
    });
    row.querySelectorAll("input").forEach(i => i.addEventListener("input", updateForm));
    row.querySelector(".x-remove").addEventListener("click", () => { row.remove(); updateForm(); });
    rows.appendChild(row);
  }

  function collectExtras() {
    return [...document.querySelectorAll("#labExtraRows .lab-extra-row")].map(row => ({
      name: row.querySelector(".x-name").value.trim(),
      value: row.querySelector(".x-value").value,
      unit: row.querySelector(".x-unit").value.trim(),
      refLow: row.querySelector(".x-low").value,
      refHigh: row.querySelector(".x-high").value,
    })).filter(x => x.name && x.value !== "");
  }

  function renderExtraNames() {
    const dl = document.getElementById("labExtraNames");
    dl.innerHTML = "";
    [...new Set(state.extras.map(e => e.name))].sort().forEach(n => {
      const o = document.createElement("option");
      o.value = n;
      dl.appendChild(o);
    });
  }

  function updateForm() {
    const date = document.getElementById("labDate").value;
    const any = ITEMS.some(i => document.getElementById("lab_" + i.key).value !== "") || collectExtras().length > 0;
    document.getElementById("labSubmitBtn").disabled = !(date && any);
  }

  document.getElementById("labDate").addEventListener("input", updateForm);

  function hasDay(date) {
    return state.results.some(r => r.date === date) || state.extras.some(e => e.date === date);
  }

  // 貼上匯入：把 { date, values: {glucose: 98, ...}, extra: [{name,value,unit,refLow,refHigh}] }
  // 填進新增表單（只填、不送出，讓使用者核對後再按「新增」）
  document.getElementById("labImportBtn").addEventListener("click", () => {
    const msg = document.getElementById("labImportMsg");
    let data;
    try {
      data = JSON.parse(document.getElementById("labImportText").value);
    } catch (e) {
      msg.textContent = "格式不對，請整段貼上對話裡給你的資料";
      return;
    }
    const known = new Set(ITEMS.map(i => i.key));
    const unknown = Object.keys(data.values || {}).filter(k => !known.has(k));
    if (data.date) document.getElementById("labDate").value = data.date;
    let filled = 0;
    ITEMS.forEach(i => {
      const v = data.values && data.values[i.key];
      if (v !== undefined && v !== null && v !== "") {
        document.getElementById("lab_" + i.key).value = v;
        filled++;
      }
    });
    document.getElementById("labExtraRows").innerHTML = "";
    (data.extra || []).forEach(x => {
      addExtraRow();
      const rows = document.querySelectorAll("#labExtraRows .lab-extra-row");
      const row = rows[rows.length - 1];
      row.querySelector(".x-name").value = x.name || "";
      row.querySelector(".x-value").value = x.value ?? "";
      row.querySelector(".x-unit").value = x.unit || "";
      row.querySelector(".x-low").value = x.refLow ?? "";
      row.querySelector(".x-high").value = x.refHigh ?? "";
      filled++;
    });
    updateForm();
    const notes = [`已填入 ${filled} 個項目，請核對後按「新增」`];
    if (unknown.length) notes.push(`有 ${unknown.length} 個不認得的欄位沒填入：${unknown.join("、")}`);
    if (data.date && hasDay(data.date)) notes.push("⚠️ 這一天已經有驗血紀錄，按「新增」會更新這天你有填的項目（沒填的保留）");
    msg.textContent = notes.join("；");
  });

  document.getElementById("labAddExtraBtn").addEventListener("click", addExtraRow);

  document.getElementById("labForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const params = { date: document.getElementById("labDate").value };
    ITEMS.forEach(i => { params[i.key] = document.getElementById("lab_" + i.key).value; });
    const extras = collectExtras();
    params.extra = JSON.stringify(extras);
    if (!params.date || !(ITEMS.some(i => params[i.key] !== "") || extras.length)) return;
    // 同一天已經有紀錄：只更新這次有填的項目，沒填的保留（可用來修正或補漏）
    if (hasDay(params.date) && !(await showConfirm(`${fmtHealthDate(params.date)} 已經有驗血紀錄。\n只會更新你這次有填的項目，沒填的會保留。確定嗎？`))) return;
    setFormBusy(e.target, true);
    try {
      apply(await api("addLabEntry", params));
      ITEMS.forEach(i => { document.getElementById("lab_" + i.key).value = ""; });
      document.getElementById("labExtraRows").innerHTML = "";
      renderAll();
      showToast("已新增驗血紀錄");
    } catch (err) {
      setStatus("新增失敗：" + err.message, true);
    } finally {
      setFormBusy(e.target, false);
      updateForm();
    }
  });

  document.getElementById("labChartItem").addEventListener("change", (e) => {
    state.chartKey = e.target.value;
    renderLatest();
    renderChart();
  });

  function apply(data) {
    state.results = (data && data.results) || [];
    state.extras = (data && data.extras) || [];
  }

  function renderAll() {
    renderChartOptions();
    renderLatest();
    renderChart();
    renderList();
    renderExtraNames();
    const dateInput = document.getElementById("labDate");
    if (!dateInput.value) dateInput.value = toDateStr(new Date());
    updateForm();
  }

  buildForm();

  window.healthLoaders = window.healthLoaders || [];
  window.healthLoaders.push(async () => {
    apply(await api("getLabData"));
    renderAll();
  });
})();
