# apps/app — Agent 手册

React UI（Vite renderer）+ `src/react-app` 域架构。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)；本页只放 **app 默认入口**。

## 默认验证

改本包后优先跑（从仓库根目录）：

```bash
pnpm task check app
pnpm check:file-size
git diff --check
```

触及 session / UI 行为时，按需再加：`pnpm task test sessions` 或 `pnpm test:ui`。

## 必读链接

| 文档 | 用途 |
|------|------|
| [`src/react-app/ARCHITECTURE.md`](./src/react-app/ARCHITECTURE.md) | React 域 / shell / session-route |
| [`../../AGENTS.md`](../../AGENTS.md) | 全仓铁律、边界、验证矩阵 |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | 系统架构 · 双运行时 |
| [`../../DESIGN.md`](../../DESIGN.md) | **UI SoT**：token、形状、signature 组件、shell chrome（勿在 AGENTS 复述细则） |

## UI 改动入口

- **视觉 / 组件契约** → 只读/只改 [`DESIGN.md`](../../DESIGN.md) + `pnpm task check design`；不要把 pill/`rounded-full`/Tab 细则写回本文件。
- **文案** → i18n（`pnpm check:i18n:cjk`）；根 AGENTS 硬性禁止。
- **session/专家行为** → 下文「Experts / Session 不变量」，不是 DESIGN。

## 热点文件（先拆再改）

下列文件贴近 `pnpm check:file-size` 基线，**禁止为功能直接抬高 baseline**：

- `src/react-app/domains/session/pages/expert.tsx`
- `src/react-app/domains/session/pages/assistant.tsx`
- `src/react-app/shell/session-route/render.tsx`

改行为时默认顺序：

1. 抽 hook / pure model / thin page（逻辑出大文件）
2. 再改产品行为
3. 本地 `pnpm check:file-size` 通过后再提交

## 双运行时

- **OpenCode** = 产品主运行时与主会话真相源（`domains/session` + server archive / SSE）。
- **Personal Local Agent** = 桌面辅轨（`domains/local-agents`），不是第二套主引擎。
- **禁止**交叉写对方 store / archive。细则：根 AGENTS「双运行时主辅」+ `docs/Architecture.md` → Dual Runtime Boundary。

## Experts / Session 不变量

改 `domains/session`、`shell/session-route`、专家 draft/origin 时必须遵守。违反即回归。契约入口：`apps/app/scripts/expert-session-invariants.test.ts`（并引用下列专项测试）。

1. **空壳禁止 startRun**  
   仅创建空专家会话壳（`onCreateFreshSessionForAgent` 等）**不得** `startRun`。只有首条真实 prompt / 已有 run 路径才能标 busy。  
   禁止：无消息却 thinking / 永久「准备中」。  
   测试：`expert-preparing-jank.test.ts` · `expert-session-invariants.test.ts`

2. **Origin 水合权威**  
   专家列表 / 空落地页必须以 origin hydration 完成（或 degraded）为准；水合中不得假装「无专家会话」。workspace 错误优先于 degraded 空态。自动重试有界，耗尽后停止假 loading。  
   测试：`expert-origin-hydration.test.ts` · `expert-session-invariants.test.ts`

3. **Bound draft 事务消费**  
   打开同专家真实 session 时消费对应 draft，禁止跨专家误消费、禁止已绑定 draft 幽灵新会话 tab、禁止重复导航。  
   测试：`expert-draft-session.test.ts` · `expert-session-invariants.test.ts`

4. **首发冷路径可见**  
   新建 session 发送：隔离目录 / create 期间须有本地乐观用户气泡；`seedOptimisticSessionUserMessage` 必须在 `activateCreatedSessionRoute` 之前；marketplace install 可与 create 重叠，空壳 create **不得** await 装包挡导航。busy 时 composer 显示 Stop 而非蓝发送。  
   测试：`expert-preparing-jank.test.ts` · `expert-session-invariants.test.ts`

5. **Snapshot / SSE 代际隔离**  
   切会话、重连、停流时取消过期 subscriber / 用 generation 丢弃过期事件，禁止串台写错 session 的 transcript 或状态。  
   测试：`expert-session-invariants.test.ts`（源码契约）+ session-sync / activity 相关单测

## 本包边界速记

- `shell/**` 只 import `domains/<domain>` 一级 barrel，不深链子路径（`pnpm check:boundaries`）。
- renderer 用户可见文案走 i18n（`pnpm check:i18n:cjk`）。
