# Documentation Map

**Only full index for `docs/`.** Link here instead of copying nav tables.

## Hierarchy (read this first)

| Layer | File | Holds |
| --- | --- | --- |
| **Monorepo SoT** | [`Architecture.md`](Architecture.md) | Platforms, dual runtime, archive, package boundaries, command surface, **pointers** to design/React |
| **React SoT** | [`../apps/app/src/react-app/ARCHITECTURE.md`](../apps/app/src/react-app/ARCHITECTURE.md) | Domains, state ownership, shell cold start / prewarm |
| **Topic SoT** | `design/*`, `windows-compat.md`, `officecli-oss-release.md`, … | Roadmap, files, config, memory, Windows, OfficeCLI CDN |
| **Agent handbook** | [`../AGENTS.md`](../AGENTS.md) | Iron rules, verify matrix, path gates; **not** visual SoT |
| **App agent handbook** | [`../apps/app/AGENTS.md`](../apps/app/AGENTS.md) | App verify entry (invariants live in Architecture Session/Expert) |
| **Visual tokens** | [`../DESIGN.md`](../DESIGN.md) | Tokens / shapes / signature components; **not** session product behavior |
| **Ship notes** | [`../CHANGELOG.md`](../CHANGELOG.md) | What shipped — **not** architecture changelog bullets |

**Rules:**

- **One SoT per topic.** Architecture / DESIGN / package AGENTS link out; do not re-copy long specs.
- **AGENTS.md** = agent runbook (gates, path permissions, Phase-2 hard entry, verify entry). **Not** visual encyclopedia (→ DESIGN) and **not** dual-runtime deep dive (→ Architecture).
- **DESIGN.md** = visual / component SoT only. **Not** session product behavior (→ Architecture Session / Expert).
- **apps/app/AGENTS.md** is a verify entry, not a second product SoT. Behavior + lifecycle/budget live in Architecture Session / Expert + React ARCHITECTURE.
- Do not invent parallel `docs/expert-*.md` roots without linking from Architecture.

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
    2026-08-09-architecture-convergence-plan.md  ← historical + board (A–D on main; E deferred)
    2026-08-09-capability-shelf.md  ← recommended vs built-in placement matrix
    expert-surface-architecture.md  ← **Expert 会话面 FSM / tab / cold-open / pending 语义 SoT**
    expert-runtime-isolation.md  ← Expert OpenCode agent/skills/HOME sandbox
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
| UI / tokens / component shape | [`../DESIGN.md`](../DESIGN.md) |
| Expert / session product behavior | [`Architecture.md`](Architecture.md) Session / Expert |
| Expert surface / tab / cold-open architecture | [`design/expert-surface-architecture.md`](design/expert-surface-architecture.md) |
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
| **Expert 会话面架构**（FSM / draft / tab / cold-open） | `design/expert-surface-architecture.md` |
| Expert runtime isolation (agent / skills / HOME sandbox) | `design/expert-runtime-isolation.md` |
| Expert lifecycle delete/create/select + cold-path **budgets** | `Architecture.md` Expert lifecycle hard rules + Cold-path budget |
| Expert / session **product behavior** (busy shell, origin, draft, first-send) | Architecture Session / Expert + `apps/app/scripts/expert-session-invariants.test.ts` |
| Release notes (human) | root `CHANGELOG.md` + GitHub Releases; product handbook excerpt: `website/docs/changelog.md` |
| Visual tokens / components | `../DESIGN.md` (only) |
| Design philosophy only | `design/theme-system.md` |
| Experts / session behavior invariants | Architecture Session / Expert + `apps/app/scripts/expert-session-invariants.test.ts` |
| UI primitive refactor habits | `design/ui-primitive-refactor-best-practices.md` |
| Files module (三来源) | `design/files-module-product-spec.md` |
| **Phase 2 + B-side prep** | `design/2026-08-02-phase-2-enterprise-prep.md` |
| Config profile migrate / resolve | `design/2026-08-02-config-consistency.md` |
| Work memory / awareness | `design/2026-08-02-work-memory-plan.md` |
| **Architecture convergence plan** | `design/2026-08-09-architecture-convergence-plan.md`（historical + board；A–D on main） |
| Capability shelf (recommended placement) | `design/2026-08-09-capability-shelf.md` + `capability-shelf.ts` |
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
| Shipped version / user-visible notes | root `CHANGELOG.md` + `website/docs/changelog.md` (+ `en/`) |
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
