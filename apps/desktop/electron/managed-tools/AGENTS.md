# managed-tools — Recommended managed CLI（OfficeCLI / Feishu CLI）

本地 **推荐安装连接器** 的安装与授权真相源。改这里前请读本文件；避免在会话 / MCP / server 里再做半套。

## 产品边界

| CLI | Manager | 授权 | 磁盘根（local profile） |
|-----|---------|------|-------------------------|
| OfficeCLI | `officecli-manager.mjs` | 无（装完即用） | `profiles/local/tools/officecli` |
| Feishu / lark-cli | `lark-cli-manager.mjs` | `lark-cli-auth.mjs` | `profiles/local/tools/lark-cli` |

- **不走** OnMyAgent server / 企业 API / 其它 MCP connector store。
- **不写** 主会话 archive；仅本地 binary + skill 物化 +（飞书）本机 OAuth。
- 两个产品 **状态与 IPC 独立**；仅共享 `managed-cli/*` 下载/校验工具与 registry 路径。
- **腾讯文档**是推荐 remote MCP 连接器（无下载），代码在 `../tencent-docs-connector/`，**禁止** import `managed-cli/*`。

## 所有权路径（默认只在此树改逻辑）

```text
apps/desktop/electron/managed-tools/**          # 安装、registry、飞书授权
apps/desktop/electron/desktop-handlers/managed-tools.mjs
apps/app/src/react-app/domains/plugins/officecli-plugin*.tsx
apps/app/src/react-app/domains/plugins/larkcli-plugin*.tsx
apps/app/src/react-app/domains/plugins/larkcli-connect-modal.tsx
packages/types/src/officecli.ts
packages/types/src/lark-cli-auth.ts
# IPC 命令名还需同步 desktop-ipc-commands / command-map（最小 diff）
```

**挂载点（勿挪到其它域）：**  
`apps/app/.../plugins/plugins-page.tsx` 推荐安装区只应 **import 并渲染** 两张卡，不内联安装逻辑。

## 禁止

- 把 install/auth 状态塞进通用 plugins enable store 或 server SQLite。
- 在 `apps/server` / `apps/orchestrator` 复制半套 managed CLI。
- 在 `LARK_CLI_LAUNCHER_SOURCE` / OfficeCLI launcher 模板里写未转义的 `\d`（模板字符串会吃掉反斜杠，写出坏正则）。必须写成 `\\d` / `\\.`。
- 为「顺手」改 `managed-cli/*` 而不跑两边 manager 测试。

## 验证（改本目录或 UI 卡后）

```bash
node --test \
  apps/desktop/electron/managed-tools/*.test.mjs \
  apps/desktop/electron/desktop-handlers/managed-tools.test.mjs
pnpm task check desktop
# 若改了 app 卡片 / i18n：
pnpm task check app
```

边界契约（防误删挂载 / 误改 launcher 转义 / 拆 IPC）：

```bash
node --test apps/desktop/electron/managed-tools/recommended-managed-cli.boundary.test.mjs
```

（已挂在 `pnpm test:runtime` / desktop `test:runtime`。）

## 与其它模块的安全关系

| 模块 | 关系 |
|------|------|
| 其它连接器卡片 / MCP | 无业务耦合 |
| `connector-tile.ts` | 仅视觉 class；可改样式，勿塞业务 |
| `managed-cli/*` | **共享**；改动 = 双产品回归 |
| `main.mjs` 装配 | 必须注入 `officeCliManager` / `larkCliManager` / `larkCliAuth` |

更长安装与 OSS 流程见 [`docs/officecli-oss-release.md`](../../../../docs/officecli-oss-release.md)。
