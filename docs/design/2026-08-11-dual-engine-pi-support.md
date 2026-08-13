# 双引擎支持计划：OpenCode + Pi

| Field | Value |
| --- | --- |
| Status | **In progress** — spike on `feat/dual-engine-pi`. P0 Personal Pi and a server `pi --mode rpc` pool exist. P1.5 UI decoupling, Pi office loop (events/abort/get), and an experimental flag are **not** done. Missing engine choice defaults to OpenCode; only an explicit persisted `pi` yields Pi. |
| Date | 2026-08-11 |
| Owner | Engineering (desktop + server + app) |
| Related | [`docs/Architecture.md`](../Architecture.md)、[`docs/design/2026-08-09-architecture-convergence-plan.md`](./2026-08-09-architecture-convergence-plan.md)、[`docs/design/2026-08-02-config-consistency.md`](./2026-08-02-config-consistency.md) |
| Hard entry | 不得违反根 [`AGENTS.md`](../../AGENTS.md) 的 Phase-2 硬约束与 **Dual Runtime Boundary** |

---

## 0. 目标与边界

### 0.1 目标

让 OnMyAgent 底层 Agent 运行时同时支持 **OpenCode（现状默认）** 和 **Pi**，做到：

1. **辅轨（Personal Agent Runtime）**：Pi 升为第 6 个内置 provider，开箱即用（低风险快速赢，**独立可发**）。
2. **主轨（server / office 会话）**：引擎抽象 + **per-workspace 引擎选择**（`workspace.agentEngine ?? config.agentEngine ?? "opencode"`）；不同 workspace 可并存不同引擎；能力差异通过 `getCapabilities()` + UI 降级，**不承诺功能对等**。
3. OpenCode 保持全局默认；Pi 为 **experimental 二级引擎**（默认关），不破坏现有路由与办公主路径承诺。

### 0.2 两条「Pi」不得混谈

| 轨 | 协议 | 宿主 | 会话存储 | 产品入口 |
| --- | --- | --- | --- | --- |
| **辅轨 P0** | `pi-acp`（标准 ACP；本机无 pi-acp 时可探测原生 `pi`，但 handshake 可能 offline） | Electron `personal-agent-runtime` | Personal conversation store；与用户 `~/.pi` 无关（辅轨不接管主轨 office 会话） | Local Agents / 本地 Agent 列表 |
| **主轨 P2+** | 原生 `pi --mode rpc`（**非** JSON-RPC；命令字段为 `type`） | `apps/server` 进程池 | **仅** `~/.onmyagent/profiles/<profile>/pi-sessions/<workspace-hash>/`（`--session-dir` 注入，**禁止**默认写 `~/.pi/agent/sessions`） | Workspace 引擎设置（experimental） |

文案硬约束：UI 中辅轨称 **「Pi CLI（Local Agent）」**；主轨称 **「Pi 引擎（实验）」**。二者协议、存储、能力承诺均不同。

> **Dual Runtime Boundary**：主轨 Pi 是 **OpenCode 主轨的可替换引擎**，不是 Personal 的升级版。Personal 仍是辅轨；禁止把 Personal conversation store 与主轨 session/archive 交叉热写（见 Architecture **Dual Runtime Boundary**）。

### 0.3 评审阻塞项（未关闭前禁止开 P1 大拆）

