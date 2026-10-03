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
 *   Events          欄位: id | date | owner | time | title | notes | createdAt | amount | hideFromCalendar
 *   Habits          欄位: id | name | frequency | workdaysOnly | target | createdAt
 *   HabitLog        欄位: id | habitId | periodKey | count | createdAt | exercise | synced
 *                   （exercise/synced 只有「每日運動挑戰」那個習慣會用到，其他習慣留空）
 *   RecurringEvents 欄位: id | owner | title | time | notes | frequency | dayOfWeek | dayOfMonth | createdAt | endDate（選填，yyyy-MM-dd，含當天；空白=無限期）
 *   RecurringExceptions 欄位: id | recurringId | date | createdAt
 *   ShoppingList    欄位: id | item | done | createdAt | category（shopping/idea，空白視為 shopping）
 *   BloodPressure   欄位: id | date | period | systolic | diastolic | pulse | createdAt
 *   InBody          欄位: id | date | weight | height | bmi | bodyFat | fatMass | skeletalMuscle | muscleMass |
 *                         bodyWater | protein | bmr | visceralFat | bodyAge | whr | createdAt
 *   LabResults      欄位: id | date | glucose | hba1c | cholesterol | ldl | hdl | triglyceride | ast | alt |
 *                         creatinine | egfr | uricAcid | tsh | ck | bun | sodium | potassium | createdAt（除 date 外都可留空）
 *   LabExtra        欄位: id | date | name | value | unit | refLow | refHigh | createdAt
 *                         （驗血「其他項目」：報告上有、LabResults 沒列的項目，一個項目一列，自帶報告參考範圍）
 *   CreditCardBills 欄位: id | bank | billingMonth | date | fullAmount | lowestAmount | paidAmount | createdAt
 *
 * Events 的 owner 是 "me" / "wife" / "shared" / 寵物名字（PET_NAMES 陣列裡列的）
 * 其中一個——寵物照護紀錄跟人的行程現在是同一張表，用 owner 分辨這筆是誰的。
 * amount 是選填的花費金額（任何 owner 的事件都可以填，跟顯不顯示在行事曆無關）；
 * hideFromCalendar 是 boolean，true 代表這筆只是記帳用途、不該出現在行事曆/
 * 每日 LINE 提醒（例如買貓砂），預設 false。
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
 * 台灣國定假日：getHolidays_() 讀 Google 內建的公開行事曆（不用自己維護清單），
 * 供前端 isWorkday() 判斷 workdaysOnly 的習慣要不要排除假日。第一次存檔或部署
 * 時會跳出要求授權 Calendar 讀取權限的視窗，允許即可。
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
        return respond({
          ok: true,
          data: addEvent(p.date, p.time, p.title, p.notes, p.owner, p.amount, p.hideFromCalendar),
        });
      case "deleteEvent":
        return respond({ ok: true, data: deleteEvent(p.id) });
      case "setEventAmount":
        return respond({ ok: true, data: setEventAmount(p.id, p.amount) });
      case "addHabit":
        return respond({ ok: true, data: addHabit(p.name, p.frequency, p.workdaysOnly, p.target) });
      case "drawChallenge":
        return respond({ ok: true, data: drawChallenge() });
      case "completeChallenge":
        return respond({ ok: true, data: completeChallenge() });
      case "toggleHabitLog":
        return respond({ ok: true, data: toggleHabitLog(p.habitId, p.periodKey, p.target) });
      case "updateHabit":
        return respond({ ok: true, data: updateHabit(p.id, p.name, p.workdaysOnly, p.target) });
      case "deleteHabit":
        return respond({ ok: true, data: deleteHabit(p.id) });
      case "addRecurringEvent":
        return respond({
          ok: true,
          data: addRecurringEvent(
            p.owner, p.title, p.time, p.notes, p.frequency, p.dayOfWeek, p.dayOfMonth, p.endDate
          ),
        });
      case "setRecurringEndDate":
        return respond({ ok: true, data: setRecurringEndDate(p.id, p.endDate) });
      case "deleteRecurringEvent":
        return respond({ ok: true, data: deleteRecurringEvent(p.id) });
      case "addRecurringException":
        return respond({ ok: true, data: addRecurringException(p.recurringId, p.date) });
      case "deleteRecurringException":
        return respond({ ok: true, data: deleteRecurringException(p.id) });
      case "addShoppingItem":
        return respond({ ok: true, data: addShoppingItem(p.item, p.category) });
      case "toggleShoppingItem":
        return respond({ ok: true, data: toggleShoppingItem(p.id) });
      case "clearDoneShoppingItems":
        return respond({ ok: true, data: clearDoneShoppingItems(p.category) });
      case "deleteShoppingItem":
        return respond({ ok: true, data: deleteShoppingItem(p.id) });
      case "getBloodPressureData":
        return respond({ ok: true, data: getBloodPressureData() });
      case "addBloodPressureReading":
        return respond({
          ok: true,
          data: addBloodPressureReading(p.date, p.period, p.systolic, p.diastolic, p.pulse),
        });
      case "deleteBloodPressureReading":
        return respond({ ok: true, data: deleteBloodPressureReading(p.id) });
      case "getInBodyData":
        return respond({ ok: true, data: getInBodyData() });
      case "addInBodyReading":
        return respond({ ok: true, data: addInBodyReading(p) });
      case "deleteInBodyReading":
        return respond({ ok: true, data: deleteInBodyReading(p.id) });
      case "getLabData":
        return respond({ ok: true, data: getLabData() });
      case "addLabEntry":
        return respond({ ok: true, data: addLabEntry(p) });
      case "deleteLabDay":
        return respond({ ok: true, data: deleteLabDay(p.date) });
      case "getCreditCardBills":
        return respond({ ok: true, data: getCreditCardBills() });
      case "addCreditCardBill":
        return respond({
          ok: true,
          data: addCreditCardBill(p.bank, p.billingMonth, p.date, p.fullAmount, p.lowestAmount),
        });
      case "setCreditCardBillPaid":
        return respond({ ok: true, data: setCreditCardBillPaid(p.id, p.paidAmount) });
      case "deleteCreditCardBill":
        return respond({ ok: true, data: deleteCreditCardBill(p.id) });
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

