# Documentation Map

**Only full index for `docs/`.** Link here instead of copying nav tables.

## Hierarchy (read this first)

| Layer | File | Holds |
| --- | --- | --- |
| **Monorepo SoT** | [`Architecture.md`](Architecture.md) | Platforms, dual runtime, archive, package boundaries, command surface, **pointers** to design/React |
| **React SoT** | [`../apps/app/src/react-app/ARCHITECTURE.md`](../apps/app/src/react-app/ARCHITECTURE.md) | Domains, state ownership, shell cold start / prewarm |
| **Topic SoT** | `design/*`, `windows-compat.md`, `officecli-oss-release.md`, … | Roadmap, files, config, memory, Windows, OfficeCLI CDN |
| **Agent handbook** | [`../AGENTS.md`](../AGENTS.md) | Iron rules + links; not a second architecture |
| **Visual tokens** | [`../DESIGN.md`](../DESIGN.md) | Tokens / components; not product behavior |
| **Ship notes** | [`../CHANGELOG.md`](../CHANGELOG.md) | What shipped — **not** architecture changelog bullets |

**Rules:** one SoT per topic; Architecture links out instead of duplicating long specs; do not invent parallel `docs/expert-*.md` roots without linking from Architecture.

## Layout

```text
docs/
  README.md                 ← this map
  Architecture.md           ← monorepo / runtime / commands / boundaries
  release.md                ← GitHub release / tags / signing
  officecli-oss-release.md  ← OfficeCLI optional plugin OSS layout / validation
  loop/
    rules.md                ← non-trivial Loop / ledger / kill switch / graphify
    incidents.md            ← severe incident log only
  design/
    theme-system.md         ← design philosophy (tokens live in ../DESIGN.md)
    ui-primitive-refactor-best-practices.md
    files-module-product-spec.md  ← Files module product SoT（三来源 Tab）
    2026-08-02-phase-2-enterprise-prep.md  ← **Phase 2 roadmap + B-side (OnMyCompany) prep SoT**
    2026-08-02-work-memory-plan.md  ← 个人/记忆 + 专家域记忆（awareness）路径 SoT
    2026-08-02-config-consistency.md  ← local/company isomorphic config + migrate (Phase 2a)
    2026-08-09-architecture-convergence-plan.md  ← **active** expert/session/cold/shelf convergence plan
    preview.html / preview-dark.html / preview.css  ← visual catalog; DESIGN.md wins on drift
  windows-compat.md         ← Windows preflight, NSIS, CU (Cua) / Appshot, remaining gaps
  windows-remote-debug-from-mac.md  ← remote Windows debug from macOS
  x-project-bp/             ← product/strategy notes (**gitignored**, not engineering SoT)
```

Root public entries stay outside `docs/`: `README*`, `AGENTS.md`, `DESIGN.md`, `BUILD.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, …

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
| OfficeCLI OSS 发布 | [`officecli-oss-release.md`](officecli-oss-release.md) |
| Heavy Loop work | [`loop/rules.md`](loop/rules.md) |
| Windows support | [`windows-compat.md`](windows-compat.md) |

## Sources of truth

| Topic | Authoritative file |
| --- | --- |
| Commands (`dev` / `task` / checks) | root `package.json`, `scripts/cli/*`, summarized in `Architecture.md` |
| Monorepo & package boundaries | `Architecture.md` |
| Dual runtime (OpenCode 主 / Personal 辅) + archive 热路径 | `Architecture.md` → **Dual Runtime Boundary**, **Server Archive Runtime** |
| Product platforms (mac / win / not Linux packages) | `Architecture.md` Product phase + root `README*` / `BUILD.md` |
| Skills write/scan roots + list resilience | `Architecture.md` Product phase hard constraints + server `listSkills` |
| React domains + shell load/boot UX | `apps/app/src/react-app/ARCHITECTURE.md` (+ **Shell load / boot**) + `domains/*/README.md` |
| Expert / session UI ownership | `react-app/ARCHITECTURE.md` + `Architecture.md` **Session / Expert / cold-path pointers** |
| Release notes (human) | root `CHANGELOG.md` + GitHub Releases |
| Visual tokens / components | `../DESIGN.md` |
| Design philosophy only | `design/theme-system.md` |
| UI primitive refactor habits | `design/ui-primitive-refactor-best-practices.md` |
| Files module (三来源) | `design/files-module-product-spec.md` |
| **Phase 2 + B-side prep** | `design/2026-08-02-phase-2-enterprise-prep.md` |
| Config profile migrate / resolve | `design/2026-08-02-config-consistency.md` |
| Work memory / awareness | `design/2026-08-02-work-memory-plan.md` |
| **Architecture convergence plan** | `design/2026-08-09-architecture-convergence-plan.md` |
| Windows / Computer Use / Appshot | `windows-compat.md` |
| Agent operating rules | `../AGENTS.md` + `loop/rules.md` |
| Local packaging | `../BUILD.md` |
| Release | `release.md` |
| OfficeCLI OSS release contract | `officecli-oss-release.md` + `packages/types/src/officecli.ts` |
| Security reporting | `../SECURITY.md` |
| Handoff / run log / plans / feature drafts | **local** `.loop/` only (gitignored) |
| Severe incidents | `loop/incidents.md` |

### Update when

| Change | Update |
| --- | --- |
| Root command surface | `Architecture.md` + `AGENTS.md` + `README*` |
| New domain folder | `Architecture.md` + `react-app/ARCHITECTURE.md` + domain `README.md` |
| New capability under `react-app/capabilities/` | `react-app/ARCHITECTURE.md` + monorepo summary in `Architecture.md` |
| External CLI / sidecar / skill bridge (e.g. BrowserSkill) | `Architecture.md` Feature→Transport table + desktop skeleton note; keep product skills under `apps/desktop/resources/bundled-skills/` |
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
3. **`docs/design/` only holds durable SoT** (roadmap, paths, product rules, theme/preview). Shipped one-shot feature notes and superseded experiments stay in git history or local `.loop/` — do not reintroduce dated “已落地 / superseded” stubs, or tracked `docs/superpowers/`.
4. After edits: link smoke + `git diff --check`.
5. Engineering doc audit: `.agents/skills/documentation-audit/SKILL.md`.  
6. **Product handbook** (`website/docs` VitePress): write with `.agents/skills/product-handbook-write/SKILL.md`; screenshots with `.agents/skills/docs-screenshot-capture/SKILL.md`. See also `website/README.md`.