| ID | 问题 | 建议默认（可改） | 关闭条件 |
| --- | --- | --- | --- |
| **B1 同 workspace 并发** | Pi 单进程同时仅 1 个活跃 session；与多会话并行、automation 同 workspace 冲突 | **A**：P2 起 **按 session 多进程**（同 cwd，独立进程 + 独立 session 文件）；或 **B**：Pi workspace **禁用 automation + 禁止第二路并发 run**（产品需明示） | 产品在 A/B 中选一并写入 §5.1 |
| **B2 引擎切换与会话列表** | opencode ↔ pi 切换后旧会话如何展示 | 会话 **按引擎分桶**；切换引擎只列出该引擎会话；旧引擎会话只读可恢复（切回引擎）或进归档；**禁止**静默混排无标记 | schema + list API 契约评审通过 |
| **B3 无审批安全边界** | Pi **技术上可达前置拦截**（源码验证：`pi --extension` 注入 → 扩展 `tool_call` handler 返回 `{block:true}` → agent-loop `beforeResult?.block` 阻止执行；审批 UI 走 `extension_ui_request/response` 子协议），但成本高（维护扩展 + 异步审批状态机），首版不承诺 | 本轮 **`approvals: "none"`**（capabilities 记 `bridge-possible`，升级路径保留）+ experimental 默认关；**company profile 禁止 pi**；UI 常驻 banner；敏感路径 workspace 建议强制 opencode | 安全文案 + 配置门禁落地设计；后续若升级审批，按 `bridge` 路径实现（无需推翻本计划） |
| **B4 Pi 二进制交付** | OpenCode 是 bundled sidecar；Pi 若只靠 PATH 则版本/Win 不可控 | 主轨：**version gate + 本机安装**（开发者预览）；后续再评估 bundled。辅轨可 PATH | 版本探测 + 最低版本写进 manifest 方案 |
| **B5 UI 解耦范围** | UI 深绑 `@opencode-ai/sdk`（`createOpencodeClient`、Message/Part/Todo、permission.reply） | 主轨 Pi **对用户可见**前必须完成 **P1.5 UI client 抽象**（见 §4.5）；否则 P2 仅 API/toy-ui 验收，不算产品闭环 | 明确 P1.5 是否进本轮 |

### 0.4 非目标

- 不做公网多租户；不做 Linux 桌面产品目标。
- 不把主轨押注在统一 ACP 上（见 D3）。
- 本轮不做 todo / MCP / 审批 的完整平移。
- 本轮不承诺 Pi 与 OpenCode 功能对等；experimental 不进入默认办公主路径。

### 0.5 硬约束（实现期违反即错）

1. **未登录完整可用**；无 company session 时禁止打企业 API（Phase-2）。
2. `local` / `company` 配置 schema 同构；**`agentEngine: pi` 在 company profile 默认拒绝或强制降级为 opencode**（B3）。
3. Provider secrets **不得回传 desktop**；Pi 进程 env 注入只在 server/sidecar 侧完成。
4. 主轨 Pi 会话目录必须用 `--session-dir` 托管路径，**不得**与用户手动 `~/.pi` 会话混列表。
5. OpenCode 与 Personal 存储/热写路径不交叉；主轨 Pi 归档走 server archive 路径（可复用 `agent=pi` 解析器）。
6. experimental flag **默认关闭**；开启路径需显式 UI 确认（含无审批提示）。

---

## 1. 现状盘点

### 1.1 主轨对 OpenCode 的耦合（server + UI）

| # | 路径 | 位置 | 规模 / 说明 |
| --- | --- | --- | --- |
| ① | SDK 类型化客户端 | server：`@opencode-ai/sdk`；`workspace-sessions` / `automation-runner` / `server` / `toy-ui` | server **56** 文件引用 opencode |
| ② | HTTP 全路径代理 | `opencode-proxy.ts`：`/opencode/*` → opencode server | **338** 行；UI 大量直连 session/skills/permission/mcp |
| ③ | 离线归档 | `session-archive-sqlite-opencode.ts` | **263** 行 |
| ④ | **UI SDK 形状** | `apps/app`：`createOpencodeClient`、`app/lib/opencode.ts`、session-route、permission-question-hook、global-sdk-provider、settings、expert preview | **核心路径深绑** OpenCode Message/Part/Session/Todo 与 permission API |

Server 专用 service（7 个）：`opencode-client-pool / connection / db / engine-reload / proxy / workspace-client / session-archive-sqlite-opencode`。

> **结论**：只抽象 server 不够。没有 **UI 侧引擎无关 client（P1.5）**，`agentEngine: pi` 无法进入桌面办公主界面。

### 1.2 主轨实际调用的 OpenCode 能力（枚举）

```
session.list / get / messages / todo / status / delete
session.create({title, directory, agentId})
session.command / promptAsync / abort
mcp.disconnect / mcp.auth.remove
HTTP: /permission/:id/reply、/session/:id/command、x-opencode-directory header
providers / models（config providers、默认模型）
skills 物化与列表（.opencode / managed skills 路径）
```

### 1.3 Pi 侧对接面（主轨 RPC）

