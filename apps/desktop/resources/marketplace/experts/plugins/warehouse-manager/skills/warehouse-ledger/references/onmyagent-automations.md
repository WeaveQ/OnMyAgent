# OnMyAgent 定时任务约定 — 仓储作业

## 门禁

- **用户确认后** 才创建定时任务。  
- 失败如实说明。

## 推荐任务

| 标题 | 调度 | 作用 |
| --- | --- | --- |
| 仓储·每日库存简报 | 每天 18:00 | 读 `warehouse-ledger.json`，输出当日进销存与异常/滞留 |
| 仓储·滞留扫描 | 每天 09:30 | 刷新超期滞留清单给调度 |

`scene`: `"office"`。

export 后提案写入 `automations/proposals/`。用户回复「确认创建」时，专家宿主自动调用 `createAutomation` 落库；同标题已存在则跳过。

## 载荷示例

```json
{
  "scene": "office",
  "title": "仓储·每日库存简报",
  "prompt": "你是仓储作业专家。读取 warehouse-ledger.json，按 anomaly-playbook 刷新异常与滞留，生成当日进销存简报到 .process；禁止编造件数。",
  "schedule": {
    "mode": "interval",
    "day": "daily",
    "time": "18:00",
    "intervalMinutes": 1440,
    "timezone": "Asia/Shanghai"
  },
  "enabled": true
}
```
