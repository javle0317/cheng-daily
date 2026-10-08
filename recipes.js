// ====== 食譜頁 ======
// WEBAPP_URL / api() / 登入流程 / showConfirm 等共用邏輯在 shared.js。
// Sheet 分頁 Recipes 由後端 ensureSheet 自動建立；tags 存成逗號分隔的文字。

let state = {
  recipes: [],
  search: "",
  tag: "all",
  sort: "new",
  expanded: new Set(), // 展開中的食譜 id（重畫後保持展開）
  editingId: null,
};

function applyRecipes(recipes) {
  state.recipes = recipes || [];
}

window.loadPageData = async function () {
  applyRecipes(await api("getRecipes"));
  renderRecipesAll();
};

// ====== 純邏輯（regression-check 會測）======
function splitTags(v) {
  const seen = new Set();
  const out = [];
  String(v === undefined || v === null ? "" : v).split(/[,，、]/).forEach(t => {
    t = t.trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  });
  return out;
}

function recipeTags(r) {
  return splitTags(r.tags);
}

function allTags(recipes) {
  const set = new Set();
  recipes.forEach(r => recipeTags(r).forEach(t => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

// 搜尋比對名稱與食材（不分大小寫）；標籤 "all" 不篩
function filterRecipes(recipes, search, tag) {
  const q = String(search || "").trim().toLowerCase();
  return recipes.filter(r => {
    if (tag && tag !== "all" && !recipeTags(r).includes(tag)) return false;
    if (!q) return true;
    return String(r.name || "").toLowerCase().includes(q) || String(r.ingredients || "").toLowerCase().includes(q);
  });
}

function ratingOf(r) {
  const n = Number(r.rating);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 0;
}

function cookCountOf(r) {
  const n = Number(r.cookCount);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// 排序：new＝最近新增（Sheet 由上往下是舊到新，所以倒過來）；其餘同分時也保持最近新增在前
function sortRecipes(recipes, mode) {
  const indexed = recipes.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    if (mode === "rating") return ratingOf(b.r) - ratingOf(a.r) || b.i - a.i;
    if (mode === "cooked") return cookCountOf(b.r) - cookCountOf(a.r) || b.i - a.i;
    return b.i - a.i;
  });
  return indexed.map(x => x.r);
}

// 貼上匯入：{ name, tags: ["主菜"] 或 "主菜,低醣", ingredients: ["…"] 或多行文字, steps: 同, notes }
// 只填表單、不送出；回傳 { fields, unknown, problems }
const IMPORT_KEYS = ["name", "tags", "ingredients", "steps", "notes"];
function parseRecipeImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const fields = {};
  const problems = [];
  const asLines = (v) => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).join("\n") : String(v === undefined || v === null ? "" : v).trim();
  IMPORT_KEYS.forEach(k => {
    const v = data[k];
    if (v === undefined || v === null || v === "") return;
    if (k === "tags") fields.tags = (Array.isArray(v) ? v.map(String) : splitTags(v)).map(t => t.trim()).filter(Boolean).join(", ");
    else if (typeof v === "object" && !Array.isArray(v)) problems.push(`${k} 的格式不對，沒有填入`);
    else fields[k] = asLines(v);
  });
  const unknown = Object.keys(data).filter(k => !IMPORT_KEYS.includes(k));
  return { fields, unknown, problems };
}

// ====== 渲染 ======
function renderRecipesAll() {
  renderTagFilter();
  renderTagOptions();
  renderRecipeList();
  updateRecipeFormValidity();
}

// 標籤下拉：資料中實際出現的標籤；選到的標籤已經沒有食譜（刪光了）就退回「全部」
function renderTagFilter() {
  const sel = document.getElementById("recipeTagFilter");
  const tags = allTags(state.recipes);
  if (state.tag !== "all" && !tags.includes(state.tag)) state.tag = "all";
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "全部標籤";
  sel.appendChild(all);
  tags.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  });
  sel.value = state.tag;
  sel.classList.toggle("hidden", !tags.length);
}

function renderTagOptions() {
  const dl = document.getElementById("recipeTagOptions");
  dl.innerHTML = "";
  allTags(state.recipes).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    dl.appendChild(opt);
  });
}

