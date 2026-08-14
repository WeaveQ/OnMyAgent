# Architecture

OnMyAgent 是面向 agentic 工作流的桌面控制台，基于 OpenCode。本地优先，消费 server API surface，不被单一实现锁定。

## Product phase (Phase 2)

> **Phase-2 hard entry is only in root [`AGENTS.md`](../AGENTS.md).** This section is engineering context + pointers; do not fork a second constraint list here.

| | |
| --- | --- |
| **Current product phase** | **Phase 2** — desktop config foundation + **B-side (enterprise control) prep** |
| Doc map | [`README.md`](./README.md) (what lives under `docs/` and which file is SoT) |
| Roadmap SoT | [`design/2026-08-02-phase-2-enterprise-prep.md`](./design/2026-08-02-phase-2-enterprise-prep.md) |
| Config foundation (2a) | [`design/2026-08-02-config-consistency.md`](./design/2026-08-02-config-consistency.md) |
| Work memory paths | [`design/2026-08-02-work-memory-plan.md`](./design/2026-08-02-work-memory-plan.md) |
| Files module (三来源) | [`design/files-module-product-spec.md`](./design/files-module-product-spec.md) |
| OfficeCLI CDN contract | [`officecli-oss-release.md`](./officecli-oss-release.md) |
| Windows product gaps | [`windows-compat.md`](./windows-compat.md) |
| React domains / cold start | [`../apps/app/src/react-app/ARCHITECTURE.md`](../apps/app/src/react-app/ARCHITECTURE.md) |
| Convergence plan (expert / cold / shelf / skills) | [`design/2026-08-09-architecture-convergence-plan.md`](./design/2026-08-09-architecture-convergence-plan.md) |

**Layering (fixed):** **OnMyAgent** = desktop; **OnMyCompany** = intranet enterprise control plane (identity / isolation / policy / approval / audit / gateway). OpenConnector-class gateway is an **implementation detail inside OnMyCompany**, not a third product line.

**Product platforms (fixed):**

| Platform | Product stance |
| --- | --- |
| **macOS** | Primary release + dogfood (signed / notarized path) |
| **Windows** | Supported Electron shell; NSIS **unsigned** developer preview — see [`windows-compat.md`](./windows-compat.md) |
| **Linux desktop packages** | **Not a product target** (no AppImage/AUR ship). CI may still use `ubuntu-latest` as a host; Docker **sandbox** may still pull linux sidecars — that is not “Linux client support”. |

**Architecture-only engineering notes** (not in AGENTS; do not restate the Phase-2 hard entry here):

- **Skills write target** is `profiles/local/config/skills`; legacy `~/.onmyagent/skills` is read/scan only. A bad `SKILL.md` must not fail the whole `listSkills` API (skip + keep listing).
- **Do not append release-changelog bullets to this file.** Shipped waves go in root `CHANGELOG.md` / GitHub Releases.

Desktop modules already on the 2a path: `apps/desktop/electron/config-profile-paths.mjs`, `ensure-local-config-migrated.mjs`, wired from `desktop-paths.mjs`, `expert-marketplace.mjs`, and `runtime.mjs` skill materialization.

## Monorepo Skeleton

pnpm monorepo，Turbo 编排构建。根包与 workspace 当前版本以各 `package.json` 为准。

