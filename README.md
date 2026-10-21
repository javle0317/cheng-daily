# Daily Hub

一頁式每日目標 / 行事曆看板。純靜態前端（GitHub Pages），資料存在 Google Sheet，
用 Google Apps Script 當輕量後端做密碼驗證與讀寫。

## 部署步驟

### 1. 建立 Google Sheet

新增一個 Google Sheet，依下面的清單建立所有分頁（共 12 個：Goals、Habits、HabitLog、Events、RecurringEvents、RecurringExceptions、BloodPressure、InBody、LabResults、LabExtra、CreditCardBills、ShoppingList，加上你自己用的其他分頁不影響）。每個分頁第一列貼上表頭（直接複製下面表格的欄位名稱，漏一欄會在寫入時報「缺少欄位」）：

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

- `amount`：選填的花費金額（**已不在畫面上使用**：首頁花費統計與事件視窗的金額欄都移除了；舊資料保留不動，寵物花費改記在 PetLog）
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
  新增時可以不填，之後點循環行程清單的那一列，在編輯視窗裡補登、修改或清除
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
  組合——目前網頁上只能新增跳過紀錄（點當日事件裡的循環行程，在編輯視窗按「只跳過這一次」），沒有「復原」
  的介面，想復原要自己去 Sheet 刪那一列

**BloodPressure**（血壓量測紀錄，獨立頁面 `health.html`）

| id | date | period | systolic | diastolic | pulse | createdAt | note |
|----|------|--------|----------|-----------|-------|-----------|------|

- `period`：`morning` / `evening`
- `note`：選填的短備註（≤200 字），記「懷疑偏高的原因」（晚餐吃火鍋、喝了咖啡）。**要手動在表頭最後面加 `note` 欄**；後端依表頭名稱寫入，有填備註卻沒有這一欄會報錯（不悄悄丟掉）。同一天同時段會量好幾次，備註寫一次就好：列表把該時段所有備註合併顯示在第一筆底下，新增表單遇到該時段已有備註會提示不用重寫
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

**Recipes**（食譜，獨立頁面 `recipes.html`；分頁由後端 `ensureSheet` 自動建立，不用手動建）

| id | name | tags | ingredients | steps | notes | rating | cookCount | lastCookedAt | createdAt |
|----|------|------|-------------|-------|-------|--------|-----------|--------------|-----------|

- `tags`：逗號分隔的文字（最多 10 個、每個 ≤20 字）；`ingredients`／`steps` 一行一項／一步；`rating` 0–5（0＝未評分）
- 編輯（`updateRecipe`）只改名稱／標籤／食材／步驟／備註，不動評分與煮過次數；評分（`setRecipeRating`）與「煮過 +1」（`markRecipeCooked`，同時記 `lastCookedAt`）各自獨立
- 這張表不會出現在主頁面的 `getData()` 回傳裡，用 `getRecipes`；欄位名稱與順序寫死在 `Code.gs` 的 `RECIPE_HEADERS`，不能改

**PetLog**（寵物購買／就醫紀錄，獨立頁面 `pets.html`；分頁由後端 `ensureSheet` 自動建立，不用手動建）

| id | pet | type | date | title | amount | note | sourceEventId | createdAt | finishedAt |
|----|-----|------|------|-------|--------|------|---------------|-----------|------------|

- `pet`：`PET_NAMES` 其中之一（前端在 `shared.js`、後端在 `Code.gs`，兩邊都要加）；`type`：`food` 飼料／`litter` 貓砂／`vet` 看醫生／`medicine` 用藥疫苗／`grooming` 美容／`other`（寫死在 `PET_LOG_TYPES`）
- `title` 是品項或就醫原因（「主食罐 12 入」「耳朵發炎」）；`amount` 選填；`sourceEventId` 是從舊 Events 搬來時的來源事件 id，用來避免重複搬
- 跟 Events 的分工：Events 的寵物事件是**行事曆預約／提醒**（會同步到 Google 行事曆與 LINE），PetLog 是**實際發生的歷史**（買了什麼、看了什麼），用來算間隔
- `note`：備註，依類型提示不同（看醫生＝醫囑／重要事項，飼料＝到期日等）
- `finishedAt`：飼料／罐罐／貓砂的**用完日**（空白＝還沒用完）；這欄是後來加的，**已存在的 PetLog 要手動在表頭最後面補上 `finishedAt`**，沒補時其他功能照常，只有按「用完了」會報錯要你補欄位（新建的分頁自動就有）
- 欄位名稱與順序寫死在 `PET_LOG_HEADERS`，不能改

**PetSkipped**（寵物「待登記」清單裡按「略過」的事件；分頁自動建立）

| id | eventId | createdAt |
|----|---------|-----------|

- 只記事件 id，之後那些事件不再出現在待登記與首頁紅點；原事件完全不動

