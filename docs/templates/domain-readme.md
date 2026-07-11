# domains/<name>

One-line purpose.

## Ownership

- What this domain owns (pages, stores, panels).
- What it explicitly does **not** own.

## Public surface

- Prefer `./index.ts` barrel. If there is no barrel yet, say so and list allowed deep paths.
- Shell and other domains must not deep-link past the barrel when a barrel exists.

## Lateral dependencies

- **Allowed:** e.g. `domains/shared` (infra), `app/lib`, `packages/types`.
- **Forbidden:** list domains that would create cycles.
- Cross-domain edges only via kernel, shared infra, barrels, or shrink-only `allowedDomainImports`.

## Do not

- Land product features in `domains/shared`.
- Import `shell/*` from a domain.
