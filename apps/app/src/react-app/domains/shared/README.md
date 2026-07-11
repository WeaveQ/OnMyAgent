# domains/shared

Cross-domain **infra only**. Not a product domain.

## What belongs here

- `env-context.ts` — env / system context helpers
- `extension-state.ts` — extension enable/hide flags
- `desktop-config-context.ts` — desktop config context
- `onmyagent-server-store.ts` — local server connection store
- `onmyagent-den-help-link.tsx` — Den help link composite
- `index.ts` — barrel for the above, plus thin session-identity re-exports from `agents/`

## What does **not** belong here

Product pages, modals, registries, toasts, MCP auth, workspace flows, plugins, or agent management.
Those live in:

| Concern | Domain |
| --- | --- |
| Agent registry / session identity | `agents/` |
| MCP + provider auth | `connections/` |
| Workspace create/share/files | `workspace/` |
| Skills / plugins pages | `plugins/` |
| Status toasts / reload banners | `shell-feedback/` |
| Automations + channels | `messaging/` |
| Local / ACP agent UI | `local-agents/` |

## Public surface

Prefer `import { … } from "../shared"` (or the domain path) via `./index.ts`.
Do not grow a product dump under this folder.

## Lateral dependencies

- Allowed: `app/lib`, `packages/types`, limited re-exports from `agents/` for session-identity helpers.
- Forbidden: importing other product domains for business UI.
