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
 *   Events          欄位: id | date | owner | time | title | notes | createdAt | amount | hideFromCalendar | endTime
 *   Habits          欄位: id | name | frequency | workdaysOnly | target | createdAt
 *   HabitLog        欄位: id | habitId | periodKey | count | createdAt | exercise | synced
 *                   （exercise/synced 只有「每日運動挑戰」那個習慣會用到，其他習慣留空）
 *   RecurringEvents 欄位: id | owner | title | time | notes | frequency | dayOfWeek | dayOfMonth | createdAt | endDate（選填，yyyy-MM-dd，含當天；空白=無限期）| endTime（選填，HH:mm，同一天內晚於 time）
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
 *   Copybook        欄位: id | lang | title | author | text | createdAt
 *                         （練字字帖的內容庫：lang 是 zh/en；text 全文，換行 = 一行；practice.html 從這裡隨機取材）
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
 * （一次性搬移／整理函式跑完就整段刪除，不留在這個檔案裡；需要參考的話到 git 歷史紀錄找：
 * migrateFromPetsSheet / fillBlankEventOwners / migratePetsIntoEvents / normalizeEventDates /
 * migrateBloodPressureFromPressure2026 / migrateCreditCardBillsFromBankSheet / mergeDuplicateHealthRows。
 * authorizeCalendar / installCalendarTriggers。目前保留的手動執行函式只有退場用的 clearSyncedCalendarEvents，
 * 見檔案最後面。）
 */

var PET_NAMES = ["林萌", "咪嚕"]; // 之後又養新寵物，這裡加名字就好

// 密碼與資料一律放 POST body（JSON 字串，前端用 text/plain 送，避免瀏覽器先發預檢請求），
// 不放網址：網址會留在瀏覽器歷史、代理伺服器與各種紀錄裡。GET 一律拒絕，寫入也不再能用 GET 觸發。
function doGet(e) {
  return respond({ ok: false, error: "請改用 POST" });
}

function doPost(e) {
  var p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ ok: false, error: "bad request" });
  }
  return handleRequest(p || {});
}

