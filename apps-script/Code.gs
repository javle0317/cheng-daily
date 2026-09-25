/**
 * Daily Hub 後端。部署方式見 repo 根目錄的 README.md。
 * 這支程式碼要貼到「這個 Google Sheet」綁定的 Apps Script 專案裡。
 *
 * 「專案設定 > Script Properties」需要這幾個屬性（值都不寫進程式碼/repo）：
 *   PASSWORD       - 網頁前端的密碼
 *   LINE_TOKEN     - LINE Messaging API 的 channel access token
 *   LINE_MY_ID     - 你的 LINE 使用者 ID
 *   LINE_WIFE_ID   - 太太的 LINE 使用者 ID
 *
 * Sheet 需要兩個分頁：
 *   Goals  欄位: id | date | text | done | createdAt
 *   Events 欄位: id | date | owner | time | title | notes | createdAt
 *
 * Events 的 owner 是 "me" / "wife" / "shared" / 寵物名字（PET_NAMES 陣列裡列的）
 * 其中一個——寵物照護紀錄跟人的行程現在是同一張表，用 owner 分辨這筆是誰的。
 *
 * 每日 LINE 通知：sendDailyNotifications()，需要另外設定時間驅動的觸發條件
 * （見 README.md），不會透過網頁前端呼叫。
 *
 * （從舊 pets Sheet 搬資料、補 owner 空值的一次性函式已經跑完並移除，
 * 需要時可以到 git 歷史紀錄找回來。）
 */

var PET_NAMES = ["林萌", "咪嚕"]; // 之後又養新寵物，這裡加名字就好

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    var p = (e && e.parameter) || {};
    var stored = PropertiesService.getScriptProperties().getProperty("PASSWORD");
    if (!stored || p.password !== stored) {
      return respond({ ok: false, error: "unauthorized" });
    }

    switch (p.action) {
      case "getData":
        return respond({ ok: true, data: getData() });
      case "addGoal":
        return respond({ ok: true, data: addGoal(p.date, p.text) });
      case "toggleGoal":
        return respond({ ok: true, data: toggleGoal(p.id) });
      case "deleteGoal":
        return respond({ ok: true, data: deleteGoal(p.id) });
      case "addEvent":
        return respond({ ok: true, data: addEvent(p.date, p.time, p.title, p.notes, p.owner) });
      case "deleteEvent":
        return respond({ ok: true, data: deleteEvent(p.id) });
      default:
        return respond({ ok: false, error: "unknown action" });
    }
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

var TIME_ZONE = "Asia/Taipei"; // 寫死，不依賴這個 Apps Script 專案本身的時區設定

function getSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("找不到分頁: " + name);
  return sheet;
}

function sheetToObjects(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  return values.map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) {
      var v = row[i];
      if (Object.prototype.toString.call(v) === "[object Date]") {
        if (h === "time") {
          v = Utilities.formatDate(v, TIME_ZONE, "HH:mm");
        } else if (h === "date") {
          v = Utilities.formatDate(v, TIME_ZONE, "yyyy-MM-dd");
        } else {
          v = Utilities.formatDate(v, TIME_ZONE, "yyyy-MM-dd HH:mm:ss");
        }
      }
      obj[h] = v;
    });
    return obj;
  });
}

function getData() {
  return {
    goals: sheetToObjects(getSheet("Goals")),
    events: sheetToObjects(getSheet("Events")),
  };
}

function addGoal(date, text) {
  var sheet = getSheet("Goals");
  sheet.appendRow([Utilities.getUuid(), date, text, false, new Date()]);
  return getData();
}

function toggleGoal(id) {
  var sheet = getSheet("Goals");
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      sheet.getRange(i + 1, 4).setValue(!values[i][3]);
      break;
    }
  }
  return getData();
}

function deleteGoal(id) {
  var sheet = getSheet("Goals");
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return getData();
}

function addEvent(date, time, title, notes, owner) {
  var sheet = getSheet("Events");
  sheet.appendRow([Utilities.getUuid(), date, owner || "", time, title, notes, new Date()]);
  return getData();
}

function deleteEvent(id) {
  var sheet = getSheet("Events");
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return getData();
}

/**
 * 每日 LINE 通知。需要另外設定時間驅動的觸發條件才會自動每天跑
 * （Apps Script 編輯器左側時鐘圖示「觸發條件」→ 新增觸發條件 → 選這個函式 →
 * 時間驅動 → 日計時器 → 選時段），見 README.md。
 *
 * 邏輯：
 *   - owner 是寵物名字（PET_NAMES）或 "shared" 的今天行程 → 一起發給你們兩人
 *   - owner="me" 的今天行程 → 只發給你
 *   - owner="wife" 的今天行程 → 只發給太太
 */
