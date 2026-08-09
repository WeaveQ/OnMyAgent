# AGENTS.md

OnMyAgent — 面向 agentic 工作流的桌面控制台，基于 OpenCode。本地优先，消费 server API surface，不被单一实现锁定。

**目标读者：AI Agent / Loop。本文是运行手册，不是架构百科。** 架构详版见 `docs/Architecture.md`。

## 产品阶段（Phase 2 — 必读）

当前处于 **阶段二**：桌面配置底座 + **B 端（OnMyCompany 类）管控准备**。

| 权威文档 | 用途 |
|----------|------|
| [`docs/Architecture.md`](docs/Architecture.md) | Monorepo SoT：平台、双运行时、skills 写路径、域指针 |
| [`docs/design/2026-08-09-architecture-convergence-plan.md`](docs/design/2026-08-09-architecture-convergence-plan.md) | Expert/session/冷启动/货架收敛执行计划 |
| [`docs/design/2026-08-02-phase-2-enterprise-prep.md`](docs/design/2026-08-02-phase-2-enterprise-prep.md) | 阶段二路线图、双模式决策 D1/B1/C1、桌面/企业轨道边界 |
| [`docs/design/2026-08-02-config-consistency.md`](docs/design/2026-08-02-config-consistency.md) | `profiles/local` 迁移与 dual-read（2a 已落地代码） |
| [`docs/design/2026-08-02-work-memory-plan.md`](docs/design/2026-08-02-work-memory-plan.md) | 记忆正文路径；与双模式写入规则 |

**硬约束（违反即错）：**

1. **未登录必须完整可用**；禁止默认登录墙；无 `companyBaseUrl`/session 时禁止打企业 API。
2. **local / company 配置 schema 同构**；未登录禁止创建 `profiles/company`。
3. 配置迁移 **只复制不删** `~/.onmyagent/skills` 与 `marketplaces/`。
4. 策略真相源在未来企业服务端；桌面只消费，**不得本地放宽**组织策略。
5. Gateway / 外发路径：**凭据不得回到桌面进程**。
6. 本 monorepo 主责仍是桌面 + 本地 server；不要在 Electron 内做半套企业控制面当第二真相源。

改配置路径 / skills 根 / 专家 marketplaces 时，须走 `config-profile-paths` resolve，并覆盖 `runtime.mjs` 的 OpenCode skill 物化路径。

## Iron Law（铁律）

Agent 在回应任何用户消息前，必须先读取并遵循相关 Skill 和本文件规则，包括：

- 看似随意的问候、闲聊或寒暄。
- 看似简单的澄清问题。
- 看似琐碎的请求，如“看下”“优化一下”“随便扫一下”。

没有例外。AI agents optimize for the shortest path, and the shortest path usually skips your process.

## 项目骨架

pnpm monorepo，Turbo 编排构建。核心边界：

```text
apps/desktop      Electron shell，IPC，sidecar 管理，打包
apps/app          React UI，src/app/lib 兼容层 + src/react-app 域架构
                  domains: session, local-agents, messaging, agents, plugins,
                  workspace, settings, connections, cloud, shell-feedback, shared(infra)
apps/server       本地 HTTP API，workspace/session/skill/MCP/审批，SQLite，SSE
apps/orchestrator 进程编排，嵌入 server，spawn opencode，sandbox
packages/types    Zod schema，共享类型边界
packages/ui       React-only 视觉组件（@onmyagent/ui/react），不依赖 app 状态
packages/handsfree macOS Computer Use（HandsFree AX/Skysight；Win/Linux 不打包此包）
packages/onmyagent-ui-mcp UI 控制面 MCP server
```

**Computer Use 跨平台：** macOS = HandsFree helper；Windows = 桌面侧 bundled **Cua Driver**（`prepare-cua-helper` / `computer-use-runtime-config`，MCP 默认关）。Appshot 在 **macOS / Windows** 走 Electron `desktopCapturer`（Linux 桌面非产品目标）。细节见 `docs/windows-compat.md` + `docs/Architecture.md` Product platforms。

默认忽略：`ee/*`、Den Web/API、landing page、cloud dashboard。完整架构、数据流、包边界只维护在 `docs/Architecture.md`；React 域细节只维护在 `apps/app/src/react-app/ARCHITECTURE.md`。

### 包级手册

改具体包时**先读该包短手册**（默认验证命令与禁止事项），再读本文件与 Architecture。不要把长文复制进包级文件。

