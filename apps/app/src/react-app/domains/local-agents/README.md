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

Session host pages under `domains/session/chat/personal-local-agent-*` consume this
domain through its root barrel. Local-agents does not depend back on session.

## Lateral dependencies

- Allowed: `app/lib`, `packages/types`, neutral capabilities and design-system composites.
- Shared artifact/markdown helpers live in `react-app/capabilities/artifacts`; do not
  introduce a reverse `local-agents -> session` dependency.
