// ====== 食譜頁：想吃的店 ======
// 共用：shared.js（api、showConfirm…）、recipes.js（splitTags、state.tab）。Sheet 分頁 Places 由後端 ensureSheet 自動建立。
// 只有店名必填；地區是三層（國家 → 縣市／城市 → 區域），選項只列實際記過的，之後出國也不用改程式。

const pl = {
  places: [],
  search: "",
  status: "want",
  country: "all",
  city: "all",
  area: "all",
  tag: "all",
  editingId: null,
  visitId: null,
  pickPool: [],
  pickLast: null,
};

const TW_CITIES = ["台北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "台中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "台南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "台東縣", "澎湖縣", "金門縣", "連江縣"];
const COUNTRY_SUGGEST = ["台灣", "日本", "韓國", "泰國", "新加坡", "香港", "越南", "美國"];

function applyPlaces(res) {
  pl.places = (res && res.places) || [];
}

async function loadPlaces() {
  applyPlaces(await api("getPlaces"));
  renderPlacesAll();
}

// ====== 純邏輯（regression-check 會測）======
function placeTags(p) {
  return splitTags(p.tags);
}

// Google 地圖店家連結：只用使用者（或整理好的匯入資料）給的確切連結；沒有就回傳空字串（不顯示地圖鈕，不自動組搜尋連結）
function placeMapUrl(p) {
  return /^https?:\/\/\S+$/i.test(String(p.mapUrl || "")) ? String(p.mapUrl) : "";
}

// 連動的地區選項：國家 → 該國家有的縣市 → 該縣市有的區域（只列有資料的）
function regionOptions(places, sel) {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-Hant"));
  const countries = uniq(places.map(p => p.country));
  const inCountry = places.filter(p => sel.country === "all" || p.country === sel.country);
  const cities = uniq(inCountry.map(p => p.city));
  const inCity = inCountry.filter(p => sel.city === "all" || p.city === sel.city);
  const areas = uniq(inCity.map(p => p.area));
  return { countries, cities, areas };
}

function filterPlaces(places, f) {
  const q = String(f.search || "").trim().toLowerCase();
  return places.filter(p => {
    if (f.status !== "all" && (p.status || "want") !== f.status) return false;
    if (f.country !== "all" && p.country !== f.country) return false;
    if (f.city !== "all" && p.city !== f.city) return false;
    if (f.area !== "all" && p.area !== f.area) return false;
    if (f.tag !== "all" && !placeTags(p).includes(f.tag)) return false;
    if (!q) return true;
    return [p.name, p.dishes, p.note, p.tags, p.area, p.city, p.country].some(x => String(x || "").toLowerCase().includes(q));
  });
}

// 最近新增在前（Sheet 由上往下是舊到新）
function sortPlaces(places) {
  return places.map((p, i) => ({ p, i })).sort((a, b) => b.i - a.i).map(x => x.p);
}

// 從清單裡隨機挑一個（avoid：盡量不要連續抽到同一家；rnd 可注入，測試用）
function pickRandomPlace(list, avoidId, rnd) {
  if (!list.length) return null;
  const pool = list.length > 1 ? list.filter(p => p.id !== avoidId) : list;
  return pool[Math.floor((rnd || Math.random)() * pool.length)];
}

// 批次匯入：{ items: [{ name, country, city, area, tags, dishes, mapUrl, source, note }], overwrite? }
function parsePlacesImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  const arr = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
  if (!arr) return null;
  const problems = [];
  const items = [];
  const seen = new Set();
  const KEYS = ["name", "country", "city", "area", "tags", "dishes", "mapUrl", "source", "note"];
  arr.forEach((it, i) => {
    const tag = `第 ${i + 1} 筆`;
    const name = String((it && it.name) || "").trim();
    if (!name) { problems.push(`${tag}：沒有店名`); return; }
    const out = { name };
    let bad = false;
    KEYS.slice(1).forEach(k => {
      let v = it[k];
      if (v === undefined || v === null || v === "") return;
      if (k === "tags") v = Array.isArray(v) ? v.map(String).join(", ") : String(v);
      else v = String(v).trim();
      if ((k === "mapUrl" || k === "source") && !/^https?:\/\/\S+$/i.test(v)) { problems.push(`${tag}（${name}）：${k === "mapUrl" ? "地圖連結" : "來源連結"}要是 http(s):// 開頭的網址`); bad = true; return; }
      out[k] = v;
    });
    if (bad) return; // 這一筆有問題就不收（整批也不會匯入）
    const key = `${name.toLowerCase().replace(/\s+/g, "")}|${out.city || ""}`;
    if (seen.has(key)) { problems.push(`${tag}：「${name}」重複了`); return; }
    seen.add(key);
    items.push(out);
  });
  return { items, problems, overwrite: !!(data && data.overwrite === true) };
}

