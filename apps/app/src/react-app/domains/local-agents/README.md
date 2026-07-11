# domains/local-agents

Local / ACP agent editing, cards, message timeline pieces, and agent-management UI.

## Ownership

- Local agent cards, draft composer, status rail, repair panel
- ACP hooks (`hooks/use-acp-*`, conversation hydration)
- Message bubbles / timeline helpers used by personal local agent
- `agent-management/` — management page, MCP panel, skill matrix, providers, health

## Public surface

There is **no** domain-level `index.ts` yet. Callers import concrete modules under this folder.
When adding new external callers, prefer introducing a barrel rather than deep-linking many paths.

Session host pages under `domains/session/chat/personal-local-agent-*` still import this domain
directly; those edges are frozen in `check-boundaries.mjs` `allowedDomainImports` (shrink-only).

## Lateral dependencies

- Allowed: `app/lib`, `packages/types`, session artifact/markdown helpers only via existing whitelist edges.
- Do not grow new `session ↔ local-agents` imports without a kernel/shared contract plan.
