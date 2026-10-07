# Daily Hub

一頁式每日目標 / 行事曆看板。純靜態前端（GitHub Pages），資料存在 Google Sheet，
用 Google Apps Script 當輕量後端做密碼驗證與讀寫。

## 部署步驟

### 1. 建立 Google Sheet

新增一個 Google Sheet，依下面的清單建立所有分頁（共 13 個：Goals、Habits、HabitLog、Events、RecurringEvents、RecurringExceptions、BloodPressure、InBody、LabResults、LabExtra、CreditCardBills、ShoppingList，加上你自己用的其他分頁不影響）。每個分頁第一列貼上表頭（直接複製下面表格的欄位名稱，漏一欄會在寫入時報「缺少欄位」）：

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
- `target`：目標次數，`daily` 固定是 1；`weekly`/`monthly` 是建立當下設定的固定值（週最多 5、月不超過 10 較合理，
  圓點最多畫 10 個）。編輯習慣可以改 target，過去期別會用新 target 重新判斷達標
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

| id | date | owner | time | title | notes | createdAt | amount | hideFromCalendar | endTime |
|----|------|-------|------|-------|-------|-----------|--------|------------------|---------|

- `amount`：選填的花費金額（任何 owner 的事件都可以填，花費統計用）
- `endTime`：選填，`HH:mm`，結束時間（要有 `time`、同一天內晚於 `time`，不處理跨日）；不填，同步到 Google 時用預設 1 小時
- `hideFromCalendar`：`TRUE` 代表這筆只是記帳（例如買貓砂），不出現在行事曆與每日 LINE 提醒；預設 `FALSE`

`owner` 是 `me` / `wife` / `shared` / 寵物名字（見 `Code.gs` 的 `PET_NAMES`）其中一個，
用來標記這筆是誰的（人的行程或寵物照護紀錄現在是同一張表）。網頁上顯示的名稱、
icon、顏色可以跟這些內部值不一樣（例如 `me` 顯示成「承承」），改 [app.js](app.js)
的 `OWNER_META` 跟 `index.html` 的 `#eventOwner` 下拉選項文字即可，不用動 Sheet 或
`Code.gs`。

**RecurringEvents**（循環行程，固定週期規則，例如「每週三打球」「每月15號幫咪嚕點藥」）

| id | owner | title | time | notes | frequency | dayOfWeek | dayOfMonth | createdAt | endDate | endTime |
|----|-------|-------|------|-------|-----------|-----------|------------|-----------|---------|---------|

- `frequency`：`weekly` / `monthly`
- `dayOfWeek`：0-6（0=日、1=一...6=六），只有 `weekly` 用得到
- `dayOfMonth`：1-31，只有 `monthly` 用得到
- `endTime`：選填，`HH:mm`，每次行程的結束時間（規則同 Events 的 `endTime`；注意跟 `endDate` 截止日不同）
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

| id | date | glucose | hba1c | cholesterol | ldl | hdl | triglyceride | ast | alt | creatinine | egfr | uricAcid | tsh | ck | bun | sodium | potassium | createdAt |
|----|------|---------|-------|-------------|-----|-----|--------------|-----|-----|------------|------|----------|-----|----|-----|--------|-----------|-----------|

- 除 `date` 外都可留空（每次驗血不一定每項都有）；一列 = 一次抽血
- 參考範圍與分級邏輯寫在 `health-labs.js` 的 `ITEMS`（參考範圍採 Dean 驗血報告上的標示，分級另參考
  ADA、台灣血脂指引、KDIGO 等，依男性）。要加新項目：Sheet 加欄位、`Code.gs` 的 `LAB_FIELDS`
  加 key、`ITEMS` 加一筆
