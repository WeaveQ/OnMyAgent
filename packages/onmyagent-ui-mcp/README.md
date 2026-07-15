# onmyagent-ui-mcp

Standalone MCP (Model Context Protocol) server that exposes OnMyAgent's UI
control surface as MCP tools. External MCP clients (OpenCode, Claude Desktop,
Cursor, etc.) invoke this server over stdio to inspect and drive a running
OnMyAgent desktop app.

Distributed as an npm-runnable binary so no local checkout is required.

## Requirements

- OnMyAgent desktop must be running with the local UI control bridge active.
- The bridge writes a discovery file (`onmyagent-ui-control.json`) into the
  platform-specific app data dir; this server reads it to locate `baseUrl` +
  `token`.

Override the discovery path with:

```
ONMYAGENT_UI_CONTROL_DISCOVERY=/absolute/path/to/onmyagent-ui-control.json
```

## Usage

Run once via npx:

```bash
npx onmyagent-ui-mcp
```

Wire into an MCP client:

```json
{
  "mcpServers": {
    "onmyagent-ui": {
      "command": "npx",
      "args": ["-y", "onmyagent-ui-mcp"]
    }
  }
}
```

## Exposed Tools

| Tool | Purpose |
| --- | --- |
| `ui_status` | Check whether the desktop bridge is reachable. |
| `ui_snapshot` | Read the current route, narration, status, and visible actions. |
| `ui_list_actions` | List actions available in the current UI state. |
| `ui_execute_action` | Execute a published UI action by ID. |
| `ui_list_sessions` | List sessions in the current workspace. |
| `ui_focus_session` | Focus a specific session by ID. |
| `ui_describe_workspace` | Describe the currently selected workspace. |

## Security

Use only against **trusted local development sessions**. The bridge trusts any
holder of the discovery token, so treat the discovery file like a session
credential.

## Development

Source is a single file (`index.mjs`) — no build step, no bundler. To edit,
follow the standard PR flow in `CONTRIBUTING.md`. Wire-level types shared with
the desktop bridge live in `@onmyagent/types` (see `packages/types/README.md`).

## Related Docs

- `README.md` § Features — user-facing description of UI control.
- `docs/Architecture.md` § Package Boundaries — where this package sits in
  the monorepo.
- `SECURITY.md` — vulnerability reporting boundaries.