// Google 內建的台灣國定假日公開行事曆，不用自己維護清單。只抓國定假日本身，
// 不處理補班日（目前 workdaysOnly 的需求只要排除假日就好）。
var HOLIDAY_CALENDAR_ID = "zh-tw.taiwan#holiday@group.v.calendar.google.com";

function getHolidays_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("holidays");
  if (cached) return JSON.parse(cached);

  var cal = CalendarApp.getCalendarById(HOLIDAY_CALENDAR_ID);
  var start = new Date();
  start.setDate(start.getDate() - 400); // 涵蓋 computeStreak 往回算 365 天需要的範圍
  var end = new Date();
  end.setDate(end.getDate() + 60);
  var holidays = cal.getEvents(start, end).map(function (ev) {
    return {
      date: Utilities.formatDate(ev.getStartTime(), TIME_ZONE, "yyyy-MM-dd"),
      name: ev.getTitle(),
    };
  });

  cache.put("holidays", JSON.stringify(holidays), 21600); // 快取 6 小時，行事曆很少變動
  return holidays;
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
      if (Object.prototype.toString.call(v) === "[object Date]") {
        if (h === "time") {
          v = Utilities.formatDate(v, TIME_ZONE, "HH:mm");
        } else if (h === "date" || h === "periodKey" || h === "endDate") {
          // periodKey 對 daily/weekly 習慣來說也是 yyyy-MM-dd 格式的日期字串，
          // Google Sheets 常會把這種格子自動判斷成日期型態存，讀回來要轉回純
          // 文字，不然跟前端送來的字串比對會對不起來（誤判成「還沒有這一列」
          // 而新增重複列，不是遞增既有的）
          v = Utilities.formatDate(v, TIME_ZONE, "yyyy-MM-dd");
        } else if (h === "billingMonth") {
          v = Utilities.formatDate(v, TIME_ZONE, "yyyy-MM");
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
    recurringExceptions: sheetToObjects(getSheet("RecurringExceptions")),
    shoppingList: sheetToObjects(getSheet("ShoppingList")),
    holidays: getHolidaysSafe_(),
  };
}

