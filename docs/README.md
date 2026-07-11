# Documentation Map

**This file is the only full documentation index.** Other docs should link here instead of duplicating long navigation tables.

## Read by role

| You are… | Start here |
| --- | --- |
| New user / trying the app | [`../README.md`](../README.md) (EN) or [`../README-zh.md`](../README-zh.md) (中文) |
| External contributor | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → this map |
| AI coding agent / Loop | [`../AGENTS.md`](../AGENTS.md) → task table below |
| Changing system architecture | [`Architecture.md`](Architecture.md) |
| Changing React domains / UI structure | [`../apps/app/src/react-app/ARCHITECTURE.md`](../apps/app/src/react-app/ARCHITECTURE.md) |
| Changing colors, components, shell chrome | [`../DESIGN.md`](../DESIGN.md) |
| Local packaging (dmg/dir) | [`../BUILD.md`](../BUILD.md) |
| GitHub release / tags / signing | [`release-process.md`](release-process.md) |

## Agent task router (short)

| Task | Read first |
| --- | --- |
| Run / check / test commands | `../AGENTS.md` + root `package.json` / `scripts/cli/*` |
| Package boundaries, monorepo, data flow | `Architecture.md` |
| Domain ownership, migration, routes | `apps/app/src/react-app/ARCHITECTURE.md` + `domains/*/README.md` |
| Visual tokens & UI contracts | `../DESIGN.md` (YAML + prose); philosophy only in `design/theme-system.md` |
| Non-trivial loop / kill switch / graphify | `loop-rules.md` |
| Session goal lifecycle | `features/session-goal/design.md` |
| Doc consistency audit | `.codex/skills/documentation-audit/SKILL.md` |

## Sources of truth (SoT)

Only one place owns each fact. Update that place; others link or summarize.

| Topic | Authoritative source | Do not treat as SoT |
| --- | --- | --- |
| Dev / check / test command surface | root `package.json`, `scripts/cli/*.mjs`, summarized in `Architecture.md` | Random package scripts without root wrapper |
| Monorepo skeleton, package boundaries, runtime flow | `Architecture.md` | README architecture blurb (summary only) |
| React domain map & migration | `apps/app/src/react-app/ARCHITECTURE.md` | Stale domain comments in chat |
| Domain ownership (local) | `apps/app/src/react-app/domains/<name>/README.md` | Cross-domain deep imports |
| Visual tokens, components, Do's/Don'ts | `../DESIGN.md` | Ad-hoc hex / radius in PRs |
| Design philosophy (narrative) | `design/theme-system.md` | Token tables (use DESIGN.md) |
| Agent / Loop operating rules | `../AGENTS.md` + `loop-rules.md` | Chat memory |
| Local packaging | `../BUILD.md` | Release CI secrets |
| Release / tag / notarize flow | `release-process.md` | `BUILD.md` (local only) |
| Security reporting | `../SECURITY.md` | Public issues for vulns |
| Current handoff / run log / intent debt / **plans** | **local** `.loop/` | Tracked `docs/plans/` / `docs/archive/` (gitignored) |
| Severe incidents | `loop-incidents.md` | Ordinary TODOs |
| Product marketplace / bundled skills content | `apps/desktop/resources/**` | Engineering architecture docs |

### What to update when

| Change type | Must update |
| --- | --- |
| New or renamed `pnpm dev` / `pnpm task` / root check script | `Architecture.md` command sections + `AGENTS.md` command block + `README.md` / `README-zh.md` useful-commands table |
| New React domain folder or ownership move | `Architecture.md` domain summary + `react-app/ARCHITECTURE.md` + domain `README.md` |
| Token / component contract | **Only** `DESIGN.md`, then `pnpm task check design` |
| Local package steps | `BUILD.md` only |
| Release / tag / CI release inputs | `release-process.md` only; `BUILD.md` links to it |
| Agent hard rules | `AGENTS.md`; long loop detail in `loop-rules.md` |
| Durable feature **design** (behavior contract) | `docs/features/<topic>/design.md` — not a plan ledger |
| Execution plans / AI ledgers | **only** `.loop/plans/` (local, gitignored via `.loop/*`) |

## Directory map

| Area | Path | Notes |
| --- | --- | --- |
| Architecture | `Architecture.md` | Monorepo SoT |
| React UI | `../apps/app/src/react-app/ARCHITECTURE.md`, `domains/*/README.md` | Domain SoT |
| Loop rules | `loop-rules.md` | Detail for non-trivial loops |
| Design contract | `../DESIGN.md` | Visual SoT |
| Design narrative / previews | `design/` | Philosophy + HTML previews |
| Design tooling | `../scripts/design/` | `pnpm task check design` |
| Feature designs | `features/` | Behavior contracts only (e.g. `session-goal/design.md`) |
| Release | `release-process.md` | Tag / GA / signing |
| Incidents | `loop-incidents.md` | Severe only |
| Legacy loop pointers | `legacy-loop-pointers.md` | Compat only; write `.loop/` |
| Domain README template | `templates/domain-readme.md` | Copy when adding a domain |
| Skills strategy | `../.codex/skills/documentation-audit/references/skills-sync.md` | Codex / OpenCode / bundled |

### Not in git (ignored)

| Path | Purpose |
| --- | --- |
| `.loop/plans/`, `.loop/state/`, `.loop/runs/` | Local loop / AI execution plans |
| `docs/plans/` | If created locally, ignored — do not commit |
| `docs/archive/` | If created locally, ignored — do not commit |

### Not engineering docs

- `apps/desktop/resources/marketplace/**` — product content packs
- `apps/desktop/resources/bundled-skills/**` — shipped skill content
- `graphify-out/**` — generated graph artifacts

## Local loop state

| Need | Write here |
| --- | --- |
| Current handoff | `.loop/state/PROGRESS.md` |
| Day's validation log | `.loop/runs/YYYY-MM-DD.md` |
| Intent debt | `.loop/state/intent-debt.md` |
| AI / execution plans | `.loop/plans/` |
| Local archive | `.loop/archive/` |

Tracked stubs `STATE.md`, `intent-debt.md`, and `LOOP-RUN-LOG.md` only redirect to [`legacy-loop-pointers.md`](legacy-loop-pointers.md). **Do not append routine work there.**

## Maintenance

1. Prefer one SoT update over copying the same paragraph into many files.
2. Keep root public docs as entry points: `README*`, `BUILD`, `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, `CHANGELOG`, `LICENSE`, `AGENTS`, `DESIGN`.
3. **Do not commit plan ledgers** under `docs/plans/` or `docs/archive/` (gitignored). Use `.loop/plans/`.
4. After doc edits: relative-link smoke on core docs + `git diff --check`.
5. Full audit workflow: `.codex/skills/documentation-audit/SKILL.md`.
