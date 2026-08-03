# packages/types — Agent 手册

共享 Zod (v4) schema 与 TypeScript 类型边界（跨 app / desktop / server / orchestrator 的契约）。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)。本页只放 **types 默认入口**。

## 默认验证

从仓库根目录：

```bash
pnpm --filter @onmyagent/types typecheck
# 或（全量类型门禁，含本包）
pnpm task check types
git diff --check
```

改 IPC / server client 契约后，按下游消费面再跑：`pnpm task check app`、`pnpm task check desktop`、`pnpm task check server`（不必一次全开，按触碰面选）。

## 必读链接

| 文档 | 用途 |
|------|------|
| [`README.md`](./README.md) | 公共入口、边界、IPC 命令 SoT |
| [`../../AGENTS.md`](../../AGENTS.md) | 分层依赖 · 铁律 · 验证矩阵 |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | Package Boundaries · Runtime Adapter |

## 硬边界

- **只定义 schema / 类型**，不写业务逻辑；不依赖 `apps/*` 或其他 `packages/*`（`pnpm check:boundaries`）。
- **Zod v4 only**。
- 新增 Electron IPC 命令：改 `src/desktop-ipc-commands.mjs`（运行时命令名 SoT）+ 对应 `desktop-ipc*.ts` 载荷类型；renderer 与 Electron dispatch 都消费该表。
- 新增 server HTTP client 方法：改 `src/server-client-methods.mjs` / `server-client-method-map.ts` 与 `server.ts` 对齐。
- 本包路径在 Allowlist；改契约等于跨包 API 变更——默认小步、可类型检查，避免 silent shape 漂移。

## 热点入口（改前先定位）

| 文件 | 职责 |
|------|------|
| `src/desktop-ipc-commands.mjs` | IPC 命令名分组 SoT |
| `src/desktop-ipc.ts` / `desktop-ipc-*.ts` | IPC 载荷与响应 |
| `src/server.ts` · `server-client-method-map.ts` | 本地 HTTP 合同 |
| `src/session-archive.ts` | 会话 archive 持久化类型 |
| `src/channel.ts` | 消息通道（飞书/微信等）合同 |
| `src/den/*` | Den 策略 / 限制 / inference |
