# Architecture

OnMyAgent 是面向 agentic 工作流的桌面控制台，基于 OpenCode。本地优先，消费 server API surface，不被单一实现锁定。

## Monorepo Skeleton

pnpm monorepo，Turbo 编排构建。根包与 workspace 当前版本以各 `package.json` 为准。

```text
apps/
  desktop/      Electron shell：main.mjs + runtime.mjs，IPC 桥接，sidecar 管理，打包；`electron/personal-agent-runtime/` 托管 multi-agent Personal Local Agent 内核与 adapters；architecture-info、application-menu、startup-flags、Computer Use desktop helper、Code workspace actions、embedded browser panel 与 UI control bridge 已拆为独立模块
    resources/marketplace/ 本地内置 marketplace 内容包：experts/skills 原始资源，打包为 Electron extraResources
  app/          React UI：src/app/lib/ 兼容层 + src/react-app/ 域架构
  server/       本地 HTTP API：workspace/session/skill/MCP/审批，SQLite，SSE 事件流；server.ts 只保留 composition root + OpenCode/配置共享 helper，路由已按 system/dev-ui/runtime/integration/workspace/file/session/import-export/blueprint 等模块注册
    src/        运行时代码：core/routes/services/workspace 分层，根目录只保留入口与编排文件
    tests/      单元/集成测试
    e2e/        HTTP/API 端到端测试
  orchestrator/ 进程编排：嵌入 server，spawn opencode，审批路由，sandbox 管理；env/PATH、data-dir、sidecar target/config、version manifest、sandbox mount helper 已拆为独立模块

packages/
  types/        共享类型与 Zod schema：server API contract, desktop-policies, restrictions, inference
  ui/           Paper shader 视觉组件：仅 React 导出（`@onmyagent/ui/react`）；Solid 已移除
  handsfree/    macOS Computer Use：Swift AX + JS CUA runner
  onmyagent-ui-mcp/ MCP stdio server：暴露 UI 控制面给外部 MCP 客户端
```

默认忽略：`ee/*`、Den Web/API、landing page、cloud dashboard。

## React App Domains

权威 UI 域说明见 `apps/app/src/react-app/ARCHITECTURE.md`。本文件只维护 monorepo 级摘要：

