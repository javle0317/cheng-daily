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
    { key: "hba1c", label: "醣化血色素 HbA1c", unit: "%", ref: "<5.7", dec: 1, group: "血糖",
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
    { key: "triglyceride", label: "三酸甘油酯", unit: "mg/dL", ref: "<150", dec: 0, group: "血脂",
      classify: v => v < 150 ? R("good", "正常") : v < 200 ? R("warning", "邊緣偏高") : v < 500 ? R("serious", "偏高") : R("critical", "很高"),
      bands: [[0, 150, "good", "正常"], [150, 200, "warning", "邊緣"], [200, 500, "serious", "偏高"], [500, 3000, "critical", "很高"]] },
    { key: "ast", label: "AST/GOT", unit: "U/L", ref: "<40", dec: 0, group: "肝功能",
      classify: v => v < 40 ? R("good", "正常") : v < 80 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 40, "good", "正常"], [40, 80, "warning", "偏高"], [80, 1000, "serious", "明顯偏高"]] },
    { key: "alt", label: "ALT/GPT", unit: "U/L", ref: "<41", dec: 0, group: "肝功能",
      classify: v => v < 41 ? R("good", "正常") : v < 82 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 41, "good", "正常"], [41, 82, "warning", "偏高"], [82, 1000, "serious", "明顯偏高"]] },
    { key: "creatinine", label: "肌酸酐 Creatinine", unit: "mg/dL", ref: "0.7-1.3", dec: 1, group: "腎功能與尿酸",
      classify: v => v < 0.7 ? R("warning", "偏低") : v <= 1.3 ? R("good", "正常") : v <= 1.5 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 0.7, "warning", "偏低"], [0.7, 1.3, "good", "正常"], [1.3, 1.5, "warning", "偏高"], [1.5, 20, "serious", "明顯偏高"]] },
    { key: "egfr", label: "eGFR 腎絲球過濾率", unit: "", ref: ">90", dec: 1, group: "腎功能與尿酸",
      classify: v => v >= 90 ? R("good", "正常") : v >= 60 ? R("warning", "輕度下降") : v >= 30 ? R("serious", "中度下降") : R("critical", "重度下降"),
      bands: [[0, 30, "critical", "重度"], [30, 60, "serious", "中度"], [60, 90, "warning", "輕度"], [90, 300, "good", "正常"]] },
    { key: "bun", label: "尿素氮 BUN", unit: "mg/dL", ref: "7-25", dec: 0, group: "腎功能與尿酸",
      classify: v => v < 7 ? R("warning", "偏低") : v <= 25 ? R("good", "正常") : v <= 40 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 7, "warning", "偏低"], [7, 25, "good", "正常"], [25, 40, "warning", "偏高"], [40, 300, "serious", "明顯偏高"]] },
    { key: "uricAcid", label: "尿酸 Uric acid", unit: "mg/dL", ref: "3.5-7.2", dec: 1, group: "腎功能與尿酸",
      classify: v => v < 3.5 ? R("warning", "偏低") : v <= 7.2 ? R("good", "正常") : v < 9 ? R("warning", "偏高（高尿酸）") : R("serious", "明顯偏高"),
      bands: [[0, 3.5, "warning", "偏低"], [3.5, 7.2, "good", "正常"], [7.2, 9, "warning", "偏高"], [9, 30, "serious", "明顯偏高"]] },
    { key: "tsh", label: "甲狀腺 TSH", unit: "", ref: "0.4-4.0", dec: 2, group: "其他",
      classify: v => v < 0.4 ? R("warning", "偏低") : v <= 4.0 ? R("good", "正常") : v <= 10 ? R("warning", "偏高") : R("serious", "明顯偏高"),
      bands: [[0, 0.4, "warning", "偏低"], [0.4, 4, "good", "正常"], [4, 10, "warning", "偏高"], [10, 100, "serious", "明顯偏高"]] },
    { key: "ck", label: "肌酸激酶 CK", unit: "U/L", ref: "30-223", dec: 0, group: "其他",
      classify: v => v < 30 ? R("warning", "偏低") : v <= 223 ? R("good", "正常") : v <= 1000 ? R("warning", "偏高（劇烈運動後常見）") : R("serious", "明顯偏高"),
      bands: [[0, 30, "warning", "偏低"], [30, 223, "good", "正常"], [223, 1000, "warning", "偏高"], [1000, 20000, "serious", "明顯偏高"]] },
  ];

  const state = { results: [], chartKey: "glucose" };

  function sortedResults() {
    return [...state.results].sort((a, b) => a.date.localeCompare(b.date));
  }

  // 某個項目的歷史（只含有填的）
  function historyOf(item) {
    return sortedResults()
      .map(r => ({ date: r.date, value: toNum(r[item.key]) }))
      .filter(p => p.value !== null);
  }

  // ====== 各項目最近一次 ======
  function renderLatest() {
    const grid = document.getElementById("labLatest");
    grid.innerHTML = "";
    const tiles = [];
    ITEMS.forEach(item => {
      const hist = historyOf(item);
      if (!hist.length) return;
      tiles.push({ item, last: hist[hist.length - 1], prev: hist.length > 1 ? hist[hist.length - 2] : null });
    });
    if (!tiles.length) {
      grid.innerHTML = `<p class="empty-hint">還沒有驗血紀錄</p>`;
      return;
    }
    tiles.forEach(({ item, last, prev }) => {
      const c = item.classify(last.value);
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `lab-tile lab-tile-${c.level}` + (item.key === state.chartKey ? " selected" : "");
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
      tile.append(name, value, buildLevelBadge(c.level, c.text));

      const ref = document.createElement("div");
      ref.className = "tile-delta";
      let refText = `參考 ${item.ref}`;
      if (prev) {
        const d = roundTo(last.value - prev.value, item.dec);
        refText += d === 0 ? " · 與上次持平" : ` · ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`;
      }
      ref.textContent = refText;
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
    const withData = ITEMS.filter(i => historyOf(i).length);
    withData.forEach(i => {
      const opt = document.createElement("option");
      opt.value = i.key;
      opt.textContent = i.label;
      select.appendChild(opt);
    });
    if (withData.some(i => i.key === prev)) select.value = prev;
    state.chartKey = select.value || state.chartKey;
  }

  function renderChart() {
    const container = document.getElementById("labChart");
    const item = ITEMS.find(i => i.key === state.chartKey);
    if (!item || !historyOf(item).length) {
      container.innerHTML = `<p class="empty-hint">還沒有資料可以畫圖</p>`;
      return;
    }
    const points = historyOf(item).map(p => ({ ...p, level: item.classify(p.value).level }));
    drawTimeChart(container, points, {
      unit: item.unit,
      decimals: item.dec,
      bands: item.bands.map(([from, to, level, label]) => ({ from, to, level, label })),
    });
  }

  // ====== 歷史列表 ======
  function renderList() {
    const container = document.getElementById("labList");
    container.innerHTML = "";
    const results = sortedResults().reverse();
    if (!results.length) {
      container.innerHTML = `<p class="empty-hint">還沒有驗血紀錄</p>`;
      return;
    }
    results.forEach(r => {
      const block = document.createElement("div");
      block.className = "lab-block";

      const head = document.createElement("div");
      head.className = "lab-block-head";
      const h = document.createElement("h3");
      h.className = "sub-heading";
      h.textContent = fmtHealthDate(r.date);
      const del = document.createElement("button");
      del.className = "delete-btn";
      del.title = "刪除這次驗血";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        if (!(await showConfirm(`確定要刪除 ${fmtHealthDate(r.date)} 這次驗血紀錄嗎？`))) return;
        await withRowLock(del, async () => {
          try {
            apply(await api("deleteLabResult", { id: r.id }));
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
      ITEMS.forEach(item => {
        const v = toNum(r[item.key]);
        if (v === null) return;
        const c = item.classify(v);
        const chip = document.createElement("span");
        chip.className = `lab-chip level-text level-${c.level}`;
        chip.textContent = `${item.label.split(" ")[0]} ${roundTo(v, item.dec)}`;
        chip.title = `${c.text}（參考 ${item.ref}）`;
        chips.appendChild(chip);
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

  function updateForm() {
    const date = document.getElementById("labDate").value;
    const any = ITEMS.some(i => document.getElementById("lab_" + i.key).value !== "");
    document.getElementById("labSubmitBtn").disabled = !(date && any);
  }

  document.getElementById("labDate").addEventListener("input", updateForm);

  document.getElementById("labForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const params = { date: document.getElementById("labDate").value };
    ITEMS.forEach(i => { params[i.key] = document.getElementById("lab_" + i.key).value; });
    if (!params.date || !ITEMS.some(i => params[i.key] !== "")) return;
    setFormBusy(e.target, true);
    try {
      apply(await api("addLabResult", params));
      ITEMS.forEach(i => { document.getElementById("lab_" + i.key).value = ""; });
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
    state.results = data || [];
  }

  function renderAll() {
    renderChartOptions();
    renderLatest();
    renderChart();
    renderList();
    const dateInput = document.getElementById("labDate");
    if (!dateInput.value) dateInput.value = toDateStr(new Date());
    updateForm();
  }

  buildForm();

  window.healthLoaders = window.healthLoaders || [];
  window.healthLoaders.push(async () => {
    apply(await api("getLabResults"));
    renderAll();
  });
})();
