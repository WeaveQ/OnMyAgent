# 仓储台账数据协议与产物约定

会话根落文件，**禁止**多余 `output/` 套层。

## 目录

| 路径 | 用途 |
| --- | --- |
| `warehouse-ledger.json` | 单一数据源：流水 + 账面 + 异常 |
| `.process/warehouse-preview.html` | 过程：库存看板预览（经 `inlineWidget` 渲染） |
| `库存台账_*.xlsx` | 结果：库存台账（滞留/负库存标红）+ 流水 |
| `库存台账_*.pdf` | 结果：看板+台账+异常（Chrome headless） |
| `automations/proposals/*.json` | 定时任务草稿 |

## `warehouse-ledger.json` 最小结构

```json
{
  "asOfDate": "2026-07-21",
  "site": "深圳福永网点仓",
  "dwellAlertDays": 7,
  "movements": [
    {
      "id": "m1",
      "time": "2026-07-21T10:00:00",
      "type": "in",
      "waybill": "YD-1001",
      "sku": "注塑机",
      "qtyDelta": 2,
      "unit": "台",
      "bin": "A-01",
      "operator": "仓管A",
      "note": ""
    }
  ],
  "balances": [
    {
      "waybill": "YD-1001",
      "sku": "注塑机",
      "bin": "A-01",
      "qty": 2,
      "unit": "台",
      "inboundDate": "2026-07-21",
      "status": "in_stock"
    }
  ],
  "anomalies": [],
  "userConfirmedAutomations": false
}
```

变动类型见 `ledger-fields.md`：`in` / `out` / `transfer` / `count_gain` / `count_loss` / `adjust`。

## 命令

```bash
python3 <Skill根目录>/scripts/build_warehouse_artifacts.py --input warehouse-ledger.json --output-dir . --mode preview
python3 <Skill根目录>/scripts/build_warehouse_artifacts.py --input warehouse-ledger.json --output-dir . --mode export
```
