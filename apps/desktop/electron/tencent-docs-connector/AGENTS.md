# tencent-docs-connector — Recommended remote MCP connector

腾讯文档推荐连接器：OAuth + OpenCode global MCP headers + skill 物化。  
**无 binary 下载**（不要 import `managed-cli/*`）。

## 边界

| 职责 | 位置 |
|------|------|
| OAuth PKCE / token | `oauth.mjs` + managed root `oauth-tokens.json` |
| OpenCode MCP 写入 | `mcp-config.mjs` → `~/.config/opencode/opencode.json` |
| Skill | Connect 时从 `bundled-skills/tencent-docs` 物化到 user skills |
| UI 卡 | `apps/app/.../plugins/tencent-docs-plugin*.tsx` |
| IPC | `desktop-handlers/managed-tools.mjs`（`tencentDocs*` 命令） |

## 禁止

- 不走 managed-cli download / registry / launcher
- 不在 server 复制半套 OAuth
- 不默认四次扫码；四端点共用同一 access token（headers）

## 验证

```bash
node --test apps/desktop/electron/tencent-docs-connector/*.test.mjs
node --test apps/desktop/electron/desktop-handlers/managed-tools.test.mjs
pnpm task check desktop
pnpm task check app
```