**PetLabs**（寵物驗血，寵物頁「驗血」分頁；分頁自動建立）

| id | pet | date | name | value | unit | refLow | refHigh | createdAt |
|----|-----|------|------|-------|------|--------|---------|-----------|

- 一個項目一列，**自帶那份報告上印的參考範圍**（寵物的範圍依物種與檢驗所不同，所以不寫死；做法跟人用驗血的 `LabExtra` 一樣）；同寵物同一天同名稱再新增＝更新那一列
- 項目名稱要**每次一致**（ALT、BUN…），歷史報告才接成同一條趨勢線；個人化設定也是依名稱對應

**PetLabPrefs**（某隻寵物某個驗血項目的個人化設定；分頁自動建立）

| id | pet | name | mode | refLow | refHigh | note | createdAt |
|----|-----|------|------|--------|---------|------|-----------|

- `mode=ok`「醫師說無妨」：照樣標出偏高／偏低，但改成中性的 ⚪（不用紅黃橘警示）；`mode=range`：用這隻的自訂範圍取代報告上的範圍（套用在這個項目的所有歷史資料）
- 設定與刪除不動原始數據，隨時可以取消回到報告上的標示

**UtilityBills**（水電瓦斯分項追蹤，帳單頁 `bills.html` 的「水電瓦斯」卡片；分頁自動建立）

| id | type | billingMonth | months | amount | note | createdAt | usage |
|----|------|--------------|--------|--------|------|-----------|-------|

- **`amount` 與 `usage` 至少要填一個**：只有用量（金額留空）＝帳單附註的歷史用量（瓦斯單的「去年同期計費度」、水費單底下前 6 期的用水度數），用量圖與「去年同月」會用到，金額圖與單價圖自動略過、列表標示「只有用量」
- `usage`：用量（度，選填；水電瓦斯帳單上都是「度」）。**這欄是後來加的，已存在的 UtilityBills 要手動在表頭最後面補上 `usage`**；沒補時沒填用量照常新增、填了用量會報錯要你補欄位（新建的分頁自動就有）
- `type`：`water`／`electric`／`gas`（寫死在 `UTILITY_TYPES`，網路、電信、訂閱先不記）；`billingMonth` 是帳單上的計費月份（yyyy-MM，期間結束月）；`months` 是計費月數（台灣水電、台北瓦斯都是兩個月一期，預設 2；1–12）
- **同類型同月份只有一筆**：再新增一次＝更新那一筆；編輯時改成別筆已有的月份會報錯
- 趨勢用**每月均攤＝amount ÷ months**（`utilMonthlyAvg`），兩個月一期和一個月一期才比得起來；**這些金額不加進信用卡帳單的任何總額**（水電多半已經刷卡，會重複）

**Places**（想吃的店，食譜頁「想吃的店」分頁；分頁自動建立）

| id | name | country | city | area | tags | source | note | dishes | mapUrl | status | rating | visitedAt | review | createdAt |
|----|------|---------|------|------|------|--------|------|--------|--------|--------|--------|-----------|--------|-----------|

- **只有 `name` 必填**，其餘之後再補（可以請 Claude 整理「第二層」JSON 批次匯入）。地區是三層：`country` 國家 → `city` 縣市／城市 → `area` 區域或商圈（自由輸入，篩選選項只列實際記過的，所以出國也不用改程式）
- `status`：`want` 想去／`visited` 去過了；去過了才有 `rating`（0–5）、`visitedAt`、`review`（心得）；改回想去會清掉評分與日期、保留心得
- `mapUrl`：**Google 地圖的店家連結**（在 Google 地圖按「分享」複製的連結）；沒填就不顯示地圖鈕，**不自動組搜尋連結**。`source` 是 IG／YouTube 來源連結。兩個連結都只收 `http(s)://` 開頭
- **不記營業時間**（會變動、容易過期）；建議時段、要排隊、只收現金等寫在 `note`
- 批次匯入（`importPlaces`）依店名比對（忽略空白與大小寫；兩邊都有填縣市時縣市也要一致）：找到＝**只補空白欄位**（勾「覆蓋已有內容」才覆蓋，標籤取聯集），找不到＝新增；全部驗證過才寫

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

訊息裡的事件發送前會先照 `time` 排序（全天事件在最前面，之後由早到晚，同一時間維持原本順序，`sortEventsByTime_`）；寵物與共同事件合併成同一則，合併後再排。

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
另有唯讀的 `WALLPAPER_TOKEN`（只給鎖定畫面桌布頁，見下方「鎖定畫面桌布」），外洩也只能讀到當月行程與今日未完成習慣。

## 鎖定畫面桌布（wallpaper.html）

給 iOS 捷徑截圖、當鎖定畫面桌布用的獨立頁面：固定深色，上方約 24% 留空給 iOS 時鐘與小工具，下面是當月月曆（有行程的日子點一點、國定假日與週日紅字）、今日行程、今天還沒完成的每日練習（運動挑戰顯示抽到的內容）。