// ====== 渲染 ======
function renderPlacesAll() {
  renderPlaceFilters();
  renderPlaceOptions();
  renderPlaceList();
  updatePlaceFormValidity();
}

function fillSelect(sel, firstLabel, values, current) {
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = firstLabel;
  sel.appendChild(all);
  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
  sel.value = values.includes(current) ? current : "all";
  return sel.value;
}

function renderPlaceFilters() {
  // 選到的選項已經沒有資料（例如刪光了）就退回「全部」；國家只有一個時不顯示國家那層
  let opt = regionOptions(pl.places, { country: pl.country, city: pl.city });
  pl.country = fillSelect(document.getElementById("placeCountry"), "全部國家", opt.countries, pl.country);
  opt = regionOptions(pl.places, { country: pl.country, city: pl.city });
  pl.city = fillSelect(document.getElementById("placeCity"), "全部縣市", opt.cities, pl.city);
  opt = regionOptions(pl.places, { country: pl.country, city: pl.city });
  pl.area = fillSelect(document.getElementById("placeArea"), "全部區域", opt.areas, pl.area);
  const tags = [...new Set(pl.places.flatMap(placeTags))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  pl.tag = fillSelect(document.getElementById("placeTag"), "全部標籤", tags, pl.tag);
  const all = regionOptions(pl.places, { country: "all", city: "all" });
  document.getElementById("placeCountry").classList.toggle("hidden", all.countries.length < 2);
  document.getElementById("placeCity").classList.toggle("hidden", !opt.cities.length && pl.city === "all");
  document.getElementById("placeArea").classList.toggle("hidden", !opt.areas.length && pl.area === "all");
  document.getElementById("placeTag").classList.toggle("hidden", !tags.length);
  document.getElementById("placeStatus").value = pl.status;
}

// 新增表單的建議清單：國家、縣市（台灣固定列出全部縣市，其他國家用你記過的）、區域、標籤
function renderPlaceOptions() {
  const fill = (id, values) => { const dl = document.getElementById(id); dl.innerHTML = ""; values.forEach(v => { const o = document.createElement("option"); o.value = v; dl.appendChild(o); }); };
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  fill("placeCountryOptions", uniq([...COUNTRY_SUGGEST, ...pl.places.map(p => p.country)]));
  fill("placeCityOptions", uniq([...pl.places.map(p => p.city), ...TW_CITIES]));
  fill("placeAreaOptions", uniq(pl.places.map(p => p.area)));
  fill("placeTagOptions", uniq(pl.places.flatMap(placeTags)));
}

function buildPlaceRow(p) {
  const li = document.createElement("li");
  li.className = "item-row recipe-row place-row";
  li.dataset.lockKey = `place:${p.id}`;
  const visited = p.status === "visited";

  const head = document.createElement("div");
  head.className = "place-head";
  const name = document.createElement("span");
  name.className = "recipe-name";
  name.textContent = p.name;
  head.appendChild(name);
  if (visited) {
    const stars = document.createElement("span");
    stars.className = "place-stars";
    stars.textContent = Number(p.rating) > 0 ? "★".repeat(Number(p.rating)) + "☆".repeat(5 - Number(p.rating)) : "✅ 去過";
    head.appendChild(stars);
  }
  li.appendChild(head);

  const meta = document.createElement("div");
  meta.className = "item-meta-row recipe-meta";
  const region = [p.country, p.city, p.area].filter(Boolean).join(" · ");
  if (region) {
    const r = document.createElement("span");
    r.className = "item-time";
    r.textContent = "📍 " + region;
    meta.appendChild(r);
  }
  placeTags(p).forEach(t => {
    const b = document.createElement("span");
    b.className = "owner-badge";
    b.textContent = t;
    meta.appendChild(b);
  });
  li.appendChild(meta);

  const lines = [];
  if (p.dishes) lines.push(["🍽", p.dishes]);
  if (p.note) lines.push(["📝", p.note]);
  if (visited && p.visitedAt) lines.push(["✅", `${String(p.visitedAt).replace(/-/g, "/")} 去過${p.review ? "：" + p.review : ""}`]);
  lines.forEach(([icon, text]) => {
    const d = document.createElement("div");
    d.className = "place-line";
    d.textContent = `${icon} ${text}`;
    li.appendChild(d);
  });

  const actions = document.createElement("div");
  actions.className = "item-meta-row recipe-actions";
  if (placeMapUrl(p)) {
    const map = document.createElement("a");
    map.className = "pay-btn";
    map.href = placeMapUrl(p);
    map.target = "_blank";
    map.rel = "noopener noreferrer";
    map.textContent = "📍 地圖";
    actions.appendChild(map);
  }
  if (/^https?:\/\//i.test(String(p.source || ""))) {
    const src = document.createElement("a");
    src.className = "pay-btn";
    src.href = p.source;
    src.target = "_blank";
    src.rel = "noopener noreferrer";
    src.textContent = "🔗 來源";
    actions.appendChild(src);
  }
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  actions.appendChild(spacer);
  const visitBtn = document.createElement("button");
  visitBtn.type = "button";
  visitBtn.className = "pay-btn";
  visitBtn.textContent = visited ? "修改" : "去過了";
  visitBtn.addEventListener("click", () => openVisit(p));
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "ghost-btn";
  editBtn.title = "編輯";
  editBtn.textContent = "✏️";
  editBtn.addEventListener("click", () => openPlaceForm(p));
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "delete-btn";
  delBtn.title = "刪除";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async () => {
    if (!(await showConfirm(`確定要刪除「${p.name}」嗎？`))) return;
    await withRowLock(delBtn, async () => {
      try {
        applyPlaces(await api("deletePlace", { id: p.id }));
        releasePending(delBtn);
        renderPlacesAll();
      } catch (err) {
        setStatus("刪除失敗：" + err.message, true);
      }
    });
  });
  actions.append(visitBtn, editBtn, delBtn);
  li.appendChild(actions);
  lockIfPending(li);
  return li;
}