// 假日抓取失敗（例如 Calendar 權限還沒授權、或 Google 那邊暫時出狀況）不該讓
// 整個 App（包含登入）掛掉，失敗就當作沒有假日資料，其餘功能照常運作。
function getHolidaysSafe_() {
  try {
    return getHolidays_();
  } catch (err) {
    Logger.log("getHolidays_ 失敗，假日功能暫時停用：" + err);
    return [];
  }
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

function addEvent(date, time, title, notes, owner, amount, hideFromCalendar) {
  var sheet = getSheet("Events");
  sheet.appendRow([
    Utilities.getUuid(),
    date,
    owner || "",
    time,
    title,
    notes,
    new Date(),
    amount === undefined || amount === "" ? "" : parseFloat(amount),
    hideFromCalendar === "true" || hideFromCalendar === true,
  ]);
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

function setEventAmount(id, amount) {
  var sheet = getSheet("Events");
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var amountCol = headers.indexOf("amount") + 1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      sheet.getRange(i + 1, amountCol).setValue(amount === "" ? "" : parseFloat(amount));
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
    new Date(),
    endDate || "",
  ]);
  return getData();
}

// 事後補登/修改/清除（傳空字串）循環行程的截止日。截止日當天仍會出現，之後就不展開。
function setRecurringEndDate(id, endDate) {
  var sheet = getSheet("RecurringEvents");
  var values = sheet.getDataRange().getValues();
  var col = values[0].indexOf("endDate") + 1;
  if (!col) throw new Error("RecurringEvents 缺少 endDate 欄位，請先在表頭補上");
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("截止日格式錯誤");
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      sheet.getRange(i + 1, col).setValue(endDate || "");
      break;
    }
  }
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

function addRecurringException(recurringId, date) {
  var sheet = getSheet("RecurringExceptions");
  sheet.appendRow([Utilities.getUuid(), recurringId, date, new Date()]);
  return getData();
}

function deleteRecurringException(id) {
  var sheet = getSheet("RecurringExceptions");
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return getData();
}

// 「清單」有兩個分類：shopping（購物）跟 idea（想法），同一張表用 category 欄位區分。
// 舊資料沒有 category 值，一律當 shopping。
function normalizeListCategory_(c) {
  return c === "idea" ? "idea" : "shopping";
}

function addShoppingItem(item, category) {
  var sheet = getSheet("ShoppingList");
  sheet.appendRow([Utilities.getUuid(), item, false, new Date(), normalizeListCategory_(category)]);
  return getData();
}

