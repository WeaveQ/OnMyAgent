# domains/session

Session runtime domain: pages, sidebar, chat hosts, surface (transcript / composer / goal),
artifacts, control, sync, marketplace, voice, browser, infinite canvas.

This is the largest app domain. Prefer extracting product surfaces that are not live
conversation runtime into sibling domains (`local-agents`, `messaging`, `workspace`, …).

## Public surface

Prefer `./index.ts` barrel. Residual re-exports from `components/shared-pages/*` exist for
compat after domain extraction; new call sites should import the target domain instead.

## Internal conventions

- `sync/` is the primary persistence / cross-session state entry for session runtime.
- `surface/` owns transcript, composer, and plan/goal helpers. Shared markdown/artifact
  rendering lives under `react-app/capabilities/artifacts`.
- `components/shared-pages/*` is transitional: most automation / agent-management / files
  pages have moved; remaining files are re-exports or residual workbench panels.
- Submodules may deep-link each other (`sidebar` ↔ `pages` ↔ `sync`); external callers should not.

## Lateral dependencies

- Allowed directions are declared in `scripts/checks/domain-boundary-policy.mjs` and
  every cross-domain import must use the target domain's root barrel.
- Forbidden: reverse dependency from domains into `shell/*`.
