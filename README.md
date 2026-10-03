# Daily Hub

一頁式每日目標 / 行事曆看板。純靜態前端（GitHub Pages），資料存在 Google Sheet，
用 Google Apps Script 當輕量後端做密碼驗證與讀寫。

## 部署步驟

### 1. 建立 Google Sheet

新增一個 Google Sheet，建立六個分頁：

**Goals**（今日待辦，一次性手動輸入的項目）

| id | date | text | done | createdAt |
|----|------|------|------|-----------|

**Habits**（習慣定義，例如「工作日每天手沖咖啡」）

| id | name | frequency | workdaysOnly | target | createdAt |
|----|------|-----------|--------------|--------|-----------|

- `frequency`：`daily` / `weekly` / `monthly`
- `workdaysOnly`：`TRUE`/`FALSE`，只有 `daily` 會用到（`TRUE` 代表週末跟國定假日
  都不出現，假日清單來自 Google 內建的台灣假期公開行事曆，見 `Code.gs` 的
  `getHolidays_()`；只排除國定假日，不處理個人請假這類臨時例外）
- `target`：目標次數，`daily` 固定是 1；`weekly`/`monthly` 是建立當下設定的固定值，
  之後想改用手動去 Sheet 改這一格
- 不需要的習慣直接在網頁上刪除即可（沒有「停用但保留」的中間狀態）

**HabitLog**（習慣的完成紀錄）

| id | habitId | periodKey | count | createdAt | exercise | synced |
|----|---------|-----------|-------|-----------|----------|--------|

- `exercise`、`synced` 只有「每日運動挑戰」那個習慣（`CHALLENGE_HABIT_ID`）會用到，
  其他習慣留空：`exercise` 是抽到的運動，`synced` 表示完成是否已成功回傳給朋友的
  挑戰站。這個習慣不走一般勾選，改由首頁「每日運動挑戰」卡片的抽卡/完成打卡處理
  （`drawChallenge` / `completeChallenge`）。
- 連線設定放 Apps Script「專案設定 → 指令碼屬性」：`CHALLENGE_URL`（朋友的 web app
  網址）、`CHALLENGE_PLAYER`（玩家名稱）、`CHALLENGE_PIN`（密碼）。不要寫進程式，
  repo 是公開的。沒設 `CHALLENGE_URL` 時抽卡/完成會直接報錯。
- 朋友的 API 約定（POST，body 是 JSON 字串）：
  - `draw`：`{action:"draw", player, pin, date}` → 回傳
    `{"mine":{"date","player","ex","name","amount","done"}}`，我們顯示 `name・amount`
    （例如「伏地挺身（可跪姿）・3 組 × 5 下」）存進 HabitLog 的 `exercise` 欄；同一天
    不可重複呼叫。
  - `done`：`{action:"done", player, pin, date, done:true}`，要能重複送同樣內容不出錯。
  - 失敗一律回 `{error:"訊息"}`（訊息會直接顯示給使用者）。

- `periodKey`：`daily` 是當天日期；`weekly` 是那一週週一的日期；`monthly` 是
  `yyyy-MM`
- `count`：該週期目前完成次數，跟對應 Habit 的 `target` 比較來判斷是否達標；
  網頁上每點一次會 +1，超過 `target` 會歸零（方便點錯復原）

**Events**

| id | date | owner | time | title | notes | createdAt |
|----|------|-------|------|-------|-------|-----------|

`owner` 是 `me` / `wife` / `shared` / 寵物名字（見 `Code.gs` 的 `PET_NAMES`）其中一個，
用來標記這筆是誰的（人的行程或寵物照護紀錄現在是同一張表）。網頁上顯示的名稱、
icon、顏色可以跟這些內部值不一樣（例如 `me` 顯示成「承承」），改 [app.js](app.js)
的 `OWNER_META` 跟 `index.html` 的 `#eventOwner` 下拉選項文字即可，不用動 Sheet 或
`Code.gs`。

**RecurringEvents**（循環行程，固定週期規則，例如「每週三打球」「每月15號幫咪嚕點藥」）

| id | owner | title | time | notes | frequency | dayOfWeek | dayOfMonth | createdAt | endDate |
|----|-------|-------|------|-------|-----------|-----------|------------|-----------|---------|

