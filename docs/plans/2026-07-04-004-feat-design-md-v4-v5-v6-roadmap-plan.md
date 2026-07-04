---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: mixed
created: 2026-07-04
name: OnMyAgent DESIGN.md v4 / v5 / v6+ — 3-bucket roadmap plan
---

# OnMyAgent DESIGN.md v4 / v5 / v6+ — Roadmap Plan

## Goal Capsule

**Objective.** v3 shipped canonical-9 parity plus Shapes / Iconography / Iteration / Known Gaps (PR #26). A side-by-side gap analysis against `getdesign.md` + Apple/Vercel/Notion/Figma exemplars surfaced **16 remaining gaps** in 3 buckets. This is a **meta-plan / roadmap**: it does not itself edit `DESIGN.md`; it decides *which gaps ship in which version*, *in which order*, and *which need `ce-brainstorm` first*. It emits three downstream artifacts:

- **v4 plan** (universal UI contracts + governance) — one implementation-ready `ce-plan` doc + one PR, ~400 LOC in DESIGN.md + 1 codemod + 1 CI workflow (human-gated).
- **v5 plan** (OnMyAgent-native signatures) — requires `ce-brainstorm` first for message-role vocabulary + streaming visual contract, then a second `ce-plan` on the brainstorm output.
- **v6+ handoffs** (4 strategic threads) — one paragraph each, pointing at future standalone `ce-brainstorm` sessions.

**Product authority.** Roadmap doc only. No `DESIGN.md`, `apps/**`, or `packages/**` changes in *this* plan's units. Downstream plans (v4 / v5) will follow the same doc-plus-token pattern established by v1–v3.

**Open blockers.** None. User affirmed the A/B/C bucketing in the immediately-preceding turn.

---

## Product Contract

### Problem Frame

DESIGN.md v3 (shipped) covers the 9 canonical getdesign.md sections and the 6 extensions common across exemplars. A follow-up gap pass identified **16 concrete deltas** grouped by risk and provenance:

- **Bucket A — universal UI contracts (5 items).** Loading/empty/error states, perceptual-timing rules (skeleton vs spinner vs progress), toast anatomy, keyboard-shortcut display contract, CJK space budget. High regression risk because these touch every screen; low novelty (every exemplar already documents them).
- **Bucket B — OnMyAgent-native signatures (7 items).** Message role vocabulary (user/assistant/tool-call/tool-output/thinking/system/error), streaming cursor contract, diff/code-block inline styles, tool-approval card anatomy, presence/activity vocabulary (6-state), session-lifecycle color coding, artifact-type palette. No exemplar to copy from — these encode OnMyAgent's identity and require design decisions before drafting.
- **Bucket C — engineering / governance (4 items).** CI gate for `pnpm task check design`, auto-fix codemod for known-mechanical drift, drift baseline (ratchet-down), Storybook/MDX generator from YAML. Low visual risk, mostly infra.
- **Bucket D — strategic threads (4 items).** Data-viz palette, voice & tone, density modes, mobile companion. Each is its own product decision, not a DESIGN.md-shaped write.

### Primary Actor

**Project owner + AI coding agents** consuming this roadmap to decide sequencing. Downstream primary actor (for v4 / v5 plans) remains: AI coding agents authoring UI code, gated by `pnpm task check design`.

### Core Outcome

- **U1** produces `docs/plans/2026-07-XX-005-feat-design-md-v4-*.md`: an implementation-ready plan for **A1–A5 + C13–C15**. Skips C16 (Storybook generator) as separate scope.
- **U2** runs a `ce-brainstorm` session on B-bucket design decisions (message-role palette, streaming cursor, presence-state model, tool-approval anatomy) and produces `docs/plans/2026-07-XX-006-feat-design-md-v5-brainstorm-*.md` (requirements-only unified plan).
- **U3** enriches U2's brainstorm output into `docs/plans/2026-07-XX-007-feat-design-md-v5-*.md` (implementation-ready plan).
- **U4** produces `docs/plans/handoffs/2026-07-04-004-design-md-v6-plus-handoffs.md`: 4 short paragraphs, one per D-item, each with a suggested `ce-brainstorm` prompt and a stub decision list.
- **U5** updates `.loop/state/PROGRESS.md` to reflect v3-shipped / v4-queued / v5-brainstorm-blocked / v6-handoff status.

### Positioning

- **Roadmap doc, not implementation doc.** No token values change here. No `DESIGN.md` edits here. This plan's success is that v4 and v5 can be started without further gap analysis.
- **Anchors on v3.** v3 shipped 6 commits on `codex/design-md-v3` (PR #26 OPEN). v4/v5 assume PR #26 is merged before U1 kicks off — if not, v4 branch stacks on `codex/design-md-v3`.
- **Preserves v1–v3 authority model.** `DESIGN.md > code`, `theme-system.md` narrative, `extract-tokens.mjs` drift detection, `pnpm task check design` gate. v4 tightens the gate; v5 grows the vocabulary; neither re-scopes the authority model.

### Scope

**In scope**
- Emit 3 downstream plan artifacts (v4 plan, v5 brainstorm, v5 plan) + 1 v6+ handoff note + 1 PROGRESS.md update.
- Rationale for bucketing, sequencing, and skip decisions (C16 deferred, D-items handed off).

**Out of scope**
- Any change under `apps/**`, `packages/**`, `DESIGN.md`, `theme-system.md`, `AGENTS.md`, `extract-tokens.mjs`, or preview HTML.
- Landing v4 / v5 code — those are downstream plan units.
- Deciding *values* for B-bucket vocabularies (e.g. what color is `tool-call` — that is `ce-brainstorm` output, not roadmap output).

---

## Key Technical Decisions

**KTD1. v4 bundles A (universal UI) + C-lite (governance).** Both are low-novelty / high-value / mechanically-verifiable. Bundling saves one PR round-trip and lets the CI gate land alongside the contracts it will enforce. Rejected alternative: ship A as v4 and C as v5 — rejected because C has no design decisions and would idle waiting on B-brainstorm.

**KTD2. v5 blocks on `ce-brainstorm` first.** B-bucket items (message roles, streaming cursor, presence states, tool-approval anatomy) are not plan-time decisions — they are *product* decisions that need option enumeration, exemplar comparison, and owner approval. Writing v5 as a direct `ce-plan` would either invent values (bad) or stall the plan (worse). Split: U2 = brainstorm (produce requirements), U3 = plan (produce implementation).

**KTD3. v6+ handed off as brainstorm stubs, not planned.** D-items (data-viz palette, voice/tone, density modes, mobile companion) each cross into product / brand / platform decisions well beyond DESIGN.md's contract surface. A single roadmap plan cannot pre-decide them. Handoff = one paragraph + a suggested `ce-brainstorm` prompt each; no `ce-plan` doc produced here.

**KTD4. C16 (Storybook / MDX generator) deferred out of v4.** Preview HTML in `docs/design/preview.html` + `preview-dark.html` already covers the visual demo need. A generator adds a Storybook toolchain, MDX pipeline, and a new build target — that is v6+ tooling scope, not a v4 governance hardening. Filed as its own future plan; no U-ID here.

**KTD5. Auto-fix codemod (C14) lives at `scripts/design/codemod/`, separate from `extract-tokens.mjs`.** `extract-tokens.mjs` is a read-only reporter; mixing write behavior into it would break the v2 contract that the report is safe to run anytime. New file: `scripts/design/codemod/fix-tokens.mjs`. Wired as `pnpm task design codemod` (new task subcommand) or via `--fix` flag on a new script — decided in v4 U-work.

**KTD6. CI gate (C13) is `.github/workflows/design-check.yml` — human-gated in AGENTS.md.** `.github/workflows/**` is human-gate per repo rules. v4 plan must explicitly call out that this file requires user approval before landing. Content: runs `pnpm task check design -- --strict` on PRs that touch `DESIGN.md`, `docs/design/**`, `scripts/design/**`, or `apps/app/src/app/index.css`.

**KTD7. Drift baseline (C15) shape mirrors `scripts/checks/baselines/forbidden-types.json`.** Existing pattern in repo: `{ "<file>": { "count": N, "signatures": [...] } }`, ratchet-down-only, PR fails if any count grows. New file: `scripts/checks/baselines/design-drift.json`. v4 seeds it from the 76 drift entries currently reported on clean tree; each PR must reduce the baseline or leave it unchanged.

**KTD8. B-bucket brainstorm scope-fences: exactly 4 questions, not 7.** B has 7 gap items but only 4 need brainstorm-level design decisions:
- Message role palette + typography (covers B6)
- Streaming cursor visual + timing (covers B7)
- Presence / activity 6-state vocabulary (covers B10)
- Tool-approval card anatomy + danger band (covers B9)
The remaining 3 (B8 diff/code-block, B11 session-lifecycle variants, B12 artifact palette) can be *drafted* directly in v5 by extending existing patterns and do not need brainstorm — they reference already-decided tokens.

---

## Gap Inventory — 16 items

### Bucket A · Universal UI Contracts (v4, high regression risk)

- **A1. Loading / Empty / Error / Success state machine.** Per-state anatomy: content, illustration slot (or none), CTA, secondary action. Applies to every list, panel, and dialog. Every exemplar carries this.
- **A2. Skeleton vs Spinner vs Progress vs direct-content thresholds.** Perceptual timing: `<200ms` render nothing (no flash), `200ms–1s` spinner, `>1s` skeleton with shape parity, predictable-progress uses `progress` element. Currently agents pick arbitrarily.
- **A3. Toast / Notification anatomy.** Position (top-right for macOS-style, bottom-center for actionable — decide one), duration by severity (info 4s, success 4s, warn 6s, error persistent-until-dismissed), stack cap (5), severity color mapping via existing `semantic.*` tokens, dismissible affordance.
- **A4. Keyboard shortcut display contract.** `kbd` chip visual (border, padding, typography), platform token (`⌘K` vs `Ctrl+K` — driven by `navigator.platform`, not hardcoded), spacing between chips (` + ` vs adjacency), where allowed (command palette, menus, tooltips).
- **A5. CJK space budget.** i18n system exists but no design contract for label max-width or truncation. Chinese ≈30% shorter than English at same rendered width; buttons and menu labels currently overflow or align badly. Contract: reserve English width as budget; document Chinese-specific line-height bump for CJK-mixed lines.

### Bucket B · OnMyAgent-Native Signatures (v5, needs brainstorm)

- **B6. Message role vocabulary.** 7 roles — `user`, `assistant`, `tool-call`, `tool-output`, `thinking`, `system`, `error`. Each needs: surface color (from `surface.*`), typography variant, left-border accent color, prefix icon or label. Highest-identity decision in the entire design system.
- **B7. Streaming state visual contract.** Cursor glyph (block vs beam vs pulse), blink frequency (motion tokens already exist — reuse `duration-fast` + `easing-linear`?), fallback when stream pauses (>1s no token = ellipsis? spinner? nothing?).
- **B8. Diff / code-block inline styles.** Diff line prefixes `+`/`-` in gutter, line numbers optional, addition/removal background using `semantic.success/danger` at low alpha, collapsible chunk affordance for large diffs. Mono font family is a **Known Gap** in v3 (deferred) — v5 can define usage without picking the font.
- **B9. Tool / approval card anatomy.** Tool name (mono), parameter summary (mono, truncated), danger band (border-left) driven by tool risk classification, approve / deny button pair (danger-secondary + primary), diff preview slot when tool writes files.
- **B10. Presence / activity vocabulary.** v3 has `online` + `signal` only. Need 6-state: `idle`, `typing`, `running`, `paused`, `disconnected`, `errored`. Each with color + optional micro-animation reference.
- **B11. Session lifecycle color coding.** `SessionCard` variants: `active` (default), `archived` (dimmed), `shared` (accent border), `read-only` (muted + lock glyph). Uses existing tokens; no new colors.
- **B12. Artifact type palette.** § 11 Intentional Exceptions allows raw color for artifacts but enumerates no types. Need explicit list: `image`, `code`, `document`, `data`, `plot`, `3d`, `audio`, `video` — each with a border-accent color from an "artifact-hue" sub-palette that does not leak into semantic use.

### Bucket C · Engineering / Governance (v4-lite, lowest risk)

- **C13. CI gate for `pnpm task check design`.** GitHub Action `design-check.yml`, runs `--strict`, triggered on PRs touching design-adjacent paths. **Human-gated file per AGENTS.md.**
- **C14. Auto-fix codemod.** `scripts/design/codemod/fix-tokens.mjs`. Mechanical replacements: `text-[13px] → text-sm`, `size={13} → SIZES.sm`, hardcoded `#hex` in known-tokenized paths → `hsl(var(--dls-*))`. Dry-run by default, `--write` to apply.
- **C15. Drift baseline.** `scripts/checks/baselines/design-drift.json`. Seeds from current 76-entry drift report. Ratchet-down-only enforcement in `extract-tokens.mjs` when run with `--baseline`.
- **C16. Storybook / MDX generator (DEFERRED).** Not in v4. Filed as future scope. Preview HTML remains the demo surface.

### Bucket D · Strategic Threads (v6+, handoff only)

- **D-i. Data-viz / chart palette.** Categorical + sequential + diverging scales. Needs product input on which chart libraries land in-app.
- **D-ii. Voice & tone.** Copy guidelines — assistant persona, error phrasing, empty-state messaging. Content-design decision, cross-team.
- **D-iii. Density modes.** Compact / comfortable / spacious. Requires user research on primary workflows before token forks.
- **D-iv. Mobile companion.** Not on roadmap yet; DESIGN.md today is Electron-desktop-only. Handoff notes future breakpoint work.

---

## Implementation Units

### U1. Write v4 implementation plan (A1–A5 + C13–C15)

**Deliverable.** `docs/plans/2026-07-XX-005-feat-design-md-v4-universal-plus-governance-plan.md`.

**Shape.** Depth = Standard. Follows v3 plan structure (frontmatter + Goal Capsule + Product Contract + KTDs + Implementation Units + Test Strategy + Rollback). Target ~500 lines.

**Units inside v4 (preview, refined at U1 time):**
- Section additions to `DESIGN.md`:
  - `## 4a. State Machines` — new sub or top-level: Loading / Empty / Error / Success anatomy (A1) + timing thresholds (A2).
  - `## 4b. Notifications` — toast anatomy, positions, duration, stack cap (A3).
  - `## 5a. Keyboard Contract` — kbd chip spec, platform mapping (A4).
  - `## 9a. Internationalization Space Budget` — under Responsive & Platform, CJK label width contract (A5).
- YAML additions: `state-timings:` block (`instant/short/long` ms thresholds), `notifications:` block (`stack-cap`, `duration-*` by severity), `kbd:` block (chip padding + separator convention).
- `scripts/design/extract-tokens.mjs` — extend R11 with 3 new diffs (state-timings usage in loading skeleton components, notifications usage in `Toaster.tsx`, kbd usage in `KbdChip.tsx` if it exists — else scoped to command-palette component).
- `scripts/design/codemod/fix-tokens.mjs` **(C14, new file)** — dry-run replacement engine, 3 rule families (numeric text-size, numeric icon-size, hardcoded hex in tokenized paths). Baseline seed loader for C15.
- `scripts/checks/baselines/design-drift.json` **(C15, new file)** — seed from `pnpm task check design` output on the tip of `codex/design-md-v3`. Ratchet-down enforcement lands in extract-tokens.
- `.github/workflows/design-check.yml` **(C13, human-gate)** — CI workflow. v4 U-work must announce this file explicitly before writing.
- Preview HTML additions: state-machine grid (loading/empty/error/success), toast stack demo, kbd chip row.
- Cross-doc updates: `theme-system.md` pointer to state machines; `AGENTS.md` UI rule references A4 kbd contract (already partially covered — extend).

**Estimated size.** ~400 LOC in `DESIGN.md`, ~200 LOC codemod, ~20 LOC baseline JSON (seeded from real drift), ~40 LOC CI YAML, ~150 LOC preview additions. Total ~1000 lines across 7 files. Single PR.

**Branch.** `codex/design-md-v4`, off `main` after PR #26 merges. If #26 still open at kickoff, stack on `codex/design-md-v3`.

**Prerequisites.** PR #26 (v3) merged **or** explicit user go-ahead to stack. No brainstorm needed — every A/C item has an obvious answer from the exemplar side-by-side.

**Verification.** `pnpm check:type` + `pnpm task check design -- --strict` (should still pass on clean tree — baseline seeded to current drift) + `git diff --check`.

### U2. `ce-brainstorm` for v5 (B-bucket design decisions)

**Deliverable.** `docs/plans/2026-07-XX-006-feat-design-md-v5-brainstorm-plan.md` — requirements-only unified plan (no implementation units yet).

**Brainstorm scope (4 questions, per KTD8).**
- Q1. Message role palette. 7 roles × 4 attributes (surface / typography / border accent / prefix) = 28 decisions. Compare against Claude Desktop / ChatGPT / Cursor / Zed exemplars.
- Q2. Streaming cursor. Glyph choice (block/beam/pulse/inline-ellipsis), blink cadence, pause fallback.
- Q3. Presence 6-state. Color + micro-motion per state; whether to reuse `semantic.*` or introduce `presence.*` sub-palette.
- Q4. Tool-approval card. Danger classification thresholds, param-summary truncation length, diff-preview inclusion rule.

**Explicit non-questions.** B8 (diff/code-block), B11 (session-lifecycle), B12 (artifact palette) are pattern-application, not decision. They go straight into v5 draft.

**Estimated brainstorm duration.** One `ce-brainstorm` session, ~45 min if owner responsive. Produces a requirements doc with option matrices + one chosen option per question.

### U3. `ce-plan` for v5 (B-bucket implementation, enriched from U2)

**Deliverable.** `docs/plans/2026-07-XX-007-feat-design-md-v5-agent-native-signatures-plan.md`.

**Depth.** Standard. ~550 lines.

**Units inside v5 (preview):**
- `DESIGN.md` additions:
  - `## 4c. Message Roles` — 7-role table, tokens for each, prefix conventions.
  - `## 4d. Streaming Presentation` — cursor + pause fallback + reduced-motion behavior.
  - `## 4e. Code & Diff` — inline diff styles; mono font remains a Known Gap.
  - `## 4f. Tool Approval` — card anatomy + danger classification.
  - `## 4g. Presence & Activity` — 6-state vocabulary.
  - Extend Signature Components: `SessionCard` variants (B11), Artifact palette (B12) with a new `artifact-hue.*` sub-palette in Colors.
- YAML additions: `message-roles:`, `streaming:`, `presence:`, `artifact-hue:`.
- `extract-tokens.mjs` — 5 new diffs (roles, streaming, presence, tool-approval usage, artifact-hue).
- Preview HTML: chat transcript demo showing all 7 roles + streaming state + tool-approval card + presence badges + artifact cards.
- Cross-doc: `theme-system.md` gains "Agent-native identity" section pointer.

**Prerequisites.** U2 brainstorm complete + owner-approved. v4 landed (so v5 lands on top of the tightened governance gate, not around it).

**Estimated size.** ~600 LOC `DESIGN.md`, ~150 LOC extract-tokens extensions, ~200 LOC preview additions. Single PR.

**Branch.** `codex/design-md-v5`.

### U4. Write v6+ handoff notes (4 D-items)

**Deliverable.** `docs/plans/handoffs/2026-07-04-004-design-md-v6-plus-handoffs.md` (new `handoffs/` sub-dir if not present).

**Shape.** 4 sections, one paragraph each. Each contains: problem statement (1 sentence), why it needs brainstorm not plan (1 sentence), suggested `ce-brainstorm` opening prompt (2–3 sentences), stub decision list (3–5 bullets), rough token/YAML block name it would introduce.

**Items.**
- D-i. Data-viz palette — needs product input on chart libraries first.
- D-ii. Voice & tone — cross-team content design decision.
- D-iii. Density modes — needs user research on primary workflows.
- D-iv. Mobile companion — needs product decision on whether OnMyAgent goes mobile at all.

**Estimated size.** ~120 LOC in one file. No PR — commit directly on `main` or the current roadmap branch depending on where U5 lands.

### U5. Update `.loop/state/PROGRESS.md`

**Deliverable.** Edit `.loop/state/PROGRESS.md` (local, not committed) with:
- v3 status: shipped, PR #26 OPEN.
- v4 status: planned (see `2026-07-XX-005-*.md`), blocked on PR #26 merge.
- v5 status: brainstorm-required (see `2026-07-XX-006-*.md`), plan follows.
- v6+ status: handed off (see `docs/plans/handoffs/2026-07-04-004-*.md`).
- Roadmap doc pointer to *this* file.

**No verification needed** (local-only file).

---

## Sequencing

```text
[v3 shipped, PR #26 OPEN]
        │
        ▼
[U1 · write v4 plan]  ── can start now (does not touch v3 branch)
        │
        │        [U2 · v5 brainstorm]  ── can run in parallel with U1
        │                │
        ▼                ▼
[v4 PR merges]  ──►  [U3 · write v5 plan]
        │                │
        │                ▼
        └────────► [v5 PR merges]
                         │
                         ▼
                  [U4 · v6+ handoff notes]  ── can run any time after v5 branch cut
                         │
                         ▼
                  [U5 · PROGRESS.md refresh]
```

**Critical path.** U1 → v4 PR review → v4 merge. Everything else parallelizes.

**Parallel-safe.** U2 brainstorm runs alongside U1. U4 handoff notes can be written the moment U3 exists (no dependency on v5 merging).

---

## Test / Verification Strategy

This roadmap plan produces **documents only**. Verification per unit:

- **U1 output** (v4 plan doc). Verify by reading against v3 plan structure — must have all v3 sections (frontmatter, Goal Capsule, Product Contract with Problem Frame + Primary Actor + Core Outcome + Positioning + Scope, KTDs, Implementation Units, Test Strategy, Rollback). Verify U-IDs are sequential from U1. Verify each U has explicit file paths and estimated size.
- **U2 output** (v5 brainstorm doc). Verify has 4 option matrices (one per Q1–Q4), each with ≥3 options + owner-chosen answer. Verify explicit non-question list (B8/B11/B12).
- **U3 output** (v5 plan doc). Verify inherits U2 decisions verbatim (no re-deciding). Verify U-IDs sequential. Verify preview HTML additions listed.
- **U4 output** (handoff notes). Verify 4 sections, each with all 5 required fields (problem, why-brainstorm, prompt, decisions, token block).
- **U5 output** (PROGRESS.md). Verify 5 status lines exist and point at correct plan filenames.

**No `pnpm` commands run at this roadmap-plan level.** Downstream plans (v4 / v5) carry their own `pnpm check:type` + `pnpm task check design` verification.

---

## Risk & Rollback

- **R1. v4 CI gate lands broken.** Mitigation: v4 U-work runs `pnpm task check design -- --strict` locally before pushing; CI workflow file is human-gated so owner sees it before merge. Rollback: revert `.github/workflows/design-check.yml` only — DESIGN.md content stays.
- **R2. Codemod (C14) rewrites too aggressively.** Mitigation: dry-run by default; `--write` opt-in; v4 U-work only seeds the *rules*, does not run codemod as part of the PR.
- **R3. Drift baseline (C15) gets misseeded.** Mitigation: seed from a clean `codex/design-md-v3` HEAD, not from an in-progress branch; document seed command in v4 plan.
- **R4. v5 brainstorm stalls waiting on owner input.** Mitigation: U2 has an explicit 4-question shape; if owner unresponsive >72h, degrade to "agent proposes defaults + owner confirms via PR review" mode. Document that fallback in U2 output.
- **R5. Roadmap drifts before v4 lands.** Mitigation: this doc is versioned via git; any material re-scope adds a suffix (`-v2`) plan doc rather than editing in place.
- **R6. v6+ handoffs never happen.** Acceptable outcome. D-items are strategic; they wait for product signal. This plan's job is only to record them so they don't get lost.

**Full rollback.** `git rm docs/plans/2026-07-04-004-feat-design-md-v4-v5-v6-roadmap-plan.md` — this is a doc-only plan with no side effects.

---

## Out-of-Scope (explicit)

- Deciding token values for any A/B/C/D item — that happens in downstream plans.
- Editing `DESIGN.md`, `theme-system.md`, `AGENTS.md`, `extract-tokens.mjs`, or any preview HTML.
- Landing v4 or v5 code.
- Building the Storybook / MDX generator (C16).
- Any change to `apps/**`, `packages/**`, or `.github/workflows/**`.

---

## Handoff Summary

This roadmap plan is complete when:
1. This file exists on disk (✓ once U1–U5 outputs are emitted as separate docs).
2. Reader can start `ce-plan` for v4 without re-doing gap analysis.
3. Reader can start `ce-brainstorm` for v5 with the 4 questions already framed.
4. Reader knows which items belong to v6+ and why they wait.