- 資料：後端唯讀動作 `getWallpaperData`（`Code.gs` 的 `getWallpaperData_`），**只認 Script Property `WALLPAPER_TOKEN`**，不接受 `PASSWORD`，也不能拿這個 token 呼叫其他動作。token 自己取一串長亂碼，第一次開頁面貼進去，只存在該瀏覽器的 localStorage，不放網址。
- 頁面不載入 `shared.js`／`app.js`（它們會綁登入表單），獨立的 `wallpaper.js`；載入完成後 `<body data-ready="1">`（失敗是 `error`，token 錯會清掉重新輸入）。
- 捷徑：打開 URL → 等待 5 秒 → 拍攝螢幕快照 → 裁切圖片（X 148／Y 350／寬 909／高 1970，以 1179×2556 的截圖為準：去掉瀏覽器上下工具列，並讓比例等於螢幕，鎖定畫面才不會被放大裁掉）→ 儲存到專用相簿。「打開 URL」用預設瀏覽器，token 要在同一個瀏覽器貼過。新版 iOS 的捷徑不一定有可靠的「設定桌布」動作，備案是把截圖存進專用相簿，鎖定畫面用「照片輪播」。

## 同步到 Google 行事曆（單向：App → Google）

App 裡的事件（含循環行程）會自動出現在 Google 的「承日常」行事曆，手機原生行事曆、提醒都能用。**單向**：App 是來源，
在 Google 那邊改標題／時間，下次同步會被 App 的內容蓋回來（想改請在 App 改）。沒設定 `CALENDAR_ID` 時整個功能關閉，其他一切照舊。

**同步什麼**：一次性事件（有填時間 = 定時事件，長度用 `endTime`、沒填結束時間就預設 1 小時；沒填時間 = 全天事件，備註放說明欄）；循環行程**展開成單次事件**，
只維護今天起 120 天（扣掉「跳過這一次」的日子、遵守截止日）；標題 `[承承] 看牙醫`。標了「不顯示在行事曆」的純記帳事件不同步。

**怎麼運作**（`Code.gs` 的「同步到 Google 行事曆」那一段）：「對帳」——算出 App 裡應該有的事件，跟行事曆上**帶本 App 標記**
（CalendarEvent tag `dh`）的現有事件比對，只做差異。**只管理有標記的事件**，別人在這個行事曆手動加的完全不碰。
寫入事件時只設旗標 `CAL_DIRTY`（不拖慢 App）；每 5 分鐘的觸發器有旗標才對帳，每天 4 點再完整對帳一次（把循環行程視窗往前滾）。
安全保險：沒確認資料表讀取正常、期望事件又全空卻要刪超過 5 筆時會中止（疑似讀取異常）；三個分頁都讀到、表頭正常（`data.verified`）只是真的沒事件了（例如刪掉最後一條循環行程）則照常刪除。同步失敗時狀態視窗優先顯示失敗原因（即使待同步旗標還在），再補一句會自動重試。
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

## 練字字帖

字帖已搬到 cheng-lingo（`copybook.html`，內容在該專案的 `data/copybook.json`，另有日文五十音）。首頁「練字」習慣列的「字」連結直接連過去（中文、英文、日文在字帖頁內切換）。
舊的 Sheet `Copybook` 分頁已經沒有程式在讀，可以自行刪除或留著當備份。

## 視覺主題與主畫面（App）

**主題「藏青・黃銅」**：暖米色底、藏青主色、黃銅點綴、磚紅當活潑色、深綠表示完成／達標；標題用宋體（Noto Serif TC，Google Fonts），內文維持系統字體。
- **換色只改一個地方**：[style.css](style.css) 最上面的 `:root`（日間）與 `@media (prefers-color-scheme: dark)`（夜間）兩組變數（`--bg`、`--card-bg`、`--text`、`--accent`、`--brass`、`--pop`、`--ok`、`--on-accent`…）。
  元件樣式在檔案最後面「視覺主題」那一段（雙線卡片、❦ 標題裝飾、圓形勾選框、連續天數膠囊、黃銅 focus 外圈）。
- 健康燈號（`--status-*`）是醫學語意、血壓圖系列色（`--series-*`）要彼此好分辨，**不跟著主題走**。對象標籤顏色在 `app.js` 的 `OWNER_META`（要在日夜背景都看得清楚，用中間色調）。
- `scripts/regression-check.js` 會檢查色票對比（WCAG ≥ 4.5），改色後跑一次。
- 品牌名稱「承日常」（分頁標題、鎖定畫面、App 名稱）；專案／repo 名稱仍是 Daily Hub / cheng-daily。

