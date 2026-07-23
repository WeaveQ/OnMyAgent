# 运力调配数据协议

会话根目录使用 `capacity-dispatch.json`，统一承载本次调度时点、订单与动态运力池。

```json
{
  "asOf": "2026-07-23T10:00:00+08:00",
  "freshness": { "freshMinutes": 60, "agingMinutes": 180 },
  "order": {
    "orderId": "D-001",
    "originRegion": "深圳宝安",
    "destinationRegion": "东莞塘厦",
    "pickupAt": "2026-07-23T15:00:00+08:00",
    "weightKg": 1800,
    "volumeM3": 12,
    "allowedVehicleTypes": ["6.8米高栏", "9.6米厢车"],
    "requiredCapabilities": ["普货"]
  },
  "vehicles": [
    {
      "plate": "粤B10001",
      "driverName": "张师傅",
      "status": "available",
      "currentRegion": "深圳宝安",
      "vehicleType": "6.8米高栏",
      "remainingWeightKg": 8000,
      "remainingVolumeM3": 35,
      "availableAt": "2026-07-23T10:30:00+08:00",
      "willingDestinations": ["东莞", "深圳"],
      "capabilities": ["普货"],
      "emptyDistanceKm": 8,
      "updatedAt": "2026-07-23T09:45:00+08:00",
      "source": "司机微信"
    }
  ]
}
```

## 判定规则

- `updatedAt` 到 `asOf`：不超过 `freshMinutes` 为 fresh，不超过 `agingMinutes` 为 aging，之后为 stale。
- stale、非 available、吨方不足、车型/能力不符、预计可用时间晚于装货时间均硬剔除。
- 候选按新鲜度、起点贴合、目的方向意愿、空驶距离、装载余量确定性计分；输出最多 3 个。
- aging 允许进入候选但必须显式风险提示；缺少关键事实不得靠默认值凑方案。
- 结果是调度建议草稿，不得自动锁车、改运力状态或对司机/客户发送消息。

## 产物

- preview：`.process/capacity-board.md`、`.process/dispatch-options.md`、`.process/rejected-capacity.md`
- export：`运力调配方案_<orderId>.md`、`运力候选_<orderId>.csv`、`司机确认话术_<orderId>.md`
