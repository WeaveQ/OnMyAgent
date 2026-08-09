# Architecture & product convergence plan

| Field | Value |
| --- | --- |
| Status | **Active** — execution plan SoT for convergence work |
| Branch | `chore/converge-architecture-sot` (docs first; follow-up PR stacks for code) |
| Date | 2026-08-09 |
| Owner | Engineering (desktop + app + server) |
| Related | Recent PR themes: expert/session thrash, cold start, OfficeCLI shelf, skills list, UI chrome |

**Doc hierarchy (do not invent parallel roots):**

| Layer | Path |
| --- | --- |
| Monorepo SoT | [`docs/Architecture.md`](../Architecture.md) |
| React SoT | [`apps/app/src/react-app/ARCHITECTURE.md`](../../apps/app/src/react-app/ARCHITECTURE.md) |
| This plan | `docs/design/2026-08-09-architecture-convergence-plan.md` |
| Agent handbook | [`AGENTS.md`](../../AGENTS.md) (links only) |

---

## 0. Why this exists

Merged PR history (~#170–#255) shows the same themes reopened repeatedly:

1. **Expert** create / CTA / search / delete / multi-tab / virtualization
2. **Multi-session + cold start + switch perf** (same story, different titles)
3. **OfficeCLI / managed CLI / recommended shelf** (placement + copy thrash)
4. **Skills** load paths / marketplace / bad frontmatter
5. **UI chrome** (rail / density / tray) trailing every feature

Goal: **one SoT per topic + engineering alignment + light process**, not more polish PR spam.

**Out of scope for this plan (defer):**

- Chrome freeze announcement (process-only; optional later)
- Linux packaging removal (builder/matrix/feed) — separate PR
- New Files / Automation / Computer Use features

**In scope:**

- Doc hierarchy fix + platform/skills hard constraints in Architecture
- Expert / multi-session lifecycle contract → code + tests
- Cold-path budget + thrash bans
- Capability shelf matrix → config-driven UI
- Skills write/scan SoT + observability

---

## 1. Success criteria (2–3 weeks)

| Metric | Target |
| --- | --- |
| Expert create/CTA/search/delete “drive-by” PRs | ≤ 1 (contract bugs only) |
| `perf(session\|cold)` PRs | Must include before/after budget numbers |
| Shelf / OfficeCLI placement changes | Must include matrix or config diff |
| `listSkills` 500 from one bad `SKILL.md` | 0 (skip bad entry) |
| Architecture.md | No new “已完成一轮” changelog bullets |
| Parallel SoT files under `docs/*.md` roots | 0 without Architecture link |

---

## 2. Phases

### Phase A — Documentation SoT (this branch first)

| # | Work | Files |
| --- | --- | --- |
| A1 | Hierarchy map | `docs/README.md` |
| A2 | Platforms, skills write path, pointers, drop changelog bloat | `docs/Architecture.md` |
| A3 | Windows intro: product mac+win; ubuntu ≠ Linux product | `docs/windows-compat.md` |
| A4 | Cold-path thrash rule | `apps/app/src/react-app/ARCHITECTURE.md` |
| A5 | Appshot platform wording | `AGENTS.md` (+ root `README*` if still “Linux Appshot”) |
| A6 | This plan | `docs/design/2026-08-09-architecture-convergence-plan.md` |

**Exit:** Architecture is the only monorepo SoT; design/React hold detail; no broken links.

### Phase B — Expert + multi-session (engineering)

| # | Work | Acceptance |
| --- | --- | --- |
| B1 | Lifecycle hard rules in Architecture **Session / Expert** section (table: create / select / hard-delete / restore) | Review sign-off |
| B2 | Align delete + select APIs (no ghost tabs) | Unit/contract tests |
| B3 | Create flow: CTA / search select / composer flush → one path | One flush per create |
| B4 | Switch + transcript virtualization boundaries | No fight with recovery |
| B5 | 3–5 contract tests (E2E optional) | CI green |

**Code hotspots (indicative):**
`domains/session/*`, expert marketplace/host, hard-delete helpers, transcript virtualization, session recovery.

### Phase C — Cold start / switch budget (engineering)

| # | Work | Acceptance |
| --- | --- | --- |
| C1 | Budget table in `react-app/ARCHITECTURE.md` (or short table in Architecture) | Numbers exist |
| C2 | Dev counters: `listSessions` / title snapshot / prewarm on cold path | Visible in dev |
| C3 | Enforce thrash bans (idle prewarm only; no title poll storm) | Budget met |
| C4 | Optional mock assert on call counts | Regression guard |

**Discipline:** no new `perf(session|cold)` without budget before/after.

### Phase D — Capability shelf + Skills (engineering)

| # | Work | Acceptance |
| --- | --- | --- |
| D1 | Matrix: built-in docs / OfficeCLI / connector / skill / managed CLI × surfaces | `docs/design/` + Architecture pointer |
| D2 | Single registry/config for shelf placement | UI reads config |
| D3 | i18n “vs built-in” once | No orphan copy PRs |
| D4 | Skills: scan priority doc = code; bad skill log/count; install write profile only | listSkills resilient |

**Already landed (keep):** invalid frontmatter skip (#251); Linux desktop unit cases dropped (#254).

### Phase E — Deferred

| Item | Note |
| --- | --- |
| Chrome freeze | Process only; not urgent |
| Linux electron-builder / release feeds | Separate chore |
| Files / Automation feature work | Own roadmaps |
| Heavy harness rewrite | Max: AGENTS one-liners linking Architecture |

---

## 3. PR stack (recommended)

```text
PR1  chore(docs): Architecture SoT hierarchy + platform/skills constraints
     (this branch — docs only)

PR2  docs+app: Expert/session lifecycle hard rules + contract tests
PR3  app: cold-path budget counters + thrash enforcement
PR4  app/desktop: capability shelf matrix + config-driven placement
PR5  server: skills path SoT + bad-skill observability (if not already enough)
```

Do **not** merge product features into PR1. Do **not** stack UI chrome polish on these PRs.

---

## 4. Engineering vs harness

| Concern | Where |
| --- | --- |
| Behavior, APIs, tests | **Engineering** (`apps/*`, `docs/Architecture*`, `docs/design/*`) |
| “No perf PR without budget” | **Light harness** (`AGENTS.md` one line + PR review) |
| Chrome freeze | Harness only, deferred |

---

## 5. Execution order (calendar sketch)

```text
Week 1
  Ship PR1 (docs)
  Draft B1 lifecycle table in Architecture / React ARCHITECTURE
  Start B2–B3

Week 2
  Finish B4–B5
  C1–C3 cold path
  D1 matrix draft

Week 3 buffer
  D2–D4 shelf + skills
  Fix regressions; optional AGENTS discipline lines
```

---

## 6. Checklist for every convergence PR

- [ ] Touches the correct SoT file(s) (Architecture / React ARCHITECTURE / design)
- [ ] No changelog bullets dumped into Architecture
- [ ] Tests for contract changes
- [ ] `git diff --check`; relevant package tests
- [ ] PR description links this plan section (B/C/D)

---

## 7. Revision history

| Date | Note |
| --- | --- |
| 2026-08-09 | Initial plan from PR retrospective + docs scan |
