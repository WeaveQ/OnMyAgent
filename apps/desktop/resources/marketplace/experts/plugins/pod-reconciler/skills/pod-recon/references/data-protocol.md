# 回单对账数据协议

会话根目录维护 `pod-recon-data.json`，每个 `records` 条目对应一票运单。

```json
{
  "asOfDate": "2026-07-23",
  "period": "2026-07",
  "counterparty": "华南承运车队",
  "currency": "CNY",
  "varianceThreshold": 50,
  "largeVarianceThreshold": 2000,
  "settlementRule": "original_required",
  "records": [
    {
      "waybillNo": "WB-001",
      "route": "深圳→东莞",
      "driverName": "张师傅",
      "dueDate": "2026-07-20",
      "podStatus": "missing",
      "podHolder": "司机",
      "fees": {
        "freight": 1800,
        "emptyRun": 0,
        "waiting": 100,
        "unloading": 0,
        "fuelSubsidy": 0,
        "informationFee": 0,
        "penalty": 0,
        "other": 0
      },
      "counterpartyAmount": 2000,
      "varianceReasonCode": "WAITING_FEE",
      "notes": "对方多列等候费100元，待提供签字"
    }
  ]
}
```

`podStatus` 支持 `original`、`electronic`、`photo`、`missing`。`settlementRule` 支持 `original_required`、`electronic_allowed`、`pod_not_required`。

受控差异原因码：`WAITING_FEE`、`EMPTY_RUN`、`UNLOADING_FEE`、`FUEL_SUBSIDY`、`INFORMATION_FEE`、`PENALTY`、`DUPLICATE_LINE`、`MISSING_LINE`、`WAIT_VERIFY`。输入不是受控码或无原因时统一为 `WAIT_VERIFY`，不得编造原因。

## 计算与门禁

- 我方金额 = `fees` 八个分项之和；差异 = 对方金额 - 我方金额。
- `|差异| > varianceThreshold` 进入差异清单；`|差异| > largeVarianceThreshold` 必须人工拍板。
- 原件规则下非 `original` 状态暂缓；电子允许规则下 `electronic`/`photo`/`original` 可通过。
- 缺单号、缺我方费用或缺对方金额的记录进入无法匹配区，不得以 0 补齐。
- 只生成对账草稿，不自动入账、付款、改回单状态或发送催办消息。

## 产物

- preview：`.process/pod-tracker.md`、`.process/reconciliation-draft.md`、`.process/variance-list.md`
- export：`对账单_<period>.csv`、`差异清单_<period>.csv`、`催回单话术_<period>.md`