function handleRequest(p) {
  try {
    var stored = PropertiesService.getScriptProperties().getProperty("PASSWORD");
    if (!stored || p.password !== stored) {
      return respond({ ok: false, error: "unauthorized" });
    }

    // 所有寫入動作（不是 get 開頭的）一律序列化：整段「讀列號→寫入」不被別的請求插進來，
    // 才不會因為列號位移寫錯列、或兩邊同時新增造成重複。讀取不用鎖。
    var lock = null;
    if (String(p.action).indexOf("get") !== 0) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    try {
      return dispatch_(p);
    } finally {
      if (lock) lock.releaseLock();
    }
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}

function dispatch_(p) {
  {
    switch (p.action) {
      case "getData":
        return respond({ ok: true, data: getData(p.keys ? String(p.keys).split(",") : undefined) });
      case "addGoal":
        return respond({ ok: true, data: addGoal(p.date, p.text) });
      case "toggleGoal":
        return respond({ ok: true, data: toggleGoal(p.id) });
      case "deleteGoal":
        return respond({ ok: true, data: deleteGoal(p.id) });
      case "addEvent":
        return respond({
          ok: true,
          data: addEvent(p.date, p.time, p.title, p.notes, p.owner, p.amount, p.hideFromCalendar, p.endTime),
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
            p.owner, p.title, p.time, p.notes, p.frequency, p.dayOfWeek, p.dayOfMonth, p.endDate, p.endTime
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
      case "getCopybook":
        return respond({ ok: true, data: getCopybook() });
      case "importCopybookEntries":
        return respond({ ok: true, data: importCopybookEntries(p.entries) });
      case "getCalendarSyncStatus":
        return respond({ ok: true, data: getCalendarSyncStatus() });
      case "syncCalendarNow":
        return respond({ ok: true, data: syncCalendarNow(p.dryRun) });
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

// keys 省略 = 全部（登入時整包讀）；寫入動作只傳自己動到的集合，不要每次都重讀七張表。
// 前端 applyData 只覆蓋回傳裡有的欄位。
var DATA_SHEETS_ = {
  goals: "Goals", events: "Events", habits: "Habits", habitLogs: "HabitLog",
  recurringEvents: "RecurringEvents", recurringExceptions: "RecurringExceptions", shoppingList: "ShoppingList",
};

function getData(keys) {
  var out = {};
  Object.keys(DATA_SHEETS_).forEach(function (k) {
    if (!keys || keys.indexOf(k) >= 0) out[k] = sheetToObjects(getSheet(DATA_SHEETS_[k]));
  });
  if (!keys || keys.indexOf("holidays") >= 0) out.holidays = getHolidaysSafe_();
  return out;
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
  appendRowSafe_(sheet, [Utilities.getUuid(), dateArg_(date, "待辦"), textArg_(text, "待辦內容", { required: true, max: 500 }), false, new Date()]);
  return getData(["goals"]);
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
  return getData(["goals"]);
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
  return getData(["goals"]);
}

// 結束時間（選填）：要有開始時間、而且同一天內晚於開始時間（不處理跨日）。不填就是空字串，同步到 Google 時用預設長度。
function endTimeArg_(time, endTime, label) {
  var start = timeArg_(time, label);
  var end = timeArg_(endTime, label + "結束");
  if (end && !start) throw new Error(label + "要先填開始時間才能填結束時間");
  if (end && end <= start) throw new Error(label + "的結束時間要晚於開始時間");
  return end;
}

function addEvent(date, time, title, notes, owner, amount, hideFromCalendar, endTime) {
  var sheet = getSheet("Events");
  var end = endTimeArg_(time, endTime, "事件");
  appendRowSafe_(sheet, [
    Utilities.getUuid(),
    dateArg_(date, "事件"),
    enumArg_(owner, "對象", ["me", "wife", "shared"].concat(PET_NAMES), { emptyValue: "" }),
    timeArg_(time, "事件"),
    textArg_(title, "事件標題", { required: true, max: 200 }),
    textArg_(notes, "備註", { max: 2000 }),
    new Date(),
    numArg_(amount, "金額", { emptyValue: "", min: 0 }),
    boolArg_(hideFromCalendar),
    end,
  ]);
  markCalendarDirty_();
  return getData(["events"]);
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
  markCalendarDirty_();
  return getData(["events"]);
}

function setEventAmount(id, amount) {
  var sheet = getSheet("Events");
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var amountCol = headers.indexOf("amount") + 1;
  var newAmount = numArg_(amount, "金額", { emptyValue: "", min: 0 });
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      sheet.getRange(i + 1, amountCol).setValue(newAmount);
      break;
    }
  }
  return getData(["events"]);
}

function addRecurringEvent(owner, title, time, notes, frequency, dayOfWeek, dayOfMonth, endDate, endTime) {
  var sheet = getSheet("RecurringEvents");
  var end = endTimeArg_(time, endTime, "行程");
  appendRowSafe_(sheet, [
    Utilities.getUuid(),
    enumArg_(owner, "對象", ["me", "wife", "shared"].concat(PET_NAMES), { emptyValue: "" }),
    textArg_(title, "行程標題", { required: true, max: 200 }),
    timeArg_(time, "行程"),
    textArg_(notes, "備註", { max: 2000 }),
    enumArg_(frequency, "頻率", ["weekly", "monthly"]),
    numArg_(dayOfWeek, "星期", { emptyValue: "", int: true, min: 0, max: 6 }),
    numArg_(dayOfMonth, "日期", { emptyValue: "", int: true, min: 1, max: 31 }),
    new Date(),
    dateArg_(endDate, "截止日", { optional: true }),
    end,
  ]);
  markCalendarDirty_();
  return getData(["recurringEvents"]);
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
  markCalendarDirty_();
  return getData(["recurringEvents"]);
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
  markCalendarDirty_();
  return getData(["recurringEvents"]);
}

function addRecurringException(recurringId, date) {
  var sheet = getSheet("RecurringExceptions");
  appendRowSafe_(sheet, [Utilities.getUuid(), textArg_(recurringId, "循環行程", { required: true, max: 100 }), dateArg_(date, "跳過的"), new Date()]);
  markCalendarDirty_();
  return getData(["recurringExceptions"]);
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
  markCalendarDirty_();
  return getData(["recurringExceptions"]);
}

// 「清單」有兩個分類：shopping（購物）跟 idea（想法），同一張表用 category 欄位區分。
// 舊資料沒有 category 值，一律當 shopping。
function normalizeListCategory_(c) {
  return c === "idea" ? "idea" : "shopping";
}

function addShoppingItem(item, category) {
  var sheet = getSheet("ShoppingList");
  appendRowSafe_(sheet, [Utilities.getUuid(), textArg_(item, "項目", { required: true, max: 5000 }), false, new Date(), normalizeListCategory_(category)]);
  return getData(["shoppingList"]);
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
  return getData(["shoppingList"]);
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
  return getData(["shoppingList"]);
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
  return getData(["shoppingList"]);
}

// 血壓頁面是獨立頁面、有自己專屬的 action，故意不回傳 getData()（不想讓主頁面
// 每個操作都順便撈一份完全用不到的血壓資料）。
function getBloodPressureData() {
  return sheetToObjects(getSheet("BloodPressure"));
}

function addBloodPressureReading(date, period, systolic, diastolic, pulse) {
  var sheet = getSheet("BloodPressure");
  appendRowSafe_(sheet, [
    Utilities.getUuid(),
    dateArg_(date, "血壓"),
    enumArg_(period, "時段", ["morning", "evening"]),
    numArg_(systolic, "收縮壓", { int: true, min: 30, max: 300 }),
    numArg_(diastolic, "舒張壓", { int: true, min: 20, max: 200 }),
    numArg_(pulse, "脈搏", { emptyValue: "", int: true, min: 20, max: 300 }),
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

// 嚴格解析數字：允許千分位 "1,000"，空白回傳 null，"12abc" 這種夾雜文字的回傳 NaN
// （不用 parseFloat，它會把 "12abc" 截成 12、"1,000" 截成 1）
function parseNumStrict_(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  var t = String(v).trim();
  if (t === "") return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  var n = Number(t);
  return isFinite(n) ? n : NaN;
}

// ====== 欄位型別（輸入進來先驗證再寫入）======
// 每個寫入 action 都要把使用者輸入「依欄位型別」過一遍，不能直接塞進 Sheet。型別一覽：
//   數字   numArg_    金額、帳單金額、血壓/脈搏、體組成與驗血數值、目標次數、星期(0-6)、日期(1-31)
//   文字   textArg_   待辦/事件/習慣/清單內容、備註、銀行名稱、驗血項目名稱與單位（另外有公式防護，見 appendRowSafe_）
//   日期   dateArg_    yyyy-MM-dd（事件、待辦、帳單截止日、血壓日期、跳過日期、循環截止日）
//   月份   monthArg_   yyyy-MM（帳單月份）
//   時間   timeArg_    HH:mm，可空白（事件、循環行程）
//   列舉   enumArg_    owner、frequency、血壓 period、清單 category
//   布林   boolArg_    workdaysOnly、hideFromCalendar
// 新增欄位時先決定它屬於哪一型，用對應的函式驗證（README「欄位型別」有對照表）。

function textArg_(v, label, opts) {
  opts = opts || {};
  var t = v === undefined || v === null ? "" : String(v).trim();
  if (t === "") {
    if (opts.required) throw new Error(label + "不能空白");
    return "";
  }
  var max = opts.max || 500;
  if (t.length > max) throw new Error(label + "太長（最多 " + max + " 字）");
  return t;
}

function dateArg_(v, label, opts) {
  opts = opts || {};
  var t = v === undefined || v === null ? "" : String(v).trim();
  if (t === "" && opts.optional) return "";
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  var d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!m || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    throw new Error(label + "日期格式錯誤（要 yyyy-MM-dd）");
  }
  return t;
}

function monthArg_(v, label) {
  var t = v === undefined || v === null ? "" : String(v).trim();
  var m = /^(\d{4})-(\d{2})$/.exec(t);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(label + "月份格式錯誤（要 yyyy-MM）");
  return t;
}

function timeArg_(v, label) {
  var t = v === undefined || v === null ? "" : String(v).trim();
  if (t === "") return "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(label + "時間格式錯誤（要 HH:mm）");
  return t;
}

function enumArg_(v, label, allowed, opts) {
  var t = v === undefined || v === null ? "" : String(v).trim();
  if (t === "" && opts && opts.emptyValue !== undefined) return opts.emptyValue;
  if (allowed.indexOf(t) < 0) throw new Error(label + "不是有效的選項");
  return t;
}

function boolArg_(v) {
  return v === true || v === "true" || v === "TRUE";
}

// 金額、次數、血壓等所有「使用者輸入的數字」寫入前都走這個：嚴格解析（允許千分位）、
// 無效就丟錯讓前端顯示，不要偷偷存成 0 或截斷（parseFloat("1,000")=1、parseFloat("abc")||0=0）。
// opts: emptyValue（空白時回傳的值；沒給就是必填）、int（必須整數）、min、max。
function numArg_(v, label, opts) {
  opts = opts || {};
  var n = parseNumStrict_(v);
  if (n === null) {
    if (opts.emptyValue !== undefined) return opts.emptyValue;
    throw new Error(label + "請填數字");
  }
  if (isNaN(n)) throw new Error(label + "「" + v + "」不是有效數字");
  if (opts.int && Math.floor(n) !== n) throw new Error(label + "必須是整數");
  if (opts.min !== undefined && n < opts.min) throw new Error(label + "不能小於 " + opts.min);
  if (opts.max !== undefined && n > opts.max) throw new Error(label + "不能大於 " + opts.max);
  return n;
}

// 使用者輸入的文字存進 Sheet 前的公式防護：開頭是 = + - @（或 Tab/換行）的字串會被 Sheets
// 當成公式執行，所以這幾格先設成純文字格式再寫入。所有帶使用者文字的寫入都走這兩個函式，
// 不要直接用 sheet.appendRow / range.setValue 寫字串。
function needsTextGuard_(v) {
  return typeof v === "string" && /^[=+\-@\t\r]/.test(v);
}

function appendRowSafe_(sheet, row) {
  var r = sheet.getLastRow() + 1;
  row.forEach(function (v, i) {
    if (needsTextGuard_(v)) sheet.getRange(r, i + 1).setNumberFormat("@");
  });
  sheet.getRange(r, 1, 1, row.length).setValues([row]);
}

function setTextSafe_(range, v) {
  if (needsTextGuard_(v)) range.setNumberFormat("@");
  range.setValue(v);
}

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
      var n = parseNumStrict_(p[h]);
      if (n === null) return "";
      if (isNaN(n)) throw new Error(h + " 不是有效數字");
      return n;
    }
    return "";
  });
  appendRowSafe_(sheet, row);
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
  fields.forEach(function (f) {
    if (isNaN(parseNumStrict_(p[f]))) throw new Error(f + " 不是有效數字");
  });
  var dateCol = headers.indexOf("date");
  if (dateCol >= 0) {
    for (var i = 1; i < values.length; i++) {
      if (normalizeDateCell_(values[i][dateCol]) !== String(p.date)) continue;
      // 整列在記憶體裡合併好，一次寫回（原本是一格一格 setValue，欄位多時很慢）
      var row = values[i].slice();
      fields.forEach(function (f) {
        var col = headers.indexOf(f);
        var n = parseNumStrict_(p[f]);
        if (col >= 0 && n !== null) row[col] = n;
      });
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
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

// 其他項目整批驗證、同名去重（以最後一筆為準）；驗證不過就丟錯，呼叫端要在寫入任何東西之前先呼叫
function normalizeLabExtras_(extras) {
  var byName = {}, order = [];
  extras.forEach(function (x) {
    var name = textArg_(x.name, "項目名稱", { max: 100 });
    if (!name) return;
    var value = parseNumStrict_(x.value);
    var lowN = parseNumStrict_(x.refLow), highN = parseNumStrict_(x.refHigh);
    if (value === null || isNaN(value)) throw new Error("「" + name + "」的數值不是有效數字");
    if (isNaN(lowN) || isNaN(highN)) throw new Error("「" + name + "」的參考範圍不是有效數字");
    if (!(name in byName)) order.push(name);
    byName[name] = { name: name, value: value, unit: textArg_(x.unit, "單位", { max: 30 }), low: lowN === null ? "" : lowN, high: highN === null ? "" : highN };
  });
  return { byName: byName, order: order };
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

  var normalized = normalizeLabExtras_(extras);
  var byName = normalized.byName, order = normalized.order;

  if (anyFixed) upsertHealthRow_("LabResults", LAB_FIELDS, p);

  if (extras.length) {
    var sheet = getSheet("LabExtra");
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    ["date", "name", "value", "unit", "refLow", "refHigh"].forEach(function (h) {
      if (headers.indexOf(h) < 0) throw new Error("LabExtra 缺少欄位 " + h + "，請先在表頭補上");
    });
    var existing = sheet.getDataRange().getValues();
    var dateCol = headers.indexOf("date"), nameCol = headers.indexOf("name");
    order.forEach(function (name) {
      var x = byName[name];
      // 同一天同名稱的項目：更新那一列
      for (var i = 1; i < existing.length; i++) {
        if (normalizeDateCell_(existing[i][dateCol]) === String(p.date) && String(existing[i][nameCol]) === name) {
          headers.forEach(function (h, c) {
            if (h === "value") sheet.getRange(i + 1, c + 1).setValue(x.value);
            if (h === "unit") setTextSafe_(sheet.getRange(i + 1, c + 1), x.unit);
            if (h === "refLow") sheet.getRange(i + 1, c + 1).setValue(x.low);
            if (h === "refHigh") sheet.getRange(i + 1, c + 1).setValue(x.high);
          });
          return;
        }
      }
      var row = headers.map(function (h) {
        if (h === "id") return Utilities.getUuid();
        if (h === "date") return p.date;
        if (h === "name") return x.name;
        if (h === "value") return x.value;
        if (h === "unit") return x.unit;
        if (h === "refLow") return x.low;
        if (h === "refHigh") return x.high;
        if (h === "createdAt") return new Date();
        return "";
      });
      appendRowSafe_(sheet, row);
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

// ====== 練字字帖內容庫（practice.html）======
// 一篇 = 一列：lang（zh/en）、篇名、作者、全文。全部回傳 { entries }，量很小，前端自己隨機挑。
// 新增／修改內容直接在 Sheet 的 Copybook 分頁改；網頁只負責讀，以及第一次「匯入內建範例」（importCopybookEntries）。
function getCopybook() {
  return { entries: sheetToObjects(getSheet("Copybook")) };
}

function copybookEntry_(e) {
  e = e || {};
  return {
    lang: enumArg_(e.lang, "語言", ["zh", "en"]),
    title: textArg_(e.title, "篇名", { required: true, max: 100 }),
    author: textArg_(e.author, "作者", { max: 50 }),
    text: textArg_(String(e.text === undefined || e.text === null ? "" : e.text).replace(/\r\n?/g, "\n"), "內容", { required: true, max: 8000 }),
  };
}

function copybookKey_(lang, title) {
  return lang + "|" + title;
}

function existingCopybookKeys_(sheet) {
  var keys = {};
  sheetToObjects(sheet).forEach(function (r) { keys[copybookKey_(r.lang, r.title)] = true; });
  return keys;
}

// 批次匯入（entries 是 JSON 陣列字串）：整批先驗證，有一筆不合格就全部不寫；
// 同語言同篇名已存在的略過，所以可以重複執行。
function importCopybookEntries(entriesJson) {
  var list;
  try { list = JSON.parse(entriesJson); } catch (e) { throw new Error("匯入內容不是有效的 JSON"); }
  if (!Array.isArray(list) || !list.length) throw new Error("匯入內容是空的");
  if (list.length > 200) throw new Error("一次最多匯入 200 篇");
  var entries = list.map(copybookEntry_);
  var sheet = getSheet("Copybook");
  var keys = existingCopybookKeys_(sheet);
  var added = 0, skipped = 0;
  entries.forEach(function (entry) {
    var key = copybookKey_(entry.lang, entry.title);
    if (keys[key]) { skipped++; return; }
    keys[key] = true;
    appendRowSafe_(sheet, [Utilities.getUuid(), entry.lang, entry.title, entry.author, entry.text, new Date()]);
    added++;
  });
  var out = getCopybook();
  out.added = added;
  out.skipped = skipped;
  return out;
}

// 信用卡帳單是獨立頁面，有自己專屬的 action，故意不回傳 getData()，理由跟
// BloodPressure 一樣：不要讓主頁面每個操作都順便撈一份用不到的資料。
function getCreditCardBills() {
  return sheetToObjects(getSheet("CreditCardBills"));
}

function addCreditCardBill(bank, billingMonth, date, fullAmount, lowestAmount) {
  var sheet = getSheet("CreditCardBills");
  appendRowSafe_(sheet, [
    Utilities.getUuid(),
    textArg_(bank, "銀行", { required: true, max: 20 }),
    monthArg_(billingMonth, "帳單"),
    dateArg_(date, "截止"),
    numArg_(fullAmount, "帳單全額", { min: 0 }),
    numArg_(lowestAmount, "最低應繳", { emptyValue: 0, min: 0 }),
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
  var newPaid = numArg_(paidAmount, "已繳金額", { emptyValue: "", min: 0 });
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      // 已繳金額等於帳單全額就視為繳清，鎖定不能再改（前端也會擋，這裡是最後防線）
      var currentPaid = values[i][paidCol - 1];
      if (currentPaid !== "" && Number(currentPaid) === Number(values[i][fullCol - 1])) {
        throw new Error("這筆帳單已繳清，不能再修改");
      }
      sheet.getRange(i + 1, paidCol).setValue(newPaid);
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

function addHabit(name, frequency, workdaysOnly, target) {
  var sheet = getSheet("Habits");
  frequency = enumArg_(frequency, "頻率", ["daily", "weekly", "monthly"]);
  var finalTarget = frequency === "daily" ? 1 : numArg_(target, "目標次數", { emptyValue: 1, int: true, min: 1, max: 31 });
  appendRowSafe_(sheet, [
    Utilities.getUuid(),
    textArg_(name, "習慣名稱", { required: true, max: 200 }),
    frequency,
    boolArg_(workdaysOnly),
    finalTarget,
    new Date(),
  ]);
  return getData(["habits"]);
}

// 編輯習慣：可改名稱、daily 的「只算工作日」、weekly/monthly 的目標次數。
// 故意不開放改 frequency——HabitLog 的 periodKey 格式依頻率而定（日期/週一/月份），
// 改了之前的紀錄就對不起來，要換頻率請刪掉重加。daily 的 target 固定 1。
function updateHabit(id, name, workdaysOnly, target) {
  var sheet = getSheet("Habits");
  var newName = textArg_(name, "習慣名稱", { required: true, max: 200 });
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      var frequency = values[i][2];
      var finalTarget = frequency === "daily" ? 1 : numArg_(target, "目標次數", { emptyValue: 1, int: true, min: 1, max: 31 });
      setTextSafe_(sheet.getRange(i + 1, 2), newName);
      sheet.getRange(i + 1, 4).setValue(frequency === "daily" ? boolArg_(workdaysOnly) : values[i][3]);
      sheet.getRange(i + 1, 5).setValue(finalTarget);
      break;
    }
  }
  return getData(["habits"]);
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
  return getData(["habits"]);
}

// 讀取現有列、決定要遞增/刪除還是新增一列、再寫回去——這整段「讀了再寫」如果
// 同時有兩次呼叫重疊（連續點太快、網路延遲重試），兩邊都會在對方寫入前讀到
// 「還沒有這一列」，結果各自新增一列造成重複資料。handleRequest 對所有寫入動作
// 都加了全域鎖（LockService），同一時間只會有一個寫入在跑，這裡不用再自己鎖
// （LockService 的鎖不能重入，內層再鎖會卡住）。
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
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(String(periodKey))) throw new Error("週期格式錯誤");
  {
    var sheet = getSheet("HabitLog");
    var values = sheet.getDataRange().getValues();
    var maxTarget = numArg_(target, "目標次數", { emptyValue: 1, int: true, min: 1, max: 31 });

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
        appendRowSafe_(sheet, [Utilities.getUuid(), habitId, periodKey, 1, new Date()]);
      }
      return getData(["habitLogs"]);
    }

    if (matchingRows.length > 0) {
      var rowIndex = matchingRows[0];
      var next = (Number(values[rowIndex][3]) || 0) + 1;
      if (next > maxTarget) next = 0;
      sheet.getRange(rowIndex + 1, 4).setValue(next);
      return getData(["habitLogs"]);
    }

    appendRowSafe_(sheet, [Utilities.getUuid(), habitId, periodKey, 1, new Date()]);
    return getData(["habitLogs"]);
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
  {
    var sheet = getSheet("HabitLog");
    var cols = challengeCols_(sheet);
    var today = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
    // 今天已經有列（例如另一個裝置先抽了）就直接回傳現況，不重抽
    if (findChallengeRow_(sheet, today)) return getData(["habitLogs"]);

    var width = sheet.getLastColumn();
    var row = [];
    for (var c = 0; c < width; c++) row.push("");
    row[0] = Utilities.getUuid();
    row[cols.habitId - 1] = CHALLENGE_HABIT_ID;
    row[cols.periodKey - 1] = today;
    row[cols.count - 1] = 0;
    var createdAtCol = sheet.getRange(1, 1, 1, width).getValues()[0].indexOf("createdAt");
    if (createdAtCol >= 0) row[createdAtCol] = new Date();
    appendRowSafe_(sheet, row);
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
      setTextSafe_(sheet.getRange(rowIndex, cols.exercise), exercise);
    } catch (err) {
      // 朋友那邊已經抽成功、但我們寫入失敗：draw 不能重複呼叫，把結果放進錯誤訊息讓人可以手動補
      throw new Error("抽到「" + exercise + "」，但記錄失敗，請手動填到 HabitLog 的 exercise 欄");
    }
    return getData(["habitLogs"]);
  }
}

function completeChallenge() {
  {
    var sheet = getSheet("HabitLog");
    var cols = challengeCols_(sheet);
    var today = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
    var rowIndex = findChallengeRow_(sheet, today);
    if (!rowIndex) throw new Error("今天還沒抽卡");
    var exercise = sheet.getRange(rowIndex, cols.exercise).getValue();
    if (!exercise) throw new Error("今天的運動還沒抽到");
    var wasDone = Number(sheet.getRange(rowIndex, cols.count).getValue()) >= 1;
    var synced = sheet.getRange(rowIndex, cols.synced).getValue();
    if (wasDone && (synced === true || synced === "TRUE")) return getData(["habitLogs"]); // 已同步，鎖死

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
    return getData(["habitLogs"]);
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
      return { date: todayStr, owner: r.owner, time: r.time, endTime: r.endTime, title: r.title, notes: r.notes };
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
  if (e.time) line += "\n   ⏰ 時間：" + e.time + (e.endTime ? "–" + e.endTime : "");
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


// ====== 同步到 Google 行事曆（單向：App → Google）======
// 目標是 Dean 另外建的「承日常」行事曆（ID 放 Script Properties 的 CALENDAR_ID，不進 repo；沒設定 = 功能關閉）。
// 做法是「對帳」：算出 App 裡「應該有」的事件（一次性事件 + 循環行程展開成單次），跟行事曆上
// 「帶本 App 標記」的事件比對，只做差異（建立／更新／刪除）。只管理有標記的事件（CalendarEvent tag "dh"），
// 別人在這個行事曆手動加的事件完全不碰。寫入 Events／循環行程時只設旗標 CAL_DIRTY（幾毫秒，不呼叫 Calendar），
// 由每 5 分鐘的觸發器（calendarSyncTick）對帳；另有每天一次的完整對帳（calendarSyncDaily）把循環行程的視窗往前滾。
// 設定步驟見 README「同步到 Google 行事曆」。

var CAL_TAG = "dh";
var CAL_DURATION_MIN = 60;      // 有時間的事件預設長度（分鐘）
var CAL_PAST_DAYS = 7;          // 對帳視窗：今天往前幾天（更早的不動）
var CAL_RECUR_DAYS = 120;       // 循環行程往後展開幾天
var CAL_ONEOFF_DAYS = 365;      // 一次性事件往後同步幾天
var CAL_OWNER_LABELS = { me: "承承", wife: "君君", shared: "一起" };

function calendarId_() {
  return PropertiesService.getScriptProperties().getProperty("CALENDAR_ID") || "";
}

function markCalendarDirty_() {
  try {
    if (calendarId_()) PropertiesService.getScriptProperties().setProperty("CAL_DIRTY", "1");
  } catch (e) { /* 旗標寫不進去不能影響原本的寫入 */ }
}

// yyyy-MM-dd 加減天數（用 UTC 計算，不受時區影響）
function calAddDays_(dateStr, days) {
  var p = String(dateStr).split("-");
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days));
  return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2);
}

function calWeekday_(dateStr) {
  var p = String(dateStr).split("-");
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
}

function calTitle_(owner, title) {
  var label = CAL_OWNER_LABELS[owner] || (PET_NAMES.indexOf(owner) !== -1 ? owner : "");
  return (label ? "[" + label + "] " : "") + String(title || "");
}

// HH:mm 加分鐘（不跨日，超過就停在 23:59）
function calAddMinutes_(hhmm, minutes) {
  var p = String(hhmm).split(":");
  var total = Math.min(Number(p[0]) * 60 + Number(p[1]) + minutes, 23 * 60 + 59);
  return ("0" + Math.floor(total / 60)).slice(-2) + ":" + ("0" + (total % 60)).slice(-2);
}

// 事件在 Google 上的結束時間：有填就用，沒填用預設長度；全天事件（沒開始時間）沒有結束時間
function calEndTime_(time, endTime) {
  if (!time) return "";
  return endTime ? String(endTime) : calAddMinutes_(time, CAL_DURATION_MIN);
}

// 純函式：App 裡「應該出現在 Google 行事曆上」的事件清單。
// 回傳 [{ key, title, date, time, description }]；time 為空 = 全天事件。
function desiredCalendarEvents_(events, rules, exceptions, todayStr) {
  var out = [];
  var from = calAddDays_(todayStr, -CAL_PAST_DAYS);
  var oneOffTo = calAddDays_(todayStr, CAL_ONEOFF_DAYS);
  var recurTo = calAddDays_(todayStr, CAL_RECUR_DAYS);

  (events || []).forEach(function (e) {
    var hidden = e.hideFromCalendar === true || e.hideFromCalendar === "TRUE" || e.hideFromCalendar === "true";
    var date = String(e.date || "");
    if (hidden || !e.id || date < from || date > oneOffTo) return;
    out.push({ key: "e:" + e.id, title: calTitle_(e.owner, e.title), date: date, time: e.time ? String(e.time) : "", endTime: calEndTime_(e.time, e.endTime), description: String(e.notes || "") });
  });

  var skipped = {};
  (exceptions || []).forEach(function (x) { skipped[x.recurringId + "|" + x.date] = true; });
  (rules || []).forEach(function (r) {
    if (!r.id) return;
    for (var d = from; d <= recurTo; d = calAddDays_(d, 1)) {
      if (r.endDate && d > String(r.endDate)) break;
      var hit = r.frequency === "weekly" ? calWeekday_(d) === Number(r.dayOfWeek)
        : r.frequency === "monthly" ? Number(d.slice(8, 10)) === Number(r.dayOfMonth) : false;
      if (!hit || skipped[r.id + "|" + d]) continue;
      out.push({ key: "r:" + r.id + ":" + d, title: calTitle_(r.owner, r.title), date: d, time: r.time ? String(r.time) : "", endTime: calEndTime_(r.time, r.endTime), description: String(r.notes || "") });
    }
  });
  return out;
}

// 純函式：期望清單 vs 行事曆上帶標記的現有事件（[{key, title, date, time, description, ref}]）→ 要做的差異。
// 同一個 key 在行事曆上出現多次（不該發生）時，多的算要刪除。
function planCalendarSync_(desired, existing) {
  var byKey = {};
  var plan = { create: [], update: [], del: [], unchanged: 0 };
  (existing || []).forEach(function (ex) {
    if (byKey[ex.key]) plan.del.push(ex); else byKey[ex.key] = ex;
  });
  var wanted = {};
  (desired || []).forEach(function (d) {
    wanted[d.key] = true;
    var ex = byKey[d.key];
    if (!ex) { plan.create.push(d); return; }
    var same = ex.title === d.title && ex.date === d.date && ex.time === d.time && ex.endTime === d.endTime && ex.description === d.description;
    if (same) plan.unchanged++; else plan.update.push({ existing: ex, desired: d });
  });
  Object.keys(byKey).forEach(function (k) { if (!wanted[k]) plan.del.push(byKey[k]); });
  return plan;
}

// ---- 以下碰 CalendarApp，薄薄一層（測試時用假的 cal 物件） ----

function calStart_(d) {
  return new Date(d.date + "T" + d.time + ":00+08:00"); // 台灣沒有日光節約，固定 +08:00
}

function calEnd_(d) {
  return new Date(d.date + "T" + d.endTime + ":00+08:00");
}

function calDay_(dateStr) {
  var p = dateStr.split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); // 全天事件用「日期」，依腳本時區
}

function readExistingCalendarEvents_(cal, todayStr) {
  var from = calDay_(calAddDays_(todayStr, -CAL_PAST_DAYS));
  var to = calDay_(calAddDays_(todayStr, CAL_ONEOFF_DAYS + 2));
  var out = [];
  cal.getEvents(from, to).forEach(function (ev) {
    var key = ev.getTag(CAL_TAG);
    if (!key) return; // 不是本 App 同步出去的，不碰
    var allDay = ev.isAllDayEvent();
    out.push({
      key: key,
      title: ev.getTitle(),
      date: allDay ? Utilities.formatDate(ev.getAllDayStartDate(), Session.getScriptTimeZone(), "yyyy-MM-dd") : Utilities.formatDate(ev.getStartTime(), TIME_ZONE, "yyyy-MM-dd"),
      time: allDay ? "" : Utilities.formatDate(ev.getStartTime(), TIME_ZONE, "HH:mm"),
      endTime: allDay ? "" : Utilities.formatDate(ev.getEndTime(), TIME_ZONE, "HH:mm"),
      description: ev.getDescription() || "",
      ref: ev,
    });
  });
  return out;
}

function createCalendarEvent_(cal, d) {
  var ev;
  if (d.time) {
    ev = cal.createEvent(d.title, calStart_(d), calEnd_(d), { description: d.description });
  } else {
    ev = cal.createAllDayEvent(d.title, calDay_(d.date), { description: d.description });
  }
  ev.setTag(CAL_TAG, d.key);
  return ev;
}

function applyCalendarPlan_(cal, plan) {
  plan.create.forEach(function (d) { createCalendarEvent_(cal, d); });
  plan.update.forEach(function (u) {
    var ex = u.existing, d = u.desired;
    if (!!ex.time !== !!d.time) { // 全天 ↔ 定時 互換：刪掉重建
      ex.ref.deleteEvent();
      createCalendarEvent_(cal, d);
      return;
    }
    ex.ref.setTitle(d.title);
    ex.ref.setDescription(d.description);
    if (d.time) {
      ex.ref.setTime(calStart_(d), calEnd_(d));
    } else if (ex.date !== d.date) {
      ex.ref.setAllDayDate(calDay_(d.date));
    }
  });
  plan.del.forEach(function (ex) { ex.ref.deleteEvent(); });
}

function summarizePlan_(plan, dryRun) {
  var short = function (d) { return d.date + (d.time ? " " + d.time + (d.endTime ? "–" + d.endTime : "") : "") + " " + d.title; };
  return {
    dryRun: !!dryRun,
    created: plan.create.length, updated: plan.update.length, deleted: plan.del.length, unchanged: plan.unchanged,
    preview: {
      create: plan.create.slice(0, 30).map(short),
      update: plan.update.slice(0, 30).map(function (u) { return short(u.desired); }),
      del: plan.del.slice(0, 30).map(short),
    },
  };
}

// 對帳（cal 可注入，測試用）。dryRun 只算不動。
function reconcileWith_(cal, data, todayStr, dryRun) {
  var desired = desiredCalendarEvents_(data.events, data.rules, data.exceptions, todayStr);
  var existing = readExistingCalendarEvents_(cal, todayStr);
  var plan = planCalendarSync_(desired, existing);
  // 保險：資料表讀不到（desired 全空）卻要刪掉一堆事件，八成是讀取出問題，中止而不是清空行事曆
  if (!dryRun && !desired.length && plan.del.length > 5) throw new Error("對帳會刪除全部 " + plan.del.length + " 個事件，疑似資料表讀取異常，已中止");
  if (!dryRun) applyCalendarPlan_(cal, plan);
  return summarizePlan_(plan, dryRun);
}

function reconcileCalendar_(dryRun) {
  var id = calendarId_();
  if (!id) throw new Error("還沒設定 CALENDAR_ID（Apps Script 指令碼屬性）");
  var cal = CalendarApp.getCalendarById(id);
  if (!cal) throw new Error("找不到這個行事曆，請確認 CALENDAR_ID，以及這個帳號有編輯權限");
  var props = PropertiesService.getScriptProperties();
  var todayStr = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
  var data = {
    events: sheetToObjects(getSheet("Events")),
    rules: sheetToObjects(getSheet("RecurringEvents")),
    exceptions: sheetToObjects(getSheet("RecurringExceptions")),
  };
  try {
    var res = reconcileWith_(cal, data, todayStr, dryRun);
    if (!dryRun) {
      props.setProperty("CAL_LAST_SYNC", new Date().toISOString());
      props.deleteProperty("CAL_LAST_ERROR");
      props.deleteProperty("CAL_DIRTY");
    }
    return res;
  } catch (err) {
    if (!dryRun) props.setProperty("CAL_LAST_ERROR", String(err && err.message ? err.message : err));
    throw err;
  }
}

// 網頁用：立即同步（可帶 dryRun=true 先預覽）
function syncCalendarNow(dryRun) {
  return reconcileCalendar_(dryRun === true || dryRun === "true");
}

function getCalendarSyncStatus() {
  var props = PropertiesService.getScriptProperties();
  return {
    enabled: !!calendarId_(),
    dirty: props.getProperty("CAL_DIRTY") === "1",
    lastSyncAt: props.getProperty("CAL_LAST_SYNC") || "",
    lastError: props.getProperty("CAL_LAST_ERROR") || "",
  };
}

// 時間觸發器：每 5 分鐘（有待同步旗標才做事）、每天一次（完整對帳，循環行程視窗往前滾）。
// 觸發器沒有走 handleRequest，要自己跟網頁的寫入搶同一把鎖。
function runCalendarSyncSafely_(onlyIfDirty) {
  if (!calendarId_()) return;
  if (onlyIfDirty && PropertiesService.getScriptProperties().getProperty("CAL_DIRTY") !== "1") return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // 有人正在寫入，下一輪再說
  try {
    reconcileCalendar_(false);
  } catch (err) {
    Logger.log("行事曆同步失敗：" + err);
  } finally {
    lock.releaseLock();
  }
}
function calendarSyncTick() { runCalendarSyncSafely_(true); }
function calendarSyncDaily() { runCalendarSyncSafely_(false); }

// ---- 手動執行的函式 ----
// 一次性的設定函式 authorizeCalendar()（跳出授權視窗、確認 CALENDAR_ID）與 installCalendarTriggers()
// （建立 calendarSyncTick 每 5 分鐘、calendarSyncDaily 每天 4 點兩個觸發器）已經執行完並移除。
// 觸發器與授權都會留著，換新版部署也不受影響；需要重建時到 git 歷史找這兩個函式。
//
// 下面這個是退場／重來用的，等同步穩定了再決定要不要也刪掉。
// 要退場或重來時：刪掉行事曆上所有帶本 App 標記的事件（別人手動加的不動）
function clearSyncedCalendarEvents() {
  var cal = CalendarApp.getCalendarById(calendarId_());
  var todayStr = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
  var n = 0;
  cal.getEvents(calDay_(calAddDays_(todayStr, -400)), calDay_(calAddDays_(todayStr, 800))).forEach(function (ev) {
    if (ev.getTag(CAL_TAG)) { ev.deleteEvent(); n++; }
  });
  return "已刪除 " + n + " 個同步出去的事件";
}
