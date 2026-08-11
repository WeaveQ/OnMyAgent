# apps/desktop — Agent 手册

Electron shell、IPC、sidecar、打包。全仓规则见根 [`AGENTS.md`](../../AGENTS.md)。

## 默认验证

```bash
pnpm task check desktop
git diff --check
```

Bridge / channels：`node --test apps/desktop/electron/channels/test/*.test.mjs`（无 live 凭证）。  
Runtime smoke：`pnpm test:runtime`（按变更选用）。

## 必读链接

| 文档 | 用途 |
|------|------|
| [`../../AGENTS.md`](../../AGENTS.md) | Phase-2 硬约束 · Human gate |
| [`../../docs/Architecture.md`](../../docs/Architecture.md) | 双运行时 · desktop 边界 · 阶段指针 |
| [`../../docs/design/2026-08-02-phase-2-enterprise-prep.md`](../../docs/design/2026-08-02-phase-2-enterprise-prep.md) | 阶段二路线图 |
| [`../../docs/design/2026-08-02-config-consistency.md`](../../docs/design/2026-08-02-config-consistency.md) | config dual-read / migrate |
| [`../../BUILD.md`](../../BUILD.md) | 本地打包 |
| [`../../docs/windows-compat.md`](../../docs/windows-compat.md) | Windows / CU / Appshot / NSIS |

## 硬边界

- `apps/desktop/electron/**` = **Human gate**（改前说明，改后完整验证）。
- 产品 bundled skills：`resources/bundled-skills/**` ≠ 工程 skill（`.agents/skills/**`），不同步。
- Personal Local Agent = **辅轨** harness；禁止当第二主引擎写主会话 archive（Architecture Dual Runtime）。
- **配置 / skills 根**：`config-profile-paths` resolve；`runtime.mjs` skill 物化必须走 resolve（禁止写死 `~/.onmyagent/skills`）。细则 → config-consistency。
- **Phase-2 流量/迁移**：未登录零企业流量；迁移只复制不删；禁止擅自 `profiles/company`（根 AGENTS 硬约束）。
- **Computer Use / Appshot 矩阵**：只在 `windows-compat.md` + Architecture Product platforms；本文件不抄矩阵。Appshot 勿引入 Rust/xcap helper。
- **Managed CLI（OfficeCLI / 飞书）**：`electron/managed-tools/**` + 对应 plugins；见 [`electron/managed-tools/AGENTS.md`](electron/managed-tools/AGENTS.md)。契约：`node --test electron/managed-tools/recommended-managed-cli.boundary.test.mjs`（`test:runtime`）。
- **Expert package metadata**：manifest 的 `skills` / `introStyle` / `approvedAgentIds` 是声明 SoT；desktop 可在一个兼容周期内读取缺少 `skills` 字段的 legacy agent frontmatter，但 renderer 不得恢复 markdown parser。显式 `skills: []` 必须覆盖 fallback。
- **Expert package delete**：desktop 只删除 `my-experts` registry 与 owner-safe skill materialization，并以 operation journal 保证重放；OpenCode session、runtime 目录和 origin tombstone 属 server saga，禁止跨层代删。