- 這兩張表跟 BloodPressure 一樣不經過主頁面的 `getData()`
- 若部署到舊版後端而產生同一天重複的列，請直接到 Sheet 手動合併（保留一列、刪掉其他）；前端偵測到同一天出現多筆會彈窗提醒。曾經用過的一次性合併函式 `mergeDuplicateHealthRows` 已移除，要參考到 git 歷史找
- 同一天已經有紀錄時，新增會**合併更新**：只覆蓋這次有填的欄位，沒填的保留（InBody、LabResults 按日期；LabExtra 按日期+項目名稱）；前端會先跳確認。要整天刪掉再重建用 ✕
- 分級依據（2026-10-03 查證過）：BMI 用國健署成人標準；血糖/HbA1c 用 ADA；總膽固醇/三酸甘油酯/HDL 用台灣血脂指引；
  eGFR 用 KDIGO 分期。**自己推估、非正式指引**的：AST/ALT/肌酸酐/BUN/尿酸/TSH/CK 的「注意/偏高」分界、
  HDL 35 以下的「過低」、腰臀比 1.0 的「過高」、體脂率 10–20/20–25 的細分（國健署只定 25% 以上肥胖）、
  內臟脂肪與身體年齡（廠商算法）、其他項目的 15%/50% 分級。LDL 目標預設 130（一般成人），可在驗血頁切換 115/100/70（存在該裝置 localStorage）

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

**ShoppingList**（「清單」，不綁日期、處理完就勾掉再清除；分購物/想法兩個分類）

| id | item | done | createdAt | category |
|----|------|------|-----------|----------|

`category` 是 `shopping` 或 `idea`，空白視為 `shopping`（舊資料不用補）。

**Copybook**（練字字帖的內容庫，`practice.html` 隨機從這裡取材）

| id | lang | title | author | text | createdAt |
|----|------|-------|-------|------|-----------|

- `lang`：`zh` 或 `en`；`title` 篇名（中文頁的標題取「・」前面那段）；`author` 作者（可空）；`text` 全文，換行 = 一行／一句（中文的標點只用來斷句，描紅不印標點）
- 新增、修改內容直接在這個分頁改（網頁只負責讀）。第一次可在字帖頁的「內容庫」按「匯入內建範例」，把 `data/copybook-seed.json`
  的唐詩宋詞與英文短文（都是公有領域）匯進來，重複按不會重複加入
- 一篇上限 8000 字；`id`、`createdAt` 由匯入自動產生，手動加列時 `id` 隨便填一個不重複的字串

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

把上一步的網址貼到 [shared.js](shared.js) 最上面的 `WEBAPP_URL`（所有頁面共用），然後 commit + push。

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
GitHub Pages 產生的網址任何人拿到連結都能打開，密碼是實際擋人的那一關。
Repo 目前是公開的（免費方案的 Pages 需要），所以**原始碼與 git 歷史裡不能放任何真實資料**
（健康數值、帳單、密碼、網址以外的金鑰）：資料只存在 Google Sheet，程式碼只放邏輯。
一次性搬移／匯入資料的函式跑完就整段刪掉，不要留在 `Code.gs` 裡 commit。

## 同步到 Google 行事曆（單向：App → Google）

App 裡的事件（含循環行程）會自動出現在 Google 的「承日常」行事曆，手機原生行事曆、提醒都能用。**單向**：App 是來源，
在 Google 那邊改標題／時間，下次同步會被 App 的內容蓋回來（想改請在 App 改）。沒設定 `CALENDAR_ID` 時整個功能關閉，其他一切照舊。

**同步什麼**：一次性事件（有填時間 = 定時事件，長度用 `endTime`、沒填結束時間就預設 1 小時；沒填時間 = 全天事件，備註放說明欄）；循環行程**展開成單次事件**，
只維護今天起 120 天（扣掉「跳過這一次」的日子、遵守截止日）；標題 `[承承] 看牙醫`。標了「不顯示在行事曆」的純記帳事件不同步。

**怎麼運作**（`Code.gs` 的「同步到 Google 行事曆」那一段）：「對帳」——算出 App 裡應該有的事件，跟行事曆上**帶本 App 標記**
（CalendarEvent tag `dh`）的現有事件比對，只做差異。**只管理有標記的事件**，別人在這個行事曆手動加的完全不碰。
寫入事件時只設旗標 `CAL_DIRTY`（不拖慢 App）；每 5 分鐘的觸發器有旗標才對帳，每天 4 點再完整對帳一次（把循環行程視窗往前滾）。
失敗了旗標保留、下一輪自動重試。首頁行事曆卡片右下角只有一個很小的 ☁️，點開才看得到狀態與「預覽」「立即同步」（預覽結果直接顯示在同一個視窗）；只有同步失敗時圖示會變 ⚠️ 並多一行紅字。純通知的訊息視窗用 `showAlert`（只有「知道了」），需要選擇才用 `showConfirm`（確定／取消）。
純函式（`desiredCalendarEvents_`、`planCalendarSync_`）有回歸測試，`reconcileWith_` 用假的行事曆測過建立／更新／刪除／冪等。