**Safari 加到主畫面（全螢幕 App）**：每頁 `<head>` 有 `apple-mobile-web-app-capable`、App 標題、`theme-color`（日夜各一）、`apple-touch-icon`、`manifest.webmanifest`、
`viewport-fit=cover`；`.app`、Toast、彈窗用 `env(safe-area-inset-*)` 避開動態島與 Home 指示條。手感：去掉點擊閃光、`overscroll-behavior`、手機上輸入欄 16px（避免聚焦時自動放大）。
- 圖示：[icons/icon.svg](icons/icon.svg)（印章・承：藏青底、磚紅略傾斜印章、象牙色「承」、黃銅細線），`sh scripts/make-icons.sh` 用本機 Chrome 輸出 180／192／512／32 的 PNG（要連網載入宋體）。
  **換圖示或名稱後，要把 iPhone 主畫面舊的捷徑刪掉重新加**，iPhone 只在加入那一刻讀一次圖示。
- 狀態列樣式先用 `default`（最保險；iPhone 17 Pro 的實際顏色沒有驗證過）。若頂端顏色不協調，可改 `black-translucent` 並做藏青頂欄（白字）。
- 全螢幕 App 的行為：登入資料與 Safari 分開（首次要重新輸入密碼）；`target=_blank` 的外部連結（地圖）會跳去 Safari；字帖（在 cheng-lingo）列印在 Mac 做。

## 健康頁的版面

- **進頁面先看資料**：血壓、體組成、驗血三個分頁最上面各有一顆「＋ 記一筆血壓／記錄體組成／新增驗血」，新增表單在彈窗裡（`#bpFormModal`、`#bodyFormModal`、`#labFormModal`，欄位 id 與送出邏輯沒變；貼上匯入也在彈窗裡）。成功才關閉彈窗，錯誤用 Toast（`z-index` 已調到彈窗之上）。
- 分頁籤用線條圖示，數據方塊兩欄（寬螢幕四欄）整齊排、數字用宋體，血壓圖的系列色跟新主題（藍／磚紅／深綠，日夜各一組），分級色帶的文字標籤放大並留出右邊空間。
- 體組成頁的趨勢圖是「一張圖 + 下拉」（跟驗血同一種做法）：上面的數據方塊可以點，點了下方圖表切到那一項（選中的方塊有外框），下拉另外有沒有方塊的項目（體脂重量、肌肉量、體水分、蛋白質、基礎代謝率）。上次選的項目記在 localStorage（`bodyChartKey`）。圖表工具 `drawTimeChart` 在 `health-charts.js`，`highlightLast` 會放大最新一點。
- 過去驗血表單中間一大片空白是版面 bug：直排的表單（`.entry-form-rows`）同時設了 `flex-wrap: wrap`，會把某個項目撐高；現在直排表單一律 `nowrap`。

## 信用卡帳單與清單（購物／想法）的版面

- 帳單頁：進頁面先看「待繳款」與圖表；「＋ 新增帳單」開彈窗（欄位有標籤：銀行、帳單年月、繳費截止日、全額、最低應繳；`#billFormModal`）。待繳款卡片的 💰 改成「登記已繳／修改已繳」文字鈕（`.pay-btn`）。帳單紀錄一次只顯示一個月份：月份下拉（`#billListMonth`，`yyyy年MM月`，新到舊）由資料產生，預設最新月份，只列目前銀行篩選下有資料的月份（選的月份不存在就退回最新）。
- 清單彈窗（`#shoppingModal`）標題去掉 emoji（頂端已有線條圖示）；想法的輸入框很高，「新增」鈕靠底對齊。
- 清單項目可以編輯：每一筆有 ✏️（已完成的不顯示），開 `#listEditModal`（購物項目 2 行、想法 6 行的文字框），後端 `updateShoppingItem` 只改 `item` 欄（勾選與分類不動）。帳單「已繳金額 = 全額」就視為繳清、鎖定不能再改（前端不顯示按鈕、後端也擋，但仍可刪除）。

## 食譜頁的版面

- 進頁面是搜尋框（比對名稱與食材）＋標籤下拉（資料中實際出現的標籤，有新標籤自動多一個選項）＋排序（最近新增／評分高到低／煮最多次），下面是食譜卡片，點名稱展開食材、步驟、備註。
- 卡片上：★ 評分（再點同一顆清除）、「煮過 +1」、✏️ 編輯（同一個彈窗 `#recipeFormModal`）、✕ 刪除。
- **貼上匯入**（只在新增時出現，跟健康頁同一個做法）：把整理好的 JSON 填進表單，不送出，核對後再按「新增」。格式見 CLAUDE.md。

## 寵物頁的版面

