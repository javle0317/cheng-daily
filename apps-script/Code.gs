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
 *   HabitLog        欄位: id | habitId | periodKey | count | createdAt
 *   RecurringEvents 欄位: id | owner | title | time | notes | frequency | dayOfWeek | dayOfMonth | createdAt
 *   RecurringExceptions 欄位: id | recurringId | date | createdAt
 *   ShoppingList    欄位: id | item | done | createdAt
 *   BloodPressure   欄位: id | date | period | systolic | diastolic | pulse | createdAt
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
      case "toggleHabitLog":
        return respond({ ok: true, data: toggleHabitLog(p.habitId, p.periodKey, p.target) });
      case "deleteHabit":
        return respond({ ok: true, data: deleteHabit(p.id) });
      case "addRecurringEvent":
        return respond({
          ok: true,
          data: addRecurringEvent(
            p.owner, p.title, p.time, p.notes, p.frequency, p.dayOfWeek, p.dayOfMonth
          ),
        });
      case "deleteRecurringEvent":
        return respond({ ok: true, data: deleteRecurringEvent(p.id) });
      case "addRecurringException":
        return respond({ ok: true, data: addRecurringException(p.recurringId, p.date) });
      case "deleteRecurringException":
        return respond({ ok: true, data: deleteRecurringException(p.id) });
      case "addShoppingItem":
        return respond({ ok: true, data: addShoppingItem(p.item) });
      case "toggleShoppingItem":
        return respond({ ok: true, data: toggleShoppingItem(p.id) });
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
        } else if (h === "date" || h === "periodKey") {
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

function addRecurringEvent(owner, title, time, notes, frequency, dayOfWeek, dayOfMonth) {
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
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
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

// ====== 一次性搬移：把舊的「Bank」試算表（年度分頁，每個月固定 9 列：月份
// 標題、欄位標題、6 家銀行各一列、小計列）搬進 CreditCardBills 分頁。整段
// （含下面的常數跟輔助函式）只要執行過一次，執行完就可以整段刪除——跟
// migrateBloodPressureFromPressure2026（已刪除）是同一個模式，GitHub Pages
// 網頁不會呼叫它，要在 Apps Script 編輯器手動選
// migrateCreditCardBillsFromBankSheet 執行（故意不加結尾底線，理由同上：底線
// 結尾會被「選取要執行的函式」下拉選單隱藏）。搬全部 5 個年度分頁
// （2022~2026）。第一次執行會跳出要求存取「其他試算表」的授權視窗，允許即可。
// 結果（搬了幾筆、跳過幾個看不懂的月份區塊）看執行紀錄。
// ======
var SOURCE_BANK_SHEET_ID = "1l2aYebEu1d4OeKeO_e3nQUAduPlubFN0sZOPowBYzLg";
var SOURCE_BANK_YEAR_TABS = ["2022", "2023", "2024", "2025", "2026"];
var SOURCE_BANK_NAMES = ["聯邦", "國泰", "中信", "富邦", "兆豐", "玉山"];

function migrateCreditCardBillsFromBankSheet() {
  var sourceSs = SpreadsheetApp.openById(SOURCE_BANK_SHEET_ID);
  var targetSheet = getSheet("CreditCardBills");
  var rowsToAppend = [];
  var skipped = [];

  SOURCE_BANK_YEAR_TABS.forEach(function (tabName) {
    var tab = sourceSs.getSheetByName(tabName);
    if (!tab) { Logger.log("找不到分頁: " + tabName); return; }
    var values = tab.getDataRange().getValues();

    for (var i = 0; i < values.length; i++) {
      var cellA = values[i][0];
      var monthMatch = typeof cellA === "string" && cellA.match(/^(\d{4})\/(\d{1,2})$/);
      if (!monthMatch) continue;

      var billingMonth = monthMatch[1] + "-" + pad2Bill_(parseInt(monthMatch[2], 10));

      // 月份標題下一列是欄位標題列（跳過），再下面固定依序 6 家銀行
      for (var b = 0; b < SOURCE_BANK_NAMES.length; b++) {
        var rowIndex = i + 2 + b;
        if (rowIndex >= values.length) break;
        var row = values[rowIndex];
        var bankName = row[0];
        if (bankName !== SOURCE_BANK_NAMES[b]) {
          skipped.push(tabName + " " + billingMonth + "：第" + (b + 1) + "家銀行應該是 " +
            SOURCE_BANK_NAMES[b] + " 但讀到 \"" + bankName + "\"，這個月份區塊整段跳過");
          break;
        }

        var full = row[2];
        if (full === "" || full === null || !(Number(full) > 0)) continue; // 這家銀行這個月沒有帳單

        var paid = row[4];
        rowsToAppend.push([
          Utilities.getUuid(),
          bankName,
          billingMonth,
          formatBankDate_(row[1]),
          Number(full) || 0,
          Number(row[3]) || 0,
          (paid === "" || paid === null) ? "" : (Number(paid) || 0),
          new Date(),
        ]);
      }
    }
  });

  if (rowsToAppend.length > 0) {
    var startRow = targetSheet.getLastRow() + 1;
    targetSheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }

  Logger.log("搬了 " + rowsToAppend.length + " 筆，跳過 " + skipped.length + " 個格式看不懂的月份區塊：");
  Logger.log(skipped.join("\n"));
}

function pad2Bill_(n) {
  return n < 10 ? "0" + n : String(n);
}

function formatBankDate_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, TIME_ZONE, "yyyy-MM-dd");
  }
  if (typeof v === "string") {
    return v.trim().replace(/\//g, "-");
  }
  return "";
}

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
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet("HabitLog");
    var values = sheet.getDataRange().getValues();
    var maxTarget = parseInt(target, 10) || 1;

    var matchingRows = [];
    for (var i = 1; i < values.length; i++) {
      if (values[i][1] === habitId && String(values[i][2]) === String(periodKey)) {
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
    .filter(function (r) { return matchesRecurringRule_(r, todayDate) && !skippedToday[r.id]; })
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

function matchesRecurringRule_(rule, dateObj) {
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
