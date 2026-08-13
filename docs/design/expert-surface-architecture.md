# Expert Surface Architecture（专家会话面架构 SoT）

| Field | Value |
| --- | --- |
| Status | **Active** — durable SoT |
| Date | 2026-08-12 |
| Scope | Expert **UI lifecycle**（路由 / draft / tab / cold-open / 标题轮询）+ 与 runtime isolation 的边界 |
| Non-scope | 视觉 token（→ `DESIGN.md`）；Directory 产品不变量全文（→ `apps/app/AGENTS.md`）；删除 saga / 创建 coach 细节（→ Architecture lifecycle 表 + 既有 design） |

**关联 SoT（不要合并成一篇）：**

| 主题 | 文件 |
| --- | --- |
| Monorepo 指针 + lifecycle 硬规则 + cold budget 数字 | [`../Architecture.md`](../Architecture.md) **Session / Expert / cold-path** |
| React 域归属 / shell 冷启动 | [`../../apps/app/src/react-app/ARCHITECTURE.md`](../../apps/app/src/react-app/ARCHITECTURE.md) |
| Expert 产品行为不变量 | [`../../apps/app/AGENTS.md`](../../apps/app/AGENTS.md) |
| OpenCode agent / skills 隔离（token 膨胀） | [`expert-runtime-isolation.md`](./expert-runtime-isolation.md) |
| 硬删除 packageName / origin 匹配 | [`../Architecture.md`](../Architecture.md) **hard_delete**（`selectExpertDeleteOriginRecords`） |
| Convergence 计划 | [`2026-08-09-architecture-convergence-plan.md`](./2026-08-09-architecture-convergence-plan.md) |

改 Expert 会话面时：**先读本文硬规则与「禁止」**，再动代码；合入前跑文末测试入口。

---

## 1. 分层总览

```text
URL (workspaceId, sessionId)
        │
        ▼
useExpertPageIdentity          目录投影 / session↔agent 映射 / inventory ready
        │
        ▼
useExpertSurfaceController     reduceExpertSurface  ← 唯一 lifecycle 状态机
        │                         route + draft + pendingTabSessionId
        ▼
selectExpertSurfaceMode        纯投影 → idle_draft | creating | real_session
        │
        ├─ useExpertRouteLifecycle      cold-open / clear-route / create-task
        ├─ useExpertBoundDraftTransition  CREATE_BOUND + force-nav
        ├─ useExpertConversationTabs → AgentSessionTabs
        └─ SessionSurface + onSendDraft({ sessionStartIntent: expert })
                │
                ▼
server expert-session-runtime + desktop OpenCode sandbox
  (default_agent=onmyagent, plugin:[], HOME sandbox — 见 isolation 文档)
```

**原则：**

1. **单一 lifecycle 状态机**（`expert-surface-machine.ts`），route 与 draft **正交**。
2. **Mode 是投影**（`selectExpertSurfaceMode`），不要再平行维护 `draftOnly` / `creating` boolean。
3. **Directory identity 只信 server 投影**；renderer 不得用本地 cache / 404 启发式「修」identity。
4. **UI 状态机 ≠ 进程隔离**：tab 不炸 ≠ token 不膨胀；隔离见 `expert-runtime-isolation.md`。

---

## 2. Surface 状态机

### 2.1 State

```ts
// apps/app/src/react-app/domains/session/pages/expert-surface-machine.ts
type ExpertSurfaceState = {
  workspaceId: string;
  route: { sessionId: string; agentId: string | null } | null; // 当前 URL 真会话
  draft: ExpertSurfaceDraft | null; // 创建事务
  pendingTabSessionId: string | null; // 见 §3 命名 — 仅 Tab 高亮
};
```

### 2.2 Events（只允许这些进入 reducer）

| Event | 作用 |
| --- | --- |
| `OPEN_DRAFT` | 打开未绑定草稿；清 `pendingTabSessionId` |
| `CREATE_BOUND` | draft 绑定真实 sessionId；设 `pendingTabSessionId` |
| `REQUEST_NAVIGATION` | 标记已请求 force-nav（防重复） |
| `SYNC_ROUTE` | 与 URL 对齐；workspace 切换原子清空 draft/pending |
| `SET_PENDING_TAB` | 仅更新 Tab 高亮 id（可 null） |
| `CLEAR_DRAFT` | 清 draft；若 pending 等于 bound 一并清 |
| `CREATE_FAILED` | 清 draft + pending |
| `RESET` | 新 workspace 初始态 |

实现：`reduceExpertSurface`。穷举序列测试：`apps/app/scripts/expert-surface-machine.test.ts`。

### 2.3 Mode 投影

`selectExpertSurfaceMode(state)` →

