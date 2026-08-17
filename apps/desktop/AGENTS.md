# apps/desktop — Agent 手册

Electron shell、IPC、sidecar、打包。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)。本页 = **验证入口 + 本包硬边界**；Dual Runtime / delete-saga 政策见 Architecture。

## 默认验证

```bash
pnpm task check desktop
git diff --check
```

Bridge / channels：`node --test apps/desktop/electron/channels/test/*.test.mjs`（无 live 凭证）。
Runtime smoke：`pnpm test:runtime`（按变更选用）。
Desktop OpenCode e2e：`apps/desktop/electron/e2e/*.e2e.test.mjs`（编入 `test:runtime`；默认无 live 模型 / 无 Electron 窗）。覆盖 knowledge 插件加载与 vault 检索/CRUD、工作区 `/file` 读写、sandbox HOME 隔离 + slash 核心技能、以及 skill-creator 写入 `profiles/local/config/skills`。可选 `OPENCODE_E2E_LIVE_MODEL=1` 跑免费模型 prompt。

## 必读链接

| 文档 | 用途 |
|------|------|
| [`../../AGENTS.md`](../../AGENTS.md) | Phase-2 硬约束 · Human gate |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | Dual Runtime · Expert lifecycle · desktop 边界 |
| [`../../docs/design/2026-08-02-phase-2-enterprise-prep.md`](../../docs/design/2026-08-02-phase-2-enterprise-prep.md) | 阶段二路线图 |
| [`../../docs/design/2026-08-02-config-consistency.md`](../../docs/design/2026-08-02-config-consistency.md) | config dual-read / migrate |
| [`../../BUILD.md`](../../BUILD.md) | 本地打包 |
| [`../../docs/windows-compat.md`](../../docs/windows-compat.md) | Windows / CU / Appshot / NSIS |

## 硬边界

- `apps/desktop/electron/**` = **Human gate**（改前说明，改后完整验证）。
- 产品 bundled skills：`resources/bundled-skills/**` ≠ 工程 skill（`.agents/skills/**`），不同步。
- Dual Runtime / Expert delete-saga：Architecture **Dual Runtime Boundary** + Expert lifecycle。desktop 只删 `my-experts` registry 与 owner-safe skill materialization（operation journal 重放）；OpenCode session / runtime / origin tombstone 属 server。
- **配置 / skills 根**：`config-profile-paths` resolve；`runtime.mjs` skill 物化必须走 resolve（禁止写死 `~/.onmyagent/skills`）。细则 → config-consistency。
- Phase-2 未登录 / 迁移：根 AGENTS 硬入口；本页不复述。
- **Computer Use / Appshot 矩阵**：只在 `windows-compat.md` + Architecture Product platforms。Appshot 勿引入 Rust/xcap helper。
- **Managed CLI（OfficeCLI / 飞书）**：`electron/managed-tools/**` + 对应 plugins；见 [`electron/managed-tools/AGENTS.md`](electron/managed-tools/AGENTS.md)。契约：`node --test electron/managed-tools/recommended-managed-cli.boundary.test.mjs`（`test:runtime`）。
- **Expert package metadata**：manifest 的 `skills` / `introStyle` / `approvedAgentIds` 是声明 SoT；desktop 可在一个兼容周期内读取缺少 `skills` 字段的 legacy agent frontmatter，但 renderer 不得恢复 markdown parser。显式 `skills: []` 必须覆盖 fallback。
