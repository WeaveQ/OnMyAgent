# OnMyAgent 定时任务约定 — 挂靠车管

## 门禁

- **必须用户确认** 后才创建/启用定时任务。
- 失败如实说明；不假装已监控。

## 推荐任务

| 标题 | 调度 | 作用 |
| --- | --- | --- |
| 挂靠车管·每日到期扫描 | 每天 09:00（interval 1440m） | 读 `fleet-ledger.json`，刷新 D-30/15/7/过期与高风险 |
| 单车下一到期节点 | `mode: once`，D-30 / D-15 / D-7 / 到期日中最近的未来节点 09:00 | 复核单车单项资料并生成对内催办话术 |

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

export 后提案写入 `automations/proposals/`：一个每日扫描提案，以及每台车一个“下一到期节点” once 提案。专家宿主在会话内容区弹出选项（自动创建 / 暂不）；缺必填则继续询问，选填可跳过，最后确认后调用 `createAutomation`（同标题已存在则跳过）。创建成功后展示结果表并可跳转助理-办公-自动化任务。不依赖聊天触发语，也不会自动停运、清退、处罚或发送外部消息。