// 清除某個分類底下所有已勾選的項目
function clearDoneShoppingItems(category) {
  var sheet = getSheet("ShoppingList");
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var catIdx = headers.indexOf("category");
  var target = normalizeListCategory_(category);
  for (var i = values.length - 1; i >= 1; i--) {
    var rowCat = normalizeListCategory_(catIdx >= 0 ? values[i][catIdx] : "");
    var done = values[i][2] === true || values[i][2] === "TRUE";
    if (done && rowCat === target) sheet.deleteRow(i + 1);
  }
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

// 血壓頁面是獨立頁面、有自己專屬的 action，故意不回傳 getData()（不想讓主頁面
// 每個操作都順便撈一份完全用不到的血壓資料）。
function getBloodPressureData() {
  return sheetToObjects(getSheet("BloodPressure"));
}

function addBloodPressureReading(date, period, systolic, diastolic, pulse) {
  var sheet = getSheet("BloodPressure");
  sheet.appendRow([
    Utilities.getUuid(),
    date,
    period,
    parseInt(systolic, 10),
    parseInt(diastolic, 10),
    parseInt(pulse, 10),
    new Date(),
  ]);
  return getBloodPressureData();
}

function deleteBloodPressureReading(id) {
  var sheet = getSheet("BloodPressure");
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return getBloodPressureData();
}

// ====== 健康頁：體重（InBody）與驗血 ======
// 跟血壓一樣是獨立 action、不經過 getData()。兩張表都依「表頭名稱」寫入（不依欄位順序），
// 數值欄位都可以留空（InBody 只有 date、weight 必填；驗血只有 date 必填、至少一項數值）。
var INBODY_FIELDS = ["weight", "height", "bmi", "bodyFat", "fatMass", "skeletalMuscle", "muscleMass",
  "bodyWater", "protein", "bmr", "visceralFat", "bodyAge", "whr"];
var LAB_FIELDS = ["glucose", "hba1c", "cholesterol", "ldl", "hdl", "triglyceride", "ast", "alt",
  "creatinine", "egfr", "uricAcid", "tsh", "ck", "bun", "sodium", "potassium"];

function appendHealthRow_(sheetName, fields, p) {
  var sheet = getSheet(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  fields.forEach(function (f) {
    if (headers.indexOf(f) < 0) throw new Error(sheetName + " 缺少欄位 " + f + "，請先在表頭補上");
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ""))) throw new Error("日期格式錯誤");
  var row = headers.map(function (h) {
    if (h === "id") return Utilities.getUuid();
    if (h === "date") return p.date;
    if (h === "createdAt") return new Date();
    if (fields.indexOf(h) >= 0) {
      var v = p[h];
      if (v === undefined || v === null || v === "") return "";
      var n = parseFloat(v);
      return isNaN(n) ? "" : n;
    }
    return "";
  });
  sheet.appendRow(row);
}

// 同一天已經有紀錄時：只更新這次有填的欄位（其他欄位保留），沒有紀錄才新增一列。
// 用來修正舊資料、或補上同一天漏填的項目；不會把沒填的欄位清掉。
function upsertHealthRow_(sheetName, fields, p) {
  var sheet = getSheet(sheetName);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  fields.forEach(function (f) {
    if (headers.indexOf(f) < 0) throw new Error(sheetName + " 缺少欄位 " + f + "，請先在表頭補上");
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ""))) throw new Error("日期格式錯誤");
  var dateCol = headers.indexOf("date");
  if (dateCol >= 0) {
    for (var i = 1; i < values.length; i++) {
      if (normalizeDateCell_(values[i][dateCol]) !== String(p.date)) continue;
      fields.forEach(function (f) {
        var col = headers.indexOf(f);
        var v = p[f];
        if (col < 0 || v === undefined || v === null || v === "") return;
        var n = parseFloat(v);
        if (!isNaN(n)) sheet.getRange(i + 1, col + 1).setValue(n);
      });
      return;
    }
  }
  appendHealthRow_(sheetName, fields, p);
}

function deleteRowById_(sheetName, id) {
  var sheet = getSheet(sheetName);
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
}

function getInBodyData() {
  return sheetToObjects(getSheet("InBody"));
}

function addInBodyReading(p) {
  if (!p.weight) throw new Error("請填體重");
  upsertHealthRow_("InBody", INBODY_FIELDS, p);
  return getInBodyData();
}

function deleteInBodyReading(id) {
  deleteRowById_("InBody", id);
  return getInBodyData();
}

// 驗血分兩張表：LabResults（固定項目，一次抽血一列）跟 LabExtra（其他項目，一個項目一列）。
// 讀寫都回傳 { results, extras }。
function getLabData() {
  return {
    results: sheetToObjects(getSheet("LabResults")),
    extras: sheetToObjects(getSheet("LabExtra")),
  };
}

function normalizeDateCell_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, TIME_ZONE, "yyyy-MM-dd");
  }
  return String(v);
}

