# AGENTS.md

OnMyAgent — 面向 agentic 工作流的桌面控制台，基于 OpenCode。本地优先，消费 server API surface，不被单一实现锁定。

**目标读者：AI Agent / Loop。本文是运行手册，不是架构百科。** 架构详版见 `docs/Architecture.md`。

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
packages/handsfree macOS Computer Use
packages/onmyagent-ui-mcp UI 控制面 MCP server
```

默认忽略：`ee/*`、Den Web/API、landing page、cloud dashboard。完整架构、数据流、包边界只维护在 `docs/Architecture.md`；React 域细节只维护在 `apps/app/src/react-app/ARCHITECTURE.md`。

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

- 最小 diff，更简单方案优先。
- 修改或生成 UI 前，必须先读根目录 `DESIGN.md`：YAML front matter（`colors` / `typography` / `rounded` / `spacing` / `buttons` / `iconography` / `z-layers` / `motion` / `focus` / `state-timings` / `notifications` / `kbd` / `message-roles` / `streaming` / `presence` / `tool-approval` / `artifact-hue` / `components`（含 `components.contracts` 组件级 `{token.ref}` 契约） / `flags`）+ § 4 组件契约（含 Signature Components）+ § 4a State Machines + § 4b Notifications + § 4c Message Roles + § 4d Streaming Presentation + § 4e Presence & Activity + § 4f Tool Approval + § 4g Code & Diff + § 4h Session & Artifact Variants + § 5a Keyboard Contract + § 7 Shapes + § 8 Do's/Don'ts + § 10 Internationalization Space Budget + § 11 Intentional Exceptions（含 `artifact-hue.*` 隔离条款）。图标尺寸、z-index、状态时序、toast 时长、键位显示必须来自对应 YAML 块，不要臆造。键盘快捷键按 § 5a 用 `⌘K` 声明式书写，跨平台在运行时替换，不要作者层 fork。代码与 `DESIGN.md` 冲突时以 `DESIGN.md` 为准。
- UI token 或 design contract 变更后（`DESIGN.md`、`apps/app/src/app/index.css`、`apps/app/tailwind.config.ts`），运行 `pnpm task check design` 确认无漂移；`-- --strict --baseline scripts/checks/baselines/design-drift.json` 是 CI 使用的门禁形态（只允许下降，不允许新增签名），必要时可用 `node scripts/design/codemod/fix-tokens.mjs`（默认 dry-run，`--write` 生效）批量修 mechanical drift。
- UI 组件用 `@/components`，新组件优先 shadcn/ui with Base UI。
- **Tab bar / segmented control**：多组 tab 切换必须用 `<SegmentedTabGroup>` + `<NavTabButton size="tab" shape="tab">`（rounded-lg 10 + text-sm）；禁止手写 `inline-flex rounded-lg border p-1` 包 `NavTabButton` 默认 pill——那是历史漂移形状。
- **`rounded-full` 仅限**：avatar（`AgentAvatarMesh` / `size-N rounded-full` 头像）、`NavTabButton shape="pill"`（compact filter chips）、`SendButton`（signature 圆形送出）、`architecture-mismatch-gate.tsx`（pre-app boot）。其它普通 CTA 用 `rounded-full` 必须拒绝，参见 `DESIGN.md` § 8 Don'ts 与 § 11 Intentional Exceptions。
- 假设最终用户非技术用户。
- 后续新增的用户可见功能必须接入现有中英文国际化体系，避免写死单一语言文案。
- Electron macOS 顶部导航栏、标题栏、侧栏 header 内的所有交互按钮必须避开原生拖拽区域：优先使用共享 `Button`，自定义交互控件或容器必须加 `mac:titlebar-no-drag`，避免点击图标位置被窗口拖拽/双击事件吞掉。

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
- 本地状态：动态 progress/run log/intent debt/执行 plan 只写 `.loop/`（gitignored）。禁止把 plan ledger 提交到 `docs/plans/` 或 `docs/archive/`（亦已 ignore）。

## 验证入口

- 每次代码变更至少跑相关 typecheck/test/import smoke 和 `git diff --check`；默认优先 `pnpm check:type` 或对应 `pnpm task check <target>`。
- 文档变更至少跑旧命令/旧引用扫描、核心链接 smoke 和 `git diff --check`。
- 详细 Maker/Checker、验证分层、失败重试和终止规则见 `docs/loop/rules.md`。


## 文档导航（精简）

**完整地图只维护一份：`docs/README.md`。** 需要目录、SoT 规则、归档位置时读那里。

| 任务 | 先读 |
|------|------|
| 人类快速开始 / 贡献 | `README.md` · `CONTRIBUTING.md` |
| 本文件之后的系统架构 | `docs/Architecture.md` |
| React 域 / 路由身份 | `apps/app/src/react-app/ARCHITECTURE.md` |
| UI 视觉契约 | `DESIGN.md` |
| 重 loop / kill switch / graphify | `docs/loop/rules.md` |
| 本地打包 | `BUILD.md` |
| 发版 / tag | `docs/release.md` |
| 本地 handoff / run log | `.loop/state/PROGRESS.md` · `.loop/runs/`（不进 git） |

动态状态只写 `.loop/`。文档目录见 `docs/README.md`。

## 项目内 Codex Skills

- 发现规则：本仓库专属 Codex skill 放在 `.codex/skills/<name>/SKILL.md`，不要同步到 `~/.codex/skills/`，避免变成全局技能。
- `documentation-audit`：当用户要求扫描、优化、整理或更新项目文档，检查旧命令、旧品牌、断链、状态文档膨胀、路线图漂移时，先读取 `.codex/skills/documentation-audit/SKILL.md` 并按其中流程执行；同名副本保留在 `.opencode/skills/documentation-audit/`。
- `ui-regression-audit`：当用户要求全局 UI 扫描、主题一致性、设置页截图巡检、中英文/i18n 检查、视觉回归报告时，先读取 `.codex/skills/ui-regression-audit/SKILL.md` 并按其中流程执行。
- `frontend-primitive-refactor`：当用户要求前端组件重构、组件复用、统一同类组件大小、design token 防偏移时，先读取 `.codex/skills/frontend-primitive-refactor/SKILL.md` 并按其中流程执行。
- OpenCode 兼容：同名副本保留在 `.opencode/skills/`；改动 `documentation-audit`、`ui-regression-audit`、`frontend-primitive-refactor` 时同步更新 `.codex/skills/` 与 `.opencode/skills/` 对应副本。
- 桌面 bundled skills：`apps/desktop/resources/bundled-skills/**` 是产品分发内容，不和项目内 `.codex/skills/**` 自动同步；来源与同步策略见 `.codex/skills/documentation-audit/references/skills-sync.md`。