| kind | 含义 |
| --- | --- |
| `idle_draft` | 仅草稿、无真路由 |
| `creating` | 已 bound、路由尚未落到 bound session；`mayForceNavToBound` |
| `real_session` | 主区画真会话（可能仍 `showDraftChrome` 显示侧栏草稿条） |

用户在创建过程中切到**另一个**真 tab → `shouldDropExpertSurfaceDraft` → 丢 draft，**禁止** force-nav 抢回。

测试：`expert-surface-mode.test.ts`。

---

## 3. 「Pending」三套语义（禁止合并）

| 名字 | 别名 / 含义 | 存哪 | 禁止 |
| --- | --- | --- | --- |
| **Create operation** | `PendingAgentContext.operationId` + `draft` | pending-agent store + surface.draft | 不要塞进 Tab effect |
| **Tab highlight** | `pendingTabSessionId` / `tabHighlightSessionId` | surface only | 不要用 `creatingSessionId` 推导后无法 clear |
| **Creating chrome** | `mode.creatingSessionId` | mode 投影 | 不要写回 surface.pending |
| **Composer outgoing** | 发送中气泡 | SessionSurface 本地 state | 与上三者无关 |

**血泪：** 若把 `creatingSessionId` 直接当 `pendingSessionId` 传给 `AgentSessionTabs`，`onPendingSessionIdChange(null)` 清不掉 → effect 环 → **Maximum update depth** → expert 白屏。

---

## 4. Cold-open 规则

代码：`order-conversation-groups.ts` + `use-expert-route-lifecycle.ts`。

### 4.1 决策

`resolveExpertColdOpenNavigation`：

| 条件 | action |
| --- | --- |
| `suppress === true` | **keep**（创建/草稿事务中） |
| 选中 id 仍是 expert identity | keep（含 inventory 滞后） |
| 无选中 + 有 cold 目标 | open |
| 非 expert 幽灵且 not live | clear-route |
| 非 expert 但 live（助手 id 残留） | create-task |

`normalizeExpertSessionId`：`""` / 空白 → **null**（禁止把空串当合法 session 去 snapshot）。

### 4.2 何时 suppress（`shouldSuppressExpertColdOpen`）

任一为真则 **禁止** open / clear-route / create-task：

- `draftSessionActive` 或 `draftAgentId`
- `creatingSessionId`（mode）
- `tabHighlightSessionId`（surface pending tab）
- `pendingAgent.operationId` 且 **尚未** `boundSessionId`

bound 之后若 chrome 标志已清，允许 cold-open 恢复。

测试：`expert-cold-open-navigation.test.ts`。

### 4.3 clear-route

`onOpenSession(workspaceId, "")` 表示清选中；打开路径必须 `normalizeExpertSessionId`（`use-open-expert-session.ts`）。

---

## 5. Tab 条（AgentSessionTabs）硬规则

文件：`domains/session/sidebar/agent-session-tabs.tsx`。
挂载：`use-expert-conversation-tabs.tsx`（**稳定 element**，避免每帧新 ReactElement）。

### 5.1 禁止（回归过白屏）

| 禁止 | 原因 |
| --- | --- |
| `useLayoutEffect` + `setState` 维护「总结中」集合 | 父组件 sessions 新引用 → max update depth |
| 在 `useQueries` 选项里每帧 `Date.now()` 驱动 pending 语义 | react-query 选项身份抖动 |
| effect 依赖 `onPendingSessionIdChange` / `onExpandedChange` 函数身份 | cloneElement 每帧新函数 |
| 对 **每个** tab 开 snapshot query | 打爆 OpenCode；冷启动卡死 |
| 从 `creatingSessionId` 派生 pending tab | 无法被 null clear 闭环 |

### 5.2 必须

| 必须 | 做法 |
| --- | --- |
| 「总结中」纯派生 | `shouldShowExpertTabSummarizing({ busy, trackedPending: false, pendingSelection, nowMs })`；`nowMs` 用 fingerprint 采样时钟，非每帧 `Date.now()` |
| Snapshot 目标 | **仅** selected（+ 可选 tab highlight），上限 `TAB_TITLE_SNAPSHOT_MAX`（1） |
| pending clear | ref 记已清理 id；callback 走 ref |
| expanded 通知父级 | callback 走 ref；仅 boolean 变化时通知 |
| inventory 未 ready 且无 session | **skeleton strip**，不要 `return null` 再被 cold-open 猛跳 |
| `SessionSurfaceView` 的 conversationTabs | effect 依赖 **hasTabs 布尔**，不依赖 element 引用 |

标题策略：人类标题优先；生成的 `New session - …` 需 fallback；message preview 赢过「总结中」chip。测试：`agent-session-tab-title.test.ts`。

---

## 6. Draft → 真会话绑定