```text
apps/
  desktop/      Electron shell：main.mjs（composition）+ runtime.mjs + desktop-command-router.mjs + `electron/desktop-handlers/*` 域 IPC handlers；sidecar 管理与打包；`electron/personal-agent-runtime/` 托管 multi-agent Personal Local Agent 内核与 adapters；agent-management-providers / skills / expert-marketplace、architecture-info、application-menu、startup-flags、Computer Use、Code workspace actions、browser-runtime、browser-skill-desktop（外部 Tencent BrowserSkill / `bsk` 探测与安装引导）、UI control bridge、lightweight GitHub Releases updater 均为独立模块
    resources/marketplace/ 本地内置 marketplace 内容包：experts/skills 原始资源，打包为 Electron extraResources
    resources/bundled-skills/  产品内置 skills（含 `browser-automation` in-app 与 `browser-skill` 真实浏览器桥）
  app/          React UI：src/app/lib/ 兼容层 + src/react-app/ 域架构
  server/       本地 HTTP API：workspace/session/skill/MCP/审批/自动化，SQLite，SSE；archive store pool + change-bus（见 Server Archive Runtime）；automation wait policy（busy→idle settle）；server.ts 为 composition root + OpenCode/配置 helper，路由按 system/dev-ui/runtime/workspace/file/session/import-export/blueprint/automation 等模块注册
    src/        运行时代码：core/routes/services/workspace 分层，根目录只保留入口与编排文件
    tests/      单元/集成测试
    e2e/        HTTP/API 端到端测试
  orchestrator/ 可选进程编排：spawn `onmyagent-server` **二进制**（不 import server 源码），再 spawn OpenCode、审批路由、sandbox；env/PATH、data-dir、sidecar target/config、version manifest、sandbox mount helper 已拆为独立模块。默认桌面路径不启动本进程

packages/
  types/        共享类型与 Zod schema：server API / Desktop IPC（含 `DesktopCommandMap`）/ desktop-policies / restrictions / inference；health/status/runtime 响应类型也在此包
  ui/           Paper shader 视觉组件：仅 React 导出（`@onmyagent/ui/react`）；Solid 已移除
  artifact-runtime/ 文档/表格/演示等 artifact 运行时（CJS helpers，供预览路径）
  handsfree/    macOS Computer Use：Swift AX + Skysight + JS CUA runner（Windows/Linux 不打包本包）
  onmyagent-ui-mcp/ MCP stdio server：暴露 UI 控制面给外部 MCP 客户端
```

**Computer Use / Appshot（产品平台摘要）：**

| 能力 | macOS | Windows | Linux desktop (not shipped) |
| --- | --- | --- | --- |
| Agent Computer Use MCP | HandsFree helper（默认开，helper 就绪时） | Bundled **Cua Driver**（staged；MCP **默认关**） | 无产品包 / 无 helper |
| Composer Appshot | Electron `desktopCapturer` | 同左 | 非产品目标（实现层或仍有 `platform===linux` 分支，勿当支持承诺） |
| HandsFree AX / Skysight | ✓ | — | — |

实现入口：`apps/desktop/electron/computer-use-desktop.mjs`、`computer-use-runtime-config.mjs`、`prepare-cua-helper.mjs`、`computer-use-appshot.mjs`。详表见 [`windows-compat.md`](./windows-compat.md)。

默认忽略：`ee/*`、Den Web/API、landing page、cloud dashboard。

## Session / Expert / cold-path pointers

跨包硬边界写在本文件；**UI 域归属与冷启动细则**以 React 架构为准，避免在 `docs/` 再复制一长篇。

| 主题 | SoT |
| --- | --- |
| OpenCode 主轨 vs Personal 辅轨 | 下文 **Dual Runtime Boundary** |
| Session goal 生命周期 | 下文 **Session Goal Lifecycle** + `domains/session` 代码/测试 |
| **Expert 会话面架构**（surface FSM / draft / tab / cold-open / pending 语义 / 禁止项） | [`design/expert-surface-architecture.md`](./design/expert-surface-architecture.md) ← **改 Expert 会话 UI 先读** |
| Expert 创建 / 选中 / 删除 / 多 tab（服务端 lifecycle） | 下表 **Expert lifecycle hard rules** + `expert-session-lifecycle.ts` / `expert-hard-delete.ts`；UI 域见 React ARCHITECTURE + **expert-surface-architecture** |
| **Expert / session 产品行为**（Directory、空壳 busy、bound draft、首发、SSE 代际） | 本节省 **Expert lifecycle** 表 + [`../apps/app/src/react-app/ARCHITECTURE.md`](../apps/app/src/react-app/ARCHITECTURE.md)；契约 `apps/app/scripts/expert-session-invariants.test.ts`（**不是** DESIGN / 包级 AGENTS） |
| Expert runtime 隔离（agent=onmyagent / sandbox HOME / token 预算） | [`design/expert-runtime-isolation.md`](./design/expert-runtime-isolation.md) |
| Shell 冷启动 / prewarm / title cache | `cold-path-budget.ts` + **Shell load / boot** in React ARCHITECTURE；prewarm 仅 idle |
| Skills 列表 / 安装写路径 | 上文 Product phase；server `skillsInstallWriteRoot()` / `listSkills` skip stats |
| Capability shelf | [`design/2026-08-09-capability-shelf.md`](./design/2026-08-09-capability-shelf.md) + `capability-shelf.ts` |
| OfficeCLI / managed CLI 发布 | [`officecli-oss-release.md`](./officecli-oss-release.md)；货架位改动须改 shelf registry |
| Files 三来源 | [`design/files-module-product-spec.md`](./design/files-module-product-spec.md) |
| 视觉 token / 组件形状 | [`../DESIGN.md`](../DESIGN.md) only |

### Expert lifecycle hard rules

| Action | Rule | Code |
| --- | --- | --- |
| **identity / list** | Server Expert Directory projects revisioned origins v2 + marker v3 + workspace session aggregate; renderer consumes `loading / ready / incomplete / error` and never repairs identity from local cache, 404 observation, or path heuristics | `expert-directory.ts` + `workspace-session-marker-inventory.ts` + `expert-directory-query.ts` |
| **empty shell** | Creating an empty expert session shell must not `startRun` or mark busy; only a real prompt / existing run path may show thinking | `onCreateFreshSessionForAgent` + `expert-session-invariants.test.ts` |
| **bound draft** | Opening a real session for the same expert consumes that draft; no cross-expert consume or ghost tab | `expert-draft-session.ts` |
| **first send** | New session send: local optimistic user bubble before `activateCreatedSessionRoute`; empty-shell create must not await marketplace install | `seedOptimisticSessionUserMessage` |
| **SSE generation** | On switch / reconnect / stop, cancel stale subscribers and drop stale events by generation | session-sync / activity |
| **hard_delete** | Server saga snapshots the origin revision, deletes OpenCode + authorized runtime directories, then writes tombstones; desktop saga removes only user-owned package/skill materialization. Both journals replay by one operation id | `expert-delete-saga.ts` + `deleteExpertPackage` + `expert-hard-delete.ts` |
| **hard_delete** | Origin match is **agentId-first**. `packageName` may be the short marketplace name (`pkg`) or the agentId composite (`pkg:pkg`); never 404 a real expert because the client sent the composite form. Built-in marketplace (`marketplace !== "my-experts"`) stays 409 | `selectExpertDeleteOriginRecords` + `resolveExpertDeletePackageName` |
| **hard_delete** | Never clears `draft:*` sessions and refuses product builtins (creation coach) | `isDraftSessionId` + `canHardDeleteExpert` |
| **hard_delete** | Local UI cleanup runs only after the server/desktop sagas and remaining Expert session ids must not retain deleted ids | `clearExpertLocalSessionBindings` + `remainingExpertSessionIdsAfterDelete` |
| **create** | Composer flush at most once per save path | `shouldFlushComposerOnExpertCreate` |
| **select** | No-op when expert id unchanged | `shouldApplyExpertSelection` |
| **skills / intro** | Package manifest metadata is the declaration SoT for `skills`, `introStyle`, and `approvedAgentIds`; marker v3 reports declared / physically installed / missing skills | `expert-marketplace.mjs` + `expert-session-runtime.ts` |
| **prompt** | Every managed Expert `prompt_async` request must pass the same runtime contract: authorized directory, marker/workspace/session identity, `onmyagent` or manifest-approved agent, empty plugin list, physical skills, and bounded first request | `expert-runtime-contract.ts` + `opencode-proxy.ts` |
| **surface UI** | Single FSM (`reduceExpertSurface`); mode is pure projection; never merge tab-highlight / create-operation / composer-pending; cold-open suppressed during create/draft; tab title snapshots only for selected (≤1) | [`design/expert-surface-architecture.md`](./design/expert-surface-architecture.md) |

### Cold-path budget (numeric)

| Metric | Budget | Code |
| --- | --- | --- |
| workspace-scoped listSessions on cold enter | ≤ 1 renderer request; bounded server fan-out ≤ 4 | `COLD_PATH_BUDGET.maxListSessionsOnColdEnter` + `workspace-session-list-policy.ts` |
| titleSnapshot on empty selected chip | 0 (thrash ban) | `isTitleSnapshotAllowedOnColdEnter` |
| sync inventory prewarm on cold enter | 0 (idle only) | `scheduleIdleWork` + `isSyncPrewarmAllowedOnColdEnter` |
| prewarm idle timeout / fallback | 8000 / 4000 ms | `COLD_PATH_BUDGET.prewarmIdleTimeoutMs` / `prewarmFallbackDelayMs` |

## React App Domains

权威 UI 域说明见 `apps/app/src/react-app/ARCHITECTURE.md`。本文件只维护 monorepo 级摘要：

```text
apps/app/src/react-app/
  kernel/          Zustand store + platform/sdk/server provider + user-error 产品错误模板
  shell/           路由 + progressive boot + route-load-registry + layout + command-palette（只编排，不深链 domain 子路径）
  infra/           React-only 运行时基建（如 QueryClient）
  capabilities/    跨域复用能力：artifacts / conversation（双运行时 timeline）/ layout（content-column）/ model-selection / session-identity
  design-system/   产品级复合组件（ConfirmModal、SelectMenu 等）
  domains/
    session/       **OpenCode 主轨**会话：composer/surface/sync/sidebar（底栏 channels+devices）/artifacts/browser/goal；expert/skills marketplace
    local-agents/  **Personal 辅轨**：ACP / 本地 agent 编辑、卡片、agent-management、personal host
    messaging/     自动化（含 list model / wait-complete UX）+ 飞书/微信等 messaging channels（桌面 channel 纯单元门禁：`node --test apps/desktop/electron/channels/test/*.test.mjs`，无需 live 凭证）
    agents/        agent registry + 注册表 UI
    workspace/     workspace CRUD + remote + share + files page
    settings/      设置 shell + pages + state stores（含全局 Updates、AI providers controller）
    connections/   MCP + provider auth（canonical；含 merge-connected-providers）
    cloud/         Den auth + restrictions + org onboarding
    plugins/       skills catalog / plugins / connectors pages
    shell-feedback/ reload banner、toast、右上角通知
    shared/        跨域 infra only（env / extension / desktop-config / server-store）
  shell/session-route/  会话宿主 facade（薄编排：hooks + bags 组装 surface；业务在 domains/session）
  shell/settings-route/ 设置宿主 facade；首载与软刷新分 scope，错误条接 user-error 恢复动作
apps/app/src/components/ui/  shadcn/ui atoms + FilterChip/SegmentedTabGroup（见 DESIGN.md）
apps/app/src/app/lib/        兼容层：desktop.ts、onmyagent-server.ts、opencode.ts
apps/app/src/react-app/domains/session/*-marketplace/*.manifest.json  轻量索引：只供 UI 列表与搜索
```

边界规则：

- `src/app/lib/` 只做桥接层，不直接操作 React state。
- `src/react-app/domains/` 跨域依赖必须同时满足显式依赖图和目标域一级 `index.ts` 公共入口；
  复用能力放入 `capabilities/`、`kernel/`、`infra/` 或 `design-system/`，不新增文件级例外。
- UI 组件用 `@/components`；新组件优先 shadcn/ui with Base UI。
- 详细 migration map、路由身份、state ownership 只维护在 `apps/app/src/react-app/ARCHITECTURE.md`。

## Runtime Data Flow

OpenCode binary pin is `constants.json` → `opencodeVersion` (**v1.17.20**); product prefers the bundled pin over stale PATH installs (see desktop `opencode-binary-policy` / orchestrator version checks).

```text
desktop(electron) → runtime.mjs → engineStart
  default DIRECT_RUNTIME (shipped desktop):
    └→ startEmbeddedServer (in-process in the Electron app)
         └→ manage OpenCode binary (manageOpencode: true)
  optional ORCHESTRATOR_RUNTIME (not the product default):
    └→ spawn onmyagent-orchestrator daemon
         └→ spawn onmyagent-server binary (never import server source)
         └→ OpenCode + approval router / Slack / Telegram
  app(React) ← server HTTP API via onmyagent-server client

app(React) ← desktop.ts(command-validated IPC bridge)
  ← preload.mjs
  ← desktop-command-router.mjs（按 desktopCommandGroups 路由）
  ← desktop-handlers/*（workspace / system / local-agents / task-orchestrator / messaging / agent-management / opencode / runtime / skills）
  ← main.mjs（组装 services + createAllDesktopDomainHandlers）
app(React) ← onmyagent-server.ts(compat barrel) ← onmyagent-server/client.ts + domains.ts ← server
app(React) ← opencode.ts(SDK) ← opencode binary
app(React) ← @onmyagent/types ← packages/types（Zod schema + DesktopCommandMap）
```

## Dual Runtime Boundary（OpenCode vs Personal Local Agent）

产品内存在两套会话相关运行时。**主辅关系固定，不因 UI 共用而模糊。**

| | **OpenCode（主）** | **Personal Local Agent（辅）** |
| --- | --- | --- |
| 定位 | 软件运行底层与主会话真相源 | 桌面侧便利入口：把本机 CLI/ACP agent 接到同一产品 UI |
| 典型用户价值 | 工作区会话、server API、archive、SSE、分析、主聊天 | 在 OnMyAgent 内使用 Claude Code / Codex / Hermes / OpenClaw / 自定义 CLI 等 |
| 宿主进程 | server sidecar + OpenCode binary（及 orchestrator 编排） | Electron main 内 `personal-agent-runtime` kernel |
| UI 域 | `domains/session` | `domains/local-agents` |
| 传输 | HTTP `onmyagent-server` + OpenCode SDK / SSE | Desktop IPC `localAgents` |
| 状态归属 | server session + session-archive（SQLite 等） | personal conversation store / run 状态（desktop 侧） |
| 是否主引擎 | **是** | **否**——不替代 OpenCode，不作为产品主会话底座 |

### 一句话

**OpenCode = 主运行时；Personal = 本机 CLI agent 的统一 harness（适配层），不是第二套主引擎。**

### Task Orchestrator（中立协调层，不是第三套运行时）

Task Center 的跨 agent 工作流由 app-userData scoped 的 detached
`task-supervisor` Node 进程持有；Electron main 只是带认证、可重连的 IPC
client。Supervisor 是 Task Center 的唯一执行 owner，并在同一进程内通过
`personalAgentRuntime` 的公开 API 管理 provider child。显式 Quit 必须先让
Supervisor checkpoint、撤销 lease 并安全暂停；普通关窗不改变 Task 生命周期。

Task / Contract / Run / Turn / Attempt / Lease / Event / Artifact / Gate / Budget /
Outbox / Process 状态以 `runtime-state/task-center-supervisor/task-center.sqlite`
的 SQLite WAL 为权威单写真相源。旧 V2 JSON 只做幂等导入且保留为恢复输入；
启用 SQLite 后禁止双写或静默回退，避免 split brain。

长期运行的资源边界也属于该 owner 契约：SQLite 显式启用 bounded WAL
autocheckpoint，Supervisor 启动后及每小时执行 single-flight、可诊断且可 drain 的
operational maintenance（checkpoint / incremental vacuum / outbox、RPC、process
tombstone retention）。Event 与 Artifact 是验收、恢复和 side-effect reconciliation
需要的不可变审计历史，因此 maintenance 不会静默删除它们；每个 Run 由有限的
Turn/Worker/Checker/时间预算约束，读取走 snapshot byte budget 和 cursor/chunk
pagination，归档/导出负责长期保留。Task MCP 的 app-userData 文件队列使用
filesystem wakeup 加 bounded idle backoff，避免无请求时固定高频扫描；renderer 以
Supervisor event/outbox 为实时真相，低频 polling 只作为 sleep/reconnect 丢事件后的
watchdog。

资源达到警戒线时 health 会报告 DB/WAL/总文件预算；不可变历史只允许显式
`archive → export manifest → PURGE <taskId>` 清理。Purge 还要求精确 revision 与
manifest digest，删除 Task 级级联数据的同时在独立 `purge_audit` 表保留最小审计，
不会由 maintenance/TTL 自动触发。

Electron main 另有主动 Supervisor watchdog（bounded backoff/jitter/circuit breaker），
不依赖 Task Center 窗口或 renderer polling。Task 活跃且用户开启“保持唤醒”时使用
`prevent-app-suspension`：允许显示器熄灭，但防止应用/系统挂起导致 provider 与网络
工作中断；真实 `powerMonitor suspend/resume` 区间才从 Turn liveness budget 扣除，
普通 event-loop/SQLite/provider stall 不享受豁免。

微信、飞书、Telegram、Discord 的普通消息仍走 Personal runtime；只有显式
`#task`/`/task` 进入共享 Messaging Task Adapter。入站 receipt、chat↔task binding、
本地通知和 channel delivery outbox 使用独立的 Channel SQLite 单写库，Task/Run
真相仍只在 Supervisor。重复 webhook 以稳定 message identity 去重，终态/审批消息
claim→send→ack，断线后按每个 event stream cursor 重放；附件只进入有界元数据引用，
不把凭证、raw app state 或任意本地路径带入 contract/output。

- Renderer 的 `domains/task-center` 只调用 typed Desktop IPC；不 import
  Personal adapter，也不复制 Task 真相到 OpenCode archive 或 renderer store。
- 新任务从一个 idea 开始，由 catalog-selected Primary 在 alignment 中提出结构化
  outcome、deliverables、acceptance、scope 和 verification。冻结 Contract 后，
  Primary 自主决定是否通过 namespaced Task MCP 委派允许列表中的 depth-one
  Worker；不存在固定 Planner / Implementer / Verifier 流水线。
- Run 创建后冻结 Primary、allowed workers、provider/model、workspace、permission、
  Contract hash 和 End Conditions；详情必须展示该 immutable Run definition，
  不能用后续可变 Task revision 冒充实际执行配置。
- 长 Run 由 bounded durable Turns 组成。每个 Turn 使用新 provider session；上下文
  接近阈值、transport recovery、暂停或重启时先写 checkpoint + redacted
  Continuation Capsule，再用冻结 identity 继续。provider prompt 结束不等于 Task
  完成；只有结构化 acceptance decision 或用户确认可以结束 Run。
- Orchestrator 只保存 Personal `runId` / `conversationId` 引用，不打开或改写
  Personal conversation/session/run 文件；Personal 仍对自己的 worker 状态负责。
- 它不写 server session archive，不把 Personal 变成主引擎，也不承担
  OpenCode/server sidecar 生命周期。
- `restricted` 使用 durable approval gate；`full-allow` 只在冻结 task/run、真实
  workspace、provider/profile、Contract hash 和有限 deadline 的 grant 内无提示执行，
  网络、外发、发布、凭证/系统路径等 hard deny 不可绕过。停止、暂停、重试、
  context rollover 和重启恢复由 supervisor epoch + task-owned lease/revision
  fencing 保证迟到结果不能覆盖新 Turn/Attempt。

### 共享合同（可以共用）

- UI 时间线形状：`react-app/capabilities/conversation/` 把两边消息映射到同一套 conversation items（展示层复用，不是存储合并）。
- 产品级 session / agent 身份展示可走中立 capability；**写路径仍按归属表分流**。
- Personal 侧 adapter 事件合同：`personal-agent-runtime/contract.mjs`（仅 Personal run 流）。
- Desktop 公共类型：`@onmyagent/types` 中 IPC / server schema（按域使用，不混写语义）。

### 禁止交叉写 / 禁止混用（硬边界）

1. **Personal 不得**直接打开、写入或 dispose OpenCode / server 的 session-archive、主会话 SQLite 热路径。
2. **OpenCode / server 生命周期**不得把 Personal conversation store 当作主会话真相源；Personal run 结束也不应「顺便」写主 archive，除非未来有**显式、单向、有主的**导出合同（默认无）。
3. **同一用户意图**不得对同一逻辑会话同时挂两套热写路径（一边 HTTP session stream，一边 personal run 写同一 archive 行）。
4. **Renderer 禁止** import `personal-agent-runtime/**` 或 adapter 实现；只经 `desktop.ts` IPC 与 `onmyagent-server` HTTP。
5. **Adapter 只做协议翻译**（CLI/ACP ↔ contract 事件）；kernel 管 run/conversation/approval；sidecar `createRuntimeManager` 管 OpenCode/server 进程——三层不要互相越权改对方 store。
6. **注销 / dispose**：OpenCode client、archive pool、Personal runtime 各自 teardown；一边失败不得留下另一边半开写句柄。
7. **新增能力默认落主轨**：工作区主聊天、归档分析、SSE 推送优化优先 OpenCode/server；仅当需求是「接某个本机 CLI agent」时才加 Personal adapter / `local-agents` UI。

### 决策启发式（改代码前）

- 改的是主会话、archive、SSE、workspace 会话 API？→ **OpenCode / server**。
- 改的是本机 Claude/Codex/… 进程、ACP、local agent 卡片、personal 通道发消息？→ **Personal**。
- 两边 UI 看起来像同一个聊天？→ 只共享 **conversation capability 展示**，不共享写存储。
- 不确定谁写？→ **默认 OpenCode 主轨**；Personal 只读或独立 store，直到有书面合同。

实现细节与 adapter 列表见 **Runtime Adapter**；主轨 archive 热路径见 **Server Archive Runtime**。

## Server Archive Runtime（主轨热路径）

OpenCode 主会话的归档/分析/SSE 落在 `apps/server`，**不是** Personal runtime 的一部分。

### 模块分工（`apps/server/src/services/`）

| 模块 | 职责 |
| --- | --- |
| `session-archive.ts` (+ schema/sql/parser/sync/…) | SQLite archive 实现与同步逻辑（大文件，继续拆分中） |
| `session-archive-store-pool.ts` | **长期 handle 池**：同 `dbPath` 复用、ref-count、idle TTL、**single-flight** 并发 open |
| `archive-change-bus.ts` | 按 `dbPath` 的轻量变更总线；mutation 后 `notifyArchiveDbChanged` |
| `archive-sse-policy.ts` | SSE 轮询/推送策略（与 pool 长连接配合，避免每 tick open/close） |
| `session-archive-analytics.ts` + `analytics-cache-policy.ts` | 分析读模型与 TTL；过期应 **整表失效** 而非半新半旧 |
| `opencode-client-pool.ts` | workspace 级 OpenCode client 复用（与 archive pool 类似意图） |
| `session-archive-lifecycle.ts` | 生命周期 status 探针；经 `withSessionArchiveStore` / pool acquire-release（不再裸 open） |

HTTP 入口：`routes/workspace-session-archive-routes.ts`（列表/同步/SSE/analytics 等）应优先 `defaultSessionArchiveStorePool.acquire` / `release`，mutation 后 `notifyArchiveDbChanged`。

### 热路径约定

1. **读/SSE/HTTP archive 路由**：只经 store pool，禁止每次请求 `open` + 立即 `dispose` 打 thrash。
2. **写/同步完成后**：调用 change-bus，让已连接 SSE 推送，而不是只靠慢轮询。
3. **Analytics cache**：TTL 到期整 cache 重建（`ensureFresh` 全量 reset 语义），禁止 scope 混用导致部分 stale。
4. **收敛目标**：lifecycle 已走 pool；新增代码不得再引入第二套 bare open 习惯路径（仅 pool 内部可调用 `openSessionArchiveStore`）。
5. **OpenCode client**：workspace 代理优先 `opencode-client-pool`；logout/dispose 与 pool `disposeAll` 对齐，避免半开 client。

### 与双运行时边界的关系

Archive pool / change-bus / analytics **仅服务 OpenCode 主轨**。Personal conversation store 不进这些模块；Personal 也不得直接 `openSessionArchiveStore`。

## Runtime Adapter (multi-agent harness)

在上一节主辅边界下，桌面端托管 **Personal Local Agent** 多 agent harness：使 Claude / Codex / Hermes / OpenClaw / OpenCode ACP / Remote ACP / custom CLI 等本地 agent 走同一套 run 事件合同与 UI 路径。实现集中在 `apps/desktop/electron/personal-agent-runtime/`，由 `runtime.mjs` 的 `createDesktopPersonalRuntimeServices` 组装，经 domain handlers（`desktop-handlers/local-agents.mjs` 等）与 `main.mjs` 组合层暴露 IPC——**renderer 不直接 import adapters**。Personal **不是** OpenCode 的替代实现。

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

1. **`createRuntimeManager`** — OpenCode / OnMyAgent server / orchestrator **sidecar 生命周期**。`engineStart` 只走 in-process OnMyAgent server（`DIRECT_RUNTIME` + `manageOpencode: true`），并序列化 lifecycle 防并发竞态。`engineState.runtime` 类型仍允许 `"onmyagent-orchestrator"`，但当前启动路径不会赋这个值。打包的 `onmyagent-orchestrator` sidecar 和 `orchestratorStartDetached` 仍在，不是这条 `engineStart` 路径。
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
- `createDesktopPersonalRuntimeServices` 返回的 runtime 由 `main.mjs` 持有，IPC 经 `desktop-handlers/local-agents.mjs`（及 router）映射 `listAgents` / `startMessage` / `runMessage` / `cancelRun` / conversations / approvals / extensions 等。
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

`pnpm check:boundaries` 实际串行四道（勿再写成「三组」）：

1. `scripts/checks/check-boundaries.mjs` — package + domain + shell-import-depth
2. `scripts/checks/check-circular-deps.mjs` — Tarjan SCC，baseline 只减不增
3. `scripts/checks/check-dual-runtime-boundary.mjs` — renderer 不得 import `personal-agent-runtime/**`；Personal 不得 import `session-archive*`
4. `node --test scripts/checks/check-dual-runtime-boundary.test.mjs`

`check-boundaries.mjs` 内的包/域规则：

- **Package + domain boundaries**：`packages/types`、`packages/ui`、`apps/server`、`apps/desktop`
  不得反向依赖上层包；`packages/artifact-runtime` 纳入 `packageDirs` 扫描。
  业务域只能按 `domain-boundary-policy.mjs` 的显式依赖图引用目标域
  一级 `index.ts`，深链或未声明方向立即失败；
  `src/components/**` 不得反向 import `react-app`；`src/app/lib/**` 不得 import `react-app`。
- **Shell import depth**：`apps/app/src/react-app/shell/**` 只能 import 到某个
  `domains/<domain>` 的一级 barrel。深链违规会被冻结在
  `scripts/checks/baselines/shell-import-depth.json` 的可缩减基线里，新增违规立即失败。
  历史深链清理完之后运行
  `node scripts/checks/check-boundaries.mjs --write-shell-depth-baseline`
  刷新 baseline，`--list-shell-depth` 打印当前所有深链。

**Circular dependencies**：`scripts/checks/check-circular-deps.mjs`（零依赖 Tarjan SCC）；扫描根含
`packages/artifact-runtime`、`packages/onmyagent-ui-mcp`、`packages/handsfree`。
baseline `scripts/checks/baselines/circular-deps.json` **只减不增**（当前目标：**0 环**）。测试：
`node --test scripts/checks/check-circular-deps.test.mjs`。

`pnpm check:forbidden-types` 是配套的**类型逃逸门禁**：扫描 `apps/**/src`、
`packages/**/src` 里的 `any` 类型注解、`as any` 断言和 `as unknown as` 双转，
按 `file::rule::excerpt` 计数写入
`scripts/checks/baselines/forbidden-types.json`。新增会立即失败；旧违规修完后运行
`node scripts/checks/check-forbidden-types.mjs --write` 缩小基线，`--list` 打印全部
发现。这条规则来自 AGENTS.md 的"不用 `any`、类型断言 `as`"硬性禁止。

`pnpm check:file-size` 是**文件体量基线门禁**（`scripts/checks/baselines/file-size.json`）：
已登记大文件只允许缩减、禁止无说明膨胀。新增大文件应先拆分或显式刷新 baseline；
与 god-file 治理（`server.ts`、`session-archive.ts`、`session-surface.tsx`、`main.mjs` 等）配套。
**不登记** `apps/desktop/resources/marketplace/**`、`bundled-skills/**`、`graphify-out/**`
（捆绑内容包 / 生成图，不是产品债；`--write` 会丢掉误加条目）。

当前检查覆盖：

- `packages/types` 不依赖 app/server/desktop/UI 业务包。
- `packages/ui` 不依赖 app/server/desktop 业务包。
- `apps/server` 不依赖 renderer、desktop 或 UI 包。
- `apps/desktop` 不直接 import renderer 包；renderer 交互必须走 IPC/preload/server API。
- **Desktop IPC 三层 SoT**：
  1. 命令名：`packages/types/src/desktop-ipc-commands.mjs`（运行时 groups）+
     `desktop-ipc-commands.d.mts`（字面量联合）；parity test 要求每条命令恰好声明和实现一次。
  2. 载荷类型：`packages/types/src/desktop-ipc.ts`（及 `desktop-ipc-code-workspace.ts`）。
  3. **命令 → args/result 映射：`packages/types/src/desktop-ipc-command-map.ts` 的
     `DesktopCommandMap` 已存在**，覆盖全部 `DesktopCommandName`。Map density：
     **全部命令均有显式 contract**（system / runtime / skills / messaging / opencode
     在 workspace + localAgents 之后已收紧）；仅少量嵌套字段仍用
     `Record<string, unknown>` 或 `unknown`（灵活 options、session metadata 等）。
     Renderer 侧 `apps/app/src/app/lib/desktop-invoke.ts` 的 `invokeDesktopCommand`
     按 Map 约束 args/result。preload / main dispatch 仍是运行时边界；handler 级
     parity 可继续加严，但不能把「命令名 parity」当成端到端 payload 已全部闭环。
- **Desktop handlers 已域拆分**：实现在 `apps/desktop/electron/desktop-handlers/`
  （`workspace` / `system` / `local-agents` / `task-orchestrator` / `messaging` / `agent-management` /
  `opencode` / `runtime` / `skills`），由 `createAllDesktopDomainHandlers` 组装；
  `desktop-command-router.mjs` 按 `desktopCommandGroups` 路由；`main.mjs` 只做
  composition root。新 IPC 优先加 domain handler + types map，而不是堆进 main。
- Renderer-facing HTTP client 方法以 `packages/types/src/server-client-methods.mjs`
  分域登记；**方法 → args/result 映射**在
  `packages/types/src/server-client-method-map.ts` 的 `ServerClientMethodMap`
  （覆盖全部 `ServerClientMethodName`；system / workspace / sessions / extensions /
  sessionArchive / artifacts / environment 等已有显式 contract，OpenCode router 等
  少数 client-local 形状仍用 fallback）。`app/lib/onmyagent-server.ts` 仅保留兼容
  barrel。实现位于 `app/lib/onmyagent-server/`：`client.ts` 为 facade
  （`createOnMyAgentServerClient` + map 类型 re-export + 可选 `serverClientMethod`
  动态访问），方法按域拆到 `client-system` / `client-workspace` /
  `client-sessions` / `client-extensions` / `client-session-archive`（共享 transport
  在 `client-shared`）；`domains.ts` 提供窄化 Pick 视图。跨端响应结构优先定义在
  `@onmyagent/types/server` 与 `@onmyagent/types/session-archive`。
- **Conversation capability（双运行时 UI）**：`react-app/capabilities/conversation/`
  提供中立 timeline / item VM / adapter 合同，把 **OpenCode 会话** 与
  **Personal Local Agent** 消息流映射到同一套 conversation items，供 `session` 与
  `local-agents` 宿主页复用，避免两套 transcript 表示分叉。
- `apps/app/src/app/lib/**` 不反向 import `react-app`。
- `apps/app/src/react-app/domains/<domain>` 的允许方向集中在
  `scripts/checks/domain-boundary-policy.mjs`；所有跨域 import 必须命中目标域一级 barrel。
- **域间依赖**（`A → B` 是否允许）写在
  `scripts/checks/domain-boundary-policy.mjs` 的 `allowedDomainDependencies`；
  `shared` 始终可读，其余跨域边必须登记。
  当前已登记方向包括（摘要，以 policy 文件为准）：
  `agents→connections|plugins|shell-feedback`、`local-agents→shell-feedback`、
  `messaging→agents|shell-feedback`（自动化 archive toast 等）、
  `session→agents|connections|local-agents|messaging|plugins|shell-feedback|workspace`、
  `settings→session|connections|plugins|shell-feedback`。
- **文件级深链过渡白名单** `allowedDomainImports`（`scripts/checks/check-boundaries.mjs`）
  **已清零**（Set 为空）：历史 `file|importPath` 例外已收完。该 Set 仍保留为文档 +
  可选再启用位；**只减不增**（不得再写入新例外）。跨域 import 必须走目标域一级 barrel。
  活跃边界由 `domain-boundary-policy.mjs` 与 public-barrel 规则强制。
  `local-agents` / `messaging` / `workspace` 不再作为「可随意反向依赖 session」的例外；
  artifact、model selection、session identity、conversation timeline、layout 与复合 UI 分别由
  `capabilities/` / `design-system/` 中立所有者承接。

### Feature → Domain → Transport

| Feature | UI domain / capability | Transport |
| --- | --- | --- |
| Live OpenCode chat | `domains/session` | HTTP `onmyagent-server` sessions + OpenCode SDK |
| Session archive / analytics | `domains/session` (+ archive UI) | HTTP sessionArchive methods |
| Personal Local Agent chat | `domains/local-agents` + `capabilities/conversation` | Desktop IPC `localAgents` |
| Workspace CRUD / remote | `domains/workspace` | Desktop IPC `workspace` + HTTP workspace |
| MCP / providers | `domains/connections` | HTTP extensions + Desktop agent-management |
| Messaging channels | `domains/messaging` | Desktop IPC `messaging` |
| Automations (schedule / run / archive) | `domains/messaging` | HTTP automations + server `automation-wait-policy` |
| Skills / plugins / marketplace | `domains/plugins` | HTTP extensions + Desktop `skills` |
| In-app browser automation | session browser + skill `browser-automation` | Desktop `browser-runtime` (in-app / chrome backends) |
| Real logged-in browser (BrowserSkill) | skill `browser-skill` + settings/setup UX | External `bsk` CLI + Chrome/Edge extension；desktop `browser-skill-desktop` 只做发现/doctor/安装引导（不替代 browser-runtime） |
| Engine / orchestrator / sandbox | shell / settings advanced | Desktop IPC `runtime` |
| Shared transcript items | `capabilities/conversation` | pure mappers (no I/O) |
| Content column / transcript layout | `capabilities/layout` | pure helpers (no I/O) |

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
pnpm test:runtime    → Desktop IPC / Electron runtime (no second orchestrator unit pass)
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
- desktop runtime / IPC 变更优先跑 `pnpm test:runtime`；该入口包含 Desktop IPC
  command/domain parity。orchestrator 模块单测走 `pnpm test:unit`。`pnpm test:ui` 包含 renderer HTTP client method parity。
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

**Current engineering constraints（边界，不是 changelog）：**

1. Server API contract 在 `@onmyagent/types/server`；`server.ts` 为 composition root，路由在 `apps/server/src/routes/`。
2. Archive 热路径走 **store pool + change-bus**（见 **Server Archive Runtime**）；写路径成功后 `notifyArchiveDbChanged`。
3. 双运行时主辅与禁交叉写见 **Dual Runtime Boundary**。
4. Desktop 新 IPC：优先 `desktop-handlers/*` + `DesktopCommandMap` / `desktopCommandGroups`，勿堆 `main.mjs`。
5. OpenCode pin 以根 `constants.json` 为准；PATH 旧 binary 不得盖住 pin/sidecar。
6. `pnpm check:file-size` 防回胀；`pnpm check:boundaries` 内置循环依赖门禁（`scripts/checks/check-circular-deps.mjs`，Tarjan SCC + 只减不增 baseline `scripts/checks/baselines/circular-deps.json`）。**禁止新增环**；存量环按 P1 计划拆除，baseline 只缩不长。
7. Shell 冷启动 / prewarm 规则见 `react-app/ARCHITECTURE.md` **Shell load / boot**。
8. **历史已合 PR 的拆文件清单不要继续堆在本节** — 见 `CHANGELOG.md` / git history。

## Personal Local Agent Runtime

- **主辅**：Personal 是辅轨（本机 CLI harness），不是主会话引擎；主辅与禁止交叉写见上文 **Dual Runtime Boundary**。
- UI 实现主目录：`apps/app/src/react-app/domains/local-agents/`（management / cards / ACP hooks / messages）。
- 会话宿主页保留兼容入口，但跨域调用必须通过 `local-agents` 一级 barrel 与 kernel 契约；文件级 `allowedDomainImports` 已清零（见上文 Package Boundaries），新跨域边只走 public barrel。
- Desktop harness / adapter 分层见上文 **Runtime Adapter (multi-agent harness)**；本段只记 UI 域边界。
- 临时执行 ledger 只写本地 `.loop/plans/`；稳定架构事实写本文件与 `apps/app/src/react-app/ARCHITECTURE.md`。
- 该路径不是 team workspace 或 global connector 的实现说明，除非用户明确扩展范围。

## Session Goal Lifecycle

会话内「追求目标」运行时（预览 → 发送创建 → 暂停/继续/结束、与规划模式互斥、按 `sessionId` 隔离）：

- 实现主要落在 `domains/session/surface/` 与 composer / goal runtime 相关模块。
- 行为细节以代码与测试为准；临时设计/执行 plan 只写本地 `.loop/`，不进 `docs/`。

## Graphify Baseline

- `graphify-out/graph.json` 是当前源码级图谱（生成产物，默认不手改）。规模随代码库变化，**不在文档里硬编码节点/边数**。
- **AST-only 一条命令（无需 LLM key）**：`pnpm task graphify build` → `scripts/cli/graphify-build.mjs`
  （`graphify update . --force --no-cluster`，校验 `graphify-out/graph.json`；CLI 缺失时非零退出 + 明确错误；可设 `GRAPHIFY_BIN`）。
- 推荐阅读入口：`graphify-out/GRAPH_REPORT.md` 与 `graphify query` / `graphify path`。完整交互 HTML 不是必需产物。
- 修改代码后优先 `pnpm task graphify build`；无法运行时记入本地 `.loop/`。

## Renderer network & logging（P0）

- **desktopFetch 策略**：`apps/app/src/app/lib/desktop-fetch-policy.ts` — loopback/相对路径直连；非 loopback http(s) **强制** main `__fetch`；协议相对 `//host` 按绝对 authority 处理；非 http(s) 拒绝。测试：`pnpm test:app desktop-fetch-policy`。
- **结构化日志**：`apps/app/src/app/lib/dev-log.ts` 的 `recordDevLog` / `createDevLogger`（level + source + label）。测试：`pnpm test:app dev-log`。

## Dual-runtime process gate（P2）

- 静态门禁：`scripts/checks/check-dual-runtime-boundary.mjs`（接入 `check:boundaries`）禁止 renderer / app 源码 import `personal-agent-runtime/**`，并禁止 personal-agent-runtime 直接 import server archive 热路径模块。
- 与上文 **Dual Runtime Boundary** 禁止交叉写一致；单元测试覆盖 fixture 违规失败。
