# AGENTS.md

OnMyAgent — 面向 agentic 工作流的桌面控制台，基于 OpenCode。本地优先，消费 server API surface，不被单一实现锁定。

**目标读者：AI Agent / Loop。本文是运行手册，不是架构/视觉百科。**
Architecture 是 monorepo SoT；包级 AGENTS 只做验证入口，不另写政策。

| 要什么 | 去哪 |
|--------|------|
| 架构 / 双运行时 / 包边界 / 命令矩阵 | [`docs/Architecture.md`](docs/Architecture.md) |
| 文档地图 / 全仓 SoT 表 | [`docs/README.md`](docs/README.md) |
| UI token / 组件形状 / shell chrome | [`DESIGN.md`](DESIGN.md) only |
| 专家/会话**产品行为**不变量 | Architecture Session / Expert + [`apps/app/src/react-app/ARCHITECTURE.md`](apps/app/src/react-app/ARCHITECTURE.md) |
| Expert lifecycle / 冷启动**预算** | Architecture → Session / Expert / cold-path |
| Loop / ledger / kill switch / graphify | [`docs/loop/rules.md`](docs/loop/rules.md) |
| 打包 | [`BUILD.md`](BUILD.md) |
| 发版 / 公证 | [`docs/release.md`](docs/release.md) |
| 安全报告 | [`SECURITY.md`](SECURITY.md) |
| 平台 / Computer Use / Appshot | [`docs/windows-compat.md`](docs/windows-compat.md) + Architecture Product platforms |

## 产品阶段（Phase 2 — 硬入口）

**阶段二**：桌面配置底座 + B 端（OnMyCompany 类）管控准备。

| 权威（长文） | 用途 |
|--------------|------|
| `docs/Architecture.md` | Monorepo SoT、阶段指针 |
| `docs/design/2026-08-09-architecture-convergence-plan.md` | Expert/session/冷启动/货架收敛计划 |
| `docs/design/2026-08-02-phase-2-enterprise-prep.md` | 路线图 · D1/B1/C1 · 桌面/企业边界 |
| `docs/design/2026-08-02-config-consistency.md` | `profiles/local` 迁移 · dual-read（2a） |
| `docs/design/2026-08-02-work-memory-plan.md` | 记忆路径 |

**硬约束（违反即错；路线图细节只在 design 文档）：**

1. **未登录必须完整可用**；禁止默认登录墙；无 `companyBaseUrl`/session 时禁止打企业 API。
2. **local / company 配置 schema 同构**；未登录禁止创建 `profiles/company`。
3. 配置迁移 **只复制不删** `~/.onmyagent/skills` 与 `marketplaces/`。
4. 组织策略真相源在未来企业服务端；桌面只消费，**不得本地放宽**。
5. Gateway / 外发：**凭据不得回到桌面进程**。
6. 本 monorepo 主责是桌面 + 本地 server；禁止在 Electron 内做半套企业控制面当第二真相源。

改配置路径 / skills 根 / 专家 marketplaces：走 `config-profile-paths` resolve，并覆盖 `runtime.mjs` 的 OpenCode skill 物化（见 desktop AGENTS + config-consistency）。

## Iron Law

回应任何用户消息前必须先读相关 Skill 与本文件（含寒暄、澄清、琐碎请求）。无例外。

## 项目骨架（地图）

```text
apps/desktop      Electron shell，IPC，sidecar，打包
apps/app          React UI（react-app 域架构）
apps/server       本地 HTTP API，SQLite，SSE
apps/orchestrator 可选编排进程：spawn onmyagent-server 二进制 + OpenCode（默认桌面不启动）
packages/types    Zod schema
packages/ui       视觉组件（无 app 状态）
packages/artifact-runtime  文档/表格 artifact 运行时（CJS）
packages/handsfree  macOS Computer Use（Win/Linux 不打包）
packages/onmyagent-ui-mcp  UI 控制面 MCP
```

