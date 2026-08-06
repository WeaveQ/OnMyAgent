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
| [`../../AGENTS.md`](../../AGENTS.md) | 全仓铁律 · Human gate · **Phase 2 硬约束** |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | 双运行时 · desktop 边界 · 阶段二指针 |
| [`../../docs/design/2026-08-02-phase-2-enterprise-prep.md`](../../docs/design/2026-08-02-phase-2-enterprise-prep.md) | 阶段二 + B 端管控准备 |
| [`../../docs/design/2026-08-02-config-consistency.md`](../../docs/design/2026-08-02-config-consistency.md) | `profiles/local` 迁移与 dual-read |
| [`../../BUILD.md`](../../BUILD.md) | 本地打包 |
| [`../../docs/windows-compat.md`](../../docs/windows-compat.md) | Windows 预检、Cua Computer Use、Appshot、NSIS |

## 硬边界

- `apps/desktop/electron/**` 属 Human gate：改前说明原因，改后完整验证。
- 产品 bundled skills：`resources/bundled-skills/**`；工程 skill 在 `.agents/skills/**`，二者不同步。
- Personal Local Agent runtime 是辅轨 harness，禁止当成第二主引擎写主会话 archive。
- **配置 / skills 根路径**：经 `config-profile-paths` resolve；OpenCode skill 物化在 `runtime.mjs` 也必须走 resolve（禁止写死 `~/.onmyagent/skills`）。
- **未登录零企业流量**；迁移只复制不删 legacy skills/marketplaces；禁止擅自创建 `profiles/company`。
- **Computer Use**：macOS → HandsFree（`packages/handsfree`）；Windows → bundled Cua（`prepare-cua-helper` / `computer-use-runtime-config`，MCP 默认关）。Appshot 全平台 Electron `desktopCapturer`，勿再引入 Rust/xcap helper。
- **推荐安装 managed CLI（OfficeCLI / 飞书 CLI）**：逻辑只在 `electron/managed-tools/**` + plugins 下 `officecli-plugin*` / `larkcli-*`；手册与禁止事项见 [`electron/managed-tools/AGENTS.md`](electron/managed-tools/AGENTS.md)。边界契约：`node --test electron/managed-tools/recommended-managed-cli.boundary.test.mjs`（已进 `test:runtime`）。
