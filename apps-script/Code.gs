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
 * Sheet 需要六個分頁：
 *   Goals           欄位: id | date | text | done | createdAt
 *   Events          欄位: id | date | owner | time | title | notes | createdAt
 *   Habits          欄位: id | name | frequency | workdaysOnly | target | createdAt
 *   HabitLog        欄位: id | habitId | periodKey | count | createdAt
 *   RecurringEvents 欄位: id | owner | title | time | notes | frequency | dayOfWeek | dayOfMonth | endDate | createdAt
 *   ShoppingList    欄位: id | item | done | createdAt
 *
 * Events 的 owner 是 "me" / "wife" / "shared" / 寵物名字（PET_NAMES 陣列裡列的）
 * 其中一個——寵物照護紀錄跟人的行程現在是同一張表，用 owner 分辨這筆是誰的。
 *
 * Habits 是「習慣定義」（例如每天手沖咖啡），frequency 是 daily/weekly/monthly；
 * HabitLog 是實際完成紀錄，periodKey 依 frequency 是當天日期/該週週一日期/該月，
 * 詳細規則見 app.js 的 getPeriodKey()。
 *
 * RecurringEvents 是「固定週期規則」（例如每週三打球、每月15號點藥），跟 Habits
 * 不同的地方是它是「固定哪一天」而不是「這期間做滿幾次」，只存規則本身，不會
 * 預先展開成很多列——實際「今天符不符合」是前端（日曆/當日清單）跟後端
 * （sendDailyNotifications）各自即時算出來的，詳細規則見 app.js 的
 * matchesRecurringRule()。
 *
 * 每日 LINE 通知：sendDailyNotifications()，需要另外設定時間驅動的觸發條件
 * （見 README.md），不會透過網頁前端呼叫。
 *
 * （曾經用過的幾支一次性搬移/整理函式都已經跑完並移除，需要參考的話到 git
 * 歷史紀錄找 migrateFromPetsSheet / fillBlankEventOwners / migratePetsIntoEvents /
 * normalizeEventDates。）
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
      case "addHabit":
        return respond({ ok: true, data: addHabit(p.name, p.frequency, p.workdaysOnly, p.target) });
      case "toggleHabitLog":
        return respond({ ok: true, data: toggleHabitLog(p.habitId, p.periodKey, p.target) });
      case "deleteHabit":
        return respond({ ok: true, data: deleteHabit(p.id) });
      case "addRecurringEvent":
        return respond({
          ok: true,
          data: addRecurringEvent(
            p.owner, p.title, p.time, p.notes, p.frequency, p.dayOfWeek, p.dayOfMonth, p.endDate
          ),
        });
      case "deleteRecurringEvent":
        return respond({ ok: true, data: deleteRecurringEvent(p.id) });
      case "addShoppingItem":
        return respond({ ok: true, data: addShoppingItem(p.item) });
      case "toggleShoppingItem":
        return respond({ ok: true, data: toggleShoppingItem(p.id) });
      case "deleteShoppingItem":
        return respond({ ok: true, data: deleteShoppingItem(p.id) });
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
    habits: sheetToObjects(getSheet("Habits")),
    habitLogs: sheetToObjects(getSheet("HabitLog")),
    recurringEvents: sheetToObjects(getSheet("RecurringEvents")),
    shoppingList: sheetToObjects(getSheet("ShoppingList")),
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

function addRecurringEvent(owner, title, time, notes, frequency, dayOfWeek, dayOfMonth, endDate) {
  var sheet = getSheet("RecurringEvents");
  sheet.appendRow([
    Utilities.getUuid(),
    owner || "",
    title,
    time || "",
    notes || "",
    frequency,
    dayOfWeek === undefined || dayOfWeek === "" ? "" : parseInt(dayOfWeek, 10),
    dayOfMonth === undefined || dayOfMonth === "" ? "" : parseInt(dayOfMonth, 10),
    endDate || "",
    new Date(),
  ]);
  return getData();
}

function deleteRecurringEvent(id) {
  var sheet = getSheet("RecurringEvents");
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return getData();
}

function addShoppingItem(item) {
  var sheet = getSheet("ShoppingList");
  sheet.appendRow([Utilities.getUuid(), item, false, new Date()]);
  return getData();
}

function toggleShoppingItem(id) {
  var sheet = getSheet("ShoppingList");
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      sheet.getRange(i + 1, 3).setValue(!values[i][2]);
      break;
    }
  }
  return getData();
}

function deleteShoppingItem(id) {
  var sheet = getSheet("ShoppingList");
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return getData();
}

function addHabit(name, frequency, workdaysOnly, target) {
  var sheet = getSheet("Habits");
  var finalTarget = frequency === "daily" ? 1 : (parseInt(target, 10) || 1);
  sheet.appendRow([
    Utilities.getUuid(),
    name,
    frequency,
    workdaysOnly === "true" || workdaysOnly === true,
    finalTarget,
    new Date(),
  ]);
  return getData();
}

function deleteHabit(id) {
  var sheet = getSheet("Habits");
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return getData();
}

function toggleHabitLog(habitId, periodKey, target) {
  var sheet = getSheet("HabitLog");
  var values = sheet.getDataRange().getValues();
  var maxTarget = parseInt(target, 10) || 1;

  for (var i = 1; i < values.length; i++) {
    if (values[i][1] === habitId && String(values[i][2]) === String(periodKey)) {
      var next = (Number(values[i][3]) || 0) + 1;
      if (next > maxTarget) next = 0;
      sheet.getRange(i + 1, 4).setValue(next);
      return getData();
    }
  }

  sheet.appendRow([Utilities.getUuid(), habitId, periodKey, 1, new Date()]);
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

  var todayDate = new Date(todayStr + "T00:00:00");
  var recurringToday = sheetToObjects(getSheet("RecurringEvents"))
    .filter(function (r) { return matchesRecurringRule_(r, todayStr, todayDate); })
    .map(function (r) {
      return { date: todayStr, owner: r.owner, time: r.time, title: r.title, notes: r.notes };
    });
  events = events.concat(recurringToday);

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

function matchesRecurringRule_(rule, dateStr, dateObj) {
  if (rule.endDate && dateStr > rule.endDate) return false;
  if (rule.frequency === "weekly") {
    return dateObj.getDay() === Number(rule.dayOfWeek);
  }
  if (rule.frequency === "monthly") {
    return dateObj.getDate() === Number(rule.dayOfMonth);
  }
  return false;
}

function formatEventLine_(e) {
  var isPet = PET_NAMES.indexOf(e.owner) !== -1;
  var line = (isPet ? "🐾 " + e.owner + "：" : "📅 ") + (e.title || "");
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