- **RPC 模式**：`pi --mode rpc`，JSONL over stdio。
  - **不是标准 JSON-RPC**：命令用 **`type`** 字段（不是 `method`），**没有** `initialize` 握手；进程启动即绑定当前会话。
  - 命令样例：`{"id":1,"type":"prompt","message":"hello"}`、`{"id":2,"type":"new_session"}`、`{"id":3,"type":"switch_session","sessionPath":"/abs/path/to/session.jsonl"}`、`{"id":4,"type":"abort"}`。
  - 可用命令（`type` 值，0.84.1 `dist/modes/rpc/rpc-mode.js`）：`prompt / steer / follow_up / abort / new_session / switch_session / fork / clone / get_messages / get_entries / get_tree / get_state / get_session_stats / set_model / cycle_model / get_available_models / set_thinking_level / compact / set_session_name / bash / abort_bash / export_html / get_commands / get_fork_messages / get_last_assistant_text`。
  - 响应：`{"id", "type":"response", "success", ...}`；错误含 `error` / `command`。
  - 事件：进程主动推送 `agent_*`、`message_*`、`tool_execution_*` 等。
  - ⚠️ P2 前必须用真实 spawn 探针固化协议（首条命令发 `initialize` 会得到 `Unknown command: undefined`）。
- **ACP 桥（仅辅轨）**：`pi-acp`；handshake 为 ACP 的 `initialize` → `session/new`（**与主轨 RPC 无关**，勿混用）。
- **会话存储**：用户默认 `~/.pi/agent/sessions/<dir-encoded>/**/*.jsonl`；主轨必须 `--session-dir` 重定向到 OnMyAgent 管理目录。
- **版本**：以 0.84.1 为协议基线；B4 version gate。

### 1.4 能力对照（主轨需求 vs Pi RPC）

| 主轨需求 | OpenCode | Pi RPC | 结论 |
| --- | --- | --- | --- |
| 发送/中止/消息/状态/用量 | ✅ | ✅ | 无缺口 |
| 异步 prompt（automation） | ✅ | ✅ | 协议层无缺口；**并发模型**见 B1 |
| 会话创建 | `session.create({title,directory,agentId})` | `new_session`（仅 `{parentSession?}`）+ 启动 `--name` / `--session-dir`；title 可后置 `set_session_name` | ⚠️ RPC 内无 directory/agentId；cwd 在进程启动时固定 |
| 会话列表/删除 | `session.list/delete` | ❌ 无 API | 🔴 扫 `--session-dir`；delete 前若为活跃会话须先 abort/switch |
| 多会话并发 | 1 server · N session | 1 进程 · 1 cwd · **同时 1 活跃 session**（可 switch rebind） | 🔴 见 B1；默认建议多进程/session |
| todo | ✅ | ❌ | 🔴 降级隐藏（D2） |
| 审批 | native `/permission/.../reply` | 技术可达 `bridge`：进程内扩展 `tool_call` handler 可 `{block:true}`（agent-loop.js:419）+ `extension_ui_request/response` 审批子协议；但 `tool_execution_*` 对 RPC 客户端仍为**通知型**（进程外不可控制） | 🔴 首版降级 `none`（见 D1 / B3；`bridge-possible`） |
| MCP | ✅ | ❌ | 🔴 降级隐藏 |
| Skills | 物化 + 运行时管理 | 仅 `--skill`/扩展加载；无运行时 list/管理 | 🔴 管理 UI 隐藏；**是否注入 OnMyAgent skills** 见 §5.3 |
| 模型/Provider | OpenCode providers/OAuth/兼容 API | env / settings / `--provider` `--model` / RPC `set_model` | 🔴 映射层必做，见 §5.3 |
| 目录隔离 | `x-opencode-directory` | 启动 `cwd` + `--session-dir` | 🟡 跨 workspace 不能同进程 |
| 会话归档 | SQLite | JSONL | 🟡 **薄封装复用**已有 `parsePiLikeFile` + registry `entry("pi")`，非从零新写 |
| 消息/事件模型 | OpenCode SDK 形状 | `AgentMessage` + 自有事件名 | 🟡 统一 `EngineEvent` + UI timeline 映射（§4.1） |

### 1.5 辅轨现状

