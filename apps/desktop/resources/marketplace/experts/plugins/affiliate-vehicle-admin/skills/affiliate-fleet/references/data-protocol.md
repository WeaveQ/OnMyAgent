# 挂靠车管数据协议与产物约定

会话根目录直接落文件，**禁止**多余 `output/` 套层。

## 目录

| 路径 | 用途 |
| --- | --- |
| `fleet-ledger.json` | 单一数据源：车辆/司机/证件/保险/年检/违章 |
| `.process/expiry-board.md` | 到期分级看板 |
| `.process/high-risk.md` | 高风险清单 |
| `挂靠车台账_*.csv` | 结果：台账导出 |
| `催办话术_*.md` | 结果：对司机/车主催补证话术 |
| `automations/proposals/*.json` | 定时任务草稿 |

## `fleet-ledger.json` 最小结构

```json
{
  "asOfDate": "2026-07-21",
  "alertThresholds": { "d30": 30, "d15": 15, "d7": 7 },
  "vehicles": [
    {
      "plate": "粤B12345",
      "driverName": "张三",
      "driverPhone": "",
      "ownerOrAffiliate": "挂靠-某某公司",
      "docs": {
        "driverLicenseExpire": "2026-08-01",
        "qualificationExpire": "2026-09-01",
        "vehicleLicenseExpire": "2026-12-01",
        "operationPermitExpire": "2026-10-01"
      },
      "insurance": {
        "compulsoryExpire": "2026-07-28",
        "commercialExpire": "2026-08-15"
      },
      "annualInspectionExpire": "2026-11-01",
      "violationsOpen": 2,
      "riskFlags": [],
      "notes": ""
    }
  ],
  "userConfirmedAutomations": false
}
```

字段细节见 `ledger-fields.md`；到期分级见 `expiry-alerts.md`。

## 命令

```bash
python3 <Skill根目录>/scripts/build_fleet_artifacts.py --input fleet-ledger.json --output-dir . --mode preview
python3 <Skill根目录>/scripts/build_fleet_artifacts.py --input fleet-ledger.json --output-dir . --mode export
```
