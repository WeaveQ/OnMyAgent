# OnMyAgent

[中文](./README-zh.md) | [English](./README.md)

**一个工作台，管理好你本地所有 Agent。**

OnMyAgent 是开源桌面工作区，也是面向 agentic 工作流的本地控制平面。

它不替代 Codex、Claude Code、OpenCode 或其他 Coding Agent；
它管理它们。

OnMyAgent 把本地 Agent、MCP 工具、Skills、Memory、Automations、会话、任务、日志、Diff 和产物统一到一个桌面工作区里，让分散的 Agent 工具变成可调度、可追踪、可交付的 AI Worker 流程。

## 为什么需要 OnMyAgent？

AI Agent 越来越强，但真正的问题不是“没有 Agent”。
真正的问题是 Agent 工作流仍然很分散：

- Codex、Claude Code、OpenCode 和其他 Agent CLI 分散在不同终端里。
- MCP 工具、模型密钥、项目上下文和权限配置分散在不同文件里。
- 会话、任务、日志、Diff 和产物很难统一审查。
- Agent 能做事，但缺少一个控制台来排队、监控、审批、恢复和交付。
- 本地优先工作流需要更清晰的权限、审批和安全边界。

所以 OnMyAgent 不再做另一个 Agent。

它做的是本地 Agent 控制平面：把你已有的 Agent 管起来，把一次次运行变成可管理的 Worker 工作流。

## 它是什么

OnMyAgent 是：

- 面向开发者和 AI Power User 的开源 Worker 工作台。
- 面向 Codex、Claude Code、OpenCode 以及 OpenCode 兼容 runtime 的本地 Agent 控制平面。
- 管理任务队列、会话、日志、Diff、产物、MCP 工具、Skills、Memory 和审批的桌面工作区。
- 本地优先、BYOK、可审计、可扩展、尽量不绑定单一模型服务商的开源项目。

OnMyAgent 不是：

- 替代 Codex、Claude Code、OpenCode 或所有 Coding Agent CLI 的工具。
- n8n、Dify、Zapier 这类云端工作流自动化平台。
- 托管式企业治理产品。
- 通用聊天克隆。

## 它和其他 Agent 工具是什么关系？

| 工具 | 它做什么 | OnMyAgent 如何配合 |
|------|----------|-------------------|
| Codex | Coding Agent runtime | 作为本地 Worker 被管理 |
| Claude Code | Coding Agent CLI | 作为本地 Worker 被管理 |
| OpenCode | 开源 Coding Agent runtime | 作为核心兼容 runtime |
| MCP servers | 外部工具连接器 | 在 OnMyAgent 中统一配置、检查和控制 |
| Skills | 可复用 Agent 能力 | 在工作台中安装、组织和调用 |
| ChatGPT / LibreChat | 聊天界面 | 不同品类：OnMyAgent 是本地控制平面，不是聊天克隆 |
| n8n / Dify / Zapier | 云端工作流自动化 | 不同品类：OnMyAgent 聚焦本地优先 Agent 工作流 |

## 核心概念

- **Agent**：能理解任务并执行操作的工具，例如 Codex、Claude Code、OpenCode。
- **Worker**：带有任务上下文、权限边界、执行状态、日志和交付物的 Agent。
- **Control Plane 控制平面**：连接、调度、监控、审批和审查本地 Worker 的桌面层。
- **Session 会话**：一次可恢复、可追踪的 Agent 工作过程。
- **Artifact 产物**：Agent 工作后产生的文件、Diff、报告、截图、文档或其他交付物。

## 功能模块

- **Agent Registry**：注册和管理 Codex、Claude Code、OpenCode 等本地 Agent。
- **Worker Workspace**：排队、运行、暂停、恢复和审查 Agent 任务。
- **Session Manager**：跨项目追踪和恢复本地 Agent 会话。
- **Automations**：调度周期性本地 Agent 任务，并查看运行历史。
- **MCP Control**：统一配置 MCP server，并通过 MCP 暴露 UI 控制能力。
- **Skills & Memory**：管理可复用能力和项目上下文。
- **软件与环境设置**：管理内置运行时、API keys、本机环境变量和 macOS 权限。
- **Artifact Review**：集中审查日志、Diff、文件、截图和交付物。
- **Permission & Approval**：为高风险本地动作提供显式权限和审批界面。
- **Local-first / BYOK**：工作留在本机，模型和服务商密钥由用户自己掌控。
- **桌面端打包**：支持 macOS Electron 桌面端打包。
- **国际化**：维护英文、简体中文和繁体中文 locale 文件。

## 平台支持

- 首批公开版本只支持 macOS，同时提供 Apple Silicon 和 Intel 构建。
- Windows 支持计划放在后续版本。
- 暂不支持 Linux 包，包括 Arch Linux AUR 包。

## 工作流

```text
连接本地 Agent
        ↓
创建或导入任务
        ↓
作为 Worker 执行
        ↓
追踪会话、日志、Diff 和审批
        ↓
审查产物
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
packages/ui         共享视觉组件
packages/handsfree  本地 Computer Use runner
packages/onmyagent-ui-mcp 让 Agent 检查/控制 UI 的 MCP server
```

运行时，桌面应用可以启动本地 host stack，连接已有 OpenCode server，或接入远程 worker。UI 通过 OpenCode SDK 和 OnMyAgent 本地 API 与 Agent 后端通信。

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

### 当前已具备

- 本地 Agent registry 和 provider switching，覆盖 Codex、Claude Code、OpenCode 及兼容 runtime。
- 面向本地 Agent 工作的会话、任务、自动化、产物、日志、权限和审批界面。
- 桌面端 Skill、MCP、Provider、模型、Memory、软件环境和工作区管理。
- 面向 Personal Agent 工作流的本地消息通道，包括 Weixin 和 Feishu 桌面集成路径。
- UI control bridge，以及可用于桌面端和 headless 开发的本地 server/orchestrator runtime。

### 下一步重点

- 持续拆分低频设置页、Skill 页面和语法高亮模块，降低冷启动成本。
- 在具备凭证和 callback 权限时，补齐 Feishu 与 Weixin 的真实外部通道 E2E 验证。
- 继续拆分 desktop 主进程和 session/settings composition root。
- 完善工作详情视图、审计轨迹和更安全的审批策略预设。
- 准备团队 Worker 协作层：共享工作区、团队权限、组织审计、Skill Packs 和企业部署选项。

## 贡献

完整贡献指南见 `CONTRIBUTING.md`。

提交 PR 前：

1. 阅读 `AGENTS.md` 和 `docs/Architecture.md`。
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
