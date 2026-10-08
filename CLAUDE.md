# cheng-daily（承日常）

個人生活小助手：待辦、習慣、行事曆、健康、帳單、練字。純靜態 HTML/JS（GitHub Pages）+ 單一 Google Apps Script 後端（`apps-script/Code.gs`）+ Google Sheet。完整慣例、部署步驟與回歸檢查見 README.md，改程式前先看一下，這裡只列最容易踩的：

- 每頁先定義 `window.loadPageData` 再呼叫 `initAuth()`；API 一律 POST，不用 GET 寫入。
- 送出期間鎖控制項：表單用 `setFormBusy`，列表項目用 `withRowLock`。
- 改了 js/css，commit 前要更新 HTML 的 `?v=`（pre-commit hook 會做；hook 不跟著 repo，新環境先跑 `sh scripts/install-hooks.sh`）。
- 改了 `Code.gs`：要手動貼進 Apps Script 重新部署新版本，並同步 `BACKEND_VERSION` 與 `shared.js` 的 `BACKEND_MIN_VERSION`。
- 純邏輯有回歸檢查：`node scripts/regression-check.js`。
- 本機預覽：`python3 -m http.server 8791`（`.claude/launch.json`）。
- 做完一項改動：**直接 commit 並 push 到 main**，不用再問（Dean 直接在線上檢查）。commit 前先跑 `node scripts/regression-check.js`。
- 文件跟著程式走：改了行為、版面、欄位、慣例，同一個 commit 內一併更新 README.md（對應段落）與本檔相關條目，避免文件飄移；純內部重構不用。

## 新增 Google Sheet 分頁的規則（已有 ensureSheet）
- 新功能需要「全新的分頁」時，用 `ensureSheet(名稱, 表頭陣列)`（`apps-script/Code.gs`，在 `getSheet` 旁邊）：找不到分頁就自己建立、寫入表頭、凍結第一列，已存在的分頁完全不動。這樣不用請 Dean 手動建分頁與表頭（cheng-lingo 的 `sheet_` 是同樣做法）。
- 既有的分頁（Events、Habits、HabitLog、InBody、LabResults…）仍然用 `getSheet`：缺分頁或缺欄位就丟錯，不要悄悄用欄位對不上的表寫入，避免資料寫錯位置。不要把既有分頁改成自動建立或自動補欄位。
- 用 `ensureSheet` 建的分頁，要把「分頁名稱＋欄位」寫進 `Code.gs` 開頭的分頁清單註解；分頁名稱與欄位是程式寫死的，不能改名或調整順序。
- 寫入純文字（日期、數字、使用者輸入）時照既有慣例處理（`setNumberFormat("@")`、使用者輸入過 `safeText_` 類的處理），避免 Sheet 自動轉型或把 `= + - @` 開頭當公式。

## 有特殊行為的習慣（id 寫死在程式裡，要跟 Sheet 的 Habits 那一列一致）
- `CHALLENGE_HABIT_ID`：每日運動挑戰，抽卡／完成回傳朋友的挑戰站，不能直接勾選（`Code.gs` 與 `app.js` 兩邊都有）。
- `PRACTICE_HABIT_ID`：練字，列上多「字」連結到 lingo 字帖頁（只在 `app.js`）。
- `LANG_HABIT_ID`：語言練習，列上多「語」連結到 lingo，打卡是手動的（只在 `app.js`）。
- `BODY_HABIT_ID`：週活動，登記「新的一天」的體組成會自動打卡，同天補填不重複計次（只在 `Code.gs`，`addInBodyReading`）。

## 與 cheng-lingo 的關係
姊妹專案在 `../cheng-lingo`（英日語練習，獨立 Sheet / Apps Script，網址 https://javle0317.github.io/cheng-lingo/）。
- 語言練習：**不聯動**。練習在 lingo 做（自己抽卡、自己看進度），daily 的語言練習習慣就是一般的手動打卡習慣（`LANG_HABIT_ID` 那一列只多一個「語」連結連到 lingo）。想分成英文、日文各一個習慣，直接在 Sheet 的 Habits 分頁加列即可（不需要改程式）。之前的抽卡／同步（`drawLanguageCard`、`syncLanguageCard`、`LANG_URL` / `LANG_TOKEN`）已經拿掉。
- 字帖已搬到 lingo（`copybook.html`）；首頁「練字」習慣的「字」連結連過去（語言在字帖頁內切換）。Sheet 的 `Copybook` 分頁已沒用，可刪。
- 食譜留在這個專案（`recipes.html/js` + Sheet 分頁 `Recipes`），已完成；內容用「貼上匯入」（格式見下）。
- 完整計畫：`~/.claude/plans/sideproject-cheng-daily-github-dazzling-catmull.md`。

## 健康頁「貼上匯入」格式（使用者傳體脂計／驗血報告截圖時，照這個產出 JSON 給他貼）
匯入只會把數值填進表單，使用者核對後按「新增」才送出；日期要 `yyyy-MM-dd`，數值給純數字（不要單位、不要千分位以外的符號），報告沒有的欄位直接省略。未知鍵名會被忽略並提示。只輸出一個 JSON 區塊，不要加註解。

體組成（`health-body.js` 的 `FIELD_MAP`）：
```json
{ "date": "2026-10-07", "values": { "weight": 113.3, "height": 175, "bodyFat": 39.0, "fatMass": 44.2, "skeletalMuscle": 35.1, "muscleMass": 66.0, "bodyWater": 45.0, "protein": 14.2, "bmr": 1900, "visceralFat": 18, "bodyAge": 50, "whr": 0.98 } }
```
`weight` 必填；身高沒給會沿用上次的。

驗血（`health-labs.js` 的 `ITEMS`）：
```json
{ "date": "2026-10-07", "values": { "glucose": 98, "hba1c": 5.6 }, "extra": [{ "name": "項目名稱", "value": 12.3, "unit": "mg/dL", "refLow": 5, "refHigh": 20 }] }
```
`values` 可用的鍵：`glucose` 空腹血糖、`hba1c`、`cholesterol` 總膽固醇、`ldl`、`hdl`、`triglyceride`、`ast`、`alt`、`creatinine`、`egfr`、`bun`、`uricAcid`、`sodium`、`potassium`、`tsh`、`ck`。不在這份清單的項目放進 `extra`（`name` 不能重複，`unit`、`refLow`、`refHigh` 可省略）。
單位換算要先做好再給（例如血糖用 mg/dL，不要給 mmol/L）。

## 食譜頁「貼上匯入」格式（使用者傳食譜網頁／截圖／文字時，照這個產出 JSON 給他貼）
匯入只會把內容填進表單，使用者核對後按「新增」才送出。只輸出一個 JSON 區塊，不要加註解；沒有的欄位直接省略，未知鍵名會被忽略並提示。評分與煮過次數不在匯入範圍（在 App 裡記）。
```json
{ "name": "滷肉飯", "tags": ["主菜", "台式"], "ingredients": ["五花肉 600g", "醬油 80ml"], "steps": ["五花肉切丁炒香", "加醬油與水滷 40 分鐘"], "notes": "可加滷蛋" }
```
- `name` 必填（≤100 字）；`tags` 陣列（或逗號分隔字串），每個 ≤20 字、最多 10 個，優先沿用已有的標籤（例如主菜、湯、點心、早餐、低醣）。
- `ingredients`、`steps` 用字串陣列（一項一元素）；食材帶份量與單位（`雞胸肉 300g`），步驟不要自己加編號。
- 單位、份量照原文，不要擅自換算；來源不明或沒寫的就省略，不要編造。