function currentPlaceList() {
  return sortPlaces(filterPlaces(pl.places, pl));
}

function renderPlaceList() {
  const list = document.getElementById("placeList");
  const shown = currentPlaceList();
  document.getElementById("placeCount").textContent = pl.places.length ? `共 ${shown.length} 家${shown.length !== pl.places.length ? `（全部 ${pl.places.length} 家）` : ""}` : "";
  list.innerHTML = "";
  if (!pl.places.length) {
    list.innerHTML = `<p class="empty-hint">還沒有店家，按「＋ 新增店家」，只要打店名就好</p>`;
    return;
  }
  if (!shown.length) {
    list.innerHTML = `<p class="empty-hint">沒有符合的店家</p>`;
    return;
  }
  shown.forEach(p => list.appendChild(buildPlaceRow(p)));
}

document.getElementById("placeSearch").addEventListener("input", (e) => { pl.search = e.target.value; renderPlaceList(); });
document.getElementById("placeStatus").addEventListener("change", (e) => { pl.status = e.target.value; renderPlaceList(); });
document.getElementById("placeCountry").addEventListener("change", (e) => { pl.country = e.target.value; pl.city = "all"; pl.area = "all"; renderPlaceFilters(); renderPlaceList(); });
document.getElementById("placeCity").addEventListener("change", (e) => { pl.city = e.target.value; pl.area = "all"; renderPlaceFilters(); renderPlaceList(); });
document.getElementById("placeArea").addEventListener("change", (e) => { pl.area = e.target.value; renderPlaceList(); });
document.getElementById("placeTag").addEventListener("change", (e) => { pl.tag = e.target.value; renderPlaceList(); });

// ====== 新增／編輯 ======
const PLACE_FIELDS = { name: "placeName", country: "placeCountryInput", city: "placeCityInput", area: "placeAreaInput", tags: "placeTags", dishes: "placeDishes", source: "placeSource", mapUrl: "placeMapUrl", note: "placeNote" };

// 底下的「新增」鈕：填了店名，或貼了批次匯入的資料，就可以按（貼了匯入資料時按它＝執行匯入）
function updatePlaceFormValidity() {
  const hasImport = !document.getElementById("placeImportBox").classList.contains("hidden") && document.getElementById("placeImportText").value.trim() !== "";
  document.getElementById("placeSubmit").disabled = !(document.getElementById("placeName").value.trim() || hasImport);
}
document.getElementById("placeName").addEventListener("input", updatePlaceFormValidity);
document.getElementById("placeImportText").addEventListener("input", updatePlaceFormValidity);

