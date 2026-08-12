# apps/app — Agent 手册

React UI（Vite renderer）+ `src/react-app` 域架构。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)；本页 = **app 默认验证 + 热点 + 专家/会话行为不变量**。

## 默认验证

```bash
pnpm task check app
pnpm check:file-size
git diff --check
```

改 session-route / draft / origin / 专家页时再加：

```bash
cd apps/app && bun test scripts/expert-session-invariants.test.ts
# 可选更广：pnpm task test sessions · pnpm test:ui
```

## 必读链接

| 文档 | 用途 |
|------|------|
| [`src/react-app/ARCHITECTURE.md`](./src/react-app/ARCHITECTURE.md) | React 域 / shell / session-route |
| [`../../AGENTS.md`](../../AGENTS.md) | 全仓铁律 · 门禁 · Human gate |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | 双运行时 · Expert lifecycle · 冷启动预算 |
| [`../../docs/design/expert-surface-architecture.md`](../../docs/design/expert-surface-architecture.md) | **Expert 会话面 FSM / tab / cold-open / pending 语义**（改会话 UI 先读） |
| [`../../docs/design/expert-runtime-isolation.md`](../../docs/design/expert-runtime-isolation.md) | Expert OpenCode agent / skills / HOME sandbox |
| [`../../DESIGN.md`](../../DESIGN.md) | **UI SoT**（勿在本文件复述视觉细则） |
| [`../../docs/README.md`](../../docs/README.md) | 文档地图 |

## 改什么读什么

| 你在改… | 读 | 验证 |
|---------|----|------|
| 颜色、圆角、Tab/CTA、shell chrome | `DESIGN.md` | `pnpm task check design` |
| 用户可见文案 | i18n locales | `pnpm check:i18n:cjk` |
| 专家/会话 busy、draft、origin、首发、SSE | **下文不变量** | `bun test scripts/expert-session-invariants.test.ts` |
| 专家会话面 FSM / tab / cold-open / pending 命名 | `docs/design/expert-surface-architecture.md` | surface / cold-open / tab-title 单测（见该文档 §10） |
| hard_delete / create flush / listSessions 预算 | Architecture Expert lifecycle + Cold-path | 对应 unit / Architecture 表中代码 |
| 域拆分 / shell import | ARCHITECTURE + 根 AGENTS 边界 | `pnpm check:boundaries` |
| 大页 expert/assistant/render | 下文热点 | `pnpm check:file-size` |

## 热点文件（先拆再改）

贴近 `pnpm check:file-size` 基线，**禁止为功能直接抬高 baseline**：

- `src/react-app/domains/session/pages/expert.tsx`
- `src/react-app/domains/session/pages/assistant.tsx`
- `src/react-app/shell/session-route/render.tsx`

顺序：抽 hook / pure model → 再改行为 → `pnpm check:file-size`。

## 双运行时

OpenCode 主 · Personal 辅 · 禁止交叉写 store/archive。  
长文 → Architecture **Dual Runtime Boundary**。

## Experts / Session 不变量

改 `domains/session`、`shell/session-route`、专家 draft/directory 时必须遵守。

| 层 | 内容 | 权威 |
|----|------|------|
| **产品行为**（本表） | 水合 / 草稿 / 首发 / SSE 代际 / 空壳 busy | 本文件 + 契约测试 |
| **会话面架构** | surface FSM、tab 硬规则、cold-open suppress、pending 三语义 | `docs/design/expert-surface-architecture.md` |
| **生命周期 / 预算** | hard_delete、create flush、select no-op、listSessions 次数 | Architecture Expert lifecycle + Cold-path budget |
| **Runtime 隔离** | agent=onmyagent、sandbox HOME、plugin 空列表 | `docs/design/expert-runtime-isolation.md` |

契约入口：`scripts/expert-session-invariants.test.ts`。

1. **空壳禁止 startRun**  
   仅创建空专家会话壳（`onCreateFreshSessionForAgent` 等）**不得** `startRun`。只有首条真实 prompt / 已有 run 路径才能标 busy。  
   禁止：无消息却 thinking / 永久「准备中」。  
   测试：`expert-preparing-jank.test.ts` · `expert-session-invariants.test.ts`

2. **Expert Directory 权威**
   专家列表 / 空落地页必须以 server Expert Directory 的 `loading / ready / incomplete / error` 状态为准；未 ready 时不得假装「无专家会话」。workspace 错误优先于 incomplete 空态；完整 revision cache 可维持稳定展示，但 renderer 不得自行恢复 origin。
   测试：`expert-directory.test.ts` · `expert-session-invariants.test.ts`

   Expert prompt 只能选择 `onmyagent` 或 package manifest 明确声明的 `approvedAgentIds`；contract violation 走三语 typed error。renderer shadow diff 只上传结构化 change/count，不上传 id、path、prompt 或 content；完整 lifecycle ring 只从 Settings diagnostics 导出。

3. **Bound draft 事务消费**  
   打开同专家真实 session 时消费对应 draft；禁止跨专家误消费、幽灵新会话 tab、重复导航。  
   测试：`expert-draft-session.test.ts` · `expert-session-invariants.test.ts`

4. **首发冷路径可见**  
   新建 session 发送：须有本地乐观用户气泡；`seedOptimisticSessionUserMessage` 在 `activateCreatedSessionRoute` **之前**；marketplace install 可与 create 重叠；空壳 create **不得** await 装包挡导航。busy 时 composer 显示 Stop。  
   测试：`expert-preparing-jank.test.ts` · `expert-session-invariants.test.ts`

5. **Snapshot / SSE 代际隔离**  
   切会话、重连、停流时取消过期 subscriber / 用 generation 丢弃过期事件；禁止串台写错 session。  
   测试：`expert-session-invariants.test.ts` + session-sync / activity 单测

## 本包边界速记

- `shell/**` → 只 import `domains/<domain>` 一级 barrel（`pnpm check:boundaries`）。
- 用户可见文案 → i18n（`pnpm check:i18n:cjk`）。