完整树、数据流、包边界 → **Architecture**。默认忽略：`ee/*`、Den Web/API、landing、cloud dashboard。

### 包级手册

改包前先读短手册（验证命令 + 硬边界），**不要**把 Architecture 长文抄进包级文件。

| 包 | 手册 |
|----|------|
| `apps/app` | [`apps/app/AGENTS.md`](apps/app/AGENTS.md) |
| `apps/desktop` | [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) |
| managed CLI | [`apps/desktop/electron/managed-tools/AGENTS.md`](apps/desktop/electron/managed-tools/AGENTS.md) |
| `apps/server` | [`apps/server/AGENTS.md`](apps/server/AGENTS.md) |
| `apps/orchestrator` | [`apps/orchestrator/AGENTS.md`](apps/orchestrator/AGENTS.md) |
| `packages/types` | [`packages/types/AGENTS.md`](packages/types/AGENTS.md) |

### 双运行时 / Expert-Session（指针）

| 主题 | SoT |
|------|-----|
| OpenCode 主 · Personal 辅 · 禁交叉写 archive | Architecture **Dual Runtime Boundary** |
| Archive pool / change-bus / SSE | Architecture **Server Archive Runtime** |
| 产品行为（空壳 busy、origin、draft、首发、SSE 代际） | Architecture Session / Expert + React ARCHITECTURE；契约 `expert-session-invariants.test.ts` |
| Session 写路径 | 每个 session PR 必须点名写路径 owner：OpenCode / Personal / Task（IM-assistant 例外） |
| hard_delete / create flush / 冷启动数值预算 | Architecture Expert lifecycle + Cold-path budget |

## 构建与验证

命令面 SoT：`package.json` + `scripts/cli/*`；矩阵见 Architecture **Dev Command Surface**。

```bash
pnpm dev
pnpm check:type
pnpm task check <app|server|desktop|orchestrator|design|types>
pnpm check
pnpm test:unit | test:api | test:runtime | test:ui
pnpm task test sessions
```

环境：Node（`.nvmrc`）、pnpm 10.27.0、本地 opencode。只用 pnpm。  
打包 → `BUILD.md` · 发版 → `docs/release.md`。

### 任务收尾（非琐碎）

1. 实际跑过的验证命令 + 退出码/一行摘要。  
2. 变更范围一句话（包/路径级）。  
无文件变更的闲聊不算完成。

Desktop messaging channel unit（无 live 凭证）：  
`node --test apps/desktop/electron/channels/test/*.test.mjs`  
Maker/Checker 分层 → `docs/loop/rules.md`。

## 编码规约

### 硬性禁止（可执行门禁）

| 规则 | 门禁 |
|------|------|
| 无必要不用 `any` / 乱 `as` | `pnpm check:forbidden-types`（baseline 只减不增） |
| 类型已保证存在时不写 fallback | 人工 |
| 不直接改 secrets、生产配置、真实云资源、队列 purge、外发消息 | 人工 + Denylist |
| 公开文档 / PR 元数据不写签名身份、证书指纹、私钥、明文口令 | `pnpm check:privacy` |
| `shell/**` 只 import `domains/<domain>` 一级 barrel | `pnpm check:boundaries` |
| renderer 不新增硬编码 CJK；用户文案走 `t()` + en/zh/zh-TW | `pnpm check:i18n:cjk` |

### 默认技术栈

Tailwind · TypeScript · React · shadcn+BaseUI · TanStack Query · Zustand · Zod(v4) · Drizzle · Better-Auth。

### UI 与文案（门禁，非视觉百科）

| 归属 | 权威 |
|------|------|
| token / 形状 / signature / shell chrome / 动效 / 键位 | **DESIGN.md only** |
| i18n 三语 + `t()` | 本文件硬性禁止 + `check:i18n:cjk` |
| 专家/会话产品行为 | Architecture Session / Expert + React ARCHITECTURE |