// p.extra 是 JSON 字串：[{name, value, unit, refLow, refHigh}, ...]
function addLabEntry(p) {
  var extras = [];
  if (p.extra) {
    try { extras = JSON.parse(p.extra); } catch (e) { throw new Error("其他項目格式錯誤"); }
  }
  var anyFixed = LAB_FIELDS.some(function (f) { return p[f] !== undefined && p[f] !== ""; });
  if (!anyFixed && !extras.length) throw new Error("至少要填一個項目");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ""))) throw new Error("日期格式錯誤");

  if (anyFixed) upsertHealthRow_("LabResults", LAB_FIELDS, p);

  if (extras.length) {
    var sheet = getSheet("LabExtra");
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    ["date", "name", "value", "unit", "refLow", "refHigh"].forEach(function (h) {
      if (headers.indexOf(h) < 0) throw new Error("LabExtra 缺少欄位 " + h + "，請先在表頭補上");
    });
    var existing = sheet.getDataRange().getValues();
    var dateCol = headers.indexOf("date"), nameCol = headers.indexOf("name");
    extras.forEach(function (x) {
      var name = String(x.name || "").trim();
      var value = parseFloat(x.value);
      if (!name || isNaN(value)) return;
      var lowN = parseFloat(x.refLow), highN = parseFloat(x.refHigh);
      // 同一天同名稱的項目：更新那一列
      for (var i = 1; i < existing.length; i++) {
        if (normalizeDateCell_(existing[i][dateCol]) === String(p.date) && String(existing[i][nameCol]) === name) {
          headers.forEach(function (h, c) {
            if (h === "value") sheet.getRange(i + 1, c + 1).setValue(value);
            if (h === "unit") sheet.getRange(i + 1, c + 1).setValue(String(x.unit || "").trim());
            if (h === "refLow") sheet.getRange(i + 1, c + 1).setValue(isNaN(lowN) ? "" : lowN);
            if (h === "refHigh") sheet.getRange(i + 1, c + 1).setValue(isNaN(highN) ? "" : highN);
          });
          return;
        }
      }
      var row = headers.map(function (h) {
        if (h === "id") return Utilities.getUuid();
        if (h === "date") return p.date;
        if (h === "name") return name;
        if (h === "value") return value;
        if (h === "unit") return String(x.unit || "").trim();
        if (h === "refLow") return isNaN(lowN) ? "" : lowN;
        if (h === "refHigh") return isNaN(highN) ? "" : highN;
        if (h === "createdAt") return new Date();
        return "";
      });
      sheet.appendRow(row);
    });
  }
  return getLabData();
}

// 刪掉某一天的所有驗血紀錄（固定項目 + 其他項目）
function deleteLabDay(date) {
  ["LabResults", "LabExtra"].forEach(function (name) {
    var sheet = getSheet(name);
    var values = sheet.getDataRange().getValues();
    var dateCol = values[0].indexOf("date");
    if (dateCol < 0) return;
    for (var i = values.length - 1; i >= 1; i--) {
      if (normalizeDateCell_(values[i][dateCol]) === String(date)) sheet.deleteRow(i + 1);
    }
  });
  return getLabData();
}

// 信用卡帳單是獨立頁面，有自己專屬的 action，故意不回傳 getData()，理由跟
// BloodPressure 一樣：不要讓主頁面每個操作都順便撈一份用不到的資料。
function getCreditCardBills() {
  return sheetToObjects(getSheet("CreditCardBills"));
}

function addCreditCardBill(bank, billingMonth, date, fullAmount, lowestAmount) {
  var sheet = getSheet("CreditCardBills");
  sheet.appendRow([
    Utilities.getUuid(),
    bank,
    billingMonth,
    date,
    parseFloat(fullAmount) || 0,
    parseFloat(lowestAmount) || 0,
    "", // paidAmount 先留空，收到帳單當下通常還沒繳
    new Date(),
  ]);
  return getCreditCardBills();
}

