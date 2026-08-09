# OnMyAgent

[中文](./README-zh.md) | [English](./README.md)

## 文档入口

| 需求 | 文档 |
| --- | --- |
| 快速开始（本页） | 继续往下读 |
| 贡献 / PR | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| AI Agent 规则 | [`AGENTS.md`](./AGENTS.md) |
| 架构 | [`docs/Architecture.md`](./docs/Architecture.md) |
| UI / 视觉契约 | [`DESIGN.md`](./DESIGN.md) |
| 文档总目录 | [`docs/README.md`](./docs/README.md) |
| 阶段二 / B 端管控准备 | [`docs/design/2026-08-02-phase-2-enterprise-prep.md`](./docs/design/2026-08-02-phase-2-enterprise-prep.md) |

**本地办公工作台：任务在本机，模型你自选。**

OnMyAgent 是开源**桌面办公 Agent 工作台**——在本机完成文档、表格、自动化与审批，而不是又一个云端聊天窗口。

**产品阶段：阶段二**——夯实本机配置底座，并为可选的**内网 B 端管控**（OnMyCompany：身份、隔离、策略、审计、Gateway）做准备。**未登录本地使用仍是默认**；连接公司为可选项，不是登录墙。详见 [阶段二路线图](./docs/design/2026-08-02-phase-2-enterprise-prep.md)。

- **办公优先**：会话、文件、自动化、消息渠道，围绕日常办公交付。
- **本地优先**：工作区与产物默认在本机；高风险操作可审批。
- **任意模型（BYOK）**：官方服务、兼容 API、本机 Ollama 等均可接入，不绑定单一厂商。
- **专家与垂类后置**：专家市场与行业能力会持续扩展；当前主路径是稳的办公体验，未就绪的能力不当主卖点。
- **组织管控（路线图）**：配置同构 + 双模式，服务内网 OnMyCompany 试点——**不是**公网多租户 SaaS 承诺。

进阶能力（本机 Coding CLI / MCP / 多 Agent 接入）仍然存在，放在设置与高级入口，不抢办公主叙事。

## 为什么需要 OnMyAgent？

办公侧的模型已经够强，缺的是「在本机把事办完、存住、定时再做」：

- 聊天工具很强，但文件、定时任务、审批和渠道往往散落各处。
- 企业办公助手常绑死一家模型或一家云，密钥与数据路径不透明。
- 纯 CLI / 开发者 Agent 强大，却不是办公用户的默认入口。
- 需要本地工作区：读写本机文件、可恢复会话、可审查产物。

所以 OnMyAgent 主打：**本地办公 + 自选模型**，而不是「再做一个聊天克隆」或「再做一个云编排平台」。

## 它是什么

OnMyAgent 是：

- 面向知识工作者与 AI 用户的**本地办公桌面工作台**。
- 会话、文件、自动化、技能 / 专家、消息渠道与权限审批的统一界面。
- **本地优先、BYOK、尽量不绑定单一模型服务商**的开源项目。

OnMyAgent 不是：

- 只做闲聊的通用 Chat 克隆。
- n8n / Dify / Zapier 这类云端工作流编排平台。
- 公网多租户托管式企业 SaaS（阶段二准备的是**内网** OnMyCompany 类管控试点；默认仍是本地优先）。
- 用来替代 Cursor / Claude Code 等编码 IDE 的主场产品（本机 Coding Agent 可作为高级接入）。

## 它和其他工具是什么关系？

| 工具 | 它做什么 | OnMyAgent 如何配合 |
|------|----------|-------------------|
| 各家大模型 / 兼容 API / Ollama | 推理与生成 | **自选接入**；密钥与默认模型在设置中管理 |
| ChatGPT / 豆包等桌面聊天 | 对话界面 | 不同品类：我们偏**本地工作区 + 文件/自动化/审批** |
| 腾讯 WorkBuddy 等办公 Agent | 生态内办公助手 | 相近场景；我们强调**本地与模型自选**，不绑单一生态 |
| OpenCode | 本地 Agent 运行底座 | **主会话 / server 底座**（实现细节，对用户呈现为本地工作区） |
| Codex / Claude Code 等 CLI | Coding Agent | **高级接入**（Personal 辅轨），非办公默认首页 |
| MCP / Skills | 工具与可复用能力 | 在工作台中配置与调用 |
| n8n / Dify / Zapier | 云端工作流 | 不同品类：我们聚焦**本机办公任务**，不是图画式编排 |

## 核心概念