禁止在 AGENTS 复述 DESIGN 细则。冲突以 DESIGN 为准。  
改 UI：读 DESIGN Task router → `pnpm task check design`。  
组件：`apps/app/src/components`；titlebar 可点区 `mac:titlebar-no-drag`（细节只在 DESIGN）。  
最小 diff；假设最终用户非技术。

### 分层依赖（摘要）

```text
packages/types → schema only
packages/ui    → 视觉 only
src/app/lib/   → 桥接，不直接拧 React state
src/react-app/domains/ → 业务域；不跨域直引 store
```

包边界全文 → Architecture **Package Boundaries**。

## 路径权限

| 类型 | 路径 | 规则 |
|------|------|------|
| Allowlist | `apps/**`, `packages/**`, `docs/**`, `AGENTS.md`, `README.md`, `README-zh.md`, `BUILD.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `DESIGN.md` | 任务范围内可改 |
| Human gate | `package.json`, `pnpm-lock.yaml`, `apps/server/src/**`, `apps/desktop/electron/**`, `apps/orchestrator/src/**` | 改前说明，改后完整验证 |
| Denylist | `.env*`, secrets, `node_modules/**`, `graphify-out/**`, generated cache | 默认不改不提交 |
| Search noise | `apps/desktop/resources/marketplace/**`, `bundled-skills/**`（非有意产品工作时）、`graphify-out/**` | 见 `.rgignore` |
| Dirty guard | 用户已有脏文件 | 禁止覆盖/顺手清理非本轮变更 |

## 多人协作

保护他人提交优先于「快速做完」。

- 开工：`git status --short --branch`（必要时 `git log -5`）。
- 禁止静默覆盖脏文件 / 远端新提交 / 落后 HEAD。
- 冲突：先分析；能双保留则合并；否则停问人；禁止默认整文件 ours/theirs。
- 禁止未授权 `reset --hard` / `checkout -- .` / `restore .` / `clean -fd` / `push --force`。
- 共享分支不用历史改写「整理」别人已基于其工作的提交。

## Loop 入口

**L2 辅助期**：可改 docs、低风险代码、补测试；不能无人确认改 Human gate 路径。

完整规则 → **`docs/loop/rules.md`**（ledger、Verifier 段、kill switch、graphify、恢复）。本文件只留：

- 可自动：实现、文档、修明确的 lint/typecheck/test。
- 必须问人：schema/真实资源、push/deploy/外发、越界、连续 3 次同错、产品/架构取舍。
- 动态状态只写 **`.loop/`**（gitignored）。禁止提交 `docs/plans|archive|features|superpowers`。

## 文档导航

**完整地图：`docs/README.md`。** 下表是 Agent 最短路径。

| 任务 | 先读 |
|------|------|
| 人类入门 / 贡献 | `README.md` · `CONTRIBUTING.md` |
| 架构 / 双运行时 / 命令面 | `docs/Architecture.md` |
| 改某包 | 该包 `AGENTS.md` |
| React 域 | `apps/app/src/react-app/ARCHITECTURE.md` |
| UI 视觉 | `DESIGN.md` only |
| 专家/会话行为 | Architecture Session / Expert + React ARCHITECTURE |
| Expert 删除/创建/冷启动预算 | Architecture cold-path / lifecycle |
| Loop | `docs/loop/rules.md` |
| 打包 / 发版 | `BUILD.md` · `docs/release.md` |
| 本地 handoff | `.loop/state/PROGRESS.md` · `.loop/runs/` |

## 项目 Skills

编辑源与分工 → [`.agents/README.md`](.agents/README.md)。  
工程 skill **只**在 `.agents/skills/**` 改；勿复制到 `.codex/` / `.claude/` / `.grok/` 或 `~/.codex/skills/`。  
产品 bundled skills：`apps/desktop/resources/bundled-skills/**`（与工程 skill 不同步）。`.opencode/` = OpenCode 工作区配置。
