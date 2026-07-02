# Architecture

OnMyAgent 是面向 agentic 工作流的桌面控制台，基于 OpenCode。本地优先，消费 server API surface，不被单一实现锁定。

## Monorepo Skeleton

pnpm monorepo，Turbo 编排构建。根包与 workspace 当前版本以各 `package.json` 为准。

```text
apps/
  desktop/      Electron shell：main.mjs + runtime.mjs，IPC 桥接，sidecar 管理，打包；architecture-info、application-menu、startup-flags、Computer Use desktop helper、Code workspace actions、embedded browser panel 与 UI control bridge 已拆为独立模块
    resources/marketplace/ 本地内置 marketplace 内容包：experts/skills 原始资源，打包为 Electron extraResources
  app/          React UI：src/app/lib/ 兼容层 + src/react-app/ 域架构
  server/       本地 HTTP API：workspace/session/skill/MCP/审批，SQLite，SSE 事件流；server.ts 只保留 composition root + OpenCode/配置共享 helper，路由已按 system/dev-ui/runtime/integration/workspace/file/session/import-export/blueprint 等模块注册
    src/        运行时代码：core/routes/services/workspace 分层，根目录只保留入口与编排文件
    tests/      单元/集成测试
    e2e/        HTTP/API 端到端测试
  orchestrator/ 进程编排：嵌入 server，spawn opencode，审批路由，sandbox 管理；env/PATH、data-dir、sidecar target/config、version manifest、sandbox mount helper 已拆为独立模块

packages/
  types/        共享类型与 Zod schema：server API contract, desktop-policies, restrictions, inference
  ui/           Paper shader 视觉组件：React + Solid 双导出
  handsfree/    macOS Computer Use：Swift AX + JS CUA runner
  onmyagent-ui-mcp/ MCP stdio server：暴露 UI 控制面给外部 MCP 客户端
```

默认忽略：`ee/*`、Den Web/API、landing page、cloud dashboard。

## React App Domains

```text
apps/app/src/react-app/
  kernel/          Zustand store + platform/sdk/server provider
  shell/           路由 + boot + layout + command-palette
  domains/
    session/       核心域：composer/surface/sync/sidebar/artifacts/browser/voice
    settings/      设置页 + state stores
    workspace/     CRUD + remote + share
    connections/   MCP + provider auth
    agents/        agent registry
    cloud/         Den auth + restrictions + org onboarding
    plugins/       skills catalog
    shell-feedback/ shell/浏览器反馈收集
    shared/        跨域共享工具 (lib/components/hooks)
apps/app/src/components/ui/  shadcn/ui 组件
apps/app/src/app/lib/        兼容层：desktop.ts、onmyagent-server.ts、opencode.ts
apps/app/src/react-app/domains/session/*-marketplace/*.manifest.json  轻量索引：只供 UI 列表与搜索，不承载完整内容包
```

边界规则：

- `src/app/lib/` 只做桥接层，不直接操作 React state。
- `src/react-app/domains/` 通过 kernel store 交互，不跨域直接引用 store。
- UI 组件用 `@/components`；新组件优先 shadcn/ui with Base UI。

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

当前检查覆盖：

- `packages/types` 不依赖 app/server/desktop/UI 业务包。
- `packages/ui` 不依赖 app/server/desktop 业务包。
- `apps/server` 不依赖 renderer、desktop 或 UI 包。
- `apps/desktop` 不直接 import renderer 包；renderer 交互必须走 IPC/preload/server API。
- `apps/app/src/app/lib/**` 不反向 import `react-app`。
- `apps/app/src/react-app/domains/<domain>` 不直接 import 其他业务 domain，跨域能力通过 `kernel` 或 `domains/shared` 暴露。

当前 React domain 互引基线已清零：`scripts/checks/check-boundaries.mjs` 中的
`allowedDomainImports` 保持为空。后续新增跨业务 domain 能力时，应通过 `kernel`、
`domains/shared` 或显式参数传递暴露契约，不要重新把例外写入边界脚本。

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

## Personal Local Agent Runtime Plan

Personal Local Agent 本地 agent runtime 的临时执行 ledger 迁入本地 `.loop/plans/`；稳定后的架构事实沉淀在本文件。

该计划不是当前全局架构的替代品，只约束 Personal Local Agent 路径；除非用户明确扩展范围，不应把它当作 team workspace 或 global connector 的当前实现说明。

## Graphify Baseline

- `graphify-out/graph.json` 是当前源码级图谱；最近一次更新生成约 13k 节点、22k+ 边。
- `graphify-out/GRAPH_TREE.html` 是当前推荐的本地可视化入口，适合大图浏览；完整 `graph.html` 对 10k+ 节点图不稳定，不作为必需产物。
- 没有 `GEMINI_API_KEY` / `GOOGLE_API_KEY` 时，Graphify 主要维护 AST/结构关系；配置 LLM key 后可增加 docs/images/语义关系抽取。
- 修改代码后按 `../AGENTS.md` 规则运行 `graphify update .`；如果无法运行，必须记录原因到本地 `.loop/runs/YYYY-MM-DD.md` 或 `.loop/state/intent-debt.md`。
