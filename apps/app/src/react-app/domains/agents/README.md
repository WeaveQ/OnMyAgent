# domains/agents

Agent registry + agent management surface (custom agents, expert packs, agent cards).

## Public surface

Export through `./index.ts`. Shell and other domains should
`import { X } from "../agents"` (or the package path) and must not deep-link.

## Lateral dependencies

- Allowed: `domains/shared` (infra only), `domains/plugins` (skill locale/scope when needed via whitelist), `app/lib`, `packages/types`.
- Forbidden: growing new imports into `session` / `settings` product trees without a barrel or kernel contract.