- 頂端切換寵物（記在 localStorage `petSel`），「概況」每個有紀錄的類型一塊：上次幾天前、共幾次、**平均間隔**（相鄰兩次日期差的平均，最多取最近 6 個間隔；少於 2 個不同日期不算）、飼料／貓砂另有「下次約幾月幾日」，看醫生顯示最近一次原因（`petIntervalStats`）。
- 「紀錄」依月份（有資料的月份，新到舊）與類型篩選，顯示該月與該年合計；新增／編輯同一個彈窗 `#petLogModal`。
- **待登記**（寵物頁按鈕「待登記（N）」；原本叫「整理舊紀錄」，現在是常駐的收件匣）：列出行事曆裡寵物**已經發生**（日期到了）、**還沒登記到寵物紀錄**、也沒按過「略過」的事件，預設只列有花費或標題看得出飼料／貓砂／醫／藥…的，勾「顯示全部寵物事件」可列出其他。每列有猜好的類型（可改）與勾選，「搬進寵物紀錄」寫進 PetLog（`importPetEvents`，全部驗證過才寫、已搬過的略過）；「略過勾選的」（`skipPetEvents`，記在 `PetSkipped` 分頁）＝不用登記，之後不再列出。原事件都不動。預約過了、事件上沒勾「登記到寵物紀錄」的，就靠這個清單補上，不用記得回去編輯事件。
- **首頁紅點**：首頁寵物圖示右上角顯示待登記的件數（9 以上顯示 9+），載入首頁與新增／編輯／刪除事件後更新（`refreshPetPending`，讀 `getPetPendingInfo` 取已登記與已略過的 id，用 `shared.js` 的 `migrationCandidates` 算；後端還沒更新或讀不到就不顯示）。
- **驗血分頁**（順序：趨勢圖在最上面，下面是各項目最近一次）：每個項目最近一次一塊（依狀況差的排前面；**項目多時預設只列需要注意的（偏高偏低、且沒標成醫師說無妨），其他收起，按「顯示全部 N 項」展開**；點方塊會捲回上面看趨勢圖）、項目趨勢圖（x 軸日期，跨年沒問題，色帶取最後一次的範圍）、與上次／整體的比較說明、依日期的歷史列表。新增彈窗每個項目一列（名稱、數值、單位、範圍下限／上限），也能「貼上匯入」（JSON 格式見 CLAUDE.md）；分級共用函式（`classifyRange`、`compareHealth`、`renderLabExplain`）在 `health-charts.js`，人用驗血 `health-labs.js` 與寵物 `pets-labs.js` 共用。「個人化設定」鈕（趨勢圖旁）設定「醫師說無妨」或自訂範圍。
- **用完了**（飼料、貓砂）：列上的「用完了」鈕記用完日（`setPetLogFinished`，不能早於購買日；已用完的顯示「✅ 用完於 … 用了 N 天」，點了可改日期或清空）。概況多「未用完 N 件（最久放了 D 天）」與「平均 N 天用完」（`petUsageStats`）。

## 匯入 JSON 的 skill（Claude app 也能用）

- 七種「貼上匯入」格式（體組成、人的驗血、寵物驗血、水電瓦斯、想吃的店、食譜、裝潢報價）的整理規則放在 **`.claude/skills/cheng-daily-import/`**（`SKILL.md` 判斷是哪一種並列共通規則，`references/*.md` 各一種格式）。這是**唯一的來源**：專案裡的 Claude Code 自動載入；Claude app 用的是同一份打包出來的檔案。
- **打包**：`sh scripts/package-skill.sh` → `dist/cheng-daily-import.skill`（zip，`dist/` 不進 git）。**上傳**：Claude app（網頁／桌面／手機）設定 → Capabilities（功能）→ Skills → 上傳這個檔案；格式有改就重新打包、重新上傳覆蓋。是否能在手機對話使用要看方案與「程式碼執行與檔案建立」有沒有開；用起來 skill 沒有出現的話，到桌面版（含 Cowork）試試，或直接對 Claude 說「用承日常匯入這個 skill」。
- **測試**：上傳後在新對話丟一張體脂計截圖或一張帳單，看它是否直接給出符合格式的 JSON 區塊（而不是開始問你格式）。
- **不會漂移**：回歸檢查會把每個參考檔的範例 JSON 丟給 App 真正的匯入解析程式（`parsePetLabImport`、`parseUtilImport`、`parsePlacesImport`、`parseRecipeImport`，體組成與驗血對照欄位清單）；改了匯入欄位或規則卻忘了改 skill，測試會失敗。

## 輸入框不記憶以前填過的值

- `shared.js` 的 `disableInputHistory()`：每個頁面載入時把所有 `input`／`textarea`／`form` 補上 `autocomplete="off"`（已經自己寫了的、密碼欄不動），之後動態新增的輸入框由 `MutationObserver` 補上，所以**新增欄位不用記得自己加**。瀏覽器輸入框下方「以前填過的值」的下拉就不會再出現。
- `<datalist>`（食譜的標籤建議、寵物驗血的項目名稱）是刻意提供的建議，不受影響，仍然會出現。