- **工作区 Workspace**：本机文件夹，任务与产物的默认落点。
- **会话 Session**：一次可恢复的办公协作过程。
- **模型 Provider**：你接入的任意推理服务；默认模型用于新对话与自动化。
- **自动化 Automation**：定时或触发的办公任务（汇报、汇总、提醒等）。
- **产物 Artifact**：文档、表格、报告、截图等交付物，可在文件区继续打开与外编。
- **专家 / 技能（扩展）**：可安装的能力包；垂类专家按就绪度逐步开放。

## 功能模块

- **首页会话**：派发办公任务、查看进度与回复。
- **专家与市场**：能力扩展入口（未就绪专家会持续打磨，不作为当前主承诺）。
- **自动化**：调度周期性办公任务并查看运行历史。
- **文件**：工作区文件、任务产物与预览 / 外编。
- **消息渠道**：飞书 / 微信等触达路径（按平台能力启用）。
- **模型与设置**：连接任意服务商、默认模型、环境变量、系统权限与偏好。
- **Skills / MCP / Memory**：可复用能力、外部工具与长期偏好。
- **权限与审批**：高风险本地动作的显式确认。
- **Local-first / BYOK**：工作留在本机，密钥由用户掌控。
- **桌面端打包**：macOS 为主；Windows NSIS 为开发者预览包。
- **国际化**：英文、简体中文、繁体中文。

## 平台支持

- **macOS** 是主发布与日常 dogfood 平台（Apple Silicon + Intel）。
- **Windows** 可跑 Electron shell、sidecar 与大部分产品 UI；预检、NSIS 打包、
  Computer Use（内置 Cua Driver）、Appshot，以及仍属 macOS-only 的缺口
  （`sandbox-exec`、HandsFree AX/Skysight、代码签名）见
  [`docs/windows-compat.md`](./docs/windows-compat.md)。
- **Linux** 包（含 Arch AUR）暂不支持。
- **Computer Use**：macOS 使用 HandsFree helper（helper 就绪时 MCP 默认开）；
  Windows 打包 **Cua Driver**（MCP 会注册，**默认关**，需
  `ONMYAGENT_COMPUTER_USE_ENABLED=1` 开启）。**不是**完整 HandsFree 对等。
- **Appshot**（对话「截取桌面」）：**macOS / Windows** 走 Electron
  `desktopCapturer`（Linux 桌面包非产品目标）；快捷键在 设置 → 快捷键 中可改。

## 工作流

```text
选择本地工作区文件夹
        ↓
连接任意模型（官方 / 兼容 API / 本机）
        ↓
派发办公任务（会话 / 自动化）
        ↓
需要时审批敏感操作
        ↓
在「文件」中打开或外编产物
        ↓
交付或继续迭代
```

## 环境要求

- Node.js 版本与 `.nvmrc` 和 `package.json#engines` 保持一致。
- `pnpm@10.27.0`。
- Bun `1.3.9+`，用于部分 runtime 脚本。
- Git。
- 使用 OpenCode runtime 时，`PATH` 中需要可用的 OpenCode CLI。
- macOS 桌面端开发需要 Xcode Command Line Tools。

## 快速开始

安装依赖：

```bash
pnpm install
```

启动桌面端：

```bash
pnpm dev
```

`pnpm dev` 会启动 Electron 桌面壳、UI 和本地运行时。它默认选择 `desktop`，并在开发模式下使用隔离的 OpenCode 状态。

指定某个 app 时使用统一入口：

```bash
pnpm dev -- app
pnpm dev -- server
pnpm dev -- orchestrator
pnpm dev -- headless
```

## 常用命令

```bash
pnpm check
pnpm check:i18n
pnpm check:security
pnpm check:boundaries
pnpm check:forbidden-types
pnpm task check app
pnpm task check server
pnpm task build app
pnpm test:unit
pnpm test:api
pnpm test:runtime
pnpm test:ui
pnpm task test server:automation
```

| 分组 | 脚本 | 说明 |
|------|------|------|
| 日常开发 | `dev -- <target>` | `dev` 默认启动桌面端；目标包括 `app`、`server`、`orchestrator` 和 `headless`。 |
| 构建 | `build`、`task build app`、`task build desktop` | UI-only 构建用 `task build app`。 |
| 检查 | `check`、`check:type`、`check:types:all`、`task check <target>` | 交付前优先运行。`check:type` 是全 workspace 类型门禁。 |
| 测试门禁 | `test:unit`、`test:api`、`test:runtime`、`test:ui` | 分层覆盖 server/orchestrator、API、Electron/runtime、app UI smoke。 |
| 专项测试 | `task test <target>` | 会话、权限、事件、自动化、server、orchestrator 和模块专项测试。 |
| 版本号 | `task bump <target>` | 应用版本更新。 |
| Website | `task website <target>` | Website dev、build、check 和 preview。 |
| 发布 | `release:*` | release review、prepare 和 ship 流程。 |

