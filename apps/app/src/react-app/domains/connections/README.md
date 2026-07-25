# domains/connections

Provider connections store, provider auth modals, MCP add/auth modals, and connection UI.

## Public surface

`./index.ts` barrel exports store / provider-auth store / ConnectionsModals and related APIs.
Submodule `provider-auth/` may deep-link internally; outside the domain, use the barrel.

### Shared inventory merge
- `merge-connected-providers.ts` (`mergeConnectedProviders`) is the **canonical** merge of
  SDK connected list + managed OpenCode providers + cloud imports.
- Consumers: settings AI controller, session model-options / catalog paths.
  Do not reimplement provider-list merging in shell or settings pages.

## Lateral dependencies

- Allowed: `domains/shared` (infra), `app/lib`, `packages/types`.
- Forbidden: product imports from `session` / `settings` for new code without an explicit contract.