## 食譜頁的「想吃的店」分頁

- 食譜頁有兩個分頁：「食譜」「想吃的店」（導覽那顆圖示叫「飲食」；分頁記在 localStorage `foodTab`）。`places.js` 由 `recipes.js` 的 `loadPageData` 呼叫 `loadPlaces()`（讀不到不影響食譜）。
- 新增只要店名（「更多欄位」收合、國家預設台灣）；平常看**想去**，可切換去過了／全部。篩選：搜尋（店名、餐點、備註、標籤、地區）＋國家→縣市→區域**連動**（只列有資料的；只有一個國家時不顯示國家那層）＋標籤。
- 卡片：地區、標籤、特色餐點、備註；「📍 地圖」（有 `mapUrl` 才有）、「🔗 來源」；「去過了」開小視窗填日期、評分、心得（已去過的顯示星星與心得，可改回想去）。
- **🎲 今天吃什麼**：在目前篩選出來的「想去」裡隨機挑一家（盡量不連續抽到同一家），可再抽。
- 批次匯入在新增彈窗最上面（貼 JSON、檢查、確認新增幾家／補充幾家後一次送出；格式見 CLAUDE.md）。

## 送出中的防重複

- 表單送出時 `setFormBusy(form, true)` 會鎖住所有控制項、送出鈕變「處理中…」，並在表單上標 `data-busy="1"`。**就算別的程式把送出鈕改回可按**（例如剛好完成的資料載入重畫畫面，順手呼叫 `updateXxxValidity` 把它重新點亮），也不會重複送出：`shared.js` 在 document 的 capture 階段攔下 busy 表單的 `submit`（`blockBusySubmit`，連 Enter 也擋），CSS `form[data-busy="1"] button` 也讓它不能點、看起來是停用的。寫入請求本來就會在前端排隊（`api()` 的 `writeChain`），所以沒有這層保護時，連按幾次會排成好幾筆重複的寫入。
- 列表項目的操作用 `withRowLock`（鎖在資料上，重畫後仍然有效）。

## 全站功能導覽

- 定義只有一份：`shared.js` 的 `APP_NAV`（首頁、健康、帳單、寵物、食譜）；每個頁面的 `<body data-page="…">` 告訴它現在在哪一頁。**首頁**的表頭是只有圖示的一排（清單、健康、帳單、寵物、食譜、登出，`#navIcons` 由 `initAppNav` 填入）；**其他頁面**在表頭下面多一列「圖示＋文字」的導覽（`.app-nav`，貼在畫面上方不隨頁面捲走），目前這一頁反白。取代了以前每頁的「← 返回」。
- **新增頁面**：在 `APP_NAV` 加一筆（key、href、label、圖示 svg）、該頁 `<body>` 加 `data-page`，所有頁面就同步多一個入口。回歸檢查會確認 5 個頁面都有 `data-page`、`APP_NAV` 的每個連結都指到存在的檔案。
- 首頁寵物圖示上的「待登記」紅點（`petPendingDot`）也是由導覽產生，件數由 `app.js` 的 `refreshPetPending` 更新（只有首頁會算）。

## 水電瓦斯卡片的版面（帳單頁）

- 在「帳單紀錄」**上面**（年度圖表之後；帳單紀錄會一直變長，放下面會被推到看不到），三個切換（水費／電費／瓦斯，記在 localStorage `utilType`）、每月均攤趨勢圖（`drawTimeChart`，**預設只畫最近 6 期（雙月一期＝一年），資料超過時圖下方有「顯示全部 N 期」切換**，tooltip 顯示原金額、用量與月數；**有填用量的類型多一排切換：月均金額（金額÷計費月數）／月均用量（用量÷計費月數）／每度單價（金額÷用量）**；「月均」就是把一期帳單攤到每個月，兩個月一期的和一個月一期的才比得起來）、摘要（最近一期、比前一期、最近 6 期平均）、**年對年表**（`utilYoY`：跟著目前的切換——月均金額／月均用量／每度單價——列出最近 6 期裡找得到去年同月的每一期，今年、去年、變化 ▲▼%，▲橘色、▼綠色只是方向不評好壞；沒有去年同期的期別不列）、帳單列表（最近 12 筆，更早的按鈕展開）。新增／編輯同一個彈窗 `#utilModal`；換類型時新增會帶入常見月數（三種預設都是 2 個月）。彈窗最上面有「批次貼上匯入（歷史帳單）」：貼 JSON、檢查通過、確認筆數後一次送出（`addUtilityBills`，全部驗證過才寫、同類型同月份＝更新、批次內重複或有任何壞資料整批不寫；格式見 CLAUDE.md）。程式在 `utilities.js`，由 `bills.js` 的 `loadPageData` 呼叫 `loadUtilityBills()`（水電瓦斯讀不到不影響信用卡帳單）。

