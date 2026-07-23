# 报价作业数据协议

会话根目录使用 `quote-request.json` 作为单票报价真相源。数字均为客户或企业提供的内部口径，不代表公开市场价。

```json
{
  "asOfDate": "2026-07-23",
  "quoteId": "Q-20260723-001",
  "currency": "CNY",
  "inquiry": {
    "origin": "深圳宝安",
    "destination": "成都双流",
    "cargoName": "注塑配件",
    "weightKg": 1800,
    "volumeM3": 12,
    "vehicleType": "9.6米厢车/零担",
    "requiredHours": 48,
    "pickupRequired": true,
    "deliveryRequired": true,
    "stackable": true,
    "taxIncluded": true,
    "podType": "电子+原件"
  },
  "costBase": {
    "linehaul": 4200,
    "pickup": 500,
    "delivery": 600,
    "handling": 200,
    "pod": 80,
    "insurance": 120,
    "tax": 360,
    "other": 0
  },
  "pricingPolicy": {
    "floorMarginRate": 0.08,
    "targetMarginRate": 0.15,
    "fastestMarkupRate": 0.12,
    "cheapestDiscountRate": 0.06,
    "validHours": 24
  },
  "optionAdjustments": {
    "fastest": { "cost": 500, "hours": 36, "service": "优先直发" },
    "balanced": { "cost": 0, "hours": 48, "service": "标准班次" },
    "cheapest": { "cost": -300, "hours": 72, "service": "可拼载候车" }
  },
  "confirmedSurcharges": ["尾板费已含"],
  "pendingConditions": ["进仓预约等待时长待确认"]
}
```

## 计算约定

- `总基础成本 = costBase` 中所有可解析数字之和。
- 每档 `档位成本 = 总基础成本 + optionAdjustments.<档>.cost`。
- `底价 = 档位成本 / (1 - floorMarginRate)`；任何建议成交价不得低于对应底价。
- 平衡价按目标毛利率倒推；最快价在其目标价上加急系数；最便宜价在目标价上让利，但仍受底价钳制。
- 金额统一保留两位小数，不能解析的值列入缺口而不是当作 0。
- 缺少任何成本数字时只生成结构与缺口，不输出貌似真实的报价金额。

## 产物

- preview：`.process/quote-options.md`、`.process/quote-floor-guard.md`
- export：`报价方案_<quoteId>.md`、`报价方案_<quoteId>.csv`、`砍价话术_<quoteId>.md`