**設定步驟（一次性）**
1. Google 日曆新增行事曆「承日常」→ 設定 → 與特定使用者共用 → 加太太的 email（**不要設成公開**）。給它一個和其他行事曆不同的顏色。
2. 該行事曆設定頁最下面「整合行事曆」複製**行事曆 ID**。
3. Apps Script「專案設定 → 指令碼屬性」新增 `CALENDAR_ID`＝那個 ID。
4. 貼新版 `Code.gs`。編輯器依序執行：`authorizeCalendar`（跳出授權視窗，允許讀寫行事曆）→ `installCalendarTriggers`（建立兩個觸發器，可重複執行）。**這兩個是一次性函式，Dean 已經執行完、已從 `Code.gs` 移除**（授權與觸發器會留著；要重新設定時到 git 歷史找回，`git log -S installCalendarTriggers`）。
5. 重新部署新版本。首頁按「預覽」看會同步哪些事件，沒問題再按「立即同步」。
6. 太太在她的 Google 日曆接受分享。**建議先用一個測試行事曆跑一輪**，確認手機上看到的沒問題，再把 `CALENDAR_ID` 換成正式的。

**看不到「承日常」時**：Google 日曆 App／網頁預設會顯示。iPhone／Mac 內建的日曆 App 要到
`calendar.google.com/calendar/u/0/syncselect` 把「承日常」勾起來才會同步過去（太太也一樣）。新建的行事曆預設沒有通知，
提醒的預設值（定時事件前幾分鐘、全天事件前一天幾點）還沒決定，之後再討論，現在同步出去的事件不帶提醒。

**要退場或重來**：執行 `clearSyncedCalendarEvents`，只刪帶標記的事件，再重新同步。

**跟公司行程有沒有衝突**：App 不讀公司行事曆（資安與個人帳號權限的考量）。建議把工作帳號和個人帳號加到同一台手機／Mac 的日曆 App，
兩邊的行程會疊在同一個畫面、不同顏色，有重疊一眼看得到。之後如果公司允許對外共用「只顯示忙碌／空閒」，
有兩個可以再加的做法：把「承日常」以只顯示忙碌的方式共用給工作帳號；或讓 App 讀取公司行事曆的忙碌／空閒（不存任何內容）在新增行程時提示衝突。
**第二階段**（還沒做）：唯讀讀取 Google 行事曆（Dean 指定的幾個行事曆 ID）顯示在首頁日曆，排除本 App 同步出去的事件。

## 練字字帖（`practice.html`）

- 入口：首頁「練字」習慣（`app.js` 的 `PRACTICE_HABIT_ID`）那一列多了 `中`、`英` 兩顆按鈕，開新分頁。勾選、編輯、刪除跟一般每日習慣一樣。
- 描紅用，所以**只印淺灰色的字**，不畫田字格、米字格、四線格（太雜）；顏色只有灰階（黑白印表機），「描紅深淺」可選淡／中／深，
  第一次請實際印一張挑一個。紙張左上角有 10 cm 刻度，印出來量一下確認是 100%（不要選「符合頁面」）。
- **一張 A4 = 一週**：
  - 中文：A4 橫向、直排、欄由右到左；每欄 14 字（字約 10.4mm），五言絕句兩句一欄、七言絕句兩句一欄（一首 = 2 欄），一頁 15 欄 ≈ 7 首絕句；
    詞比較長，一首會佔 4–8 欄。每首的第一欄上方有小字篇名。建議一天寫兩欄（一首絕句，約 20–28 字）。
  - 英文：A4 直向、字 6mm、行距 12mm，一頁約 21 行、每行約 60 字元；建議一天寫 3 行。
  - 一頁盡量放「整篇放得下」的文章（整篇放不進剩下的位置就換別篇），所以不會從詩的中間開始；單篇太長才會在頁尾註明沒印完。