function buildStars(r) {
  const wrap = document.createElement("span");
  wrap.className = "recipe-stars";
  const cur = ratingOf(r);
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "star-btn" + (n <= cur ? " on" : "");
    b.title = `${n} 星`;
    b.setAttribute("aria-label", `評 ${n} 星`);
    b.textContent = n <= cur ? "★" : "☆";
    b.addEventListener("click", async () => {
      const next = n === cur ? 0 : n; // 再點一次同一顆＝清除評分
      await withRowLock(b, async () => {
        try {
          applyRecipes(await api("setRecipeRating", { id: r.id, rating: next }));
          releasePending(b);
          renderRecipesAll();
        } catch (err) {
          setStatus("評分失敗：" + err.message, true);
        }
      });
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function buildTextBlock(title, text) {
  const block = document.createElement("div");
  block.className = "recipe-block";
  const h = document.createElement("h4");
  h.textContent = title;
  const p = document.createElement("p");
  p.className = "recipe-text";
  p.textContent = text;
  block.append(h, p);
  return block;
}

function buildRecipeRow(r) {
  const li = document.createElement("li");
  li.className = "item-row recipe-row";
  li.dataset.lockKey = `recipe:${r.id}`;
  const open = state.expanded.has(r.id);

  const head = document.createElement("button");
  head.type = "button";
  head.className = "recipe-head";
  head.setAttribute("aria-expanded", open ? "true" : "false");
  const name = document.createElement("span");
  name.className = "recipe-name";
  name.textContent = r.name;
  const caret = document.createElement("span");
  caret.className = "recipe-caret";
  caret.textContent = open ? "▾" : "▸";
  head.append(name, caret);
  head.addEventListener("click", () => {
    if (state.expanded.has(r.id)) state.expanded.delete(r.id); else state.expanded.add(r.id);
    renderRecipeList();
  });
  li.appendChild(head);

  const tags = recipeTags(r);
  const meta = document.createElement("div");
  meta.className = "item-meta-row recipe-meta";
  tags.forEach(t => {
    const badge = document.createElement("span");
    badge.className = "owner-badge";
    badge.textContent = t;
    meta.appendChild(badge);
  });
  const cooked = document.createElement("span");
  cooked.className = "item-time";
  const n = cookCountOf(r);
  cooked.textContent = n ? `煮過 ${n} 次${r.lastCookedAt ? `（上次 ${r.lastCookedAt}）` : ""}` : "還沒煮過";
  meta.appendChild(cooked);
  li.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "item-meta-row recipe-actions";
  actions.appendChild(buildStars(r));
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const cookBtn = document.createElement("button");
  cookBtn.type = "button";
  cookBtn.className = "pay-btn";
  cookBtn.textContent = "煮過 +1";
  cookBtn.addEventListener("click", async () => {
    await withRowLock(cookBtn, async () => {
      try {
        applyRecipes(await api("markRecipeCooked", { id: r.id }));
        releasePending(cookBtn);
        renderRecipesAll();
        showToast("已記一次");
      } catch (err) {
        setStatus("更新失敗：" + err.message, true);
      }
    });
  });
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "ghost-btn";
  editBtn.title = "編輯";
  editBtn.textContent = "✏️";
  editBtn.addEventListener("click", () => openRecipeForm(r));
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "delete-btn";
  delBtn.title = "刪除";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async () => {
    if (!(await showConfirm(`確定要刪除「${r.name}」嗎？`))) return;
    await withRowLock(delBtn, async () => {
      try {
        applyRecipes(await api("deleteRecipe", { id: r.id }));
        releasePending(delBtn);
        state.expanded.delete(r.id);
        renderRecipesAll();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    });
  });
  actions.append(spacer, cookBtn, editBtn, delBtn);
  li.appendChild(actions);

  if (open) {
    const body = document.createElement("div");
    body.className = "recipe-body";
    if (r.ingredients) body.appendChild(buildTextBlock("食材", r.ingredients));
    if (r.steps) body.appendChild(buildTextBlock("步驟", r.steps));
    if (r.notes) body.appendChild(buildTextBlock("備註", r.notes));
    if (!body.children.length) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = "還沒有內容，點 ✏️ 補上食材與步驟";
      body.appendChild(empty);
    }
    li.appendChild(body);
  }

  lockIfPending(li);
  return li;
}

function renderRecipeList() {
  const list = document.getElementById("recipeList");
  const shown = sortRecipes(filterRecipes(state.recipes, state.search, state.tag), state.sort);
  const count = document.getElementById("recipeCount");
  count.textContent = state.recipes.length ? `共 ${shown.length} 道${shown.length !== state.recipes.length ? `（全部 ${state.recipes.length} 道）` : ""}` : "";
  list.innerHTML = "";
  if (!state.recipes.length) {
    list.innerHTML = `<p class="empty-hint">還沒有食譜，按「＋ 新增食譜」開始收藏</p>`;
    return;
  }
  if (!shown.length) {
    list.innerHTML = `<p class="empty-hint">沒有符合的食譜</p>`;
    return;
  }
  shown.forEach(r => list.appendChild(buildRecipeRow(r)));
}

document.getElementById("recipeSearch").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderRecipeList();
});
document.getElementById("recipeTagFilter").addEventListener("change", (e) => {
  state.tag = e.target.value;
  renderRecipeList();
});
document.getElementById("recipeSort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderRecipeList();
});