- 内置 5 provider：opencode / codex / claude / openclaw / hermes（`provider-registry.mjs`）。
- ACP 客户端通用；Pi 已在 discoverable 目录（`detect-local-agents.mjs`）：`commands: ["pi-acp","pi"]`，`resolveDiscoverableAcpArgs` / `preferPiAcpAgent` 已存在。
- 辅轨探测 handshake 是 **ACP** 路径（`initialize` → `session/new`），与主轨 RPC 无关。

### 1.6 Managed OpenCode 生命周期（缺口）

Desktop `engineStart` 默认 `manageOpencode: true`，会拉起 OpenCode sidecar。当前方案若只加 Pi 进程池、**不**改生命周期，则：

- 即使用户默认/全 workspace 用 pi，仍付 OpenCode 启动成本；
- 混合模式（A=opencode，B=pi）必须同时活着 OpenCode + 若干 pi 进程。

**要求（P1/P2）**：

| 场景 | 行为 |
| --- | --- |
| 全局默认 opencode，且存在任一 opencode workspace / 或未全部切 pi | 保持现有 manage OpenCode |
| 所有 active workspace 均为 pi，且无 opencode 依赖功能 | **允许不 spawn OpenCode**（或延迟到首次需要） |
| 混合 | OpenCode 按需 + Pi 按 workspace/session 池 |
| `reloadOpencodeEngine` / 配置指纹 | **仅 opencode workspace** 触发；pi workspace no-op |

---

## 2. 阶段总览

| 阶段 | 内容 | 工作量 | 交付物 | 依赖 |
| --- | --- | --- | --- | --- |
| **P0** | 辅轨 Pi 内置 provider | 0.5–1 天 | Local Agents 列表出现 Pi | 无 |
| **P0.5** | 关闭 B1–B5 + 真实模式 benchmark + RPC 探针 | 1–2 天 | 决策记录 + 数据附录 | 评审 |
| **P1** | Server 引擎抽象 + 配置 + OpenCode 零回归 | 5–7 天 | `AgentEngine`、`getEngine(config, workspace)`、opencode 实现迁入 `engines/opencode/` | P0.5 |
| **P1.5** | **UI 引擎无关 client + `/agent/*` 主路径** | 5–8 天 | 桌面会话表面可切引擎而不 import OpenCode SDK 细节 | P1 |
| **P2** | PiEngine（RPC、进程池、事件桥、模型映射最小集） | 6–8 天 | `agentEngine: pi` 产品最小闭环（含 UI） | P1.5、B1/B4 |
| **P3** | 能力降级、安全文案、归档打磨、automation 策略 | 4–6 天 | capabilities UI、banner、列表分桶 | P2、B2/B3 |
| **P4** | 回归矩阵、文档、experimental 发布 | 4–6 天 | 测试矩阵 + Architecture/AGENTS 更新 | P3 |

合计（含 P1.5）：约 **26–38 人天（5–8 周）**。  
**不含 P1.5 的「仅 API 闭环」**约 18–26 人天，但**不算**用户可感知的主轨交付。

> 旧版「P1+P2 ≈ 2 周出主轨」低估了 UI SDK 解耦与并发/安全决策；以本表为准。

---

## 3. P0 —— 辅轨 Pi 内置 provider（0.5–1 天）

### 3.1 改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/electron/personal-agent-runtime/provider-registry.mjs` | `PERSONAL_LOCAL_AGENT_PROVIDERS` / `CAPABILITIES` 加 `pi`（优先 pi-acp，`supportsAcp: true`）；`defaultPersonalLocalAgents()` 加条目；**`personalLocalAgentConnectionMode()`** 加 `Pi ACP session` 分支 |
| `apps/desktop/electron/personal-agent-runtime/agent-metadata.mjs` | metadata 对齐其他内置 |
| `apps/desktop/electron/personal-agent-runtime/detect-local-agents.mjs` | 内置 + PATH 双模式；保留 `preferPiAcpAgent` / `resolveDiscoverableAcpArgs` |
| 测试 | 仿 `custom-agent-acp.test.mjs`；pi-acp handshake 实测 |

### 3.2 验收

- [ ] Pi 卡始终在本地 agent 列表；未安装时可见 + 安装引导（核对 `installed` 状态语义：`online|offline|needs_auth`）
- [ ] pi-acp 在线 → `online`；失败不拖垮其他 provider
- [ ] 真实辅轨会话：prompt → 流式 → 可恢复
- [ ] 文案不暗示「已切换主轨 office 引擎」

