# 寵物驗血（寵物頁 → 驗血 → ＋ 新增驗血 →「貼上匯入」）

一份報告一個 JSON（歷史報告有好幾份就各給一個，使用者逐份貼）。

```json
{ "pet": "咪嚕", "date": "2026-10-10", "items": [ { "name": "ALT", "value": 45, "unit": "U/L", "refLow": 10, "refHigh": 100 }, { "name": "BUN", "value": 28, "unit": "mg/dL", "refLow": 16, "refHigh": 36 } ] }
```

## 規則
- `pet` 必須是 **林萌**（狗）或 **咪嚕**（貓）。報告上的寵物名字、種類（犬／貓）對得上就用；對不上或沒寫要先問，不要猜。
- `date` 是**這份報告的檢驗日期**（西元 `yyyy-MM-dd`；民國年要換）。IDEXX 報告常把「這次」與「前一次」並排：**這次**在左邊（日期在項目名稱欄的括號裡），**前一次**的日期與數值在右邊。使用者要匯入前一次時，也各給一個 JSON。
- `name` 用報告上的縮寫，**每次一致**，歷史報告才會接成同一條趨勢線：`RBC HCT HGB MCV MCH MCHC RDW %RETIC RETIC RETIC-HGB WBC %NEU %LYM %MONO %EOS %BASO NEU LYM MONO EOS BASO PLT MPV PDW PCT GLU CREA BUN BUN/CREA TP ALB GLOB ALB/GLOB ALT AST ALKP Na K Na/K Cl Osm Calc`，以及 `SDMA TBIL CHOL TRIG Ca PHOS T4`。報告上沒有縮寫的項目用報告上的名稱。
- `value` 純數字；`unit` 照報告（例如 `M/µL`、`K/µL`、`mg/dL`、`U/L`、`mmol/L`、`g/dL`、`%`、`pg`、`fL`）；**不要換算單位**。
- `refLow`、`refHigh`：照**這份報告印的參考範圍**抄（寵物的範圍依物種與檢驗所而不同，不要用人的、不要自己補）；範圍只印「<100」就只給 `refHigh`；沒印範圍的項目（例如 %NEU、BUN/CREA）省略兩者。
- **前一次的欄位通常沒有印參考範圍，只有色條**。若兩次是同一台機器、同一物種，而色條位置顯示範圍相同，才可以沿用這次的範圍；要在回覆裡**明講這是沿用**。
- 不是數字的結果（例如 nRBC「疑似」）不要放；「<0.5」「>1000」先問使用者。
- 「這隻本來就偏低、醫師說沒關係」不是匯入的一部分，使用者在頁面上用「個人化設定」自己設。

貼到：寵物頁 → 選寵物 → 驗血 → ＋ 新增驗血 →「貼上匯入」→「填入表單」→ 核對後按「新增」（同一天同寵物同名稱會更新）。
