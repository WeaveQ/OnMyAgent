# domains/plugins

Skills catalog, plugins page, connectors entry, and expert/skills marketplace for the desktop UI.

## Ownership

- `plugins-page.tsx` — Plugins / Skills / Connectors pages
- `skills-catalog.ts` — catalog data
- `skill-scope.ts` — scope / origin classification
- `bundled-skill-locale.ts` — bundled skill display locale
- `expert-marketplace/` — builtin expert catalog, install helpers, marketplace UI
- `skills-marketplace/` — builtin skills catalog + marketplace page
- `pinned-skills.ts` — composer skill pin persistence (shared with skills marketplace)

## Public surface

`./index.ts` barrel. New imports must use `domains/plugins`, not historical `shared/`
or `session/expert-marketplace` / `session/skills-marketplace` paths.

## Lateral dependencies

- Allowed: `domains/shared` (infra), `app/lib`, `packages/types`.
- Product domains that need skill/marketplace metadata should import this barrel rather
  than deep-linking into subfolders.
- Marketplace → pending-agent mapping lives in `domains/agents` (`buildPendingAgentFromMarketplaceExpert`).