function setCreditCardBillPaid(id, paidAmount) {
  var sheet = getSheet("CreditCardBills");
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var paidCol = headers.indexOf("paidAmount") + 1;
  var fullCol = headers.indexOf("fullAmount") + 1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      // 已繳金額等於帳單全額就視為繳清，鎖定不能再改（前端也會擋，這裡是最後防線）
      var currentPaid = values[i][paidCol - 1];
      if (currentPaid !== "" && Number(currentPaid) === Number(values[i][fullCol - 1])) {
        throw new Error("這筆帳單已繳清，不能再修改");
      }
      sheet.getRange(i + 1, paidCol).setValue(paidAmount === "" ? "" : parseFloat(paidAmount) || 0);
      break;
    }
  }
  return getCreditCardBills();
}

function deleteCreditCardBill(id) {
  var sheet = getSheet("CreditCardBills");
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return getCreditCardBills();
}

// 一次性搬移函式 migrateCreditCardBillsFromBankSheet()（含常數跟
// pad2Bill_/formatBankDate_ 輔助函式）已經執行完、資料確認搬移成功，整段刪除
// 了。要參考寫法到 git 歷史紀錄找，跟 migrateBloodPressureFromPressure2026
// 一樣的模式。

// 一次性搬移函式 migrateBloodPressureFromPressure2026()（含 pad2_/parseBpCell_
// 輔助函式）已經執行完、資料確認搬移成功（888 筆），整段刪除了。要參考寫法
// 到 git 歷史紀錄找，跟 migrateFromPetsSheet 等舊的一次性函式一樣的模式。

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

// 編輯習慣：可改名稱、daily 的「只算工作日」、weekly/monthly 的目標次數。
// 故意不開放改 frequency——HabitLog 的 periodKey 格式依頻率而定（日期/週一/月份），
// 改了之前的紀錄就對不起來，要換頻率請刪掉重加。daily 的 target 固定 1。
function updateHabit(id, name, workdaysOnly, target) {
  var sheet = getSheet("Habits");
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      var frequency = values[i][2];
      var finalTarget = frequency === "daily" ? 1 : (parseInt(target, 10) || 1);
      sheet.getRange(i + 1, 2).setValue(name);
      sheet.getRange(i + 1, 4).setValue(frequency === "daily" ? (workdaysOnly === "true" || workdaysOnly === true) : values[i][3]);
      sheet.getRange(i + 1, 5).setValue(finalTarget);
      break;
    }
  }
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

// 讀取現有列、決定要遞增/刪除還是新增一列、再寫回去——這整段「讀了再寫」如果
// 同時有兩次呼叫重疊（連續點太快、網路延遲重試），兩邊都會在對方寫入前讀到
// 「還沒有這一列」，結果各自新增一列造成重複資料。用 LockService 把整段包起來
// 序列化，確保同一時間只有一個執行緒在動這個習慣。
//
// target=1（目前固定是所有 daily 習慣）是「存在就算打勾」的二元狀態，不是
// 累計次數：沒有列就新增一列（count 固定存 1），有列就直接刪掉——而且是刪掉
// 「所有」符合 habitId+periodKey 的列，不只刪第一筆，這樣就算之前因為某個
// bug（例如 periodKey 被 Sheets 誤判成日期型態比對失敗）意外產生過重複列，
// 下一次取消打勾也會順便全部清乾淨，不用手動去 Sheet 處理。
// target>1（weekly/monthly）維持原本的遞增/超過歸零邏輯，因為要追蹤的是
// 「目前做到第幾次」，不是單純有沒有。
function toggleHabitLog(habitId, periodKey, target) {
  if (habitId === CHALLENGE_HABIT_ID) throw new Error("每日運動挑戰請用抽卡/完成打卡，不能直接勾選");
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet("HabitLog");
    var values = sheet.getDataRange().getValues();
    var maxTarget = parseInt(target, 10) || 1;

    var matchingRows = [];
    for (var i = 1; i < values.length; i++) {
      var rowKey = values[i][2];
      // 這裡是原始 getValues()，periodKey 若被 Sheets 轉成 Date 型態，要先轉回
      // 跟前端一致的字串再比對，否則找不到既有列，取消打勾會變成又新增一列
      if (Object.prototype.toString.call(rowKey) === "[object Date]") {
        rowKey = Utilities.formatDate(rowKey, TIME_ZONE, "yyyy-MM-dd");
      }
      if (values[i][1] === habitId && String(rowKey) === String(periodKey)) {
        matchingRows.push(i);
      }
    }

    if (maxTarget === 1) {
      if (matchingRows.length > 0) {
        for (var j = matchingRows.length - 1; j >= 0; j--) {
          sheet.deleteRow(matchingRows[j] + 1);
        }
      } else {
        sheet.appendRow([Utilities.getUuid(), habitId, periodKey, 1, new Date()]);
      }
      return getData();
    }

    if (matchingRows.length > 0) {
      var rowIndex = matchingRows[0];
      var next = (Number(values[rowIndex][3]) || 0) + 1;
      if (next > maxTarget) next = 0;
      sheet.getRange(rowIndex + 1, 4).setValue(next);
      return getData();
    }

    sheet.appendRow([Utilities.getUuid(), habitId, periodKey, 1, new Date()]);
    return getData();
  } finally {
    lock.releaseLock();
  }
}

