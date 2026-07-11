# domains/workspace

Workspace create / rename / share / remote connection editor / diagnostics / files page.

## Public surface

`./index.ts` barrel: create/share/rename modals, remote connection helpers, diagnostics,
and workspace files page exports as maintained in the barrel.

## Lateral dependencies

- Allowed: `domains/shared` (infra), `app/lib`, `packages/types`.
- Forbidden: growing product imports from `session` / `settings` without a barrel or kernel contract.
