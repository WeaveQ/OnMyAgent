# apps/app — Agent 手册

React UI（Vite renderer）+ `src/react-app` 域架构。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)。本页 = **验证入口 + 热点**；产品不变量不在此复述。

## 默认验证

```bash
pnpm task check app
pnpm check:file-size
git diff --check
```

改 session-route / draft / origin / 专家页 / 冷路径 / 货架时再加：

```bash
# Default CI (`pnpm test:ui`) already runs these harness contracts.
cd apps/app && bun test scripts/expert-session-invariants.test.ts
cd apps/app && bun test scripts/cold-path-budget.test.ts
cd apps/app && bun test scripts/capability-shelf.test.ts
# 可选：expert-preparing-jank · expert-directory · expert-draft-session · expert-cold-path
# 更广：pnpm test:ui
```

## 必读链接

| 文档 | 用途 |
|------|------|
| [`src/react-app/ARCHITECTURE.md`](./src/react-app/ARCHITECTURE.md) | React 域 / shell / session-route / Expert surface |
| [`../../AGENTS.md`](../../AGENTS.md) | 全仓铁律 · 门禁 · Human gate |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | 双运行时 · Expert lifecycle · 冷启动预算 · 产品行为 |
| [`../../docs/design/expert-surface-architecture.md`](../../docs/design/expert-surface-architecture.md) | Expert 会话面 FSM / tab / cold-open / pending |
| [`../../docs/design/expert-runtime-isolation.md`](../../docs/design/expert-runtime-isolation.md) | Expert OpenCode agent / skills / HOME sandbox |
| [`../../DESIGN.md`](../../DESIGN.md) | **UI SoT**（勿在本文件复述视觉细则） |
| [`../../docs/README.md`](../../docs/README.md) | 文档地图 |

## 改什么读什么

| 你在改… | 读 | 验证 |
|---------|----|------|
| 颜色、圆角、Tab/CTA、shell chrome | `DESIGN.md` | `pnpm task check design` |
| 用户可见文案 | i18n locales | `pnpm check:i18n:cjk` |
| 专家/会话 busy、draft、origin、首发、SSE | Architecture Session/Expert + React ARCHITECTURE | `bun test scripts/expert-session-invariants.test.ts` |
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

产品不变量 SoT：[`docs/Architecture.md`](../../docs/Architecture.md) **Session / Expert / cold-path** + [`src/react-app/ARCHITECTURE.md`](./src/react-app/ARCHITECTURE.md)。契约入口：`scripts/expert-session-invariants.test.ts`。本页不另列全文。

- 空壳禁止 startRun
- Expert Directory 权威
- Bound draft 事务消费
- 首发冷路径可见
- Snapshot / SSE 代际隔离

## 本包边界速记

- `shell/**` → 只 import `domains/<domain>` 一级 barrel（`pnpm check:boundaries`）。
- 用户可见文案 → i18n（`pnpm check:i18n:cjk`）。