// ====== 新增／編輯彈窗 ======
const FORM_IDS = { name: "recipeName", tags: "recipeTags", ingredients: "recipeIngredients", steps: "recipeSteps", notes: "recipeNotes" };

function updateRecipeFormValidity() {
  document.getElementById("recipeSubmitBtn").disabled = !document.getElementById("recipeName").value.trim();
}
document.getElementById("recipeName").addEventListener("input", updateRecipeFormValidity);

function fillRecipeForm(r) {
  Object.entries(FORM_IDS).forEach(([key, id]) => {
    let v = r ? r[key] : "";
    if (key === "tags") v = splitTags(v).join(", ");
    document.getElementById(id).value = v === undefined || v === null ? "" : v;
  });
  updateRecipeFormValidity();
}

// r 有值＝編輯那一道，沒有＝新增
function openRecipeForm(r) {
  state.editingId = r ? r.id : null;
  document.getElementById("recipeFormTitle").textContent = r ? "編輯食譜" : "新增食譜";
  document.getElementById("recipeSubmitBtn").textContent = r ? "儲存" : "新增";
  document.getElementById("recipeImportBox").classList.toggle("hidden", !!r);
  document.getElementById("recipeImportText").value = "";
  document.getElementById("recipeImportMsg").textContent = "";
  fillRecipeForm(r || null);
  document.getElementById("recipeFormModal").classList.remove("hidden");
}
function closeRecipeForm() { document.getElementById("recipeFormModal").classList.add("hidden"); }
document.getElementById("openRecipeForm").addEventListener("click", () => openRecipeForm(null));
document.getElementById("recipeFormClose").addEventListener("click", closeRecipeForm);
document.getElementById("recipeFormModal").addEventListener("click", (e) => { if (e.target.id === "recipeFormModal") closeRecipeForm(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("dialogModal").classList.contains("hidden")) closeRecipeForm();
});

// 貼上匯入：把整理好的 JSON 填進表單（不送出，核對後再按「新增」）
document.getElementById("recipeImportBtn").addEventListener("click", () => {
  const msg = document.getElementById("recipeImportMsg");
  const parsed = parseRecipeImport(document.getElementById("recipeImportText").value);
  if (!parsed) { msg.textContent = "格式不對，請整段貼上對話裡給你的資料"; return; }
  // 先清乾淨再填：第二份不能殘留第一份的內容
  fillRecipeForm(null);
  Object.entries(parsed.fields).forEach(([key, v]) => { document.getElementById(FORM_IDS[key]).value = v; });
  updateRecipeFormValidity();
  const notes = [`已填入 ${Object.keys(parsed.fields).length} 個欄位，請核對後按「新增」`];
  if (parsed.unknown.length) notes.push(`有 ${parsed.unknown.length} 個不認得的欄位沒填入：${parsed.unknown.join("、")}`);
  parsed.problems.forEach(t => notes.push("⚠️ " + t));
  if (parsed.fields.name && state.recipes.some(r => r.name === parsed.fields.name)) notes.push("⚠️ 已經有同名的食譜");
  msg.textContent = notes.join("；");
});

document.getElementById("recipeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = {};
  Object.entries(FORM_IDS).forEach(([key, id]) => { params[key] = document.getElementById(id).value; });
  if (!params.name.trim()) return;
  const editing = state.editingId;
  if (editing) params.id = editing;
  setFormBusy(e.target, true);
  try {
    applyRecipes(await api(editing ? "updateRecipe" : "addRecipe", params));
    renderRecipesAll();
    closeRecipeForm();
    showToast(editing ? "已儲存" : "已新增食譜");
  } catch (err) {
    setStatus((editing ? "儲存失敗：" : "新增失敗：") + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updateRecipeFormValidity();
  }
});

// ====== Boot ======
initAuth();
