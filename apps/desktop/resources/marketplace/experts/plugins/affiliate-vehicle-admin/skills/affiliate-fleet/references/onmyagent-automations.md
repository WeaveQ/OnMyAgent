# OnMyAgent 定时任务约定 — 挂靠车管

## 门禁

- **必须用户确认** 后才创建/启用定时任务。  
- 失败如实说明；不假装已监控。

## 推荐任务

| 标题 | 调度 | 作用 |
| --- | --- | --- |
| 挂靠车管·每日到期扫描 | 每天 09:00（interval 1440m） | 读 `fleet-ledger.json`，刷新 D-30/15/7/过期与高风险 |
| 某车交强险到期 once | `mode: once` 到期前 7 天 09:00 | 单车催续保话术 |

`scene`: `"office"`。

## 载荷示例

```json
{
  "scene": "office",
  "title": "挂靠车管·每日到期扫描",
  "prompt": "你是挂靠车管作业专家。读取 fleet-ledger.json，按 expiry-alerts 刷新到期与高风险清单，更新 .process；禁止编造证件日期。",
  "schedule": {
    "mode": "interval",
    "day": "daily",
    "time": "09:00",
    "intervalMinutes": 1440,
    "timezone": "Asia/Shanghai"
  },
  "enabled": true
}
```

export 后提案写入 `automations/proposals/`。用户回复「确认创建」时，专家宿主自动调用 `createAutomation` 落库；同标题已存在则跳过。
