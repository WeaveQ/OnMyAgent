# domains/connections

Provider connections store, provider auth modals, MCP add/auth modals, and connection UI.

## Public surface

`./index.ts` barrel exports store / provider-auth store / ConnectionsModals and related APIs.
Submodule `provider-auth/` may deep-link internally; outside the domain, use the barrel.

## Lateral dependencies

- Allowed: `domains/shared` (infra), `app/lib`, `packages/types`.
- Forbidden: product imports from `session` / `settings` for new code without an explicit contract.