## 事件／循環行程的新增與編輯（彈窗）

**約定：多欄位的實體（事件、循環行程）用彈窗新增與編輯；單欄快速輸入（待辦、購物清單）留在列表上；健康與帳單頁的表單不動。**

- 事件：「今日事件」標題旁的 ＋ 新增（日期預設是目前選的那天）；點列表裡的一筆編輯、刪除（要確認）。**事件對象是寵物時，視窗會多一個「要登記到寵物紀錄嗎？」勾選**（勾了出現類型與金額）：存事件的同一個請求裡一起寫進 PetLog（後端 `addEventWithPetLog_`／`updateEventWithPetLog_`，先驗證再寫、PetLog 的 `sourceEventId`＝事件 id，同一個事件只會登記一次）；**還沒到的日期（預約）不能勾**，發生之後編輯那個事件再勾。**寵物的循環行程**在當天（或之前的日子）那一列多一顆「🐾 記到寵物紀錄」，開小視窗選類型／金額後記一筆（`sourceEventId`＝`rec_規則id_日期`，同一次不會記兩遍）。事件視窗已經沒有「花費」與「只記帳」欄位（寵物的購買／就醫花費改記在寵物頁的 PetLog）；`Events` 的 `amount`、`hideFromCalendar` 欄位仍保留、既有資料照舊生效（`hideFromCalendar=true` 的事件仍不顯示在行事曆與 LINE），編輯舊事件時前端會把原值原樣帶回去（不然後端會當成清空）。首頁的花費統計卡片已經移除（逐筆記帳不做：刷卡等最後都進信用卡帳單，重複記、對不起來）。
- 循環行程：標題旁 ＋ 新增；點列表那一列、或點「今日事件」裡的循環行程，開編輯視窗。**編輯 = 改整條規則，之後每一次都變**（過去的不重算）；從當日事件點進來時多一顆「只跳過這一次」。不支援「只改某一次」。
- 後端 `updateEvent`、`updateRecurringEvent` 依表頭名稱只改傳進來的欄位（`updateRowByHeaders_`），驗證跟新增一樣（驗證不過整筆不寫）；寫入後標記待同步，Google 行事曆沿用對帳（key 不變 → 更新，不是刪掉重建）。
- 錯誤顯示在視窗裡（Toast 的層級比視窗低會被蓋住）。視窗的 HTML 在 `index.html`（`#eventModal`、`#recurringModal`），邏輯在 `app.js` 的「事件／循環行程 編輯視窗」。
- 列表上不再有 💰、✕、⏭️、📅 小按鈕；改金額、刪除、跳過都在視窗裡。（`setEventAmount`、`setRecurringEndDate` 後端 action 仍保留，目前沒有網頁入口。）

## 裝潢報價（`renovation.html/js`）

一次性、跨好幾個月的專案：把設計師／廠商的報價單整理成 JSON 貼進來（格式見 `.claude/skills/cheng-daily-import/references/renovation.md`），頁面依商家列出品項，原價、優惠價、小計一目了然，並算出總額。資料有保密需求（商家與金額），**只放 Sheet、要密碼才讀，不要寫進 repo 的靜態檔**。

- 分頁（`ensureSheet` 自動建立，欄位見 `Code.gs` 開頭清單）：`RenoItems`（一個品項一列的現況）、`RenoQuoteLog`（每次報價內容有變就多記一列，不覆蓋＝history；`vendor`／`name` 冗餘存一份，品項刪了紀錄仍看得懂）。
- 價格是**單價**，小計＝數量 × 單價；優惠價沒填 = 沒優惠（用原價）、原價沒填 = 只有成交價；價格可為負數（「整單折讓」這類品項）。統計一律**不含「不買」**。
- 匯入（`importRenoQuote`）依「商家＋品項名稱」比對：沒有就新增（第 1 輪）、價格／數量／單位／備註有變就更新現況並記下一輪、完全沒變略過（前端 `renoImportPlan` 先預覽，跟後端規則一致）。同一商家的名稱兩邊要寫一樣，不然會被當新品項。
- 狀態：報價中／已簽約／已付款／不買（`setRenoStatus`，單項或整家）；總覽有「已簽約＋已付款」、已付、待付。品項後的 ⓘ 看該品項每一輪報價與變動；刪品項連同它的紀錄一起刪，也可整家刪（`deleteRenoItem`／`deleteRenoVendor`）。
- 沒有網頁手動新增／編輯品項（修錯字或改價就重新匯入）。BACKEND 2026-10-21.2。

## 習慣的呈現與連續統計