---

## 4. P1 —— Server 引擎抽象层（5–7 天）

### 4.1 接口草案

```ts
// apps/server/src/engines/types.ts（新）

export type EngineId = "opencode" | "pi";

export interface AgentEngineCapabilities {
  todo: boolean;
  mcp: boolean;
  skills: boolean; // 运行时 list/管理；pi 首版 false
  skillsLoad: boolean; // 是否能在 spawn 时注入 OnMyAgent skills（pi 可为 true）
  approvals: "native" | "bridge" | "none";
  archive: "sqlite" | "jsonl";
  /** opencode: 单 server 多会话；pi: 见 B1 决议 */
  multiSession: "server-multi" | "process-per-session" | "process-per-workspace-serial";
  sessionList: { search: boolean; pagination: boolean; multiRoot: boolean };
  models: "engine-native" | "mapped-from-host" | "env-only";
}

/** 统一事件 → server SSE → UI timeline（字段在 P1 定稿，P1.5 消费） */
export type EngineEvent =
  | { type: "session_status"; sessionId: string; status: "idle" | "busy" | "error"; message?: string }
  | { type: "message_delta"; sessionId: string; role: "assistant" | "user" | "tool"; text?: string; parts?: unknown[] }
  | { type: "tool_start" | "tool_update" | "tool_end"; sessionId: string; toolCallId: string; toolName: string; args?: unknown; result?: unknown; isError?: boolean }
  | { type: "usage"; sessionId: string; inputTokens?: number; outputTokens?: number }
  | { type: "permission_request"; sessionId: string; requestId: string; permission: unknown } // pi 首版不发
  | { type: "error"; sessionId?: string; code: string; message: string };

export interface AgentEngine {
  readonly id: EngineId;
  getCapabilities(): AgentEngineCapabilities;

  start?(workspace: WorkspaceInfo): Promise<void>;
  stop?(workspace: WorkspaceInfo): Promise<void>;
  reload?(workspace: WorkspaceInfo): Promise<void>; // opencode only 有意义

  createSession(input: {
    title?: string;
    directory?: string;
    agentId?: string;
    model?: { providerID: string; modelID: string };
  }): Promise<SessionRef>;

  listSessions(opts?: {
    directories?: string[];
    start?: number;
    limit?: number;
    search?: string;
  }): Promise<SessionSummary[]>;

  getSession(id: string): Promise<SessionDetail>;
  deleteSession(id: string): Promise<void>; // pi: 活跃会话须先 abort/switch 再删文件

  sendMessage(sessionId: string, input: {
    prompt: string;
    tools?: string[];
    model?: { providerID: string; modelID: string };
  }): Promise<void>;
  abort(sessionId: string): Promise<void>;
  getMessages(sessionId: string): Promise<AgentMessage[]>;

  listModels?(): Promise<ModelInfo[]>;
  listMcpServers?(sessionId: string): Promise<McpServerInfo[]>;
  disconnectMcp?(sessionId: string, server: string): Promise<void>;
  listSkills?(sessionId: string): Promise<SkillInfo[]>;

  onEvent(cb: (event: EngineEvent) => void): Unsubscribe;
  approvePermission(sessionId: string, requestId: string, allow: boolean): Promise<void>;
  // pi: capabilities.approvals==="none" 时实现为 no-op 或 throw unsupported（路由层不调用）
}
```

实现约束：

- `getEngine(config, workspace)` → `workspace.agentEngine ?? config.agentEngine ?? "opencode"`。
- Pi：`directory`/`agentId` 忽略或仅用于隔离 cwd 选择；`title` → `--name` 或 `set_session_name`。
- Session id：**引擎前缀分桶**（如 `opencode:…` / `pi:…` 或 metadata.engine），满足 B2。

### 4.2 收口动作

