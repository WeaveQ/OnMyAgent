# OnMyAgent 定时任务（Automation）约定 — 应收催收

专家不仅出对话与台账，还应在 **用户确认后** 把催收节奏落成 OnMyAgent **定时任务**，避免靠人脑记节点。

## 硬性门禁

1. **禁止擅自创建** 定时任务；必须先给出「任务标题 / 触发时间 / 将执行的提示词摘要」，用户明确同意后再创建。  
2. 创建失败时如实说明，不假装已生效。  
3. 不把 token、完整系统提示词贴进用户可见正文。

## 推荐场景 → 调度模板

| 场景 | schedule 建议 | prompt 要点 |
| --- | --- | --- |
| 每日催收看板 | `mode: "interval"`, `intervalMinutes: 1440`, `day: "daily"`, `time: "09:00"` | 读取会话目录 `ar-ledger.json`，刷新 `.process` 看板，列出今日节点与话术档 |
| 某票 D-7 / 到期日 | `mode: "once"`, `onceAt` / `time` 为到期前 7 天或到期日 09:00 | 只处理指定 `invoiceNo`，输出可转发提醒话术 |
| 每周一总览 | `mode: "weekly"`, `day: "weekly"`, `weekdays: [1]`, `time: "09:30"` | 输出本周逾期分层与负责人清单 |

`scene` 固定用 `"office"`（办公场景）。

## createAutomation 载荷形状（与 server 契约对齐）

```json
{
  "scene": "office",
  "title": "应收催收·每日看板",
  "prompt": "你是应收催收作业专家。请读取工作区 ar-ledger.json，按 aging-nodes 规则刷新今日催收清单与话术档，输出 Markdown 看板；无新数据时简短说明。禁止编造金额。",
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

## 交付方式（按环境能力）

1. **有工作区 Automations API**（`POST /workspace/:id/automations`）：用户确认后调用创建，回报任务 id 与 `nextRunAt`。  
2. **仅有文件权限**：把载荷写入 `automations/proposals/<title-slug>.json`，并提示用户在侧栏 **定时任务** 中导入/确认创建。  
3. 无论哪种方式，用户可见回复只保留：**任务列表表** + 一句话确认，不要贴整段 JSON。

## 用户可见确认话术模板

```markdown
建议创建以下定时提醒（需你确认后才会生效）：

| 标题 | 触发 | 作用 |
| --- | --- | --- |
| 应收催收·每日看板 | 每天 09:00 | 刷新今日催收节点与话术 |
| 票 FP2026-001·到期提醒 | 2026-06-30 09:00 一次 | 到期日正式催款话术 |

回复「确认创建」或勾选要创建的行；也可说「先不要定时任务」。
```
