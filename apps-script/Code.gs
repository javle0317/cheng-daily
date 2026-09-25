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
 * Sheet 需要三個分頁：
 *   Goals  欄位: id | date | text | done | createdAt
 *   Events 欄位: id | date | owner | time | title | notes | createdAt
 *   Pets   欄位: id | date | petName | type | time | location | createdAt
 *
 * 每日 LINE 通知：sendDailyNotifications()，需要另外設定時間驅動的觸發條件
 * （見 README.md），不會透過網頁前端呼叫。
 *
 * （從舊 pets Sheet 搬資料、補 owner 空值的一次性函式已經跑完並移除，
 * 需要時可以到 git 歷史紀錄找回來。）
 */

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
      if (v instanceof Date) {
        v = Utilities.formatDate(v, TIME_ZONE, "yyyy-MM-dd");
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
    pets: sheetToObjects(getSheet("Pets")),
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
 *   - Pets 分頁今天的紀錄 + Events 分頁 owner="shared" 的今天行程 → 一起發給你們兩人
 *   - Events 分頁 owner="me" 今天的行程 → 只發給你
 *   - Events 分頁 owner="wife" 今天的行程 → 只發給太太
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
  var allPets = sheetToObjects(getSheet("Pets"));
  var allEvents = sheetToObjects(getSheet("Events"));

  // 暫時除錯用：確認完問題後可以整段刪掉
  Logger.log("todayStr = [" + todayStr + "]");
  Logger.log("Pets 分頁的 date 值: " + JSON.stringify(allPets.map(function (p) { return p.date; })));
  Logger.log("Events 分頁的 date 值: " + JSON.stringify(allEvents.map(function (e) { return e.date; })));

  var pets = allPets.filter(function (p) {
    return p.date === todayStr;
  });
  var events = allEvents.filter(function (e) {
    return e.date === todayStr;
  });

  var petLines = pets.map(formatPetLine_);
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

function formatPetLine_(p) {
  var line = "🐾 " + (p.petName || "") + "：" + (p.type || "");
  if (p.time) line += "\n   ⏰ 時間：" + p.time;
  if (p.location) line += "\n   📍 地點：" + p.location;
  return line;
}

function formatEventLine_(e) {
  var line = "📅 " + (e.title || "");
  if (e.time) line += "\n   ⏰ 時間：" + e.time;
  if (e.notes) line += "\n   📍 " + e.notes;
  return line;
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