- `frequency`：`weekly` / `monthly`
- `dayOfWeek`：0-6（0=日、1=一...6=六），只有 `weekly` 用得到
- `dayOfMonth`：1-31，只有 `monthly` 用得到
- `owner`：跟 Events 一樣的值域
- `endDate`：選填，`yyyy-MM-dd`，截止日當天（含）仍會出現、之後不再展開；空白 = 無限期。
  新增時可以不填，之後隨時能在循環行程清單的 📅 按鈕補登、修改或清除
- 只存規則本身，不會預先展開成很多列——前端跟 `sendDailyNotifications` 都是
  即時判斷「今天符不符合」，改規則不用擔心舊資料沒同步；不想要整條規則了就直接
  刪除（網頁上刪除按鈕會先跳確認彈窗），只是某一次不算則用下面的
  RecurringExceptions

**RecurringExceptions**（循環行程的「跳過這一次」紀錄，規則本身不動）

| id | recurringId | date | createdAt |
|----|-------------|------|-----------|

- `recurringId` 對應 RecurringEvents 的 `id`，`date` 是被跳過的那一天
  （yyyy-MM-dd）
- 展開規則判斷「今天符不符合」時，會先排除掉這裡有紀錄的 (recurringId, date)
  組合——目前網頁上只能新增跳過紀錄（當日事件清單上的 ⏭️ 按鈕），沒有「復原」
  的介面，想復原要自己去 Sheet 刪那一列

**BloodPressure**（血壓量測紀錄，獨立頁面 `health.html`）

| id | date | period | systolic | diastolic | pulse | createdAt |
|----|------|--------|----------|-----------|-------|-----------|

- `period`：`morning` / `evening`
- **一列代表一次量測**，不是一天一列——早上量兩次就是兩列，想刪掉某一次直接
  刪那一列，跟 Events 的新增/刪除邏輯一樣
- 這張表**不會**出現在主頁面用的 `getData()` 回傳裡，有自己專屬的
  `getBloodPressureData`/`addBloodPressureReading`/`deleteBloodPressureReading`
  三個 action，確保主頁面的操作速度不受血壓資料量增長影響

**InBody**（體組成紀錄，健康頁「體組成」分頁；設備其實是 Tokuyo 體脂計，Sheet 分頁名稱沿用 InBody）

| id | date | weight | height | bmi | bodyFat | fatMass | skeletalMuscle | muscleMass | bodyWater | protein | bmr | visceralFat | bodyAge | whr | createdAt |
|----|------|--------|--------|-----|---------|---------|----------------|------------|-----------|---------|-----|-------------|---------|-----|-----------|

- 只有 `date`、`weight` 必填，其他可留空；寫入依「表頭名稱」，欄位順序不影響
- 目標體重（90 kg）和實際年齡寫在 `health-body.js` 最上面的 `TARGET_WEIGHT`、`ACTUAL_AGE`
- 分級：BMI 用國健署成人標準；體脂率、腰臀比用男性標準；內臟脂肪 1-9 標準、10-14 偏高、15+ 高；身體年齡跟實際年齡（`health-body.js` 的 `ACTUAL_AGE`）比。體脂計報告裡其他欄位（礦物質、肌肉率、皮下脂肪、四肢分段、健康評分…）刻意不放：不是從體重算出來的衍生值就是日常很少看

**LabResults**（驗血，健康頁「驗血」分頁）

| id | date | glucose | hba1c | cholesterol | ldl | hdl | triglyceride | ast | alt | creatinine | egfr | uricAcid | tsh | ck | bun | createdAt |
|----|------|---------|-------|-------------|-----|-----|--------------|-----|-----|------------|------|----------|-----|----|-----|-----------|

- 除 `date` 外都可留空（每次驗血不一定每項都有）；一列 = 一次抽血
- 參考範圍與分級邏輯寫在 `health-labs.js` 的 `ITEMS`（參考範圍採 Dean 驗血報告上的標示，分級另參考
  ADA、台灣血脂指引、KDIGO 等，依男性）。要加新項目：Sheet 加欄位、`Code.gs` 的 `LAB_FIELDS`
  加 key、`ITEMS` 加一筆