| 现状 | 去向 |
| --- | --- |
| `opencode-client-pool` / `connection` / `workspace-client` / `db` / `engine-reload` | `engines/opencode/*` 内部 |
| `opencode-proxy.ts` | 保留 `/opencode/*` **仅当 workspace 引擎为 opencode**（或兼容期双挂）；新增 `/agent/*` 与 `/w/:id/agent/*` 由 `getEngine(config, workspace)` 供给 |
| `session-archive-sqlite-opencode.ts` | opencode 归档实现；pi 走薄封装 `engines/pi/pi-session-archive.ts` → **调用**现有 `parsePiLikeFile` |
| `workspace-sessions.ts` / `automation-runner.ts` | **只**依赖 `getEngine(config, workspace)` |
| Desktop `manageOpencode` | 按 §1.6 场景表，与引擎解析联动 |

### 4.3 配置

```jsonc
// ~/.onmyagent/profiles/local/config/server.jsonc
{ "agentEngine": "opencode" }  // "pi" = experimental

// packages/types WorkspaceInfo / ServerConfig
// agentEngine?: "opencode" | "pi"
```

解析：`getEngine(config, workspace)`。  
schema 同构约束见 config-consistency；company 侧对 `pi` 的拒绝策略见 B3。

**混合模式**：不同 workspace 不同引擎。Automation：默认跟随 workspace 引擎；若 B1 选「Pi 禁用 automation」，则 pi workspace 的 automation 创建/执行应失败并提示切 opencode。

### 4.4 P1 验收

- [ ] `agentEngine: opencode` 下 unit/api/runtime **零回归**
- [ ] `getEngine(config, workspace)` 对 pi 返回 PiEngine 占位（可未实现完整 RPC）
- [ ] 业务 service 无直接 opencode SDK import（除 `engines/opencode/`）
- [ ] manage OpenCode 行为符合 §1.6 测试用例

### 4.5 P1.5 —— UI 引擎无关层（5–8 天，**主轨产品闭环前置**）

**问题**：UI 通过 `createOpencodeClient` 直连 OpenCode 形状 API；permission、message parts、event stream 均 SDK 化。

**方向**（二选一，推荐 A）：

| 方案 | 做法 | 利弊 |
| --- | --- | --- |
| **A（推荐）** | 新增 `createAgentSessionClient(workspaceId)`：HTTP 只打 `/w/:id/agent/*` + SSE；类型用 `@onmyagent/types` 的引擎无关 DTO | 一次解耦，长期可加第三引擎 |
| **B** | Pi 时 server 模拟 OpenCode HTTP 子集 | 快但脆弱，协议适配成本转移到伪装层 |

验收：

- [ ] session-route 主路径在 pi workspace 不依赖 `permission.reply` 成功路径（approvals none 时不展示 permission 队列风暴）
- [ ] 流式文本 + tool card 可渲染（基于 `EngineEvent` 映射）
- [ ] opencode workspace 行为与现网一致（无视觉/功能回归）

---

## 5. P2 —— PiEngine 实现（6–8 天）

### 5.1 进程模型（随 B1 二选一）

**默认建议（B1-A）：按 session 多进程**

```
PiEngine
 ├─ processPool: Map<sessionId, ChildProcess>
 │    spawn(pi, ["--mode","rpc","--session-dir", managedDir, "--name", title?, ...modelFlags],
 │          { cwd: workspaceRoot 或 expert 隔离目录, env })
 │    每会话独立进程 → 真并发；代价：内存 × N
 ├─ sessionId ⇄ session.jsonl（managedDir 索引）
 └─ idle 超时 SIGTERM；server 退出杀全部；并发上限可配（建议默认 4–8，数据校准）
```

**备选（B1-B）：按 workspace 单进程串行**

```
processPool: Map<workspaceRoot, ChildProcess>
进程内 switch_session / new_session；同 workspace 同时仅 1 个 busy
automation 与第二会话必须排队或拒绝
```

无论 A/B：

- **托管目录**：`~/.onmyagent/profiles/<profile>/pi-sessions/<workspace-hash>/`（可再分子目录 per session）。
- **恢复**：`{"type":"switch_session","sessionPath":"<abs>.jsonl"}`（A 模型下通常是「起新进程 + 打开该文件」）。
- **删除**：若 session 在跑 → abort → 停进程 → 删文件。
- **列表**：扫 managedDir；search/pagination 能力写入 `sessionList`；不足则 UI 隐藏。
- **归档**：`engines/pi/pi-session-archive.ts` **复用** `session-archive-parser.parsePiLikeFile` + registry `pi`，只改 root 指向 managedDir。

### 5.2 模型 / Provider / Skills（最小可用）

