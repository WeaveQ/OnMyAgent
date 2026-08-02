# apps/desktop — Agent 手册

Electron shell、IPC、sidecar、打包。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)。

## 默认验证

```bash
pnpm task check desktop
git diff --check
```

触及 bridge / channels 时：`node --test apps/desktop/electron/channels/test/*.test.mjs`（纯本地，无 live 凭证）。  
runtime smoke：`pnpm test:runtime`（按变更范围选用）。

## 必读链接

| 文档 | 用途 |
|------|------|
| [`../../AGENTS.md`](../../AGENTS.md) | 全仓铁律 · Human gate |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | 双运行时 · desktop 边界 |
| [`../../BUILD.md`](../../BUILD.md) | 本地打包 |

## 硬边界

- `apps/desktop/electron/**` 属 Human gate：改前说明原因，改后完整验证。
- 产品 bundled skills：`resources/bundled-skills/**`；工程 skill 在 `.agents/skills/**`，二者不同步。
- Personal Local Agent runtime 是辅轨 harness，禁止当成第二主引擎写主会话 archive。
