# Daily Hub

一頁式每日目標 / 行事曆看板。純靜態前端（GitHub Pages），資料存在 Google Sheet，
用 Google Apps Script 當輕量後端做密碼驗證與讀寫。

## 部署步驟

### 1. 建立 Google Sheet

新增一個 Google Sheet，建立三個分頁：

**Goals**

| id | date | text | done | createdAt |
|----|------|------|------|-----------|

**Events**

| id | date | owner | time | title | notes | createdAt |
|----|------|-------|------|-------|-------|-----------|

`owner` 是 `me` / `wife` / `shared` 其中一個，用來標記是誰的行程。

**Pets**

| id | date | petName | type | time | location | createdAt |
|----|------|---------|------|------|----------|-----------|

第一列填欄位名稱（跟上面一樣），下面留空即可。

### 從舊的 pets Google Sheet 搬資料

如果你原本有一份單獨的 pets Google Sheet（寵物照護紀錄 + his/her 個人行程混在一起），
把 `apps-script/Code.gs` 貼好、Goals/Events/Pets 三個分頁都建立好之後：

1. 在 Apps Script 編輯器上方的函式下拉選單，選 **`migrateFromPetsSheet`**
2. 按執行（第一次會跳出授權視窗，因為要讀另一份 Sheet，照畫面允許即可）
3. 執行完到「執行項目」（Executions）看 log，確認搬了幾筆
4. 這個函式只會「複製」資料過來，**不會動到舊的 pets Sheet**，原本的 LINE 每日通知
   可以繼續正常運作，等之後把通知功能也搬過來、確認新架構都沒問題後，再自己決定
   要不要清理舊檔案

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

- 目標支援「計數/百分比」等不同進度類型，不只是打勾完成
- Google Sheet 再拆更多分頁（例如習慣追蹤），Apps Script 只要多加 action 對應新分頁
- 頁面上直接新增/編輯 Pets 紀錄（目前只有唯讀顯示）
