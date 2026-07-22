# 油费稽核数据协议

会话根目录只维护一份 `fuel-audit-data.json`。过程看板写入 `.process/`，最终报告和 CSV 直接写在会话根目录；禁止再套 `output/`。

```json
{
  "asOfDate": "2026-07-23",
  "period": "2026 年 6 月",
  "vehicles": [
    {
      "plate": "皖A·D8201",
      "driver": "张师傅",
      "vehicleType": "9.6 高栏",
      "lane": "合肥-广州",
      "tankCapacityLiters": 400,
      "distanceKm": 1000,
      "baseline": { "low": 24, "high": 28, "source": "fleet-history" },
      "fills": [
        {
          "at": "2026-06-12 08:20",
          "station": "合肥东站",
          "stationRegion": "合肥",
          "vehicleRegionAtFill": "合肥",
          "liters": 190,
          "amount": 1450,
          "isNetworkStation": true,
          "distanceSincePreviousKm": null
        }
      ]
    }
  ]
}
```

## 约束

- `plate` 是对齐车辆、油卡、里程、轨迹和任务单的主键；模糊车牌进入待确认，不猜。
- `distanceKm` 是当前稽核周期里程；脚本只在它大于 0 且有升数时计算 L/100km。
- `baseline.low/high` 优先使用同车同线历史或车队确认值；示意基准的 `source` 必须写 `illustrative`。
- `fills[].distanceSincePreviousKm` 是该笔与前一笔之间的里程，用于短里程重复加油判断。
- 只有同时提供 `stationRegion` 与 `vehicleRegionAtFill` 才判断时空矛盾。
- 规则命中是线索，不是对司机偷油、套现或违规的事实认定。

## 脚本

```bash
python3 <Skill根目录>/scripts/build_fuel_audit.py \
  --input fuel-audit-data.json --output-dir . --mode preview

python3 <Skill根目录>/scripts/build_fuel_audit.py \
  --input fuel-audit-data.json --output-dir . --mode export
```

- `preview`：刷新 `.process/fuel-audit-board.md` 与 `.process/fuel-high-risk.md`。
- `export`：另生成油费稽核报告、单车油耗汇总 CSV、异常明细 CSV，以及 `automations/proposals/fuel-weekly-scan.json`。
- 自动化 proposal 只能由 OnMyAgent 现有确认流程创建；专家不得直接声称已建立定时任务。
