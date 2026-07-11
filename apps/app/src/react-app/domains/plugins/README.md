# domains/plugins

Skills catalog, plugins page, and connectors entry for the desktop UI.

## Ownership

- `plugins-page.tsx` — Plugins / Skills / Connectors pages
- `skills-catalog.ts` — catalog data
- `skill-scope.ts` — scope / origin classification
- `bundled-skill-locale.ts` — bundled skill display locale

## Public surface

`./index.ts` barrel. New imports must use `domains/plugins`, not historical `shared/` paths
(implementations no longer live under `shared/`).

## Lateral dependencies

- Allowed: `domains/shared` (infra), `app/lib`, `packages/types`.
- Product domains that need skill metadata should import this barrel rather than duplicating catalogs.