| 包 | 手册 |
|----|------|
| `apps/app` | [`apps/app/AGENTS.md`](apps/app/AGENTS.md) |
| `apps/desktop` | [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) |
| `apps/desktop` managed CLI（OfficeCLI / 飞书） | [`apps/desktop/electron/managed-tools/AGENTS.md`](apps/desktop/electron/managed-tools/AGENTS.md) |
| `apps/server` | [`apps/server/AGENTS.md`](apps/server/AGENTS.md) |
| `apps/orchestrator` | [`apps/orchestrator/AGENTS.md`](apps/orchestrator/AGENTS.md) |
| `packages/types` | [`packages/types/AGENTS.md`](packages/types/AGENTS.md) |

### 双运行时主辅（硬事实）

- **OpenCode** = 产品主运行时与主会话真相源（server / archive / SSE / `domains/session`）。
- **Personal Local Agent** = 桌面辅轨：本机 CLI/ACP agent harness（`personal-agent-runtime` + `domains/local-agents`），**不是**第二套主引擎。
- 可共享 conversation **展示**合同；**禁止**交叉写对方 store / archive。细则与决策启发式：`docs/Architecture.md` → **Dual Runtime Boundary**。
- 主轨 archive 热路径：store pool + change-bus + SSE 策略（同文档 **Server Archive Runtime**）；新增代码勿绕过 pool 裸 open。

### Experts / Session 不变量（摘要）

专家空壳、origin 水合、bound draft 消费、首发冷路径可见性、snapshot/SSE 代际隔离等 **行为铁律** 写在 [`apps/app/AGENTS.md`](apps/app/AGENTS.md) → **Experts / Session 不变量**。改相关代码前必读；契约：`apps/app/scripts/expert-session-invariants.test.ts`。

## 构建与启动

```bash
pnpm dev                  # 默认启动桌面端（Electron + UI + server）
pnpm dev -- app           # 统一入口：仅 UI（Vite renderer）
pnpm dev -- server        # 统一入口：本地 HTTP API
pnpm dev -- orchestrator  # 统一入口：runtime/orchestrator CLI
pnpm dev -- headless      # 统一入口：无 Electron 的 Web + server smoke 模式
pnpm check:type           # 全 workspace TypeScript 基线
pnpm check:types:all      # 显式全量类型门禁：types/ui/app/server/desktop/orchestrator
pnpm task check app       # 低频专项检查入口：app renderer 类型检查
pnpm task check server    # 低频专项检查入口：server 类型检查
pnpm task check desktop   # 低频专项检查入口：desktop Electron 类型检查
pnpm task check orchestrator # 低频专项检查入口：orchestrator 类型检查
pnpm task check design    # 低频专项检查入口：DESIGN.md YAML 与代码 token 漂移检测
pnpm check:boundaries     # 架构边界 + shell-import-depth 门禁
pnpm check:forbidden-types # any / as any / as unknown as 类型逃逸门禁
pnpm check:file-size      # 大文件体量基线（只减不增）
pnpm check:i18n:cjk       # renderer 层中日韩硬编码字符串门禁
pnpm test:unit            # server + orchestrator 单元/集成测试
pnpm test:api             # server HTTP/API e2e 测试
pnpm test:runtime         # Electron bridge + orchestrator runtime smoke
pnpm test:ui              # app version gate + UI/e2e smoke
pnpm task test sessions   # 低频 app 专项测试入口
pnpm task build app       # UI 构建
```

环境要求：Node（见 `.nvmrc`）、pnpm 10.27.0、本地 opencode binary。只用 pnpm，不用 npm / yarn。

## 编码规约

### 硬性禁止

- 不用 `any`、类型断言 `as`，除非 100% 必要或用户明确要求。
  由 `pnpm check:forbidden-types` 强制（新违规立即失败）；历史违规冻结在
  `scripts/checks/baselines/forbidden-types.json`，只能缩减、禁止手改扩增。
- 类型或控制流已保证存在时，不写 fallback。
- 不直接改 secrets、生产配置、真实云资源、队列 purge、外部消息发送。
- `apps/app/src/react-app/shell/**` 只能 import 到 `domains/<domain>` 的一级 barrel，
  不得深链 `domains/<domain>/<sub>/...`。由 `pnpm check:boundaries` 中的
  shell-import-depth 规则强制，baseline 位于
  `scripts/checks/baselines/shell-import-depth.json`，同样只减不增。
