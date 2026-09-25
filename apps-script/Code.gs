/**
 * Daily Hub 後端。部署方式見 repo 根目錄的 README.md。
 * 這支程式碼要貼到「這個 Google Sheet」綁定的 Apps Script 專案裡，
 * 且需要在「專案設定 > Script Properties」加一個 PASSWORD 屬性。
 *
 * Sheet 需要三個分頁：
 *   Goals  欄位: id | date | text | done | createdAt
 *   Events 欄位: id | date | owner | time | title | notes | createdAt
 *   Pets   欄位: id | date | petName | type | time | location | createdAt
 *
 * 從舊的 pets Google Sheet 搬資料過來：見檔案最下面的 migrateFromPetsSheet()，
 * 在 Apps Script 編輯器上方函式下拉選單選它、手動按一次「執行」，
 * 只會「複製」資料過來，不會動到舊檔案。
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
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
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
 * 一次性搬移用：從舊的 pets Google Sheet 把資料複製過來，不會修改或刪除舊檔案。
 * 使用方式：在 Apps Script 編輯器上方的函式下拉選單選「migrateFromPetsSheet」，
 * 按執行。第一次執行會跳出授權視窗（因為要讀另一份 Sheet），照畫面允許就好。
 * 執行後到「執行項目」/「Logs」看搬了幾筆。
 *
 * 會同時讀「工作表1」（手動輸入/最新資料）跟「log」（手動歸檔的歷史資料）兩個
 * 分頁，兩邊合併搬過來。
 *
 * 分類邏輯：pet 欄位是 "his"/"her" 的，視為個人行程搬去 Events（owner 標成
 * me/wife）；其他（實際寵物名字，例如 咪嚕、林萌）搬去 Pets。
 *
 * 注意：這支只會「新增」，重複執行會重複搬移同一批資料。如果你已經跑過一次、
 * 現在要重新跑修正過的版本，記得先把 Events / Pets 分頁裡先前搬進去的那些列
 * 刪掉（只留標題列），再重新執行。
 */
function migrateFromPetsSheet() {
  var OLD_PETS_SHEET_ID = "1_UFktfGUzYpPCYzxWStE0ZLn7GU8DjMRwS1lDG-h9lI";
  var oldSs = SpreadsheetApp.openById(OLD_PETS_SHEET_ID);
  var rows = sheetToObjects(oldSs.getSheetByName("工作表1")).concat(
    sheetToObjects(oldSs.getSheetByName("log"))
  );

  var eventsSheet = getSheet("Events");
  var petsSheet = getSheet("Pets");

  var eventCount = 0;
  var petCount = 0;

  rows.forEach(function (row) {
    var who = row["pet"];
    var now = new Date();

    if (who === "his" || who === "her") {
      eventsSheet.appendRow([
        Utilities.getUuid(),
        row["date"] || "",
        who === "his" ? "me" : "wife",
        row["時間"] || "",
        row["種類"] || "",
        row["地點"] || "",
        now,
      ]);
      eventCount++;
    } else {
      petsSheet.appendRow([
        Utilities.getUuid(),
        row["date"] || "",
        who || "",
        row["種類"] || "",
        row["時間"] || "",
        row["地點"] || "",
        now,
      ]);
      petCount++;
    }
  });

  Logger.log("搬移完成：Events 新增 " + eventCount + " 筆，Pets 新增 " + petCount + " 筆");
}

/**
 * 一次性補值用：Events 分頁裡 owner 是空白的列，補成 "shared"（代表不確定是誰的/
 * 算共同），不會刪除任何資料。用法跟 migrateFromPetsSheet 一樣：函式下拉選單選
 * 「fillBlankEventOwners」，執行一次即可。
 */
function fillBlankEventOwners() {
  var sheet = getSheet("Events");
  var values = sheet.getDataRange().getValues();
  var ownerCol = 3; // C 欄，1-indexed 給 getRange 用
  var filled = 0;

  for (var i = 1; i < values.length; i++) {
    if (!values[i][ownerCol - 1]) {
      sheet.getRange(i + 1, ownerCol).setValue("shared");
      filled++;
    }
  }

  Logger.log("補值完成：owner 從空白改成 shared 共 " + filled + " 筆");
}
