# cheng-daily（承日常）

個人生活小助手：待辦、習慣、行事曆、健康、帳單、練字。純靜態 HTML/JS（GitHub Pages）+ 單一 Google Apps Script 後端（`apps-script/Code.gs`）+ Google Sheet。完整慣例、部署步驟與回歸檢查見 README.md，改程式前先看一下，這裡只列最容易踩的：

- 每頁先定義 `window.loadPageData` 再呼叫 `initAuth()`；API 一律 POST，不用 GET 寫入。
- 送出期間鎖控制項：表單用 `setFormBusy`，列表項目用 `withRowLock`。`setFormBusy` 另外會標 `data-busy`，`shared.js` 的 capture 階段守門員會擋掉忙碌表單的 submit（即使別的程式——重畫畫面時的 `updateXxxValidity` 之類——把按鈕改回可按，也不會重複送出）；不要在送出期間自己去改送出鈕的 `disabled` 以外的狀態。
- 改了 js/css，commit 前要更新 HTML 的 `?v=`（pre-commit hook 會做；hook 不跟著 repo，新環境先跑 `sh scripts/install-hooks.sh`）。
- 改了 `Code.gs`：要手動貼進 Apps Script 重新部署新版本，並同步 `BACKEND_VERSION` 與 `shared.js` 的 `BACKEND_MIN_VERSION`。
- 新增頁面：在 `shared.js` 的 `APP_NAV` 加一筆並在該頁 `<body>` 加 `data-page`（全站共用導覽；不要每頁自己手寫連結）。
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

## 「貼上匯入」JSON 格式（體組成、驗血、寵物驗血、水電瓦斯、想吃的店、食譜）
使用者傳報告、帳單、截圖、店名、食譜時，要照 App 的匯入格式產出 JSON 給他貼。**格式與規則只有一份來源：`.claude/skills/cheng-daily-import/`**（`SKILL.md` 判斷是哪一種、列共通規則；`references/*.md` 是各種格式）。這個專案裡的 Claude Code 會自動載入它；Claude app 用的是同一份打包成的 `.skill`（`sh scripts/package-skill.sh` 重新打包後上傳）。
- **改了匯入欄位或規則，就改那份 skill**（不要把格式再抄回這個檔案）；回歸檢查會用 App 真正的匯入解析程式驗證 skill 裡的範例 JSON，改了卻漏改會直接失敗。
- 修改後記得提醒 Dean 重新打包上傳 Claude app 的 skill。