function sendDailyNotifications() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("LINE_TOKEN");
  var myId = props.getProperty("LINE_MY_ID");
  var wifeId = props.getProperty("LINE_WIFE_ID");

  if (!token || !myId || !wifeId) {
    Logger.log("LINE 設定不完整，請確認 Script Properties 有 LINE_TOKEN / LINE_MY_ID / LINE_WIFE_ID");
    return;
  }

  var todayStr = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
  var events = sheetToObjects(getSheet("Events")).filter(function (e) {
    return e.date === todayStr;
  });

  var petLines = events
    .filter(function (e) { return PET_NAMES.indexOf(e.owner) !== -1; })
    .map(formatEventLine_);
  var sharedLines = events
    .filter(function (e) { return e.owner === "shared"; })
    .map(formatEventLine_);
  var meLines = events
    .filter(function (e) { return e.owner === "me"; })
    .map(formatEventLine_);
  var wifeLines = events
    .filter(function (e) { return e.owner === "wife"; })
    .map(formatEventLine_);

  var header = "【每日提醒】\n日期：" + todayStr + "\n\n";

  var sharedAll = petLines.concat(sharedLines);
  if (sharedAll.length > 0) {
    var sharedMsg = header + sharedAll.join("\n\n");
    [myId, wifeId].forEach(function (id) {
      sendLinePush_(token, id, sharedMsg);
    });
  }

  if (meLines.length > 0) {
    sendLinePush_(token, myId, "【個人提醒】\n日期：" + todayStr + "\n\n" + meLines.join("\n\n"));
  }

  if (wifeLines.length > 0) {
    sendLinePush_(token, wifeId, "【個人提醒】\n日期：" + todayStr + "\n\n" + wifeLines.join("\n\n"));
  }
}

function formatEventLine_(e) {
  var isPet = PET_NAMES.indexOf(e.owner) !== -1;
  var line = (isPet ? "🐾 " + e.owner + "：" : "📅 ") + (e.title || "");
  if (e.time) line += "\n   ⏰ 時間：" + e.time;
  if (e.notes) line += "\n   📍 " + e.notes;
  return line;
}

/**
 * 一次性搬移用：把 Pets 分頁的資料併進 Events（owner 填寵物名字），
 * 只會「複製」，不會刪除或修改 Pets 分頁。搬完自己確認 Events 資料沒問題後，
 * 再自己決定要不要把 Pets 分頁刪掉。用法跟之前的搬移函式一樣：函式下拉選單選
 * 「migratePetsIntoEvents」，執行一次。
 */
function migratePetsIntoEvents() {
  var petsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Pets");
  if (!petsSheet) {
    Logger.log("找不到 Pets 分頁，可能已經刪掉了，不用再搬一次");
    return;
  }

  var pets = sheetToObjects(petsSheet);
  var eventsSheet = getSheet("Events");
  var count = 0;

  pets.forEach(function (p) {
    eventsSheet.appendRow([
      Utilities.getUuid(),
      p.date || "",
      p.petName || "",
      p.time || "",
      p.type || "",
      p.location || "",
      new Date(),
    ]);
    count++;
  });

  Logger.log("搬移完成：Events 新增 " + count + " 筆寵物紀錄");
}

/**
 * 一次性整理用：把 Events 分頁的 date 欄統一成純文字 "yyyy-MM-dd"，並把整欄設成
 * 純文字格式，避免之後 Sheets 又自動把某些列轉成日期型別、某些列不轉，兩種格式
 * 混在一起造成比對失敗。用法跟其他一次性函式一樣：函式下拉選單選
 * 「normalizeEventDates」，執行一次。
 */
function normalizeEventDates() {
  var sheet = getSheet("Events");
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var range = sheet.getRange(2, 2, lastRow - 1, 1); // B 欄，跳過標題列
  var values = range.getValues();
  var fixed = 0;

  for (var i = 0; i < values.length; i++) {
    var v = values[i][0];
    var normalized = normalizeDateValue_(v);
    if (normalized !== null && normalized !== v) {
      values[i][0] = normalized;
      fixed++;
    }
  }

  range.setNumberFormat("@"); // 整欄設成純文字，避免之後又被自動轉成日期型別
  range.setValues(values);

  Logger.log("日期格式統一完成，修正了 " + fixed + " 筆");
}

function normalizeDateValue_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, TIME_ZONE, "yyyy-MM-dd");
  }
  if (typeof v !== "string") return null;

  var s = v.trim();

  // 標準 2026-9-26 或 2026/9/26 這種有分隔符號的
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  }

  // 像 2026/0720 這種缺一個斜線的舊資料（年/月日黏在一起）
  m = s.match(/^(\d{4})\/(\d{2})(\d{2})$/);
  if (m) {
    return m[1] + "-" + m[2] + "-" + m[3];
  }

  return null; // 看不懂的格式，不動它，留著自己手動檢查
}

function sendLinePush_(token, userId, text) {
  var options = {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: text }],
    }),
  };
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", options);
}