- 字型：中文霞鶩文楷 TC、英文 Andika（印刷體），都是 OFL 字型，從 Google Fonts 載入（中文用 `&text=` 只載入當頁用到的字）。
  版面計算在 [practice-layout.js](practice-layout.js)（純函式、有回歸測試），畫面與字型在 [practice.js](practice.js)；
  字大小、每欄字數、行距等常數集中在 practice-layout.js 最上面（`ZH_PAGE`、`EN_PAGE`）。
- 網址 `?lang=&ids=` 可以重現同一頁；按「重新抽」換一批（最近用過的篇章排後面）。
- 列印用 Mac 的 Chrome／Safari 最穩；`@page` 由頁面依語言設成橫向／直向。iPhone AirPrint 對頁面方向支援不完整，不建議。

## 習慣的呈現與連續統計

- 每日：左邊 checkbox；🔥 = 目前連續天數，點開看歷史最長、本月完成次數。
- 每週／每月：左邊圓形 `＋`（達標後變 `✓`，再按一次會先確認再歸零）；第二行是「本期圓點（做了幾次／目標幾次）」
  加「最近 6 期長條」（最右邊粗框是目前這一期，全滿 = 達標）；🔥 = 目前連續週數／月數，點 🔥 或長條展開詳情。
  整列不是點擊區，避免誤觸。
- 規則：這一期（今天／本週／本月）還沒達標**不算斷**，從上一期往回數；更早任何一期沒達標才斷。
  程式在 [app.js](app.js) 的 `computeStreak`（每日）與 `computePeriodStreak` / `computePeriodStats` / `getPeriodHistory`（週月）。
- 手機窄螢幕（≤480px）的版面規則在 [style.css](style.css) 最後面的 `@media`；首頁 header 有 `.multi` 才會換行，
  健康／帳單頁只有一個登出鈕，維持左右並排。

## API 傳輸與寫入規則

- **全部用 POST**：前端 `api()`（[shared.js](shared.js)）把 `{action, password, ...參數}` 轉成 JSON 字串放 body，
  `Content-Type: text/plain`（避免瀏覽器的 CORS 預檢，Apps Script 不處理 OPTIONS）；後端 `doPost`
  自己 `JSON.parse`。密碼與健康資料不會出現在網址／瀏覽器歷史。後端的 `doGet` 一律回「請改用 POST」，
  所以寫入不能用 GET 觸發。
- **後端寫入全域鎖**：`handleRequest` 對所有不是 `get` 開頭的 action 先取 `LockService` 腳本鎖（最多等 30 秒），
  整段「讀列號 → 寫入」序列化，不會因為列號位移寫錯列。⚠️ 這個鎖**不能重入**，action 函式裡面不要再自己
  `getScriptLock()`。
- **寫入只回傳異動的集合**：主頁面的寫入 action 用 `getData(["goals"])` 這種形式只回傳自己動到的資料，前端
  `applyData` 只覆蓋回傳裡有的欄位；登入時 `getData` 整包讀（清單 `shoppingList` 除外，開 📝 才載入）。
- **前端寫入排隊**：`api()` 對寫入（不是 `get` 開頭）一個接一個送，回應一定照操作順序到達，快速連點不會
  讓舊回應蓋掉新畫面。讀取不排隊。
- **文字寫入防公式**：任何帶使用者文字的寫入一律走 `appendRowSafe_` / `setTextSafe_`（`=`、`+`、`-`、`@` 開頭的
  字串會先把那格設成純文字），不要直接 `sheet.appendRow` / `range.setValue` 寫字串。
- **數字一律嚴格解析**：前端 `parseStrictNumber`；後端所有使用者輸入的數字（金額、帳單、血壓、次數、星期/日期、目標）
  都走 `numArg_`（底層 `parseNumStrict_`）：允許千分位 `1,000`，`abc`／`12abc` 直接回錯誤訊息，不會存成 0 或截斷。
  不要在 `Code.gs` 用 `parseFloat` / `parseInt` 解析輸入（回歸腳本會檢查）。