- 這兩張表跟 BloodPressure 一樣不經過主頁面的 `getData()`
- 分級依據（2026-10-03 查證過）：BMI 用國健署成人標準；血糖/HbA1c 用 ADA；總膽固醇/三酸甘油酯/HDL 用台灣血脂指引；
  eGFR 用 KDIGO 分期。**自己推估、非正式指引**的：AST/ALT/肌酸酐/BUN/尿酸/TSH/CK 的「注意/偏高」分界、
  HDL 35 以下的「過低」、腰臀比 1.0 的「過高」、體脂率 10–20/20–25 的細分（國健署只定 25% 以上肥胖）、
  內臟脂肪與身體年齡（廠商算法）、其他項目的 15%/50% 分級。LDL 130 是一般成人目標，高風險族群醫師目標更低

**LabExtra**（驗血「其他項目」：報告上有、`LabResults` 沒列的項目，例如鈉、鉀、血紅素、尿蛋白）

| id | date | name | value | unit | refLow | refHigh | createdAt |
|----|------|------|-------|------|--------|---------|-----------|

- 一個項目一列；同名稱的項目會在畫面上自動接成同一條趨勢線
- `refLow` / `refHigh` 是那份報告上印的參考範圍，可只填一邊或都不填；分級就用這個範圍判斷
  （範圍內 🟢、超出 15% 以內 🟡、超出 50% 以內 🟠、更多 🔴），不需要我們懂每個項目的醫學意義
- 某項目如果發現每次都會驗，可以升級成 `LabResults` 的固定項目（補完整醫學分級）

**CreditCardBills**（信用卡帳單，獨立頁面 `bills.html`）

| id | bank | billingMonth | date | fullAmount | lowestAmount | paidAmount | createdAt |
|----|------|--------------|------|------------|--------------|------------|-----------|

- `bank`：固定幾家銀行（聯邦/國泰/中信/富邦/兆豐/玉山），之後開新卡再加
- `billingMonth`：帳單年月（yyyy-MM），`date` 是繳費截止日
- **先新增（帳單全額/最低應繳/截止日），收到繳費後再回來補 `paidAmount`**——
  帳單紀錄旁邊的 💰 按鈕只改這一個欄位，跟 Events 補登花費金額的按鈕是同一套
  寫法。剩餘未繳（`remain`）不存，前端用 `fullAmount - paidAmount` 即時算
- 這張表也不會出現在主頁面的 `getData()` 回傳裡，理由跟 BloodPressure 一樣
- `apps-script/Code.gs` 裡的 `migrateBloodPressureFromPressure2026()` 是一次性
  搬移函式（把舊的 `pressure2026` 試算表資料搬過來），只需要在 Apps Script
  編輯器手動執行一次，確認資料搬完後可以整段刪除——故意沒加結尾底線，因為
  Apps Script 的「選取要執行的函式」下拉選單會隱藏底線結尾的函式，這支是要
  手動選來執行的，不能被藏起來

**ShoppingList**（「清單」，不綁日期、處理完就勾掉再清除；分購物/想法兩個分類）

| id | item | done | createdAt | category |
|----|------|------|-----------|----------|

`category` 是 `shopping` 或 `idea`，空白視為 `shopping`（舊資料不用補）。

第一列填欄位名稱（跟上面一樣），下面留空即可。

> 這份資料原本是從一個獨立的 pets Google Sheet 搬過來、先放在自己的 Pets 分頁，
> 後來又併回 Events（owner 填寵物名字）。用過的一次性搬移／補值函式都已經跑完並
> 從 `Code.gs` 移除，需要參考的話到 git 歷史紀錄找
> `migrateFromPetsSheet` / `fillBlankEventOwners` / `migratePetsIntoEvents`。

### 2. 設定 Apps Script

1. Sheet 選單「擴充功能 → Apps Script」
2. 把 `apps-script/Code.gs` 的內容整個貼進去（覆蓋預設的 `Code.gs`）
3. 左側「專案設定」→ 「指令碼屬性」（Script Properties）→ 新增這幾筆
   （值都自己記住，不要寫進任何程式碼或 commit 裡）：
   - `PASSWORD` — 網頁前端的密碼
   - `LINE_TOKEN` — LINE Messaging API 的 channel access token
   - `LINE_MY_ID` — 你的 LINE 使用者 ID
   - `LINE_WIFE_ID` — 太太的 LINE 使用者 ID

### 3. 部署成 Web App

1. 右上角「部署」→「新增部署作業」
2. 類型選「網頁應用程式」
3. 執行身分：「我」
4. 具有存取權的使用者：「所有人」
5. 部署後複製那組 `https://script.google.com/macros/s/.../exec` 網址

