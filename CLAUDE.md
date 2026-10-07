# cheng-daily（承日常）

個人生活小助手：待辦、習慣、行事曆、健康、帳單、練字。純靜態 HTML/JS（GitHub Pages）+ 單一 Google Apps Script 後端（`apps-script/Code.gs`）+ Google Sheet。完整慣例、部署步驟與回歸檢查見 README.md，改程式前先看一下，這裡只列最容易踩的：

- 每頁先定義 `window.loadPageData` 再呼叫 `initAuth()`；API 一律 POST，不用 GET 寫入。
- 送出期間鎖控制項：表單用 `setFormBusy`，列表項目用 `withRowLock`。
- 改了 js/css，commit 前要更新 HTML 的 `?v=`（pre-commit hook 會做；hook 不跟著 repo，新環境先跑 `sh scripts/install-hooks.sh`）。
- 改了 `Code.gs`：要手動貼進 Apps Script 重新部署新版本，並同步 `BACKEND_VERSION` 與 `shared.js` 的 `BACKEND_MIN_VERSION`。
- 純邏輯有回歸檢查：`node scripts/regression-check.js`。
- 本機預覽：`python3 -m http.server 8791`（`.claude/launch.json`）。

## 新增 Google Sheet 分頁的規則（已有 ensureSheet）
- 新功能需要「全新的分頁」時，用 `ensureSheet(名稱, 表頭陣列)`（`apps-script/Code.gs`，在 `getSheet` 旁邊）：找不到分頁就自己建立、寫入表頭、凍結第一列，已存在的分頁完全不動。這樣不用請 Dean 手動建分頁與表頭（cheng-lingo 的 `sheet_` 是同樣做法）。
- 既有的分頁（Events、Habits、HabitLog、InBody、LabResults…）仍然用 `getSheet`：缺分頁或缺欄位就丟錯，不要悄悄用欄位對不上的表寫入，避免資料寫錯位置。不要把既有分頁改成自動建立或自動補欄位。
- 用 `ensureSheet` 建的分頁，要把「分頁名稱＋欄位」寫進 `Code.gs` 開頭的分頁清單註解；分頁名稱與欄位是程式寫死的，不能改名或調整順序。
- 寫入純文字（日期、數字、使用者輸入）時照既有慣例處理（`setNumberFormat("@")`、使用者輸入過 `safeText_` 類的處理），避免 Sheet 自動轉型或把 `= + - @` 開頭當公式。

## 與 cheng-lingo 的關係
姊妹專案在 `../cheng-lingo`（英日語練習，獨立 Sheet / Apps Script，網址 https://javle0317.github.io/cheng-lingo/）。
- 語言練習：**不聯動**。練習在 lingo 做（自己抽卡、自己看進度），daily 的語言練習習慣就是一般的手動打卡習慣（`LANG_HABIT_ID` 那一列只多一個「語」連結連到 lingo）。想分成英文、日文各一個習慣，直接在 Sheet 的 Habits 分頁加列即可（不需要改程式）。之前的抽卡／同步（`drawLanguageCard`、`syncLanguageCard`、`LANG_URL` / `LANG_TOKEN`）已經拿掉。
- 字帖已搬到 lingo（`copybook.html`）；首頁「練字」習慣的「字」連結連過去（語言在字帖頁內切換）。Sheet 的 `Copybook` 分頁已沒用，可刪。
- 食譜留在這個專案（`recipes.html/js` + Sheet 分頁），尚未開始。
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