`use-expert-bound-draft-transition.ts` + `expert-draft-session.ts`：

1. 用户开草稿 → `OPEN_DRAFT` + `PendingAgentContext.operationId`
2. 首发 / create session → 得到真 `sessionId`
3. `CREATE_BOUND` → `pendingTabSessionId = sessionId`
4. `mayForceNavToBound` → `onOpenSession` 到 bound（一次）
5. `SYNC_ROUTE` 落到 bound → 清 pending tab
6. 用户中途切走真 tab → drop draft（不抢回）

事务匹配：`matchesExpertDraftTransaction`（operationId）；忽略过期 CREATE。

---

## 7. 与 Runtime Isolation 的边界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| 本文 / surface | 路由、草稿、tab、cold-open、UI 稳定性 | OpenCode HOME、插件列表 |
| `expert-runtime-isolation.md` | session 目录 materialize、`agent=onmyagent`、sandbox HOME、`plugin:[]` | React 状态机 |

Dev models 目录：默认 `https://models.onmyagentlabs.com/`；仅 `ONMYAGENT_MODELS_LOCAL=1` 时用 `localhost:8791`（避免 /provider 挂死）。见 `apps/server/src/embedded.ts`。

---

## 8. 代码地图（改前先定位）

| 区域 | 路径 |
| --- | --- |
| Page 编排 | `pages/use-expert-page.tsx` |
| Surface FSM | `pages/expert-surface-machine.ts` |
| Mode | `pages/expert-surface-mode.ts` |
| Controller | `pages/use-expert-surface-controller.ts` |
| Cold-open | `pages/order-conversation-groups.ts`, `use-expert-route-lifecycle.ts` |
| Open / normalize | `pages/use-open-expert-session.ts` |
| Bound draft | `pages/use-expert-bound-draft-transition.ts`, `expert-draft-session.ts` |
| Tabs 挂载 | `pages/use-expert-conversation-tabs.tsx` |
| Tabs UI | `sidebar/agent-session-tabs.tsx` |
| Surface clone tabs | `surface/session-surface-view.tsx` |
| Identity | `pages/use-expert-page-identity.ts`, `expert-conversation-model.ts` |
| Server runtime | `apps/server/src/services/expert-session-runtime.ts`, `expert-runtime-contract.ts` |
| Desktop sandbox | `apps/desktop/electron/opencode-sandbox-home.mjs`, `runtime.mjs` `buildChildEnv` |

---

## 9. 改动检查清单（PR 自检）

- [ ] 是否动到 surface **事件形状**？→ 更新 `expert-surface-machine.test.ts` 穷举假设
- [ ] 是否新增「pending」字段？→ 先写清属于 §3 哪一类，禁止混用
- [ ] 是否在 AgentSessionTabs 加 `useLayoutEffect` + setState？→ **默认禁止**
- [ ] 是否对全量 tab 开 query / 紧轮询？→ 违反 cold-path budget
- [ ] 是否在 create/draft 期间调用 cold-open open/clear/create-task？→ 必须 suppress
- [ ] 是否把 `""` 当 sessionId 去 snapshot？→ 用 `normalizeExpertSessionId`
- [ ] 是否只改 UI 却假设 token 会下降？→ 还要看 isolation 文档
- [ ] 相关测试是否绿：见 §10

---

## 10. 测试入口（改 Expert 会话面必跑）

```bash
cd apps/app && bun test \
  scripts/expert-surface-machine.test.ts \
  scripts/expert-surface-mode.test.ts \
  scripts/expert-cold-open-navigation.test.ts \
  scripts/agent-session-tab-title.test.ts \
  scripts/expert-session-invariants.test.ts
```

Runtime / isolation：

```bash
cd apps/server && # 见 package 脚本
  # expert-session-runtime / expert-runtime-contract 相关 tests
```

Desktop sandbox：`apps/desktop/electron/opencode-sandbox-home.test.mjs`。

---

## 11. 已知债（有意延后）

| 债 | 说明 |
| --- | --- |
| `useExpertPage` 上帝钩子 | 20+ hooks；拆分需独立 PR，勿与行为修复捆在一起 |
| `AgentSessionTabs` 仍偏大 | 展示 / snapshot / pin 可再拆，但先守住 §5 禁止项 |
| OpenCode 仍可能扫真实 `~/.opencode`（passwd home） | isolation path B 继续堵；勿在 UI 层「假装解决」 |
| 多 effect 竞态（cold + bound + clear draft） | suppress + 事务匹配已降险；全串行化属后续 |

---

## 12. 变更记录

| Date | Note |
| --- | --- |
| 2026-08-10 | 首版：固定 surface FSM、pending 三语义、cold-open suppress、tab 硬规则；对齐当次 max-update-depth / 加载服务商 / isolation 工作 |