### 4. 接上前端

把上一步的網址貼到 [app.js](app.js) 最上面的 `WEBAPP_URL`，然後 commit + push。

> 之後每次改 `Code.gs` 存檔，網頁不會自動吃到新版——要到「部署 → 管理部署作業 →
> 編輯（鉛筆圖示）→ 版本選『新版本』→ 部署」，網址不變但會套用最新程式碼。

### 5. 設定每日 LINE 通知的觸發條件

`sendDailyNotifications()` 不會被網頁呼叫，需要另外設定「每天自動跑一次」：

1. Apps Script 編輯器左側**時鐘圖示「觸發條件」**
2. 右下角「新增觸發條件」
3. 選取執行的函式：`sendDailyNotifications`
4. 選取活動來源：「時間驅動」→「日計時器」→ 選一個時段（例如上午 8-9 點）
5. 儲存（第一次也會跳授權視窗，允許即可）

### 6. 啟用 GitHub Pages

Repo 的 Settings → Pages → Source 選 `main` 分支 `/ (root)`，存檔後會得到一個公開網址
（例如 `https://<你的帳號>.github.io/<repo 名稱>/`）。血壓記錄是獨立的
`health.html`（跟 `index.html` 共用 `shared.js`/`style.css`），GitHub Pages 會
自動一起部署，不用額外設定，從主頁面右上角的 ❤️ 連過去即可。

## 快取版本參數

HTML 裡 `style.css` 和各個 `.js` 的網址都帶 `?v=時間戳`，避免改版後瀏覽器/GitHub Pages
還在用舊檔。更新方式：

- 第一次在新電腦上 clone 之後，跑一次 `sh scripts/install-hooks.sh` 安裝 pre-commit
  hook，之後只要 commit 有改到根目錄的 `.js` / `.css`，就會自動更新版本參數並一起 commit。
- 也可以手動跑 `sh scripts/bump-version.sh`。
- 注意：`apps-script/Code.gs` 不在這個機制內，那個要手動貼進 Apps Script 並重新部署。

## 前端開發守則

**所有會呼叫後端（`api(...)`）的操作，等待回應期間一律要鎖住對應的控制項，回來前不能再操作。** 後端（Apps Script）有延遲，沒鎖的話使用者會連點，造成重複請求、畫面與資料不一致（例如勾選框已翻轉但刪除線還沒更新、取消勾選又被當成新增）。

- 表單送出：用 `setFormBusy(form, true/false)`，會鎖住表單內所有輸入框、下拉、按鈕。記得先讀完欄位值再鎖，`finally` 裡解鎖。
- 列表項目的操作（勾選、刪除、改金額、跳過…）：用 `withRowLock(el, async () => {...})` 包住 `api` 呼叫，會鎖住那一列所有控制項並加上 `.pending` 樣式。需要確認/輸入的對話框（`showConfirm`/`showPrompt`）放在鎖之前。
- 勾選框要樂觀更新（先同步 `done` 樣式），失敗時還原 `checked` 與樣式。
- 之後新增任何欄位或按鈕，只要會送後端，都照這個規則做。

## 密碼保護的原理

前端不會做假的驗證邏輯（那種在瀏覽器看原始碼就能繞過）。所有讀寫都要帶密碼呼叫
Apps Script，密碼比對在 Apps Script 這一端做，沒有正確密碼就完全拿不到資料。
Repo 本身建議設為 Private，這樣專案不會出現在你的 GitHub 個人頁面或被搜尋到，
但 GitHub Pages 產生的網址本身還是任何人拿到連結都能打開，密碼是實際擋人的那一關。

## 未來可以加的東西

需要先做決定才能動工的：

- 食譜功能——先決定要不要繼續往同一個 app 塞功能，還是另開（可以先把點子丟進「清單」的想法分頁累積）
- 新增的行事曆項目同步到 Google Calendar——要先定：單向還是雙向、要不要抓公司行事曆、要不要寫進太太的帳號

可以直接做的：

- 每週/每月習慣的連續統計（連續幾週/幾個月達標、歷史最長），目前只有每日習慣有 🔥
- 靜態檔案快取問題：shared.js / app.js 等改版後瀏覽器可能還在用舊版，可以在 HTML 的 script/css 網址加版本參數（例如 `?v=日期`）