```text
apps/app/src/react-app/
  kernel/          Zustand store + platform/sdk/server provider
  shell/           路由 + boot + layout + command-palette（只编排，不深链 domain 子路径）
  infra/           React-only 运行时基建（如 QueryClient）
  design-system/   产品级复合组件（ConfirmModal、SelectMenu 等）
  domains/
    session/       会话运行时：composer/surface/sync/sidebar/artifacts/browser/voice/goal
    local-agents/  ACP / 本地 agent 编辑、卡片、agent-management
    messaging/     自动化 + 飞书/微信等 messaging channels（桌面 channel 纯单元门禁：`node --test apps/desktop/electron/channels/test/*.test.mjs`，无需 live 凭证）
    agents/        agent registry + 注册表 UI
    workspace/     workspace CRUD + remote + share + files page
    settings/      设置 shell + pages + state stores
    connections/   MCP + provider auth（canonical）
    cloud/         Den auth + restrictions + org onboarding
    plugins/       skills catalog / plugins / connectors pages
    shell-feedback/ reload banner、toast、右上角通知
    shared/        跨域 infra only（env / extension / desktop-config / server-store）
apps/app/src/components/ui/  shadcn/ui atoms（见 DESIGN.md）
apps/app/src/app/lib/        兼容层：desktop.ts、onmyagent-server.ts、opencode.ts
apps/app/src/react-app/domains/session/*-marketplace/*.manifest.json  轻量索引：只供 UI 列表与搜索
```

边界规则：

- `src/app/lib/` 只做桥接层，不直接操作 React state。
- `src/react-app/domains/` 默认通过 kernel / domain barrel 交互，不新增业务 domain 互引。
- UI 组件用 `@/components`；新组件优先 shadcn/ui with Base UI。
- 详细 migration map、路由身份、state ownership 只维护在 `apps/app/src/react-app/ARCHITECTURE.md`。

## Runtime Data Flow

```text
desktop(electron) → runtime.mjs → spawn sidecars
  ├→ opencode binary (sidecar)
  ├→ orchestrator → embed server + spawn router → Slack/Telegram
  └→ server HTTP API ← app(React) 通过 onmyagent-server.ts 调用

app(React) ← desktop.ts(IPC桥) ← preload.mjs ← main.mjs
app(React) ← onmyagent-server.ts(HTTP API) ← server
app(React) ← opencode.ts(SDK) ← opencode binary
app(React) ← @onmyagent/types ← packages/types (Zod schema)
```

## Runtime Adapter (multi-agent harness)

OpenCode 仍是产品 / server 的主会话底座；桌面端在此之上另托管 **Personal Local Agent** 多 agent harness，使 Claude / Codex / Hermes / OpenClaw / OpenCode ACP / Remote ACP / custom CLI 等本地 agent 走同一套 run 事件合同与 UI 路径。实现集中在 `apps/desktop/electron/personal-agent-runtime/`，由 `runtime.mjs` 的 `createDesktopPersonalRuntimeServices` 组装，经 `main.mjs` IPC 暴露给 renderer——**renderer 不直接 import adapters**。

### Adapter contract

权威合同在 `personal-agent-runtime/contract.mjs`：

- `normalizeRunEvent(event)`：把 adapter 原始事件收成统一 `type` + `text`（及透传字段）。未知 `type` 降为 `log`；`chunk` → `assistant_chunk`；部分 `log` 前缀可升格为 `assistant_chunk` / `tool`。
- 规范事件类型（`CONTRACT_EVENT_TYPES` / 内部 `EVENT_TYPES`）：`log`、`status`、`assistant_chunk`、`assistant`、`finish`、`tool`、`acp_tool_call`、`error`、`exit`、`approval_request`、`approval_decision`、`artifact`、`plan`、`thinking`、`tips`。
- `appendContractEvent(events, event)`：normalize 后打上 `at` 并追加到 run 事件流。
- `normalizeAdapterResult(result)`：要求非空 `output`；规范化 `command`、`connectionMode`、`pid`、`providerSessionId` / `resumeKey`、`metadata`、`workdir`。
- `runEventsToConversationMessages(events)`：事件流 → 会话消息（assistant 合并、tool/approval/thinking/plan 等）。

Adapter 工厂通常接收 `{ appendEvent, registerCancel, requestApproval?, approvalMode?, ... }`，返回至少 `sendMessage(ctx)` / `cancel(ctx)`；ACP 通用适配器还可实现 `warmupConversation`、`listSessions`、`loadSession`、`closeSession`、`forkSession` 等可选能力。

### Adapter 实现与路由

磁盘上的 adapters（`personal-agent-runtime/adapters/`）：

| 模块 | 工厂 | 角色 |
| --- | --- | --- |
| `acp-generic.mjs` | `createGenericAcpAdapter` | 默认 ACP 会话路径（内置 provider + custom CLI ACP） |
| `claude.mjs` | `createClaudeAdapter` | Claude Code stream-json harness（可注入覆盖） |
| `codex.mjs` | `createCodexAdapter` | Codex 专用 harness（可注入覆盖） |
| `hermes.mjs` | `createHermesAdapter` | Hermes 专用 harness（可注入覆盖） |
| `openclaw.mjs` | `createOpenClawAdapter` | OpenClaw 专用 harness（可注入覆盖） |
| `opencode.mjs` | `createOpenCodeAdapter` | OpenCode SDK/session harness（可注入覆盖） |
| `remote-acp.mjs` | `createRemoteAcpAdapter` | Remote ACP WebSocket |

`createPersonalAgentRuntime`（`index.mjs`）维护 `adapterFactories` 映射；`adapterFactoryForProvider` 的**当前默认**：`claude` / `codex` / `hermes` / `opencode` / `openclaw` 以及 `custom`+CLI+ACP 走 `createGenericAcpAdapter`；`remote` 走 `createRemoteAcpAdapter`；无 factory 时回退 `legacy-harness`（`createPersonalAgentLegacyHarness`）。测试或调用方可经 `options.adapters` 注入覆盖工厂。Provider 元数据见 `provider-registry.mjs`（`PERSONAL_LOCAL_AGENT_PROVIDERS` 等）。

### Desktop runtime manager vs personal kernel

`runtime.mjs` 职责分层：

1. **`createRuntimeManager`** — OpenCode / OnMyAgent server / orchestrator **sidecar 生命周期**。`engineState.runtime` 取值为 `"direct"`（`DIRECT_RUNTIME`）或 `"onmyagent-orchestrator"`（`ORCHESTRATOR_RUNTIME`）。`startDirectRuntime` 直接 `opencode serve`；`startOrchestratorRuntime` 拉起 `onmyagent-orchestrator daemon`。当前 `engineStart` 默认走 OnMyAgent server 管理 OpenCode 的 **direct** 路径（`manageOpencode: true`），并序列化 lifecycle 防并发竞态。
2. **`createDesktopPersonalRuntimeServices`** — 组装 Personal Local Agent：**kernel**（`createPersonalAgentRuntime`）+ **legacy harness** + heartbeat + native sessions + messaging channels。Kernel 负责 run 状态、conversation store、approval、extensions；adapters 只做 provider 协议翻译。

### 边界

```text
renderer (domains/local-agents, session)
  → desktop.ts IPC / onmyagent-server.ts HTTP
    → preload.mjs → main.mjs 分发 personalAgentRuntime.*
      → personal-agent-runtime/index.mjs (kernel)
        → adapters/*.mjs + contract.mjs
```

- Adapters 与 contract **仅**存在于 `apps/desktop/electron/personal-agent-runtime/`（含 `adapters/`）。
- `main.mjs` 持有 `createDesktopPersonalRuntimeServices` 返回的 runtime，IPC channel 映射 `listAgents` / `startMessage` / `runMessage` / `cancelRun` / conversations / approvals / extensions 等。
- UI 只经 desktop IPC 与 server HTTP；**禁止** renderer import adapter 或 `personal-agent-runtime` 内部模块。
- 扩展：`extension-registry.mjs` 从 bundled/user 的 `onmyagent-extension.json` 读取 `contributes.acpAdapters[]`，经 `adapterToCustomAgent` 变成 `provider: "custom"` 虚拟 agent，再走 generic ACP 路径。

### 扩展点：新增 adapter（高层）

1. 在 `adapters/` 新增 `createXxxAdapter`，实现 `sendMessage` / `cancel`，用 `appendEvent` 只发 contract 事件类型，结束时返回可被 `normalizeAdapterResult` 接受的结果。
2. 在 `createPersonalAgentRuntime` 的 `adapterFactories`（及必要时 `adapterFactoryForProvider`）注册 provider 键；若走 ACP CLI，可复用 `createGenericAcpAdapter` 而不写专用模块。
3. 在 `provider-registry.mjs` 补 provider 元数据 / capabilities（可执行名、ACP/审批/流式等）。
4. 或通过 extension：`onmyagent-extension.json` → `contributes.acpAdapters[]`（`cliCommand` / `defaultCliPath` / `acpArgs` 等），无需改 kernel 代码。
5. 用 `options.adapters` 注入做单测；IPC 面已由 kernel 暴露，一般不必新增 channel，除非有全新宿主能力。

## Package Boundaries

```text
packages/types → 只定义 schema，不依赖 app/server 业务逻辑
packages/ui → 只做视觉组件，不依赖 app 状态
src/app/lib/ → 桥接层，不直接操作 React state
src/react-app/domains/ → 业务域，通过 kernel store 交互，不跨域直接引用 store
```

自动化边界检查：

```bash
pnpm check:boundaries
```

`check:boundaries` 目前执行两组门禁：

- **Package + domain boundaries**：`packages/types`、`packages/ui`、`apps/server`、`apps/desktop`
  不得反向依赖上层包；`apps/app/src/react-app/domains/<domain>` 之间不得直连；
  `src/components/**` 不得反向 import `react-app`；`src/app/lib/**` 不得 import `react-app`。
- **Shell import depth**：`apps/app/src/react-app/shell/**` 只能 import 到某个
  `domains/<domain>` 的一级 barrel。深链违规会被冻结在
  `scripts/checks/baselines/shell-import-depth.json` 的可缩减基线里，新增违规立即失败。
  历史深链清理完之后运行
  `node scripts/checks/check-boundaries.mjs --write-shell-depth-baseline`
  刷新 baseline，`--list-shell-depth` 打印当前所有深链。

`pnpm check:forbidden-types` 是配套的**类型逃逸门禁**：扫描 `apps/**/src`、
`packages/**/src` 里的 `any` 类型注解、`as any` 断言和 `as unknown as` 双转，
按 `file::rule::excerpt` 计数写入
`scripts/checks/baselines/forbidden-types.json`。新增会立即失败；旧违规修完后运行
`node scripts/checks/check-forbidden-types.mjs --write` 缩小基线，`--list` 打印全部
发现。这条规则来自 AGENTS.md 的"不用 `any`、类型断言 `as`"硬性禁止。

当前检查覆盖：

- `packages/types` 不依赖 app/server/desktop/UI 业务包。
- `packages/ui` 不依赖 app/server/desktop 业务包。
- `apps/server` 不依赖 renderer、desktop 或 UI 包。
- `apps/desktop` 不直接 import renderer 包；renderer 交互必须走 IPC/preload/server API。
- `apps/app/src/app/lib/**` 不反向 import `react-app`。
- `apps/app/src/react-app/domains/<domain>` 默认不直接 import 其他业务 domain；跨域能力优先通过
  `kernel`、`domains/shared`（infra only）、或 domain 一级 barrel 暴露。

**Domain 互引过渡白名单（未清零）：** `scripts/checks/check-boundaries.mjs` 中的
`allowedDomainImports` 冻结了约 100 条历史/过渡边，主要是：

- `session` ↔ `local-agents`（Personal Local Agent 拆域后的双向依赖）
- PR #49 域提取后的 agents / messaging / workspace / shell-feedback / connections 过渡边

规则：只允许缩减、禁止手改扩增。新跨域能力应经 kernel/shared/barrel 暴露，不要再往白名单加边。
用 `node scripts/checks/check-boundaries.mjs` 验证；清掉某条边后从 Set 删除对应条目。

## Dev Command Surface

四个 `apps/*` 项目的运行时职责不同：`apps/app` 使用 Vite renderer，`apps/desktop` 使用 Node 脚本编排 Electron、Vite 和 sidecar，`apps/server` 与 `apps/orchestrator` 使用 Bun CLI。仓库不强行把内部运行时统一成 Bun 或 Vite，而是在 root 层统一开发者入口：

```text
pnpm dev                  → 默认 desktop
pnpm dev -- app           → Vite renderer only
pnpm dev -- server        → local HTTP API
pnpm dev -- orchestrator  → runtime/orchestrator CLI
pnpm dev -- headless      → web + server smoke mode
```

新增 app 级入口时应先补 root `scripts/cli/dev.mjs` 映射，再在 README / AGENTS 中同步说明，避免各 app 暴露不一致的启动记忆。旧的 `dev:*` 兼容脚本已移除，统一使用 `pnpm dev -- <target>`。

Root `package.json` 只保留高频稳定入口。低频模块专项命令统一走 `pnpm task <group> <target>`，例如 `pnpm task check app`、`pnpm task test sessions`、`pnpm task bump patch`、`pnpm task website build`；具体模块私有脚本仍保留在各自 `package.json` 中。

## Test Architecture

测试门禁按速度和风险分层，根命令是项目内协作和 CI 的稳定入口：

```text
pnpm check:type      → 全 workspace 类型门禁：types/ui/app/server/desktop/orchestrator
pnpm test:unit       → server tests + orchestrator pure-module tests
pnpm test:api        → server HTTP/API e2e
pnpm test:runtime    → Electron bridge + orchestrator runtime smoke
pnpm test:release-smoke → desktop build + Electron package directory smoke, no publish
pnpm test:ui         → app version gate + UI/e2e smoke
```

CI 的主测试 workflow 使用这些分层命令，而不是直接堆模块私有脚本。模块内仍保留更细粒度脚本用于本地定位，例如 `onmyagent-server test:unit/test:e2e`、`@onmyagent/desktop check:electron`、`@onmyagent/app test:e2e`、`onmyagent-orchestrator test:unit`。

Root `check:type`、可缓存的 `test:*` 和 `pnpm task check/test <target>` 通过 Turbo 调度对应 workspace 脚本。`turbo.json` 为 typecheck/test 类任务声明空输出以复用远近端缓存，同时保留 `dev` 类任务无缓存、持久运行。仓库仍保持同一命令面；需要绕过缓存时使用 Turbo 原生命令参数，例如 `pnpm exec turbo run typecheck --filter @onmyagent/app --force`。

`@onmyagent/app` 的低频专项测试统一由 `apps/app/scripts/test.mjs` 分发，包内 `package.json` 只保留 `test:app`、`test:e2e`、`test:ui`、`test:version-gate` 等高层入口；人类和 Agent 日常仍优先使用 root `pnpm task test <target>`。

CI 主测试 workflow 拆为 `checks` 与 `tests` matrix，并缓存 pnpm store 与 `.turbo`。主线自动化统一以 `main` 为 push / pull request 目标；alpha、i18n、MCP package 等专项 workflow 也从 `main` 派生，避免旧 `dev` 分支漏跑或误触发。如果仓库配置 `TURBO_TOKEN` secret 和 `TURBO_TEAM` variable，Turbo 会自动使用 remote cache；未配置时仍使用 GitHub Actions `.turbo` local cache restore/save。

当前策略：

- `pnpm check` 是交付前基础门禁：类型、i18n、security smoke、架构边界。
- server 行为变更优先跑 `pnpm test:unit` 和 `pnpm test:api`。
- server 局部定位可跑 `pnpm task test server:archive`、`server:automation`、`server:routes`、`server:workspace`。
- desktop/orchestrator/runtime 变更优先跑 `pnpm test:runtime`。
- 发布前或打包链路变更跑 `pnpm test:release-smoke`，只做本地目录包 smoke，不签名、不发布。
- app renderer 或用户路径变更优先跑 `pnpm test:ui`。
- release/packaging 仍由 Electron/package/release workflow 兜底，不放进快速 PR gate。

## Root Scripts Layout

`scripts/` 根目录按职责分组，根 `package.json` 只暴露稳定入口：

```text
scripts/cli/          root dev/check/task/build command adapters
scripts/checks/       i18n/security/boundary/rename consistency checks
scripts/dev/          local debugging, headless web, mock OAuth helpers
scripts/maintenance/  repo maintenance and one-off analysis helpers
scripts/lib/          shared script helpers
scripts/release/      release review, prepare, ship, and asset publishing
```

新增 root-level 命令时优先扩展 `scripts/cli/task.mjs` 或 `scripts/cli/dev.mjs`，不要重新把长命令链塞回 `package.json`。

边界演进优先级：

1. 已开始：server API contract 迁入 `@onmyagent/types/server`，server 旧 `types.ts` 只保留兼容 re-export。
2. 已完成一轮：server `src` 已按 `core/`、`routes/`、`services/`、`workspace/` 分组；路由统一在 `apps/server/src/routes/` 注册，`server.ts` 当前不再直接 `addRoute`。
3. 下一步：继续压缩 `server.ts` 中 OpenCode/client/config 共享 helper，条件成熟后迁入专门 service 模块，但保持路由 composition root 不承载业务路由实现。
4. 已开始：orchestrator spawn 环境与 PATH 扩展逻辑迁入 `apps/orchestrator/src/env-paths.ts`，data-dir 解析迁入 `apps/orchestrator/src/data-dir.ts`，sidecar target/config 解析迁入 `apps/orchestrator/src/sidecar-config.ts`，版本 manifest 读取迁入 `apps/orchestrator/src/version-manifest.ts`，sandbox mount allowlist/config/data-dir 挂载校验迁入 `apps/orchestrator/src/sandbox-mounts.ts`；后续继续拆 args/config、runtime services、sandbox、logging。
5. 已开始：Electron 架构下载信息 helper 迁入 `apps/desktop/electron/architecture-info.mjs`，原生菜单控制迁入 `apps/desktop/electron/application-menu.mjs`，启动期 CDP/Chromium flags 迁入 `apps/desktop/electron/startup-flags.mjs`，Computer Use 权限/helper 逻辑迁入 `apps/desktop/electron/computer-use-desktop.mjs`，Code workspace/open-in-editor/Git actions 迁入 `apps/desktop/electron/code-workspace-actions.mjs`，BrowserView tabs/menu overlay 逻辑迁入 `apps/desktop/electron/embedded-browser-panel.mjs`，UI control HTTP bridge 迁入 `apps/desktop/electron/ui-control-server.mjs`；后续继续拆窗口、IPC、runtime sidecar 等注册模块。

## Personal Local Agent Runtime

- UI 实现主目录：`apps/app/src/react-app/domains/local-agents/`（management / cards / ACP hooks / messages）。
- 会话宿主页仍有部分入口在 `domains/session/chat/personal-local-agent-*`，经边界白名单与 `local-agents` 互引；目标是继续收敛到 barrel 或 kernel 契约。
- Desktop harness / adapter 分层见上文 **Runtime Adapter (multi-agent harness)**；本段只记 UI 域边界。
- 临时执行 ledger 只写本地 `.loop/plans/`；稳定架构事实写本文件与 `apps/app/src/react-app/ARCHITECTURE.md`。
- 该路径不是 team workspace 或 global connector 的实现说明，除非用户明确扩展范围。

## Session Goal Lifecycle

会话内「追求目标」运行时（预览 → 发送创建 → 暂停/继续/结束、与规划模式互斥、按 `sessionId` 隔离）：

- 实现主要落在 `domains/session/surface/` 与 composer / goal runtime 相关模块。
- 行为细节以代码与测试为准；临时设计/执行 plan 只写本地 `.loop/`，不进 `docs/`。

## Graphify Baseline

- `graphify-out/graph.json` 是当前源码级图谱（生成产物，默认不手改）。规模会随代码库增长；当前量级约 **5.9 万节点 / 8.4 万边**（以本地 `graph.json` 为准，勿把旧数字写死进 PR 说明）。
- 推荐阅读入口：`graphify-out/GRAPH_REPORT.md`（文本报告）与 `graphify query` / `graphify affected` CLI。完整交互 HTML（如 `graph.html` / `GRAPH_TREE.html`）对超大图不稳定，**不是**当前必需产物。
- 没有 `GEMINI_API_KEY` / `GOOGLE_API_KEY` 时，Graphify 主要维护 AST/结构关系；配置 LLM key 后可增加 docs/images/语义关系抽取。
- 修改代码后按 `AGENTS.md` 规则运行 `graphify update .`；如果无法运行，必须记录原因到本地 `.loop/runs/YYYY-MM-DD.md` 或 `.loop/state/intent-debt.md`。
- 大型重构后本地再跑一次 `graphify update .`（输出在 gitignored 的 `graphify-out/`）。