- `apps/app/src` renderer 层不新增硬编码 CJK（中/日/韩）字符串：
  用户可见文案必须走 `apps/app/src/i18n/locales/{en,zh,zh-TW}/*.ts` 的 `t()`。
  由 `pnpm check:i18n:cjk` 强制，历史违规冻结在
  `scripts/checks/baselines/i18n-cjk-hardcoded.json`，只能缩减、禁止手改扩增。

### 默认技术栈

Tailwind / TypeScript / React / shadcn+BaseUI / TanStack Query / Zustand / Zod(v4) / Drizzle / Better-Auth。

### UI 与文案

**视觉 / token / 组件形状 / 动效 / 键位展示 SoT = 根目录 [`DESIGN.md`](DESIGN.md)**（YAML front matter + §4–§11）。  
AGENTS 只保留**流程门禁**；细则（`SegmentedTabGroup`、`rounded-full` 白名单、`mac:titlebar-no-drag`、signature 组件、颜色阶梯等）以 DESIGN 为准，**禁止在本文件复述或分叉**。代码与 DESIGN 冲突时以 DESIGN 为准。

- 最小 diff；假设最终用户非技术用户。
- 改/生成 UI 前：先读 `DESIGN.md`（可用文内 Task router）；改 token/CSS/tailwind 后跑 `pnpm task check design`（CI：`--strict --baseline scripts/checks/baselines/design-drift.json`）。
- 组件：优先 `apps/app/src/components`（shadcn + Base UI）；新原始件先对 DESIGN `components.contracts`。
- **i18n 门禁**（可执行，非视觉）：renderer 用户可见文案走 `t()` + `locales/{en,zh,zh-TW}`（见上文 `check:i18n:cjk`）。
- 桌面 titlebar 可点区域：交互控件加 `mac:titlebar-no-drag`（细则见 DESIGN flags / § shell chrome）。
### 分层依赖

```text
packages/types → 只定义 schema，不依赖 app/server 业务逻辑
packages/ui → 只做视觉组件，不依赖 app 状态
src/app/lib/ → 桥接层，不直接操作 React state
src/react-app/domains/ → 业务域，通过 kernel store 交互，不跨域直接引用 store
```

## 路径权限

| 类型 | 路径 | 规则 |
|------|------|------|
| Allowlist | `apps/**`, `packages/**`, `docs/**`, `AGENTS.md`, `README.md`, `README-zh.md`, `BUILD.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` | 可在任务范围内修改 |
| Human gate | `package.json`, `pnpm-lock.yaml`, `apps/server/src/**`, `apps/desktop/electron/**`, `apps/orchestrator/src/**` | 修改前说明原因，修改后完整验证 |
| Denylist | `.env*`, secrets, `node_modules/**`, `graphify-out/**`, generated runtime/cache 输出 | 默认不改、不提交 |
| Search noise (default ignore when grepping) | `apps/desktop/resources/marketplace/**`, `apps/desktop/resources/bundled-skills/**`（除有意产品/分发内容工作外）、`graphify-out/**` | 搜代码时优先排除；见根目录 `.rgignore` |
| Dirty guard | 用户已有脏文件 | 先识别，禁止覆盖或顺手清理非本轮变更 |

## 多人协作安全规则

多人或多 Agent 并行开发时，保护他人提交和本轮提交优先于快速完成任务。

- 开工前必须检查当前分支和脏状态：`git status --short --branch`，必要时再看 `git log --oneline -5`，确认当前 HEAD、远端位置和已有未提交文件。
- 不允许静默覆盖别人或用户的改动。发现任务相关文件已有脏改动、远端新提交、或本地 HEAD 已落后时，必须先说明风险并基于当前内容继续，不能把文件回滚到旧版本后直接重写。
- 拉取、合并、rebase 或解决冲突前必须先分析冲突内容。能同时保留双方改动的，必须合并成同时保留的结果；不能同时保留的，必须停止让人工确认。
- 请求人工确认冲突取舍时，必须说明冲突双方分别改了什么、影响什么功能、可选方案是什么，方便人工判断保留哪一边或如何组合。
- 禁止用“ours/theirs 整文件覆盖”作为默认冲突解决方式。只有在逐段确认该文件另一边改动确实不需要，或用户明确指示保留某一边时，才允许采用整块取舍。
- 恢复旧提交内容时，禁止直接整文件回滚后交付。若必须从旧提交恢复文件，恢复后必须逐项核对该文件在旧提交之后的所有后续改动，并把非目标变更重新保留回来。
- 提交或交付前必须报告本轮 touched files，并确认没有夹带无关文件、没有删除他人后续提交、没有把用户脏文件当成本轮成果。
- 禁止 `git reset --hard`、`git checkout -- .`、`git restore .`、`git clean -fd`、`git push --force` 等批量破坏性命令，除非用户明确点名要求该操作并已说明后果。
- 对多人共享分支，优先使用独立工作分支和普通 merge/rebase 流程；不要在共享分支上用历史改写命令“整理”别人已经基于其工作的提交。