function openPlaceForm(p) {
  pl.editingId = p ? p.id : null;
  document.getElementById("placeFormTitle").textContent = p ? "編輯店家" : "新增店家";
  document.getElementById("placeSubmit").textContent = p ? "儲存" : "新增";
  Object.entries(PLACE_FIELDS).forEach(([key, id]) => {
    let v = p ? p[key] : "";
    if (key === "tags") v = splitTags(v).join(", ");
    if (!p && key === "country") v = "台灣"; // 新增時預設台灣（出國再改）
    document.getElementById(id).value = v === undefined || v === null ? "" : v;
  });
  document.getElementById("placeMore").open = !!p; // 編輯時展開；新增時預設收起，只填店名就能存
  document.getElementById("placeImportBox").classList.toggle("hidden", !!p);
  document.getElementById("placeImportText").value = "";
  document.getElementById("placeImportMsg").textContent = "";
  document.getElementById("placeImportBox").open = false;
  updatePlaceFormValidity();
  document.getElementById("placeFormModal").classList.remove("hidden");
  if (!p) setTimeout(() => document.getElementById("placeName").focus(), 0);
}
function closePlaceForm() { document.getElementById("placeFormModal").classList.add("hidden"); }
document.getElementById("openPlaceForm").addEventListener("click", () => openPlaceForm(null));
document.getElementById("placeFormClose").addEventListener("click", closePlaceForm);
document.getElementById("placeFormModal").addEventListener("click", (e) => { if (e.target.id === "placeFormModal") closePlaceForm(); });

document.getElementById("placeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = {};
  Object.entries(PLACE_FIELDS).forEach(([key, id]) => { params[key] = document.getElementById(id).value; });
  if (!params.name.trim()) {
    // 沒填店名但貼了批次匯入資料：按「新增」就是執行匯入（不然看起來按了沒反應）
    if (document.getElementById("placeImportText").value.trim() !== "") document.getElementById("placeImportBtn").click();
    return;
  }
  const editing = pl.editingId;
  if (editing) params.id = editing;
  setFormBusy(e.target, true);
  try {
    applyPlaces(await api(editing ? "updatePlace" : "addPlace", params));
    if (!editing) { pl.status = "want"; } // 新增的是「想去」，確保看得到
    renderPlacesAll();
    closePlaceForm();
    showToast(editing ? "已儲存" : "已新增");
  } catch (err) {
    setStatus((editing ? "儲存失敗：" : "新增失敗：") + err.message, true);
  } finally {
    setFormBusy(e.target, false);
    updatePlaceFormValidity();
  }
});

// 批次匯入：檢查通過、確認筆數後一次送出（全部成功或全部不寫）
document.getElementById("placeImportBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget; // 要在第一個 await 之前取：await 之後 currentTarget 會是 null
  const msg = document.getElementById("placeImportMsg");
  const parsed = parsePlacesImport(document.getElementById("placeImportText").value);
  if (!parsed) { msg.textContent = "格式不對，請整段貼上對話裡給你的資料（要有 items 陣列）"; return; }
  if (parsed.problems.length) { msg.textContent = "⚠️ 有問題，整批沒有匯入：" + parsed.problems.slice(0, 5).join("；") + (parsed.problems.length > 5 ? `…（共 ${parsed.problems.length} 處）` : ""); return; }
  if (!parsed.items.length) { msg.textContent = "沒有可以匯入的店家"; return; }
  const overwrite = document.getElementById("placeImportOverwrite").checked || parsed.overwrite;
  const existing = parsed.items.filter(i => pl.places.some(p => p.name.trim().toLowerCase().replace(/\s+/g, "") === i.name.toLowerCase().replace(/\s+/g, "") && (!i.city || !p.city || p.city === i.city))).length;
  const summary = `${parsed.items.length} 家（${parsed.items.length - existing} 家新增，${existing} 家是已有的店${existing ? (overwrite ? "，會覆蓋有填的欄位" : "，只補空白欄位") : ""}）`;
  if (!(await showConfirm(`確定匯入 ${summary}？`))) return;
  const form = document.getElementById("placeForm");
  setFormBusy(form, true); // 跟一般新增一樣：整張表單鎖住、送出鈕變「處理中…」
  try {
    const res = await api("importPlaces", { items: JSON.stringify(parsed.items), overwrite: overwrite ? "true" : "false" }); // api() 會把參數轉成字串，陣列要先轉成 JSON
    applyPlaces(res);
    renderPlacesAll();
    closePlaceForm();
    showToast(`已匯入：新增 ${res.created} 家、補充 ${res.updated} 家`);
  } catch (err) {
    msg.textContent = "匯入失敗：" + err.message;
  } finally {
    setFormBusy(form, false);
    updatePlaceFormValidity();
  }
});

