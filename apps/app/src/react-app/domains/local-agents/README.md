# domains/local-agents

Local / ACP agent editing, cards, message timeline pieces, and agent-management UI.

## Ownership

- Local agent cards, draft composer, status rail, repair panel
- ACP hooks (`hooks/use-acp-*`, conversation hydration)
- Message bubbles / timeline helpers used by personal local agent
- `agent-management/` — management page, MCP panel, skill matrix, providers, health

## Public surface

Domain barrel: `domains/local-agents/index.ts`. External callers (session host pages,
session re-exports) import from the barrel. Internal modules may keep deep relative paths.

Session host pages under `domains/session/chat/personal-local-agent-*` still cross the
domain boundary via the barrel; those edges are frozen in `check-boundaries.mjs`
`allowedDomainImports` (shrink-only).

## Lateral dependencies

- Allowed: `app/lib`, `packages/types`, session artifact/markdown helpers only via existing whitelist edges.
- Do not grow new `session ↔ local-agents` imports without a kernel/shared contract plan.
