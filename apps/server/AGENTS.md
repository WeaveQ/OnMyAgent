# apps/server — Agent 手册

本地 HTTP API：workspace / session / skill / MCP / 审批，SQLite，SSE。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)。本页 = **验证入口 + 本包硬边界**；Dual Runtime / archive-pool / delete-saga 政策见 Architecture。

## 默认验证

```bash
pnpm task check server
git diff --check
```

按变更范围选用：`pnpm test:unit`、`pnpm test:api`。

## 必读链接

| 文档 | 用途 |
|------|------|
| [`../../AGENTS.md`](../../AGENTS.md) | 全仓铁律 · Human gate |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | Dual Runtime · Server Archive Runtime · Expert lifecycle |

## 硬边界

- `apps/server/src/**` 属 Human gate：改前说明原因，改后完整验证。
- Archive pool / change-bus / Dual Runtime / delete-saga：Architecture **Server Archive Runtime**、**Dual Runtime Boundary**、Expert lifecycle。新增代码勿绕过 pool 裸 open。
- 生命周期诊断只记录 allow-listed 计数/枚举/单向 hash，不得记录 prompt、message body、token、secret、原始 home path 或用户文件内容。
