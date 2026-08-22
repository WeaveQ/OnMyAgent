# domains/shared

Cross-domain **infra plus existing product helpers** already exported from
`index.ts`. Not a product domain to grow.

## What belongs here

Infra:

- `env-context.ts` — env / system context helpers
- `extension-state.ts` — extension enable/hide flags
- `extension-registry.tsx` — extension config/runtime registration
- `desktop-config-context.ts` — desktop config context
- `onmyagent-server-store.ts` — local server connection store
- `onmyagent-den-help-link.tsx` — Den help link composite
- `session-parent-tree.ts` — session parent-tree walk helpers

Existing product helpers (already on the barrel — describe, do not grow):

- `personalization/` — onboarding vertical rank / automations
- `memory/` — conversation memory + work-memory file sync
- `assistant-archived-tasks.ts` — archived-task helpers used by chrome

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
Do not add new product exports to the barrel.

## Lateral dependencies

- Allowed: `app/lib`, `packages/types`, limited helpers already in this folder.
- Forbidden: importing other product domains for business UI.
