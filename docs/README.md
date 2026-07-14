# Documentation Map

**Only full index for `docs/`.** Link here instead of copying nav tables.

## Layout

```text
docs/
  README.md                 ← this map
  Architecture.md           ← monorepo / runtime / commands / boundaries
  release.md                ← GitHub release / tags / signing
  loop/
    rules.md                ← non-trivial Loop / ledger / kill switch / graphify
    incidents.md            ← severe incident log only
  design/
    theme-system.md         ← design philosophy (tokens live in ../DESIGN.md)
    ui-primitive-refactor-best-practices.md
    preview.html / preview-dark.html / preview.css
```

Root public entries stay outside `docs/`: `README*`, `AGENTS.md`, `DESIGN.md`, `BUILD.md`, `CONTRIBUTING.md`, `SECURITY.md`, …

## Read by role

| You are… | Start here |
| --- | --- |
| New user | [`../README.md`](../README.md) / [`../README-zh.md`](../README-zh.md) |
| Contributor | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| AI coding agent | [`../AGENTS.md`](../AGENTS.md) |
| Architecture change | [`Architecture.md`](Architecture.md) |
| React domain change | [`../apps/app/src/react-app/ARCHITECTURE.md`](../apps/app/src/react-app/ARCHITECTURE.md) |
| UI / tokens | [`../DESIGN.md`](../DESIGN.md) |
| Local packaging | [`../BUILD.md`](../BUILD.md) |
| Release / tags | [`release.md`](release.md) |
| Heavy Loop work | [`loop/rules.md`](loop/rules.md) |

## Sources of truth

| Topic | Authoritative file |
| --- | --- |
| Commands (`dev` / `task` / checks) | root `package.json`, `scripts/cli/*`, summarized in `Architecture.md` |
| Monorepo & package boundaries | `Architecture.md` |
| React domains | `apps/app/src/react-app/ARCHITECTURE.md` + `domains/*/README.md` |
| Visual tokens / components | `../DESIGN.md` |
| Design philosophy only | `design/theme-system.md` |
| Agent operating rules | `../AGENTS.md` + `loop/rules.md` |
| Local packaging | `../BUILD.md` |
| Release | `release.md` |
| Security reporting | `../SECURITY.md` |
| Handoff / run log / plans / feature drafts | **local** `.loop/` only (gitignored) |
| Severe incidents | `loop/incidents.md` |

### Update when

| Change | Update |
| --- | --- |
| Root command surface | `Architecture.md` + `AGENTS.md` + `README*` |
| New domain folder | `Architecture.md` + `react-app/ARCHITECTURE.md` + domain `README.md` |
| Tokens / UI contract | `DESIGN.md` only → `pnpm task check design` |
| Packaging steps | `BUILD.md` |
| Release flow | `release.md` |
| Agent hard rules | `AGENTS.md` / `loop/rules.md` |
| Execution / design drafts | `.loop/` only — never under `docs/features`, `docs/plans`, `docs/archive`, or `docs/superpowers` |

## Not in git

| Path | Why |
| --- | --- |
| `.loop/*` | Local loop state, AI plans, drafts |
| `docs/plans/`, `docs/archive/`, `docs/features/`, `docs/superpowers/` | gitignored; do not reintroduce |

## Not engineering docs

- `apps/desktop/resources/marketplace/**`
- `apps/desktop/resources/bundled-skills/**`
- `graphify-out/**`

## Maintenance

1. Keep this folder to the layout above — no plan/feature draft trees under `docs/`.
2. Prefer one SoT update over copying paragraphs.
3. After edits: link smoke + `git diff --check`.
4. Audit workflow: `.agents/skills/documentation-audit/SKILL.md`.
