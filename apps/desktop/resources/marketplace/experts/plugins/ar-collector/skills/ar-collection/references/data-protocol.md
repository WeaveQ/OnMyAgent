# 应收催收数据协议与产物约定

会话工作区本身已按专家/会话隔离。**禁止**再建无意义的 `output/` 套层。所有产物写在会话根目录。

## 目录约定

| 路径 | 用途 |
| --- | --- |
| `ar-ledger.json` | 单一业务数据源（台账行、回款、跟进、节点） |
| `.process/ar-board.md` | 过程产物：催收看板 Markdown（可覆盖） |
| `.process/follow-ups.md` | 过程产物：今日/本周催收清单 |
| `应收台账_*.csv` | 结果产物：台账导出（用户确认后） |
| `催收话术_*.md` | 结果产物：分阶段话术包（用户确认后） |
| `automations/proposals/*.json` | 定时任务草稿（用户确认前） |

## `ar-ledger.json` 最小结构

```json
{
  "asOfDate": "2026-07-21",
  "termsDefaults": { "startBasis": "invoice_date", "netDays": 60 },
  "nodes": ["D-7", "due", "+3", "+15"],
  "rows": [
    {
      "id": "inv-001",
      "customer": "某某物流",
      "invoiceNo": "FP2026-001",
      "invoiceDate": "2026-05-01",
      "amountInvoiced": 12000.0,
      "amountPaid": 0,
      "amountOpen": 12000.0,
      "terms": "开票后 net 60",
      "startDate": "2026-05-01",
      "dueDate": "2026-06-30",
      "status": "overdue",
      "owner": "财务小王",
      "nextNode": "+15",
      "riskFlags": ["long_terms"],
      "waybills": ["YD-1001"],
      "lastFollowUp": "",
      "acceptance": null
    }
  ],
  "payments": [],
  "userConfirmedAutomations": false
}
```

字段含义见 `ar-ledger.md`。Agent **只维护本 JSON**；报表/CSV 由脚本从 JSON 生成，禁止手改 CSV 造成不一致。

## 状态机

| 状态 | 进入条件 | 允许产物 |
| --- | --- | --- |
| `collecting` | 缺起算日/金额/客户等关键字段 | 草稿台账、追问清单 |
| `ready` | 台账可算节点，用户未确认定时任务 | 看板、话术草稿、automation proposals |
| `armed` | 用户确认创建/更新定时提醒 | 写入 automations proposals + 结果 CSV/话术包 |

## 生成命令

```bash
python3 <Skill根目录>/scripts/build_ar_artifacts.py \
  --input ar-ledger.json \
  --output-dir . \
  --mode preview
```

- **preview**：只写 `.process/*.md`，不写结果 CSV/话术包。  
- **export**：用户确认后生成 CSV + 话术包 +（可选）automation proposal 文件。

```bash
python3 <Skill根目录>/scripts/build_ar_artifacts.py \
  --input ar-ledger.json \
  --output-dir . \
  --mode export
```
