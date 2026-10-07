// ====== 健康頁：體組成分頁 ======
// 共用工具（drawTimeChart / buildLevelBadge / toNum ...）在 health-charts.js。
// 分級依據：BMI 用國健署成人標準；體脂率、腰臀比用男性標準；內臟脂肪用常見等級；
// 身體年齡跟實際年齡比。（Dean 男、42 歲；設備是 Tokuyo 體脂計，不是 InBody，
// 但 Sheet 分頁名稱維持 InBody。）
(function () {
  const TARGET_WEIGHT = 90; // 目標體重（kg）
  const ACTUAL_AGE = 42; // 實際年齡（歲），身體年齡拿來比；生日過了要手動更新

  const state = { readings: [], range: "all", version: 0 };

  function classifyBmi(v) {
    if (v < 18.5) return { level: "warning", text: "過輕" };
    if (v < 24) return { level: "good", text: "正常" };
    if (v < 27) return { level: "warning", text: "過重" };
    if (v < 30) return { level: "serious", text: "輕度肥胖" };
    if (v < 35) return { level: "serious", text: "中度肥胖" };
    return { level: "critical", text: "重度肥胖" };
  }

  function classifyBodyFat(v) {
    if (v < 10) return { level: "warning", text: "偏低" };
    if (v <= 20) return { level: "good", text: "標準" };
    if (v <= 25) return { level: "warning", text: "偏高" };
    return { level: "serious", text: "肥胖" };
  }

  function classifyVisceral(v) {
    if (v < 10) return { level: "good", text: "標準" };
    if (v < 15) return { level: "warning", text: "偏高" };
    return { level: "serious", text: "高" };
  }

  function classifyWhr(v) {
    if (v < 0.9) return { level: "good", text: "正常" };
    if (v < 1.0) return { level: "warning", text: "偏高" };
    return { level: "serious", text: "過高" };
  }

  // 身體年齡跟實際年齡的差
  function classifyBodyAge(v) {
    const diff = roundTo(v - ACTUAL_AGE, 0);
    if (diff <= 0) return { level: "good", text: `比實際年輕 ${Math.abs(diff)} 歲` };
    if (diff <= 5) return { level: "warning", text: `比實際大 ${diff} 歲` };
    return { level: "serious", text: `比實際大 ${diff} 歲` };
  }

  function sortedReadings() {
    return [...state.readings].sort((a, b) => a.date.localeCompare(b.date));
  }

  function rangeFiltered() {
    const all = sortedReadings();
    if (state.range === "all" || !all.length) return all;
    const cutoff = new Date();
    if (state.range === "3m") cutoff.setMonth(cutoff.getMonth() - 3);
    else cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = toDateStr(cutoff);
    return all.filter(r => r.date >= cutoffStr);
  }

  // ====== 狀態卡 ======
  function makeTile(label, valueText, opts = {}) {
    const tile = document.createElement("div");
    tile.className = "bp-stat-tile";
    const value = document.createElement("div");
    value.className = "bp-stat-value";
    value.textContent = valueText;
    const lab = document.createElement("div");
    lab.className = "bp-stat-label";
    lab.textContent = label;
    tile.append(value, lab);
    if (opts.delta !== undefined && opts.delta !== null) {
      const d = document.createElement("div");
      d.className = "tile-delta";
      d.textContent = opts.delta === 0 ? "與上次持平" : `${opts.delta > 0 ? "▲" : "▼"} ${Math.abs(opts.delta)}${opts.unit || ""}`;
      tile.appendChild(d);
    }
    if (opts.badge) tile.appendChild(buildLevelBadge(opts.badge.level, opts.badge.text));
    return tile;
  }

  function renderStatus() {
    const row = document.getElementById("bodyStatsRow");
    const meta = document.getElementById("bodyLatestMeta");
    const progress = document.getElementById("bodyProgress");
    row.innerHTML = "";
    progress.innerHTML = "";
    const all = sortedReadings();
    if (!all.length) {
      meta.textContent = "";
      row.innerHTML = `<p class="empty-hint">還沒有紀錄</p>`;
      return;
    }
    const latest = all[all.length - 1];
    const prev = all.length > 1 ? all[all.length - 2] : null;
    meta.textContent = `最近一次：${fmtHealthDate(latest.date)}`;

    const delta = (key, dec = 1) => {
      const a = toNum(latest[key]);
      const b = prev ? toNum(prev[key]) : null;
      return a !== null && b !== null ? roundTo(a - b, dec) : null;
    };

    const weight = toNum(latest.weight);
    const bmi = toNum(latest.bmi);
    const bodyFat = toNum(latest.bodyFat);
    const skeletal = toNum(latest.skeletalMuscle);
    const visceral = toNum(latest.visceralFat);
    const bodyAge = toNum(latest.bodyAge);
    const whr = toNum(latest.whr);

    if (weight !== null) row.appendChild(makeTile("體重 kg", String(weight), { delta: delta("weight"), unit: " kg" }));
    if (bmi !== null) row.appendChild(makeTile("BMI", String(bmi), { badge: classifyBmi(bmi) }));
    if (bodyFat !== null) row.appendChild(makeTile("體脂率 %", String(bodyFat), { delta: delta("bodyFat"), unit: "%", badge: classifyBodyFat(bodyFat) }));
    if (skeletal !== null) row.appendChild(makeTile("骨骼肌量 kg", String(skeletal), { delta: delta("skeletalMuscle"), unit: " kg" }));
    if (visceral !== null) row.appendChild(makeTile("內臟脂肪", String(visceral), { delta: delta("visceralFat", 0), badge: classifyVisceral(visceral) }));
    if (bodyAge !== null) row.appendChild(makeTile("身體年齡", String(bodyAge), { delta: delta("bodyAge", 0), unit: " 歲", badge: classifyBodyAge(bodyAge) }));
    if (whr !== null) row.appendChild(makeTile("腰臀比", String(whr), { badge: classifyWhr(whr) }));

    // 目標進度：從第一筆體重到目標體重
    const first = toNum(all[0].weight);
    if (weight !== null && first !== null) {
      const remain = roundTo(weight - TARGET_WEIGHT, 1);
      const total = first - TARGET_WEIGHT;
      const pct = total > 0 ? Math.min(100, Math.max(0, ((first - weight) / total) * 100)) : 0;
      const text = document.createElement("div");
      text.className = "progress-text";
      text.textContent = remain > 0
        ? `距離目標 ${TARGET_WEIGHT} kg 還差 ${remain} kg（已完成 ${Math.round(pct)}%，起始 ${first} kg）`
        : `已達成目標 ${TARGET_WEIGHT} kg 🎉`;
      const bar = document.createElement("div");
      bar.className = "progress-bar";
      const fill = document.createElement("div");
      fill.className = "progress-fill";
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      progress.append(text, bar);
    }
  }

  // ====== 圖表 ======
  function pointsFor(key, classify) {
    return rangeFiltered()
      .map(r => ({ date: r.date, value: toNum(r[key]) }))
      .filter(p => p.value !== null)
      .map(p => (classify ? { ...p, level: classify(p.value).level } : p));
  }

  // 趨勢圖：一張圖 + 下拉切換項目（跟驗血同一種做法）。顏色依意義分組：
  // 體重類藍、脂肪類紅、肌肉與代謝類綠；有分級的項目疊上色帶，點的顏色也跟著分級。
  const CHART_BLUE = "var(--series-systolic)";
  const CHART_RED = "var(--series-diastolic)";
  const CHART_GREEN = "var(--series-pulse)";
  const CHART_ITEMS = [
    { key: "weight", label: "體重", unit: "kg", dec: 1, color: CHART_BLUE },
    { key: "bodyFat", label: "體脂率", unit: "%", dec: 1, color: CHART_RED, classify: classifyBodyFat, bands: [
      { from: 0, to: 10, level: "warning", label: "偏低" },
      { from: 10, to: 20, level: "good", label: "標準" },
      { from: 20, to: 25, level: "warning", label: "偏高" },
      { from: 25, to: 100, level: "serious", label: "肥胖" },
    ] },
    { key: "fatMass", label: "體脂重量", unit: "kg", dec: 1, color: CHART_RED },
    { key: "skeletalMuscle", label: "骨骼肌量", unit: "kg", dec: 1, color: CHART_GREEN },
    { key: "muscleMass", label: "全身肌肉量", unit: "kg", dec: 1, color: CHART_GREEN },
    { key: "bodyWater", label: "體水分", unit: "kg", dec: 1, color: CHART_GREEN },
    { key: "protein", label: "蛋白質", unit: "kg", dec: 1, color: CHART_GREEN },
    { key: "bmr", label: "基礎代謝率", unit: "kcal", dec: 0, color: CHART_GREEN },
    { key: "visceralFat", label: "內臟脂肪", unit: "", dec: 0, color: CHART_RED, classify: classifyVisceral, bands: [
      { from: 0, to: 10, level: "good", label: "標準" },
      { from: 10, to: 15, level: "warning", label: "偏高" },
      { from: 15, to: 60, level: "serious", label: "高" },
    ] },
    { key: "bmi", label: "BMI", unit: "", dec: 1, color: CHART_BLUE, classify: classifyBmi },
    { key: "whr", label: "腰臀比", unit: "", dec: 2, color: CHART_BLUE, classify: classifyWhr },
    { key: "bodyAge", label: "身體年齡", unit: "歲", dec: 0, color: CHART_BLUE },
  ];

  function chartKey() {
    const select = document.getElementById("bodyChartItem");
    return select.value || state.chartKey || CHART_ITEMS[0].key;
  }

  function renderChartOptions() {
    const select = document.getElementById("bodyChartItem");
    if (select.options.length) return;
    CHART_ITEMS.forEach(i => {
      const opt = document.createElement("option");
      opt.value = i.key;
      opt.textContent = i.label;
      select.appendChild(opt);
    });
    let saved = null;
    try { saved = localStorage.getItem("bodyChartKey"); } catch (e) { /* 沒有就用預設 */ }
    select.value = CHART_ITEMS.some(i => i.key === saved) ? saved : CHART_ITEMS[0].key;
  }

  // 圖表上方一行摘要：最新值、跟上一筆的差、這段期間的範圍
  function chartSummary(item, points) {
    if (!points.length) return "";
    const unit = item.unit ? " " + item.unit : "";
    const fmt = v => roundTo(v, item.dec).toFixed(item.dec);
    const last = points[points.length - 1];
    const parts = [`最新 ${fmt(last.value)}${unit}（${fmtHealthDate(last.date)}）`];
    if (points.length > 1) {
      const diff = roundTo(last.value - points[points.length - 2].value, item.dec);
      parts.push(`較上一筆 ${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${fmt(Math.abs(diff))}`);
      const vals = points.map(p => p.value);
      parts.push(`範圍 ${fmt(Math.min(...vals))}–${fmt(Math.max(...vals))}`);
    }
    return parts.join("　");
  }

  function renderCharts() {
    renderChartOptions();
    const item = CHART_ITEMS.find(i => i.key === chartKey()) || CHART_ITEMS[0];
    state.chartKey = item.key;
    const points = pointsFor(item.key, item.classify);
    document.getElementById("bodyChartMeta").textContent = chartSummary(item, points);
    drawTimeChart(document.getElementById("bodyChart"), points, {
      unit: item.unit, decimals: item.dec, color: item.color, bands: item.bands, highlightLast: true,
    });
  }

  // ====== 紀錄列表 ======
  function renderList() {
    const container = document.getElementById("bodyList");
    container.innerHTML = "";
    const readings = sortedReadings().reverse();
    if (!readings.length) {
      container.innerHTML = `<p class="empty-hint">還沒有紀錄</p>`;
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "item-list";
    readings.forEach(r => {
      const li = document.createElement("li");
      li.className = "item-row health-record-row";

      const date = document.createElement("span");
      date.className = "owner-badge";
      date.textContent = fmtHealthDate(r.date);

      const main = document.createElement("span");
      main.className = "item-text";
      main.textContent = `${r.weight} kg`;

      li.append(date, main);
      const bmi = toNum(r.bmi);
      if (bmi !== null) {
        const c = classifyBmi(bmi);
        const s = document.createElement("span");
        s.className = `item-time level-text level-${c.level}`;
        s.textContent = `BMI ${bmi}（${c.text}）`;
        li.appendChild(s);
      }
      const bf = toNum(r.bodyFat);
      if (bf !== null) {
        const c = classifyBodyFat(bf);
        const s = document.createElement("span");
        s.className = `item-time level-text level-${c.level}`;
        s.textContent = `體脂 ${bf}%（${c.text}）`;
        li.appendChild(s);
      }
      const vf = toNum(r.visceralFat);
      if (vf !== null) {
        const c = classifyVisceral(vf);
        const s = document.createElement("span");
        s.className = `item-time level-text level-${c.level}`;
        s.textContent = `內臟脂肪 ${vf}（${c.text}）`;
        li.appendChild(s);
      }
      const sk = toNum(r.skeletalMuscle);
      if (sk !== null) {
        const s = document.createElement("span");
        s.className = "item-time";
        s.textContent = `骨骼肌 ${sk} kg`;
        li.appendChild(s);
      }

      const del = document.createElement("button");
      del.className = "delete-btn";
      del.title = "刪除";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        if (!(await showConfirm("確定要刪除這筆體組成紀錄嗎？"))) return;
        await withRowLock(del, async () => {
          try {
            apply(await api("deleteInBodyReading", { id: r.id }));
            releasePending(del);
            renderAll();
          } catch (err) {
            setStatus("刪除失敗：" + err.message, true);
          }
        });
      });
      li.appendChild(del);
      li.dataset.lockKey = `body:${r.id}`;
      lockIfPending(li);
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  // ====== 新增 ======
  const FIELD_MAP = {
    bodyWeight: "weight", bodyHeight: "height", bodyFatInput: "bodyFat", bodyFatMass: "fatMass",
    bodySkeletal: "skeletalMuscle", bodyMuscle: "muscleMass", bodyWater: "bodyWater",
    bodyProtein: "protein", bodyBmr: "bmr", bodyVisceral: "visceralFat", bodyAge: "bodyAge", bodyWhr: "whr",
  };

  function computeBmi() {
    const w = toNum(document.getElementById("bodyWeight").value);
    const h = toNum(document.getElementById("bodyHeight").value);
    if (w === null || h === null || h <= 0) return null;
    return roundTo(w / Math.pow(h / 100, 2), 1);
  }

  function updateForm() {
    const w = document.getElementById("bodyWeight").value;
    const date = document.getElementById("bodyDate").value;
    document.getElementById("bodySubmitBtn").disabled = !(date && w);
    const bmi = computeBmi();
    const preview = document.getElementById("bodyBmiPreview");
    preview.textContent = "";
    if (bmi !== null) {
      const c = classifyBmi(bmi);
      preview.textContent = `BMI ${bmi}（${c.text}）`;
    }
  }

  function prefillForm() {
    const dateInput = document.getElementById("bodyDate");
    if (!dateInput.value) dateInput.value = toDateStr(new Date());
    const heightInput = document.getElementById("bodyHeight");
    if (!heightInput.value) {
      const last = sortedReadings().reverse().find(r => toNum(r.height) !== null);
      if (last) heightInput.value = last.height;
    }
    updateForm();
  }

  // 貼上匯入：{ date, values: {weight: 113.3, bodyFat: 39.0, ...} } 填進表單（不送出，核對後再按新增）
  document.getElementById("bodyImportBtn").addEventListener("click", () => {
    const msg = document.getElementById("bodyImportMsg");
    let data;
    try {
      data = JSON.parse(document.getElementById("bodyImportText").value);
    } catch (e) {
      msg.textContent = "格式不對，請整段貼上對話裡給你的資料";
      return;
    }
    const keyToId = {};
    Object.entries(FIELD_MAP).forEach(([id, key]) => { keyToId[key] = id; });
    const unknown = Object.keys(data.values || {}).filter(k => !keyToId[k]);
    const problems = [];
    // 先清乾淨再填：第二份報告不能殘留第一份的數值（身高沒給就沿用上次的）
    Object.keys(FIELD_MAP).forEach(id => { document.getElementById(id).value = ""; });
    if (data.date) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) document.getElementById("bodyDate").value = data.date;
      else problems.push(`日期「${data.date}」格式不對（要 yyyy-MM-dd），沒有填入`);
    }
    let filled = 0;
    Object.entries(keyToId).forEach(([key, id]) => {
      const raw = data.values && data.values[key];
      if (raw === undefined || raw === null || raw === "") return;
      const n = parseStrictNumber(raw);
      if (n === null) { problems.push(`${key}「${raw}」不是有效數字`); return; }
      document.getElementById(id).value = n;
      filled++;
    });
    prefillForm();
    updateForm();
    const notes = [`已填入 ${filled} 個欄位，請核對後按「新增」`];
    if (unknown.length) notes.push(`有 ${unknown.length} 個不認得的欄位沒填入：${unknown.join("、")}`);
    problems.forEach(t => notes.push("⚠️ " + t));
    if (data.date && state.readings.some(r => r.date === data.date)) notes.push("⚠️ 這一天已經有體組成紀錄，按「新增」會更新這天你有填的欄位（沒填的保留）");
    msg.textContent = notes.join("；");
  });

  Object.keys(FIELD_MAP).concat(["bodyDate"]).forEach(id => {
    document.getElementById(id).addEventListener("input", updateForm);
  });

  document.getElementById("bodyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const params = { date: document.getElementById("bodyDate").value };
    Object.entries(FIELD_MAP).forEach(([id, key]) => {
      params[key] = document.getElementById(id).value;
    });
    const bad = [];
    Object.entries(FIELD_MAP).forEach(([id, key]) => {
      if (params[key] === "") return;
      const n = parseStrictNumber(params[key]);
      if (n === null) bad.push(key); else params[key] = n;
    });
    if (bad.length) { setStatus("這些欄位不是有效數字：" + bad.join("、"), true); return; }
    const bmi = computeBmi();
    params.bmi = bmi === null ? "" : bmi;
    if (!params.date || !params.weight) return;
    // 同一天已經有紀錄：只更新這次有填的欄位，沒填的保留（同一天量兩次會合併成一筆）
    if (state.readings.some(r => r.date === params.date) && !(await showConfirm(`${fmtHealthDate(params.date)} 已經有體組成紀錄。\n只會更新你這次有填的欄位，沒填的會保留。確定嗎？`))) return;
    setFormBusy(e.target, true);
    try {
      apply(await api("addInBodyReading", params));
      // 送出成功後整張表單清空（身高會由 prefillForm 帶回上次的值，日期回到今天）
      Object.keys(FIELD_MAP).forEach(id => { document.getElementById(id).value = ""; });
      document.getElementById("bodyImportText").value = "";
      document.getElementById("bodyImportMsg").textContent = "";
      document.querySelectorAll("#bodyForm details").forEach(d => { d.open = false; });
      document.getElementById("bodyDate").value = "";
      renderAll();
      closeFormModal("bodyFormModal");
      showToast("已新增體組成紀錄");
      if (state.readings.filter(r => r.date === params.date).length > 1) {
        showAlert(`⚠️ ${fmtHealthDate(params.date)} 出現了不只一筆體組成紀錄。\n後端（Apps Script）可能還是舊版，請重新部署新版本；已經存在的重複列請直接到 Sheet 的 InBody 分頁手動合併（保留一列、刪掉其他）。`);
      }
    } catch (err) {
      setStatus("新增失敗：" + err.message, true);
    } finally {
      setFormBusy(e.target, false);
      updateForm();
    }
  });

  document.getElementById("bodyInfoBtn").addEventListener("click", () => {
    document.getElementById("bodyInfoBox").classList.toggle("hidden");
  });

  document.getElementById("bodyRange").addEventListener("change", (e) => {
    state.range = e.target.value;
    renderCharts();
  });

  document.getElementById("bodyChartItem").addEventListener("change", (e) => {
    try { localStorage.setItem("bodyChartKey", e.target.value); } catch (err) { /* 存不了就只對本次有效 */ }
    renderCharts();
  });

  // 寫入（新增/刪除）的回應 version+1；背景載入（登入後才讀其他分頁）拿到結果時如果 version 變了，
  // 代表使用者在載入期間已經寫入過，載入的是更舊的資料，要丟掉，不然剛新增的紀錄會「消失」
  function apply(data, fromLoader) {
    if (!fromLoader) state.version++;
    state.readings = data || [];
  }

  function renderAll() {
    renderStatus();
    renderCharts();
    renderList();
    prefillForm();
  }

  window.healthLoaders = window.healthLoaders || [];
  window.healthLoaders.push({ tab: "body", load: async () => {
    const v = state.version;
    const data = await api("getInBodyData");
    if (state.version !== v) return;
    apply(data, true);
    renderAll();
  } });
})();
