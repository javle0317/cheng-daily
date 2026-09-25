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

| id | name | frequency | workdaysOnly | target | active | createdAt |
|----|------|-----------|--------------|--------|--------|-----------|

- `frequency`：`daily` / `weekly` / `monthly`
- `workdaysOnly`：`TRUE`/`FALSE`，只有 `daily` 會用到（`TRUE` 代表週末不出現，
  工作日固定當週一到週五，不處理請假/國定假日例外）
- `target`：目標次數，`daily` 固定是 1；`weekly`/`monthly` 是建立當下設定的固定值，
  之後想改用手動去 Sheet 改這一格
- `active`：`TRUE`/`FALSE`，要停用某個習慣但保留歷史紀錄的話手動改這格成 `FALSE`

**HabitLog**（習慣的完成紀錄）

| id | habitId | periodKey | count | createdAt |
|----|---------|-----------|-------|-----------|

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

**RecurringEvents**（固定週期規則，例如「每週三打球」「每月15號幫咪嚕點藥」）

| id | owner | title | time | notes | frequency | dayOfWeek | dayOfMonth | active | createdAt |
|----|-------|-------|------|-------|-----------|-----------|------------|--------|-----------|

- `frequency`：`weekly` / `monthly`
- `dayOfWeek`：0-6（0=日、1=一...6=六），只有 `weekly` 用得到
- `dayOfMonth`：1-31，只有 `monthly` 用得到
- `owner`：跟 Events 一樣的值域
- 只存規則本身，不會預先展開成很多列——前端跟 `sendDailyNotifications` 都是
  即時判斷「今天符不符合」，改規則不用擔心舊資料沒同步，但也代表**沒有「跳過
  這一次」的例外功能**，只能整條規則停用或刪除

**ShoppingList**（購物清單，不綁日期、買了就勾掉）

| id | item | done | createdAt |
|----|------|------|-----------|

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
（例如 `https://<你的帳號>.github.io/<repo 名稱>/`）。

## 密碼保護的原理

前端不會做假的驗證邏輯（那種在瀏覽器看原始碼就能繞過）。所有讀寫都要帶密碼呼叫
Apps Script，密碼比對在 Apps Script 這一端做，沒有正確密碼就完全拿不到資料。
Repo 本身建議設為 Private，這樣專案不會出現在你的 GitHub 個人頁面或被搜尋到，
但 GitHub Pages 產生的網址本身還是任何人拿到連結都能打開，密碼是實際擋人的那一關。

## 未來可以加的東西

- 習慣支援編輯/停用的頁面 UI（目前要停用一個習慣得手動去 Habits 分頁把 `active`
  改成 `FALSE`）
- 每週/每月目標的次數改成新增當下可調整以外，還能事後編輯
- 工作日判斷加入請假/國定假日例外（目前固定週一到週五）
- 重複規則行程支援「跳過這一次」的例外，目前只能整條規則停用/刪除
