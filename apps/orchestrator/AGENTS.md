# apps/orchestrator — Agent 手册

Host 进程编排：嵌入 server、spawn OpenCode、sidecar、sandbox、CLI/TUI。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)。

## 默认验证

从仓库根目录：

```bash
pnpm task check orchestrator
git diff --check
```

按变更范围选用：

```bash
pnpm task test orchestrator          # 包内全量 unit
pnpm task test orchestrator:cli-args # 或 runtime-auth / runtime-health / runtime-sandbox 等专项
pnpm test:runtime                    # Electron bridge + orchestrator runtime smoke（触及 spawn/sidecar 时）
```

本地开发：

```bash
pnpm dev -- orchestrator -- start --workspace <path> --approval auto --allow-external
```

`pnpm dev` 会设 `ONMYAGENT_DEV_MODE=1`，使用隔离 OpenCode 状态，勿复用个人生产环境配置。

## 必读链接

| 文档 | 用途 |
|------|------|
| [`README.md`](./README.md) | CLI 标志、sidecar、sandbox、下载策略 |
| [`../../AGENTS.md`](../../AGENTS.md) | Human gate · 双运行时 · 验证矩阵 |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | 双运行时 · 进程边界 · Runtime |

## 硬边界

- `apps/orchestrator/src/**` 属 **Human gate**：改前说明原因，改后完整验证（至少 typecheck + 相关 unit）。
- Orchestrator 编排主轨 server + OpenCode；**不是** Personal Local Agent 辅轨。禁止把辅轨 store/archive 写进主轨路径。
- 默认 stdout **不打印** live pairing/token 等密钥；需要原始输出时才用显式 `--json`（且勿把密钥写入日志/提交）。
- sidecar / sandbox 策略走已有 resolve 与 env 合同（`ONMYAGENT_SIDECAR_*`、`--sidecar-source` 等）；勿写死用户家目录或个人 binary 路径。
- 打包/发布走 `scripts/publish-npm.mjs` 与 sidecar 构建链路；不要用包内 `prepublishOnly` 当发布入口。

## 热点模块（改前先定位）

| 区域 | 职责 |
|------|------|
| `src/cli.ts` · `cli-commands/*` | CLI 入口与子命令 |
| `src/runtime-*.ts` | spawn / health / auth / sandbox / services |
| `src/sidecar-config.ts` · `version-manifest.ts` | sidecar 解析与清单 |
| `src/tui/*` | 交互状态面板 |
| `tests/*` | 与上面对齐的 unit 面 |