| 主题 | P2 最小行为 |
| --- | --- |
| 默认模型 | 读 workspace/host 默认模型 → 映射为 pi `--provider` / `--model` 或 RPC `set_model` |
| 列表 | `get_available_models` 或 host 侧已配置模型列表映射；OAuth/复杂 custom endpoint **可降级**（capabilities.models 标明） |
| Secrets | server 侧 env 注入；**不**写用户 `~/.pi/agent/settings.json` 污染全局 |
| Skills | spawn 时 `--skill` 注入 OnMyAgent 已物化 skill 路径（若可行）；`skills`（管理 API）仍为 false；若无法注入则 `skillsLoad: false` 并在 UI 说明「Pi 引擎不加载工作区技能」 |
| Expert 隔离目录 | 每 expert cwd 独立；冷启动预算 **重测**（不可沿用 OpenCode 60s/skill index 假设） |

### 5.3 事件桥

Pi JSONL 事件 → `EngineEvent` → 现有 workspace SSE。  
P2 验收以 **客观事件表** 为准（至少覆盖：assistant 文本增量、tool_start/end、idle/busy、error）。

### 5.4 P2 验收

- [ ] `agentEngine: pi`：**UI 主路径** 新建会话 → 发消息 → 流式文本/工具 → 会话可恢复 → 归档可见
- [ ] `approvals: none`：不出现 permission 错误风暴；有明确 banner
- [ ] B1 策略单测：并发/automation 行为符合决议
- [ ] abort + idle 回收无僵尸进程
- [ ] 不写入 `~/.pi/agent/sessions`（或测试断言 managedDir only）
- [ ] automation：若允许 pi，跑通 1 个定时任务；若禁止，错误信息可理解

---

## 6. P3 —— 能力对齐、安全与打磨（4–6 天）

### 6.1 能力矩阵与 UI

| 能力 | OpenCode | Pi | 动作 |
| --- | --- | --- | --- |
| todo | ✅ | ❌ | 隐藏进度；D2 后置提取 |
| 审批 | native | none | banner + 设置页说明；company 禁 pi |
| MCP | ✅ | ❌ | 隐藏管理 UI |
| Skills 管理 | ✅ | ❌ | 隐藏；加载能力见 `skillsLoad` |
| 归档 | SQLite | JSONL thin adapter | 复用 parser |
| 会话列表 | 全功能 | 视 `sessionList` | 隐藏不支持的搜索/分页 |
| 并发 | server-multi | 见 B1 | UI 可提示「实验引擎并发限制」 |
| `/opencode/*` | 兼容 | 不走 | 主路径 `/agent/*` |

```ts
// apps/app: useEngineCapabilities(workspaceId)
// GET /w/:id/agent/capabilities
```

### 6.2 决策点

- **D1 审批（建议确认）**：首版选 **无审批（本地信任）**，理由不是"技术不可行"而是**首版不投入扩展注入成本**（`tool_call` block + `extension_ui_request` 子协议已源码验证可达）；后续升级走 `bridge` 路径（注入 `--extension` 审批扩展），可选 `--exclude-tools` 收敛作为低成本中间态。
- **D2 todo**：建议首版 **直接隐藏**（0 天）。
- **D3 ACP**：本轮主轨 **不依赖** ACP；辅轨继续 pi-acp。
- **D4 二进制（B4）**：首版 PATH + version gate；版本不符 → 引擎不可选 + 安装说明。
- **D5 引擎切换（B2）**：分桶列表 + 切换需 idle（无 running run）。

### 6.3 安全门禁（发布前）

- [ ] experimental 默认关
- [ ] 开启 pi 时二次确认（无执行前审批）
- [ ] company profile 拒绝或强制 opencode
- [ ] CHANGELOG / SECURITY 边界说明

---

## 7. P4 —— 回归、文档、发布（4–6 天）

- [ ] 矩阵：macOS / Windows × {opencode, pi} × {会话, 文件, 归档, automation 策略, 引擎切换}
- [ ] 性能：真实模式（skills + `--session-dir`，**非** `--no-session`）冷启动、内存、N 会话并发；给出默认并发上限与 idle TTL
- [ ] Windows：`pi` / `pi.cmd` spawn、PATH、编码
- [ ] 文档：`Architecture.md` 引擎层；`AGENTS.md` 硬约束指针；本文件链入 `docs/README.md`
- [ ] 发布：flag 默认关；不写「完全替代 OpenCode」类承诺

