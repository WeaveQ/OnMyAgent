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
| [`../../DESIGN.md`](../../DESIGN.md) | UI token / 视觉契约 |

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

## 本包边界速记

- `shell/**` 只 import `domains/<domain>` 一级 barrel，不深链子路径（`pnpm check:boundaries`）。
- renderer 用户可见文案走 i18n（`pnpm check:i18n:cjk`）。