## Loop 规则入口

默认运行级别为 **L2 辅助期**：可修改 docs、低风险代码、补测试脚本；不能无人确认地改高风险路径。

非平凡 loop、跨阶段任务、durable ledger、Reference Parity、Kill Switch、graphify 和恢复流程的完整规则必须读取并遵循 `docs/loop/rules.md`。本文件只保留硬入口：

- 可自动继续：代码实现、文档更新、运行/修复明确的 lint/typecheck/test。
- 必须跳出问用户：schema/数据结构变更、线上/真实资源、push/deploy/外部消息、超出当前边界、连续 3 次同错失败、需要产品/架构取舍。
- 本地状态：动态 progress/run log/intent debt/执行 plan 只写 `.loop/`（gitignored）。禁止把 plan ledger 提交到 `docs/plans/`、`docs/archive/`、`docs/features/` 或 `docs/superpowers/`（均已 ignore）。

## 验证入口

- 每次代码变更至少跑相关 typecheck/test/import smoke 和 `git diff --check`；默认优先 `pnpm check:type` 或对应 `pnpm task check <target>`。
- 文档变更至少跑旧命令/旧引用扫描、核心链接 smoke 和 `git diff --check`。
- Desktop messaging **channel unit gate**（纯本地、无飞书/微信凭证）：`node --test apps/desktop/electron/channels/test/*.test.mjs`（亦可包含 `apps/desktop/electron/channels/AgentReplyHeader.test.mjs`）。不要用需要 live credentials 的 E2E 代替。
- 详细 Maker/Checker、验证分层、失败重试和终止规则见 `docs/loop/rules.md`。

### 任务收尾（非琐碎任务）

结束前必须留下**可解析的验收信号**（便于 harness / 后续会话对照；勿贴密钥或私有绝对路径）：

1. **实际跑过的验证命令** + **退出码或一行结果摘要**。
2. **变更范围一句话**（包或路径级）。

常用示例：

```bash
pnpm task check app          # 改 apps/app 时
pnpm check:file-size         # 触碰大文件 / session 页时
pnpm task check server       # 改 apps/server 时
pnpm task check desktop      # 改 apps/desktop 时
pnpm task check orchestrator # 改 apps/orchestrator 时
pnpm task check types        # 改 packages/types 或全量 typecheck 时
```

只讨论不跑 check、或无文件变更的闲聊，不算完成非琐碎任务。

## 文档导航（精简）

**完整地图只维护一份：`docs/README.md`。** 需要目录、SoT 规则、归档位置时读那里。

| 任务 | 先读 |
|------|------|
| 人类快速开始 / 贡献 | `README.md` · `CONTRIBUTING.md` |
| 本文件之后的系统架构 | `docs/Architecture.md` |
| 改 app / desktop / server / orchestrator / types | 对应包级 `AGENTS.md`（见上「包级手册」） |
| React 域 / 路由身份 | `apps/app/src/react-app/ARCHITECTURE.md` |
| UI 视觉契约 | `DESIGN.md` |
| 重 loop / kill switch / graphify | `docs/loop/rules.md` |
| 本地打包 | `BUILD.md` |
| 发版 / tag | `docs/release.md` |
| 本地 handoff / run log | `.loop/state/PROGRESS.md` · `.loop/runs/`（不进 git） |

动态状态只写 `.loop/`。文档目录见 `docs/README.md`。

## 项目 Skills

编辑源、跨 harness symlink、Skill 目录、新增流程与产品/工程 skill 分工全部在 `.agents/README.md`。工程 skill 只在 `.agents/skills/**` 编辑；不要复制到 `.codex/` / `.claude/` / `.grok/` 或 `~/.codex/skills/`。桌面 **产品** bundled skills 在 `apps/desktop/resources/bundled-skills/**`，`.opencode/` 是 OpenCode 工作区配置，二者都不与工程 skill 同步。