// ====== 每日運動挑戰 ======
// 朋友維護的運動挑戰站有自己的打卡 API（Google Apps Script web app，POST JSON）。
// 這個挑戰在我們這邊用 HabitLog 存：同一個 habit（CHALLENGE_HABIT_ID）、一天一列，
// 多用兩個欄位：exercise（抽到的運動）、synced（完成是否已成功回傳給朋友）。
//   - 抽卡：先寫一列 count=0（佔位），再呼叫朋友的 draw，成功就把運動寫進 exercise，
//     失敗就把佔位列刪掉讓使用者可重抽。朋友的 draw 同一天不能重複呼叫，所以結果
//     一定要立刻存下來。
//   - 完成：先記 count=1，再送 done 給朋友；成功才標 synced=TRUE（之後鎖死不能再按），
//     失敗就還原成 count=0 讓使用者可重送。
// 連線設定放「專案設定 → 指令碼屬性」（不能寫進程式，repo 是公開的）：
//   CHALLENGE_URL（朋友的 web app 網址）、CHALLENGE_PLAYER（玩家名稱）、CHALLENGE_PIN（密碼）。
var CHALLENGE_HABIT_ID = "85bf9ff2-7233-4b66-a301-f5a0c3ac36a6";

// 朋友 draw 的回應格式：{"mine":{"date","player","ex","name":"伏地挺身（可跪姿）","amount":"3 組 × 5 下","done":false}}
// 顯示用字串 = name・amount（沒有 amount 就只有 name）。
function formatChallengeExercise_(res) {
  var m = (res && res.mine) || res || {};
  var name = String(m.name || "").trim();
  var amount = String(m.amount || "").trim();
  return amount ? name + "・" + amount : name;
}

function callChallengeApi_(payload) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("CHALLENGE_URL");
  if (!url) throw new Error("尚未設定 CHALLENGE_URL（指令碼屬性）");
  var body = {
    player: props.getProperty("CHALLENGE_PLAYER"),
    pin: props.getProperty("CHALLENGE_PIN"),
  };
  Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "text/plain",
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
    followRedirects: true,
  });
  var json;
  try {
    json = JSON.parse(res.getContentText());
  } catch (e) {
    throw new Error("運動挑戰站回應格式錯誤（HTTP " + res.getResponseCode() + "）：" + res.getContentText().slice(0, 200));
  }
  if (json.error) throw new Error(String(json.error));
  return json;
}

// 回傳今天（台北時間）那一列在 HabitLog 的位置（1-based row），沒有就回 0
function findChallengeRow_(sheet, today) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var key = values[i][2];
    if (Object.prototype.toString.call(key) === "[object Date]") {
      key = Utilities.formatDate(key, TIME_ZONE, "yyyy-MM-dd");
    }
    if (values[i][1] === CHALLENGE_HABIT_ID && String(key) === today) return i + 1;
  }
  return 0;
}