---

## 8. 风险登记

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| UI 仍绑 OpenCode SDK → 主轨 Pi 不可用 | **高** | 强制 P1.5；无 P1.5 不宣称产品闭环 |
| 同 workspace 并发 / automation 冲突 | **高** | B1 先决；多进程或禁用并行 |
| 无审批撕开本地安全承诺 | **高** | B3：默认关、banner、company 禁、文档明示 |
| 进程数 × 内存线性涨 | 高 | 并发上限 + idle 回收 + 真实模式 benchmark |
| 模型/Provider 映射不全 | 中 | P2 最小映射；复杂 OAuth 降级 |
| Skills 不注入 → 办公技能空 | 中 | `skillsLoad` 诚实暴露；能注入则 `--skill` |
| 双轨都叫 Pi → 用户困惑 | 中 | 文案分离（§0.2） |
| 协议/版本漂移 | 中 | version gate + RPC 探针金测 |
| 双引擎维护成本 | 中 | 接口最小化；不承诺对等 |
| pi-acp 辅轨能力有限 | 低 | 辅轨本就不承诺 todo/MCP/审批 |

---

## 9. 里程碑

| 里程碑 | 时间（含 P1.5） | 门禁 |
| --- | --- | --- |
| M0 辅轨 Pi | ~1 天 | P0 全绿 |
| M0.5 决策与数据 | ~2 天 | B1–B5 关闭 + benchmark 附录 |
| M1 Server 抽象 | ~1.5 周 | P1 opencode 零回归 |
| M1.5 UI 可切换 | ~2.5–3 周 | P1.5 主路径不绑 SDK 细节 |
| M2 Pi 产品最小闭环 | ~4–5 周 | P2 UI 闭环验收 |
| M3 打磨发布 | ~5–8 周 | P3/P4；flag 默认关 |

---

## 10. 本周可执行

1. **P0**：辅轨内置 Pi（独立 PR，可先发）。
2. **评审会**：只关 B1–B5（并发、列表分桶、安全、二进制、是否做 P1.5）。
3. **RPC 探针 + 真实模式 benchmark**（冷启动、内存、双会话并发、switch 延迟）→ 附录写入本文件或 `.loop/` 备注（勿当 0.6s `--no-session` 为容量依据）。
4. **不要**在 B1/B5 未关时开始 56 文件大搬家。

---

## 11. 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-08-11 | 初稿：双引擎阶段划分 |
| 2026-08-11 | 校准 Pi RPC（`type` 非 method）、审批可达 `bridge`（`tool_call` block 源码验证）、cwd/进程模型 |
| 2026-08-11 | 三审修正：B3/§1.4/D1 改为「审批技术可达 bridge，首版降级 none（成本理由非能力理由）」 |
| 2026-08-11 | 二轮评审入库：P1.5 UI 解耦、B1–B5 阻塞项、双轨 Pi 分离、managed OpenCode 生命周期、模型/skills、归档复用、工期上修、安全门禁 |
| 2026-08-13 | 纠正 Status：P0–P4 未完成；缺省引擎改回 OpenCode；`agentEngine` 必须可 persist |

---

## 附录 A：P0.5 实测基准（2026-08-11，macOS arm64，pi 0.84.1）

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| pi RPC 冷启动（真实模式，session-dir） | 平均 **0.81s**（首次 1.53s 含索引，后续 0.44-0.47s） | 每会话 spawn 可接受 |
| pi RPC 进程内存（RSS） | **~189 MB/进程** | 3 进程合计 565.7 MB |
| opencode serve（多会话共享） | **375.6 MB/进程** | 对比基线 |
| 内存结论 | pi 并发 8 = ~1.5 GB | **并发上限建议默认 4**（756 MB），idle TTL 60s |
| pi-acp ACP 握手 | ✅ 成功（v0.0.33，initialize → session/new 返回 sessionId） | 辅轨 P0 已验证 |

**容量校准**（替代原计划"默认 8"）：`pi` 引擎并发上限 **4**、idle TTL **60s**；自动化场景优先评估进程复用（B1-B 折中）以省内存。