- **習慣區塊不跟著行事曆選的日期走**：永遠是「今天」；卡片標題列的 ‹ › 可往前補打卡（最多 7 天，`HABIT_BACKFILL_DAYS`），補登時顯示「補登 M/D」、卡片加框並出現提示，按「今天」回來。未來日期前後端都擋（`toggleHabitLog` 丟「還沒到的日期不能打卡」，BACKEND 2026-10-19.1）。
- **習慣細節（ⓘ）**：編輯習慣的視窗有「細節」欄（選填，最多 2000 字，可換行，例如該做到什麼、步驟）；有填的習慣列上會出現 ⓘ，點了開彈窗顯示。細節存在獨立分頁 `HabitNotes`（`habitId | detail | updatedAt`，`ensureSheet` 自動建立，一個習慣一列，清空就刪列；刪習慣時一併刪），前端 `state.habitNotes`，`updateHabit` 多收 `detail`（BACKEND 2026-10-21.1）。
- 每日：左邊 checkbox；🔥 = 目前連續天數，點開看歷史最長、本月完成次數。
- 每週／每月：左邊圓形 `＋`（達標後變 `✓`，再按一次會先確認再歸零）；第二行是「本期圓點（做了幾次／目標幾次）」
  加「最近 6 期長條」（最右邊粗框是目前這一期，全滿 = 達標）；🔥 = 目前連續週數／月數，點 🔥 或長條展開詳情。
  整列不是點擊區，避免誤觸。
- 規則：這一期（今天／本週／本月）還沒達標**不算斷**，從上一期往回數；更早任何一期沒達標才斷。
  程式在 [app.js](app.js) 的 `computeStreak`（每日）與 `computePeriodStreak` / `computePeriodStats` / `getPeriodHistory`（週月）。
- **有特殊行為的習慣**（id 寫死在程式裡，要跟 Sheet 的 Habits 那一列一致）：每日運動挑戰（`CHALLENGE_HABIT_ID`，兩邊都有，抽卡／完成回傳、不能直接勾選）；練字（`PRACTICE_HABIT_ID`，列上多一個「字」連結到 cheng-lingo 字帖頁）；語言練習（`LANG_HABIT_ID`，多一個「語」連結到 cheng-lingo，打卡是手動的）；週活動（`BODY_HABIT_ID`，只在後端）：登記「新的一天」的體組成就自動幫這一週打卡（`addInBodyReading` → `markHabitProgress_`；同一天補填不重複計次，週目標大於 1 時累計到達標為止，不會歸零；仍可手動點）。
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

會檢查數字解析、跳脫、習慣連續天數、公式防護、驗血項目驗證、每一種習慣列都能渲染（刪了變數卻漏改用法會讓登入後整頁讀不出來，畫面顯示成「密碼錯誤」）、登記體組成自動幫週活動打卡的週期與計次（純邏輯，不連網路）。畫面流程要在瀏覽器手動
過一遍：

1. **登入**：輸入錯誤密碼 → 留在登入頁並顯示錯誤、不進畫面；正確密碼 → 進入；按登出 → 回到登入頁，
   重新登入前看不到上一個人的資料、沒有殘留彈窗。（健康頁、帳單頁、首頁都要試）
2. **日期切換**：首頁日曆點另一天、按「今天」→ 待辦、事件跟著換，**習慣不動**（永遠今天）；習慣卡的 ‹ 往前補登，› 不能超過今天，最多 7 天。
3. **匯入**：健康頁驗血、體組成各貼兩份不同的報告 → 第二份不會殘留第一份的數值；貼 `"1,000"` 變 1000；
   無效數字、重複項目會在訊息列出。
4. **寫入衝突**：兩個分頁／裝置同時快速新增、勾選、刪除 → 沒有重複列、沒有勾錯列；輸入以 `=1+1` 開頭的
   文字（待辦、清單、驗血其他項目名稱）→ Sheet 裡原樣顯示成文字，不是 2。

## 未來可以加的東西

需要先做決定才能動工的：

- Google 行事曆第二階段（唯讀讀取 Google 行事曆顯示在 App、公司忙碌／空閒衝突提示）——見上面「同步到 Google 行事曆」

## 時間輸入（24 小時制）

`<input type="time">` 的顯示格式跟著瀏覽器／系統（常是上午／下午 12 小時制），網頁沒辦法強制，所以 `shared.js` 的 `initTimeSelects()` 把頁面上
所有 `type="time"` 換成「時」「分」兩個下拉（00–23、每 5 分鐘），一律 24 小時制；換掉後同 id 的元素仍有 `.value`（`"HH:mm"` 或 `""`），
其他程式照舊用 `.value` 讀寫。舊資料的分鐘不是 5 的倍數（08:32、23:59）時，設定 `.value` 會臨時補一個該分鐘的選項（`data-extra`，下次設值時移除），不然讀回會變空字串、編輯事件只改標題就存成全天事件。新增含時間的輸入欄位時，直接寫 `<input type="time">`，頁面載入時會自動換成這個。
