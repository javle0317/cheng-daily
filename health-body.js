// ====== 健康頁：體重（InBody）分頁 ======
// 共用工具（drawTimeChart / buildLevelBadge / toNum ...）在 health-charts.js。
// 分級依據：BMI 用國健署成人標準；體脂率、腰臀比用男性標準（Dean 男、42 歲）；
// 內臟脂肪用 InBody 的等級（1-9 標準、10-14 偏高、15+ 高）。
(function () {
  const TARGET_WEIGHT = 90; // 目標體重（kg）

  const state = { readings: [], range: "all" };

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
    const whr = toNum(latest.whr);

    if (weight !== null) row.appendChild(makeTile("體重 kg", String(weight), { delta: delta("weight"), unit: " kg" }));
    if (bmi !== null) row.appendChild(makeTile("BMI", String(bmi), { badge: classifyBmi(bmi) }));
    if (bodyFat !== null) row.appendChild(makeTile("體脂率 %", String(bodyFat), { delta: delta("bodyFat"), unit: "%", badge: classifyBodyFat(bodyFat) }));
    if (skeletal !== null) row.appendChild(makeTile("骨骼肌量 kg", String(skeletal), { delta: delta("skeletalMuscle"), unit: " kg" }));
    if (visceral !== null) row.appendChild(makeTile("內臟脂肪等級", String(visceral), { badge: classifyVisceral(visceral) }));
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

  function renderCharts() {
    drawTimeChart(document.getElementById("bodyWeightChart"), pointsFor("weight"), { unit: "kg", decimals: 1 });
    drawTimeChart(document.getElementById("bodyFatChart"), pointsFor("bodyFat", classifyBodyFat), {
      unit: "%",
      decimals: 1,
      color: "var(--series-diastolic)",
      bands: [
        { from: 0, to: 10, level: "warning", label: "偏低" },
        { from: 10, to: 20, level: "good", label: "標準" },
        { from: 20, to: 25, level: "warning", label: "偏高" },
        { from: 25, to: 100, level: "serious", label: "肥胖" },
      ],
    });
    drawTimeChart(document.getElementById("bodyMuscleChart"), pointsFor("skeletalMuscle"), {
      unit: "kg",
      decimals: 1,
      color: "var(--series-pulse)",
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
        if (!(await showConfirm("確定要刪除這筆體重紀錄嗎？"))) return;
        await withRowLock(del, async () => {
          try {
            apply(await api("deleteInBodyReading", { id: r.id }));
            renderAll();
          } catch (err) {
            setStatus("刪除失敗：" + err.message, true);
          }
        });
      });
      li.appendChild(del);
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  // ====== 新增 ======
  const FIELD_MAP = {
    bodyWeight: "weight", bodyHeight: "height", bodyFatInput: "bodyFat", bodyFatMass: "fatMass",
    bodySkeletal: "skeletalMuscle", bodyMuscle: "muscleMass", bodyWater: "bodyWater",
    bodyProtein: "protein", bodyMineral: "mineral", bodyVisceral: "visceralFat",
    bodyBmr: "bmr", bodyWhr: "whr", bodyScore: "score",
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

  Object.keys(FIELD_MAP).concat(["bodyDate"]).forEach(id => {
    document.getElementById(id).addEventListener("input", updateForm);
  });

  document.getElementById("bodyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const params = { date: document.getElementById("bodyDate").value };
    Object.entries(FIELD_MAP).forEach(([id, key]) => {
      params[key] = document.getElementById(id).value;
    });
    const bmi = computeBmi();
    params.bmi = bmi === null ? "" : bmi;
    if (!params.date || !params.weight) return;
    setFormBusy(e.target, true);
    try {
      apply(await api("addInBodyReading", params));
      Object.keys(FIELD_MAP).forEach(id => {
        if (id !== "bodyHeight") document.getElementById(id).value = "";
      });
      renderAll();
      showToast("已新增體重紀錄");
    } catch (err) {
      setStatus("新增失敗：" + err.message, true);
    } finally {
      setFormBusy(e.target, false);
      updateForm();
    }
  });

  document.getElementById("bodyRange").addEventListener("change", (e) => {
    state.range = e.target.value;
    renderCharts();
  });

  function apply(data) {
    state.readings = data || [];
  }

  function renderAll() {
    renderStatus();
    renderCharts();
    renderList();
    prefillForm();
  }

  window.healthLoaders = window.healthLoaders || [];
  window.healthLoaders.push(async () => {
    apply(await api("getInBodyData"));
    renderAll();
  });
})();
