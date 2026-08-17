# Handbook sidebar ↔ product menu

Source rail: `apps/app/src/react-app/domains/session/sidebar/main-rail.tsx`.

Labels: `apps/app/src/i18n/locales/zh/nav.ts`.

## Main rail (top → bottom)

| App | Doc page | Notes |
| --- | --- | --- |
| 首页 (`assistant`) | `guide/sessions.md`（会话） | 内置办公助手任务 |
| 专家 (`chat`) | `guide/experts.md` | 岗位专家对话 |
| 自动 (`automation`) | `guide/automation.md` | 定时/触发 |
| 文件 (`files`) | `guide/files.md` | 工作区与产物 |
| 市场 (`store`) | `guide/skills.md` + `guide/mcp.md` | 专家也在市场 Tab，详文仍用 experts |
| 知识库 (`knowledgeBase`) | `guide/knowledge.md` | 本机 Markdown 笔记 |
| 企业 (`company`, gated) | platform docs | 可选；侧栏功能指南可不列 |
| 项目 (`projects`) | (add when product-stable) | 按需 |

## Account menu (bottom)

| App | Doc page |
| --- | --- |
| Agent 管理 (`nav.management`) | `guide/agent-management.md` |
| Agent 对话 (`nav.local_agent`) | `guide/agent-chat.md` |
| 设置 | `guide/settings.md` + models / memory / approvals |

## Docs-only prefix

| Doc | Role |
| --- | --- |
| `guide/overview.md` | 界面总览；始终放功能指南第一项 |

## Canonical 功能指南 order

```text
界面与工作区
会话
专家
自动化
文件与产物
知识库
技能
MCP / 连接
Agent 对话
Agent 管理
审批与权限
模型与 BYOK
记忆 / 个人
设置
```

Keep `website/docs/.vitepress/config.mjs` → `sidebarZh` in sync with this list.