- **欄位型別（寫入前先驗證）**：後端每個寫入 action 都依欄位型別過一遍輸入，驗證不過就回錯誤訊息、不寫入。
  新增欄位時先決定它是哪一型，用對應的函式（`Code.gs`「欄位型別」那一段有同樣的對照）：

  | 型別 | 函式 | 用在哪些欄位 |
  |------|------|--------------|
  | 數字 | `numArg_` | 事件／帳單／已繳金額、血壓與脈搏（整數、有合理範圍）、體組成與驗血數值（`parseNumStrict_`，≥0 不設上限）、習慣目標次數（整數 1–31）、循環行程的星期（0–6）與日期（1–31） |
  | 文字 | `textArg_` | 待辦／事件／行程標題、習慣名稱、清單內容、備註、銀行名稱、驗血項目名稱與單位（必填與否、長度上限各自設定；另有公式防護） |
  | 日期 | `dateArg_` | 待辦與事件日期、血壓日期、帳單截止日、跳過日期、循環截止日（yyyy-MM-dd，會檢查真的存在，如 2/30 無效） |
  | 月份 | `monthArg_` | 帳單月份（yyyy-MM） |
  | 時間 | `timeArg_` | 事件與行程時間（HH:mm，可空白） |
  | 列舉 | `enumArg_` | owner、habit／循環行程的 frequency、血壓 period |
  | 布林 | `boolArg_` | workdaysOnly、hideFromCalendar |

  銀行名稱刻意只當必填文字、不限定清單（開新卡不用改後端）。
- **處理中的鎖跟著資料走**：寫入排隊時，前一筆回來會重畫整份清單；列的 `data-lock-key`（`goal:id`、`item:id`、
  `habit:id|週期`）讓還在處理中的那一筆重畫後仍被鎖住（`lockIfPending`），完成前用 `releasePending(li)` 釋放。
  新增會重畫清單的操作時，在 render 設 `li.dataset.lockKey` 並呼叫 `lockIfPending(li)`。待辦、清單、習慣、事件、循環行程、帳單、
  健康紀錄的刪除都已接上。
- **背景載入不能蓋掉新寫入**：健康頁各分頁的 state 有 `version`，寫入回應 +1；背景載入拿到結果時 version 變了就丟掉。
- 每個 API 的耗時會記在瀏覽器 console 的 `apiTimings`，覺得慢時先看這個再決定要不要加快取。

## 回歸檢查

改動登入、日期切換、匯入或寫入流程之後：

```bash
node scripts/regression-check.js
```

會檢查數字解析、跳脫、習慣連續天數、公式防護、驗血項目驗證（純邏輯，不連網路）。畫面流程要在瀏覽器手動
過一遍：

1. **登入**：輸入錯誤密碼 → 留在登入頁並顯示錯誤、不進畫面；正確密碼 → 進入；按登出 → 回到登入頁，
   重新登入前看不到上一個人的資料、沒有殘留彈窗。（健康頁、帳單頁、首頁都要試）
2. **日期切換**：首頁日曆點另一天、按「今天」→ 待辦、事件、每日/每週/每月習慣都跟著換；在別天勾習慣，
   重新整理後勾到的是那一天。
3. **匯入**：健康頁驗血、體組成各貼兩份不同的報告 → 第二份不會殘留第一份的數值；貼 `"1,000"` 變 1000；
   無效數字、重複項目會在訊息列出。
4. **寫入衝突**：兩個分頁／裝置同時快速新增、勾選、刪除 → 沒有重複列、沒有勾錯列；輸入以 `=1+1` 開頭的
   文字（待辦、清單、驗血其他項目名稱）→ Sheet 裡原樣顯示成文字，不是 2。

## 未來可以加的東西

需要先做決定才能動工的：

- 食譜功能——先決定要不要繼續往同一個 app 塞功能，還是另開（可以先把點子丟進「清單」的想法分頁累積）
- Google 行事曆第二階段（唯讀讀取 Google 行事曆顯示在 App、公司忙碌／空閒衝突提示）——見上面「同步到 Google 行事曆」

## 時間輸入（24 小時制）

`<input type="time">` 的顯示格式跟著瀏覽器／系統（常是上午／下午 12 小時制），網頁沒辦法強制，所以 `shared.js` 的 `initTimeSelects()` 把頁面上
所有 `type="time"` 換成「時」「分」兩個下拉（00–23、每 5 分鐘），一律 24 小時制；換掉後同 id 的元素仍有 `.value`（`"HH:mm"` 或 `""`），
其他程式照舊用 `.value` 讀寫。新增含時間的輸入欄位時，直接寫 `<input type="time">`，頁面載入時會自動換成這個。
