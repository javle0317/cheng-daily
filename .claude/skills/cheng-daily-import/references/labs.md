# 驗血（人）（健康頁 → 驗血 →「貼上匯入」）

```json
{ "date": "2026-10-07", "values": { "glucose": 98, "hba1c": 5.6 }, "extra": [{ "name": "項目名稱", "value": 12.3, "unit": "mg/dL", "refLow": 5, "refHigh": 20 }] }
```

## `values` 可用的鍵（固定項目，App 有醫學分級）
`glucose` 空腹血糖、`hba1c`、`cholesterol` 總膽固醇、`ldl`、`hdl`、`triglyceride`、`ast`、`alt`、`creatinine`、`egfr`、`bun`、`uricAcid`、`sodium`、`potassium`、`tsh`、`ck`。

- 值給**純數字**（不要單位、不要千分位以外的符號）。
- 報告上有、但**不在上面清單**的項目放進 `extra`：`name`（不能重複）、`value`，`unit`、`refLow`、`refHigh` 可省略。`refLow`／`refHigh` 照**報告上印的參考範圍**抄；只印一邊就只給一邊；沒印就省略。
- **單位換算要先做好再給**：血糖用 mg/dL（不要給 mmol/L）。有疑問就問，不要硬換。
- 報告沒有的欄位直接省略。「<0.5」「>1000」這類不是精確數值的結果先問使用者怎麼處理。
- 日期民國年換西元；沒有日期就問。

貼到：健康頁 → 驗血 → ＋ 新增驗血紀錄 →「貼上匯入」→「填入表單」→ 核對後按「新增」。