function challengeCols_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var cols = {};
  ["habitId", "periodKey", "count", "exercise", "synced"].forEach(function (h) {
    cols[h] = headers.indexOf(h) + 1;
  });
  if (!cols.exercise || !cols.synced) throw new Error("HabitLog 缺少 exercise / synced 欄位，請先在表頭補上");
  return cols;
}

function drawChallenge() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet("HabitLog");
    var cols = challengeCols_(sheet);
    var today = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
    // 今天已經有列（例如另一個裝置先抽了）就直接回傳現況，不重抽
    if (findChallengeRow_(sheet, today)) return getData();

    var width = sheet.getLastColumn();
    var row = [];
    for (var c = 0; c < width; c++) row.push("");
    row[0] = Utilities.getUuid();
    row[cols.habitId - 1] = CHALLENGE_HABIT_ID;
    row[cols.periodKey - 1] = today;
    row[cols.count - 1] = 0;
    var createdAtCol = sheet.getRange(1, 1, 1, width).getValues()[0].indexOf("createdAt");
    if (createdAtCol >= 0) row[createdAtCol] = new Date();
    sheet.appendRow(row);
    var rowIndex = sheet.getLastRow();

    var exercise;
    try {
      var res = callChallengeApi_({ action: "draw", date: today });
      exercise = formatChallengeExercise_(res);
      if (!exercise) throw new Error("運動挑戰站沒有回傳運動內容");
    } catch (err) {
      sheet.deleteRow(rowIndex); // 抽卡失敗，拿掉佔位列，使用者可以重抽
      throw err;
    }
    try {
      sheet.getRange(rowIndex, cols.exercise).setValue(exercise);
    } catch (err) {
      // 朋友那邊已經抽成功、但我們寫入失敗：draw 不能重複呼叫，把結果放進錯誤訊息讓人可以手動補
      throw new Error("抽到「" + exercise + "」，但記錄失敗，請手動填到 HabitLog 的 exercise 欄");
    }
    return getData();
  } finally {
    lock.releaseLock();
  }
}

function completeChallenge() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet("HabitLog");
    var cols = challengeCols_(sheet);
    var today = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
    var rowIndex = findChallengeRow_(sheet, today);
    if (!rowIndex) throw new Error("今天還沒抽卡");
    var exercise = sheet.getRange(rowIndex, cols.exercise).getValue();
    if (!exercise) throw new Error("今天的運動還沒抽到");
    var wasDone = Number(sheet.getRange(rowIndex, cols.count).getValue()) >= 1;
    var synced = sheet.getRange(rowIndex, cols.synced).getValue();
    if (wasDone && (synced === true || synced === "TRUE")) return getData(); // 已同步，鎖死

    sheet.getRange(rowIndex, cols.count).setValue(1);
    sheet.getRange(rowIndex, cols.synced).setValue("");
    try {
      callChallengeApi_({ action: "done", date: today, done: true });
    } catch (err) {
      // 第一次送失敗就還原成未完成讓使用者重送；已經是「完成但未同步」的重新同步失敗則維持原狀
      if (!wasDone) sheet.getRange(rowIndex, cols.count).setValue(0);
      throw err;
    }
    sheet.getRange(rowIndex, cols.synced).setValue(true);
    return getData();
  } finally {
    lock.releaseLock();
  }
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

  events = events.filter(function (e) { return !e.hideFromCalendar; });

  var todayDate = new Date(todayStr + "T00:00:00");
  var skippedToday = {};
  sheetToObjects(getSheet("RecurringExceptions")).forEach(function (ex) {
    if (ex.date === todayStr) skippedToday[ex.recurringId] = true;
  });
  var recurringToday = sheetToObjects(getSheet("RecurringEvents"))
    .filter(function (r) { return matchesRecurringRule_(r, todayDate, todayStr) && !skippedToday[r.id]; })
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

function matchesRecurringRule_(rule, dateObj, dateStr) {
  // 有設截止日的話，截止日當天（含）之後就不再出現
  if (rule.endDate && dateStr > String(rule.endDate)) return false;
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
