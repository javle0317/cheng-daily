/**
 * Daily Hub 後端。部署方式見 repo 根目錄的 README.md。
 * 這支程式碼要貼到「這個 Google Sheet」綁定的 Apps Script 專案裡，
 * 且需要在「專案設定 > Script Properties」加一個 PASSWORD 屬性。
 *
 * Sheet 需要兩個分頁：
 *   Goals  欄位: id | date | text | done | createdAt
 *   Events 欄位: id | date | time | title | notes | createdAt
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
        return respond({ ok: true, data: addEvent(p.date, p.time, p.title, p.notes) });
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
      obj[h] = row[i];
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

function addEvent(date, time, title, notes) {
  var sheet = getSheet("Events");
  sheet.appendRow([Utilities.getUuid(), date, time, title, notes, new Date()]);
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
