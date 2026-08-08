# Baidu Netdisk connector

Product connector that registers Baidu’s official remote MCP into OpenCode global config.

| Layer | Location |
| --- | --- |
| Desktop manager | `manager.mjs` (OAuth code + loopback, or access_token paste) |
| Constants | `constants.mjs` |
| IPC | `desktop-handlers/managed-tools.mjs` (`baiduDrive*` commands) |
| Preload events | `onmyagent:baidu-drive:status` / `auth-progress` |
| Renderer | `apps/app/.../baidu-drive-plugin.tsx` |

## Auth modes

1. **OAuth** when `ONMYAGENT_BAIDU_NETDISK_CLIENT_ID` + `ONMYAGENT_BAIDU_NETDISK_CLIENT_SECRET` (or manager options) are set — browser authorize → local callback → token exchange.
2. **Token paste** when OAuth is not configured — UI collects `access_token` and calls `baiduDriveConnectWithToken`.

MCP URL: `https://mcp-pan.baidu.com/sse?access_token=…` (server name `baidu-netdisk`).

## Tests

```bash
node --test apps/desktop/electron/baidu-drive-connector/*.test.mjs
```
