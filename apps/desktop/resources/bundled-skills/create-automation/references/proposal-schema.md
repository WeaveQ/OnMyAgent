# Automation proposal schema

## Required fields

```json
{
  "scene": "office",
  "title": "每日应收催收看板",
  "prompt": "读取 ar-ledger.json，刷新今日催收清单与话术档，并更新 .process 看板。若数据没有变化，简短说明。",
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

- `scene`: `office` for document/data/operations work; `code` for repository and development work.
- `title`: concise user-facing task name.
- `prompt`: complete standalone instructions for a fresh automation run.
- `schedule.mode`: `interval`, `weekly`, or `once`.
- `schedule.day`: `daily`, `weekly`, `biweekly`, `monthly`, or `yearly`.
- `schedule.time`: local `HH:mm` using 24-hour time.
- `enabled`: normally `true`.

## Schedule fields

- `intervalMinutes`: required for `interval`; integer from 5 through 43200.
- `weekdays`: optional array using Monday `1` through Sunday `7`.
- `onceAt`: required for `once`; Unix epoch milliseconds.
- `timezone`: IANA timezone such as `Asia/Shanghai`. Use the user's known local timezone; ask if it is unknown and materially important.

Examples:

```json
{
  "mode": "weekly",
  "day": "weekly",
  "time": "18:00",
  "weekdays": [5],
  "timezone": "Asia/Shanghai"
}
```

```json
{
  "mode": "once",
  "day": "daily",
  "time": "14:30",
  "onceAt": 1785133800000,
  "timezone": "Asia/Shanghai"
}
```

## Optional fields

```json
{
  "effectiveRange": {
    "startDate": "2026-08-01",
    "endDate": "2026-12-31"
  },
  "accessMode": "default",
  "model": {
    "providerID": "openai",
    "modelID": "gpt-5.2"
  }
}
```

- `effectiveRange` dates use `YYYY-MM-DD`; start must not be after end.
- `accessMode`: `default` or `full`. Prefer `default`; use `full` only when the user explicitly needs unrestricted workspace operations and understands the risk.
- `model`: include only for an explicit model override.

Do not write `sourceSessionId`, `workspaceDirectory`, run state, timestamps, or task IDs. OnMyAgent owns those fields.

## Output rules

- Path: `automations/proposals/<descriptive-slug>.json`
- Encoding: UTF-8
- Format: one JSON object, no comments or Markdown fence
- Filename: lowercase letters, digits, and hyphens