// ====== 去過了 ======
function openVisit(p) {
  pl.visitId = p.id;
  document.getElementById("placeVisitName").textContent = p.name;
  document.getElementById("placeVisitDate").value = p.status === "visited" && p.visitedAt ? String(p.visitedAt) : toDateStr(new Date());
  document.getElementById("placeVisitRating").value = String(Number(p.rating) || 0);
  document.getElementById("placeVisitReview").value = p.review || "";
  document.getElementById("placeVisitHint").textContent = "";
  document.getElementById("placeVisitUndo").classList.toggle("hidden", p.status !== "visited");
  document.getElementById("placeVisitModal").classList.remove("hidden");
}
function closeVisit() { document.getElementById("placeVisitModal").classList.add("hidden"); }
document.getElementById("placeVisitClose").addEventListener("click", closeVisit);
document.getElementById("placeVisitModal").addEventListener("click", (e) => { if (e.target.id === "placeVisitModal") closeVisit(); });

async function saveVisit(status, form) {
  const hint = document.getElementById("placeVisitHint");
  if (form) setFormBusy(form, true);
  try {
    applyPlaces(await api("setPlaceVisit", {
      id: pl.visitId, status,
      rating: document.getElementById("placeVisitRating").value,
      visitedAt: document.getElementById("placeVisitDate").value,
      review: document.getElementById("placeVisitReview").value,
    }));
    renderPlacesAll();
    closeVisit();
    showToast(status === "visited" ? "已記為去過" : "已改回想去");
  } catch (err) {
    hint.textContent = "儲存失敗：" + err.message;
  } finally {
    if (form) setFormBusy(form, false);
  }
}
document.getElementById("placeVisitForm").addEventListener("submit", (e) => { e.preventDefault(); saveVisit("visited", e.target); });
document.getElementById("placeVisitUndo").addEventListener("click", () => saveVisit("want", null));

// ====== 今天吃什麼：在目前篩選出來的「想去」裡隨機挑一家 ======
function drawPlace() {
  const pool = filterPlaces(pl.places, Object.assign({}, pl, { status: "want" }));
  const body = document.getElementById("placePickBody");
  const info = document.getElementById("placePickInfo");
  body.innerHTML = "";
  if (!pool.length) {
    body.innerHTML = `<p class="empty-hint">目前的篩選條件下沒有「想去」的店，換個地區或標籤試試</p>`;
    info.textContent = "";
    document.getElementById("placePickAgain").disabled = true;
    return;
  }
  document.getElementById("placePickAgain").disabled = pool.length < 2;
  const p = pickRandomPlace(pool, pl.pickLast);
  pl.pickLast = p.id;
  const name = document.createElement("div");
  name.className = "recipe-name place-pick-name";
  name.textContent = p.name;
  body.appendChild(name);
  const region = [p.country, p.city, p.area].filter(Boolean).join(" · ");
  [region && ["📍", region], p.dishes && ["🍽", p.dishes], p.note && ["📝", p.note]].filter(Boolean).forEach(([i, t]) => {
    const d = document.createElement("div");
    d.className = "place-line";
    d.textContent = `${i} ${t}`;
    body.appendChild(d);
  });
  if (placeMapUrl(p)) {
    const map = document.createElement("a");
    map.className = "pay-btn";
    map.href = placeMapUrl(p);
    map.target = "_blank";
    map.rel = "noopener noreferrer";
    map.textContent = "📍 開地圖";
    body.appendChild(map);
  }
  info.textContent = `從 ${pool.length} 家裡抽的`;
}
document.getElementById("placePickBtn").addEventListener("click", () => { pl.pickLast = null; drawPlace(); document.getElementById("placePickModal").classList.remove("hidden"); });
document.getElementById("placePickAgain").addEventListener("click", drawPlace);
document.getElementById("placePickClose").addEventListener("click", () => document.getElementById("placePickModal").classList.add("hidden"));
document.getElementById("placePickModal").addEventListener("click", (e) => { if (e.target.id === "placePickModal") e.currentTarget.classList.add("hidden"); });
