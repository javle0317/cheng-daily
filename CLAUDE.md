# cheng-daily（承日常）

個人生活小助手：待辦、習慣、行事曆、健康、帳單、練字。純靜態 HTML/JS（GitHub Pages）+ 單一 Google Apps Script 後端（`apps-script/Code.gs`）+ Google Sheet。完整慣例、部署步驟與回歸檢查見 README.md，改程式前先看一下，這裡只列最容易踩的：

- 每頁先定義 `window.loadPageData` 再呼叫 `initAuth()`；API 一律 POST，不用 GET 寫入。
- 送出期間鎖控制項：表單用 `setFormBusy`，列表項目用 `withRowLock`。
- 改了 js/css，commit 前要更新 HTML 的 `?v=`（pre-commit hook 會做；hook 不跟著 repo，新環境先跑 `sh scripts/install-hooks.sh`）。
- 改了 `Code.gs`：要手動貼進 Apps Script 重新部署新版本，並同步 `BACKEND_VERSION` 與 `shared.js` 的 `BACKEND_MIN_VERSION`。
- 純邏輯有回歸檢查：`node scripts/regression-check.js`。
- 本機預覽：`python3 -m http.server 8791`（`.claude/launch.json`）。

## 與 cheng-lingo 的關係
姊妹專案在 `../cheng-lingo`（英日語練習，獨立 Sheet / Apps Script，網址 https://javle0317.github.io/cheng-lingo/）。計畫中：
- 習慣列新增語言練習：抽卡、顯示今天的卡、「去練習 →」連到 lingo，並同步完成狀態。仿運動挑戰（`drawChallenge`、`setupChallengeRow`）。
- daily 的 Apps Script 以指令碼屬性 `LANG_URL` / `LANG_TOKEN` 呼叫 lingo 後端（lingo 端屬性叫 `LINGO_TOKEN`，兩邊同一串）。
- 字帖（`practice*.js`、`data/copybook-seed.json`）之後搬到 lingo，並加日文。
- 食譜留在這個專案（`recipes.html/js` + Sheet 分頁），尚未開始。
- 完整計畫：`~/.claude/plans/sideproject-cheng-daily-github-dazzling-catmull.md`。
