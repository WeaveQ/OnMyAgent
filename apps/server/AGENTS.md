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
- 会话真相源在 server-owned Primary Runtime 主轨（OpenCode / Grok Build adapter + canonical archive）；禁止与 Personal Local Agent 辅轨交叉写 archive。
- Expert identity/list 的权威读模型是 revisioned origins + marker inventory + workspace session aggregate 生成的 `Expert Directory`。renderer 不得承担 origin 恢复、404 删除推断或路径身份推断。
- Expert runtime 写入、heal、prompt contract 与删除 saga 都是 server owner；写入必须 revision-checked、路径授权、失败闭合。生命周期诊断只记录 allow-listed 计数/枚举/单向 hash，不得记录 prompt、message body、token、secret、原始 home path 或用户文件内容。