本地 Electron 打包流程见 `BUILD.md`。

完整文档导航见 `docs/README.md`。

## 架构

```text
apps/desktop        Electron shell、IPC、sidecar/runtime 管理
apps/app            React UI、会话工作区、设置、Artifacts、i18n
apps/server         本地 HTTP API，用于 workspace/session/skill/MCP 操作
apps/orchestrator   启动 OpenCode、server、sandbox 的宿主进程
packages/types      共享 Zod schema 和类型边界
packages/ui         共享 React 视觉组件（`@onmyagent/ui/react`）
packages/handsfree  macOS Computer Use（HandsFree）；Windows CU 见桌面 Cua Driver
packages/onmyagent-ui-mcp 让 Agent 检查/控制 UI 的 MCP server
```

运行时，桌面应用可以启动本地 host stack，连接已有 OpenCode server，或接入远程 worker。UI 通过 OpenCode SDK 和 OnMyAgent 本地 API 与 Agent 后端通信。

**双运行时主辅：** OpenCode 是产品主会话与 server 真相源；Personal Local Agent 是桌面侧本机 CLI agent 的统一 harness（辅轨）。展示层可共用 conversation timeline，存储与热写路径不交叉。细则见 `docs/Architecture.md` 的 **Dual Runtime Boundary** 与 **Server Archive Runtime**。

更详细的架构说明见 `docs/Architecture.md`。

## MCP UI 控制

`packages/onmyagent-ui-mcp` 把桌面 UI 暴露为 MCP 工具，让 Agent 可以检查和执行已发布的 UI 动作：

- `ui_status` 检查桌面桥是否可达。
- `ui_snapshot` 读取当前路由、叙述状态、运行状态和可见动作。
- `ui_list_actions` 列出当前 UI 状态下可用的动作。
- `ui_execute_action` 按 ID 执行已发布的 UI 动作。

只建议在可信的本地开发会话中使用。

## 安全模型

OnMyAgent 是本地优先应用，但仍可能接触敏感面：服务商密钥、本地文件、MCP 工具、shell 命令和外部 URL。

提交改动前运行：

```bash
pnpm check:security
```

漏洞报告方式和项目安全边界见 `SECURITY.md`。

## 当前能力与路线图

### 当前主路径（办公）

- 本地工作区会话、文件产物、办公自动化、权限与审批。
- **任意模型**：官方服务商、兼容 API、本机模型；默认模型与设置页空态引导。
- Skills / MCP / Memory、软件环境与系统权限（按平台）。
- 消息渠道（飞书 / 微信等）桌面集成路径。
- 专家 / 市场：扩展位；垂类专家按就绪度迭代，**未上线前不作完整承诺**。

### 高级 / 工程能力（非默认首页）

- OpenCode 作为本地主会话底座（server + archive）；Personal 辅轨可接入 Codex / Claude Code 等 CLI。
- UI control bridge、headless / orchestrator 开发路径。

### 下一步重点

- 继续压低「文件夹 → 连模型 → 第一件办公任务成功」的路径成本。
- 办公空态、默认模型状态与失败文案持续产品化（少用引擎术语）。
- 专家货架按就绪度分级展示；垂类分批发。
- 通道 E2E、Windows 办公主路径、审批与审计体验。
- 可选的团队协作层（共享工作区、组织权限等）——不阻塞个人办公主线。

## 贡献

完整贡献指南见 `CONTRIBUTING.md`。

提交 PR 前：

1. 阅读 `AGENTS.md`、`docs/Architecture.md`；涉及 UI 变更时同时阅读根目录 `DESIGN.md`（视觉契约）。
2. 保持改动小而聚焦。
3. 如果行为发生变化，添加或更新测试。
4. 对跨模块或架构类改动，先用 Graphify 判断影响范围：

```bash
graphify query "what area does this change touch" --budget 1200
graphify affected "path/or/symbol"
```

5. 运行最相关的检查：

```bash
pnpm check:security
pnpm check:i18n
pnpm check:type
pnpm task build app
```

如果涉及桌面端或 runtime，也要运行相关 Electron 或 headless smoke test，并在 PR 描述里写明命令。

较大的代码改动后，运行 `graphify update .` 刷新 `graphify-out/graph.json`。

社区参与规则见 `CODE_OF_CONDUCT.md`。

## 国际化

应用当前维护英文、简体中文和繁体中文 locale 文件。用户可见文案应接入现有 i18n 体系，避免写死单一语言字符串。

## 许可证

OnMyAgent 使用 Apache License 2.0。详情见 `LICENSE`。
