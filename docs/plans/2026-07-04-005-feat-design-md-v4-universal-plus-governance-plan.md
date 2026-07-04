---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-07-04
name: OnMyAgent DESIGN.md v4 — universal UI contracts + governance
---

# OnMyAgent DESIGN.md v4 — Plan

## Goal Capsule

**Objective.** Land the two low-risk / high-value buckets flagged by the v3→v4 gap analysis: **A. Universal UI contracts (state machines, perceptual timing, notifications, keyboard-shortcut display, CJK space budget)** and **C-lite. Governance (CI gate, auto-fix codemod, drift baseline)**. v4 does not touch OnMyAgent-native identity (that's v5) and does not add tooling scope beyond a single codemod + one CI workflow (that defers Storybook C16 out of v4).

**Product authority.** Adds four new sections to `DESIGN.md` (`## 4a. State Machines`, `## 4b. Notifications`, `## 5a. Keyboard Contract`, `## 9a. Internationalization Space Budget`), three new YAML blocks (`state-timings:`, `notifications:`, `kbd:`), one new codemod script (`scripts/design/codemod/fix-tokens.mjs`), one new baseline JSON (`scripts/checks/baselines/design-drift.json`), and one new CI workflow (`.github/workflows/design-check.yml`, human-gated). Extends `scripts/design/extract-tokens.mjs` with three more diff extractors + baseline enforcement.

**Open blockers.** PR #26 (v3) is OPEN. v4 branches off `codex/design-md-v3` if #26 not yet merged at kickoff; otherwise off `main`.

---

## Product Contract

### Problem Frame

v3 shipped canonical-9 parity plus Shapes / Iconography / Iteration / Known Gaps. The v3→v4 gap analysis identified 5 universal UI contracts every design-system exemplar carries but OnMyAgent still leaves implicit:

- **State semantics are ad-hoc.** Loading / empty / error / success states are drawn per-screen with no shared anatomy. Skeleton vs spinner vs progress is picked by whoever writes the component. There is no perceptual-timing rule (e.g. `<200ms` shows nothing to avoid flash) — every agent-authored screen invents its own thresholds.
- **Toast has no contract.** `apps/app/src/**` uses `sonner` today but stack cap, duration by severity, position, and dismissibility are not tokenized. Users see 10 toasts stack on error bursts; success toasts persist as long as error toasts.
- **Keyboard hints render inconsistently.** Command palette shows `⌘K`, menus show `Cmd+K`, tooltips show plain text `K`. There is no `kbd` chip primitive with an agreed platform-aware label.
- **CJK budget silently overflows.** i18n is enforced (AGENTS.md rule) but at rendered width Chinese labels are ~30% shorter than English, so buttons look under-filled and menus mis-align. No contract exists.

Alongside these five visual gaps, three governance gaps let drift creep back:

- **No CI gate.** `pnpm task check design` runs locally, not on PRs. A contributor can land a `text-[13px]` that DESIGN.md forbids and the PR review misses it.
- **No auto-fix.** The 76 drift entries currently reported are all mechanical (numeric text-size, numeric icon-size, occasional hardcoded hex). Each one is a manual replace today. A codemod eliminates the tedium and unblocks ratchet-down.
- **No ratchet baseline.** Any regression is currently either "0 drift" (blocking) or "everything allowed" (report-only). We need the `forbidden-types.json` pattern: freeze current count, forbid growth, encourage reduction.

### Primary Actor

**AI coding agents** authoring UI code. Secondary: **project owner** reviewing PRs, running `pnpm task check design --strict`, and merging.

### Core Outcome

- `DESIGN.md` gains 4 new sub/top-level sections and 3 new YAML blocks; v3-shipped content untouched.
- `extract-tokens.mjs` gains 3 more extractors (state-timings usage, notifications usage, kbd usage) + baseline-aware diffing (`--baseline scripts/checks/baselines/design-drift.json`).
- `scripts/design/codemod/fix-tokens.mjs` (new) can dry-run + `--write` 3 rule families and reduce the 76-entry drift baseline.
- `scripts/checks/baselines/design-drift.json` (new) seeded from clean `codex/design-md-v3` HEAD, ratchet-down enforcement.
- `.github/workflows/design-check.yml` (new, human-gated) runs `--strict` on design-adjacent PRs.
- Preview HTML gains state-machine grid + toast stack demo + kbd chip row.
- `theme-system.md` gets pointer sentences for the new sections; `AGENTS.md` UI rule references the kbd contract.

### Positioning

v4 is the "housekeeping" release: no new identity, no new component vocabulary, no new tokens for anything visually novel. It hardens the contract surface (governance) and closes the universal-UI blank spots that every mature design system covers. v5 will build agent-native identity on top of the v4 governance floor.

### Scope

**In scope**
- 4 new `DESIGN.md` sections + 3 new YAML blocks.
- 3 new extract-tokens extractors + baseline-aware diffing.
- 1 new codemod script.
- 1 new baseline JSON file, seeded from real drift.
- 1 new CI workflow file (human-gate: announce before writing).
- Preview HTML additions for the new contracts.
- Cross-doc pointer updates in `theme-system.md` + `AGENTS.md`.

**Out of scope**
- Any B-bucket item (message roles, streaming, presence, tool-approval, session-lifecycle, artifact palette) — v5.
- Storybook / MDX generator (C16) — deferred, filed as future scope.
- Any change to `apps/**` runtime code except a possible tiny `KbdChip.tsx` primitive if v3 doesn't already have one (announced separately at U-work).
- Codemod `--write` runs as part of the PR — codemod ships but is not applied in this PR.

---

## Key Technical Decisions

**KTD1. State-timing thresholds anchor to human perceptual research, not aesthetic taste.** `<200ms` = render nothing (below the flash threshold, matches RAIL / Nielsen's 0.1s "instantaneous"), `200ms–1s` = spinner (below Nielsen's 1s "seamless"), `>1s` = skeleton with shape parity (above 1s the user's attention shifts; give them layout so eyes settle), predictable-progress uses `<progress>` element. YAML: `state-timings: { instant-ms: 200, short-ms: 1000, long-ms: 10000 }`.

**KTD2. Toast position = top-right on desktop.** Matches macOS notification convention and stays out of the way of the chat input at the bottom. Bottom-center considered — rejected because it collides with the assistant streaming region on the primary surface. Stack cap = 5 (older toasts drop out silently, not push-up). Duration = `info: 4s`, `success: 4s`, `warn: 6s`, `error: persistent`. Reduced-motion respected (no slide-in — fade only).

**KTD3. Keyboard chip is platform-aware at render, not at author time.** DESIGN.md documents that authors write `⌘K` and the runtime substitutes `Ctrl+K` on Windows / Linux via a small helper. Reason: content stays declarative, no if-platform-else forks in JSX. The helper (`formatShortcut(key)`) is out-of-scope for v4 code (v5 or later), but the *contract* lands in v4.

**KTD4. CJK contract = English width is the label budget.** Design at English rendered width; Chinese naturally fits at ~70%. Never re-design at Chinese width or English will overflow. Line-height bump for CJK-mixed lines: `line-height: 1.6` when any CJK glyph present (v4 declares the rule; enforcement remains in Tailwind class discipline, not new tokens).

**KTD5. Codemod ships as a script, not integrated into `extract-tokens.mjs`.** `extract-tokens.mjs` is read-only by v2 contract. New file `scripts/design/codemod/fix-tokens.mjs` with three rule families: (a) `text-[13px]` → `text-sm` mapping table driven by YAML `text-sizes` block, (b) `size={13}` on Lucide icons → `SIZES.sm` constant import + prop replacement, (c) hardcoded `#hex` in already-tokenized files → `hsl(var(--dls-*))` when the hex has a known mapping. Dry-run default, `--write` opt-in, `--report-json` for CI.

**KTD6. Baseline JSON shape mirrors `forbidden-types.json`.** File: `scripts/checks/baselines/design-drift.json`. Shape: `{ "<extractor-name>": { "<file>": { "count": N, "signatures": ["text-[13px]:apps/app/src/foo.tsx:42", ...] } } }`. Enforcement in `extract-tokens.mjs`: if `--baseline <path>` is passed, drift is compared against baseline; any *new* signature (not in baseline) fails; any count *exceeding* baseline fails; count reduction is silently accepted. Manual baseline rewrite is possible but discouraged (documented in Iteration Guide).

**KTD7. CI workflow lives at `.github/workflows/design-check.yml` — HUMAN-GATED.** AGENTS.md flags `.github/workflows/**` as human-gate. v4 U-work will announce this file explicitly before creating it, provide the full YAML for review, and ask for user confirmation before committing. Trigger: `pull_request` on paths `DESIGN.md`, `docs/design/**`, `scripts/design/**`, `apps/app/src/app/index.css`, `scripts/checks/baselines/design-drift.json`. Job: install pnpm, restore cache, `pnpm task check design -- --strict --baseline scripts/checks/baselines/design-drift.json`. Node version from `.nvmrc`.

**KTD8. Preview HTML additions go in the existing `preview.html` + `preview-dark.html`.** No new preview files. Three new sections: state-machine grid (loading skeleton / empty state illustration slot / error card / success confirmation), toast stack demo (info + success + warn + error, top-right positioned in a mocked window), kbd chip row (⌘K, ⌘⇧P, ⌥1, arrow-key hints, chord notation).

**KTD9. `KbdChip` component decision deferred.** v4 documents the visual contract; it does not require a new `apps/app/src/**` primitive to exist. If a `KbdChip.tsx` already lives in the code (check at U-work start), v4 references it and adds token-check coverage. If not, v4 leaves a note in Known Gaps: "kbd chip visual defined; primitive implementation pending — inline Tailwind acceptable until v5 or later".

---

## Requirements

- **R1. New `## 4a. State Machines` section in DESIGN.md.** Placed after `## 4. Component Stylings`. Contains:
  - `### Anatomy` — 4 canonical states (Loading / Empty / Error / Success) with per-state slots (icon or illustration slot / heading / body / primary CTA / secondary action).
  - `### Perceptual Timing` — 3-band threshold table driven by `state-timings:` YAML.
  - `### Skeleton vs Spinner vs Progress` — decision tree: predictable duration → progress; short indeterminate → spinner; long indeterminate → skeleton; below `instant-ms` → render nothing.
- **R2. New `## 4b. Notifications` section.** After `## 4a`. Contains:
  - `### Toast Anatomy` — surface color (semantic.* per severity), icon slot, title, body, dismiss glyph.
  - `### Position & Stacking` — top-right, stack cap 5, oldest drops silently.
  - `### Duration by Severity` — mapped to `notifications.duration-*` YAML tokens.
  - `### Motion` — slide-in-from-right + fade; reduced-motion = fade-only, no slide.
- **R3. New `## 5a. Keyboard Contract` section.** Placed after `## 5. Typography` (or at end of `## 5`). Contains:
  - `### `kbd` Chip Visual` — border, padding, typography scale, radius (from `rounded.sm`), background surface.
  - `### Platform Mapping` — author writes `⌘K`, runtime substitutes on non-mac; documents the intended helper signature `formatShortcut(key: string, platform?: Platform): string`.
  - `### Where Allowed` — command palette (mandatory), menus (allowed), tooltips (allowed), inline body copy (discouraged).
  - `### Chord Notation` — ` + ` separator with hair-space, e.g. `⌘ + ⇧ + P`.
- **R4. New `## 9a. Internationalization Space Budget` section.** Under `## 9. Responsive & Platform`. Contains:
  - `### CJK vs Latin` — design at English width; Chinese fits at ~70% naturally.
  - `### Truncation` — labels: ellipsis at container edge; body: no truncation; button labels: never wrap.
  - `### Line-Height` — `line-height: 1.6` on any line containing CJK glyphs; Latin-only lines keep `1.5`.
- **R5. New YAML `state-timings:` block** in DESIGN.md front matter — `instant-ms: 200`, `short-ms: 1000`, `long-ms: 10000`.
- **R6. New YAML `notifications:` block** — `stack-cap: 5`, `position: top-right`, `duration-info-ms: 4000`, `duration-success-ms: 4000`, `duration-warn-ms: 6000`, `duration-error: persistent`.
- **R7. New YAML `kbd:` block** — `separator: " + "`, `separator-uses-hair-space: true`, `chip-padding-x-px: 4`, `chip-padding-y-px: 2`, `chip-radius: rounded.sm`, `platform-substitution: runtime`.
- **R8. `extract-tokens.mjs` new extractors** (3):
  - `diffStateTimings` — greps for `setTimeout(.., N)` and `Promise` deferrals in `apps/app/src/**/*.{ts,tsx}` where N ∈ suspicious range (150–1200); reports drift when N ∉ {200, 1000, 10000}. Best-effort regex; report-only unless in baseline.
  - `diffNotifications` — scans `sonner` calls in `apps/app/src/**/*.{ts,tsx}`, checks duration prop against `notifications.duration-*`; reports missing severity mapping.
  - `diffKbd` — scans JSX for `<kbd>` and Tailwind class strings containing `kbd`; reports usages not wrapped in the documented chip anatomy (border + padding + text-xs).
- **R9. `extract-tokens.mjs` baseline mode.** New CLI flag `--baseline <path>`. Loads JSON, compares extractor output: fails on new signatures + count growth; accepts count reduction. Baseline path threaded through `pnpm task check design -- --baseline …`.
- **R10. New file `scripts/design/codemod/fix-tokens.mjs`.** CLI: `node scripts/design/codemod/fix-tokens.mjs [--write] [--only=rule] [--report-json <path>]`. Three rule families:
  - `text-numeric` — arbitrary Tailwind text sizes `text-[Npx]` → nearest named token from `typography.text-sizes` YAML.
  - `icon-numeric` — Lucide icon `size={N}` → `size={SIZES.xs|sm|base|lg|xl}` via mapping (12→xs, 14→sm, 16→base, 20→lg, 24→xl).
  - `hardcoded-hex` — `#RRGGBB` literals in `apps/app/src/**/*.{ts,tsx,css}` when the hex has an exact match in the design token registry → `hsl(var(--dls-*))`.
  Dry-run prints unified diff. `--write` applies. `--report-json` emits machine-readable summary for CI.
- **R11. New file `scripts/checks/baselines/design-drift.json`.** Seeded from `pnpm task check design` output on the tip of `codex/design-md-v3`. Shape per KTD6. Committed with initial 76-entry inventory (49 numeric icon-sizes + 20 numeric text-sizes + 7 hardcoded z-layer CSS entries; exact counts re-verified at U-work).
- **R12. New file `.github/workflows/design-check.yml` — HUMAN-GATED.** Content preview:
  ```yaml
  name: design-check
  on:
    pull_request:
      paths:
        - "DESIGN.md"
        - "docs/design/**"
        - "scripts/design/**"
        - "apps/app/src/app/index.css"
        - "scripts/checks/baselines/design-drift.json"
  jobs:
    check:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
        - uses: actions/setup-node@v4
          with:
            node-version-file: .nvmrc
            cache: pnpm
        - run: pnpm install --frozen-lockfile
        - run: pnpm task check design -- --strict --baseline scripts/checks/baselines/design-drift.json
  ```
  U-work must announce this file, show final YAML, and wait for user confirmation before writing.
- **R13. Preview HTML additions.** In `docs/design/preview.html` + `preview-dark.html`:
  - State-machine grid section — 4 mocked cards (loading skeleton with shape-parity blocks, empty state with icon slot + CTA, error card with retry CTA, success confirmation with dismiss).
  - Toast stack demo — mocked window with 4 stacked toasts in top-right at info / success / warn / error variants.
  - Kbd chip row — `⌘K`, `⌘ + ⇧ + P`, `⌥1`, arrow-key sequence.
- **R14. Cross-doc pointer updates.**
  - `docs/design/theme-system.md` — pointer sentence under narrative: "State semantics, notification anatomy, keyboard-shortcut display, and CJK space budget are defined in `DESIGN.md` §§ 4a, 4b, 5a, 9a."
  - `AGENTS.md` — extend the UI rule bullet: "keyboard shortcuts render via the DESIGN.md § 5a kbd chip contract, platform-substituted at runtime, not authored per platform".
- **R15. Path allowlist and human-gate compliance.**
  - Allowlist edits: `DESIGN.md`, `docs/design/**`, `scripts/design/**`, `scripts/checks/baselines/**`, `AGENTS.md`.
  - Human-gate edits: `.github/workflows/design-check.yml`. Announce before writing.
  - No `apps/**` runtime edits in this PR.

**Out-of-scope (deferred to v5 or beyond)**
- Message role vocabulary, streaming, presence, tool-approval — v5.
- Storybook / MDX generator — filed post-v5.
- `formatShortcut()` helper implementation in `apps/app/src/**` — v5 or later.
- Codemod `--write` execution as part of the PR — the codemod ships dry-run only.

---

## Implementation Units

### U1. DESIGN.md — new sections 4a / 4b / 5a / 9a

**Files.** `DESIGN.md`.

**Actions.**
1. Append `## 4a. State Machines` after `## 4. Component Stylings`; renumber later sections if numbering conflict emerges (v3 uses `## 5. Typography` next — insert `## 4a` cleanly without renumbering; heading `4a` documented as a sub-major intentional).
2. Append `## 4b. Notifications` after `## 4a`.
3. Append `## 5a. Keyboard Contract` after `## 5. Typography`.
4. Append `## 9a. Internationalization Space Budget` inside `## 9. Responsive & Platform`.
5. Update `## 14. Known Gaps` — remove items now covered (state semantics, toast, kbd, CJK), leave the rest (data-viz palette, voice/tone, brand assets, mobile companion, mono font family, CI gate — this last one moves to "landed in v4" line).

**Est.** ~350 LOC in DESIGN.md.

**Verify.** `pnpm task check design` (no `--strict` yet — baseline not seeded). `git diff --check`.

### U2. DESIGN.md — new YAML blocks

**Files.** `DESIGN.md` (front-matter YAML region).

**Actions.**
1. Add `state-timings:` block with `instant-ms: 200`, `short-ms: 1000`, `long-ms: 10000`.
2. Add `notifications:` block per R6.
3. Add `kbd:` block per R7.
4. Add flags: `notifications-tokenized: required`, `state-timings-tokenized: required`, `kbd-tokenized: required`.

**Est.** ~40 LOC YAML additions.

**Verify.** YAML parse round-trip (extract-tokens loads without error).

### U3. `extract-tokens.mjs` — 3 new extractors + baseline mode

**Files.** `scripts/design/extract-tokens.mjs`.

**Actions.**
1. Add `diffStateTimings(files, tokens)` — regex `setTimeout\([^,]+,\s*(\d+)\)` + `new Promise(r => setTimeout(r, (\d+)))` in `apps/app/src/**/*.{ts,tsx}`; report values in `[150, 1200]` not in `{200, 1000, 10000}`.
2. Add `diffNotifications(files, tokens)` — regex `sonner|toast\.(info|success|warning|error)` + `duration:\s*(\d+)`; report missing / non-matching duration.
3. Add `diffKbd(files, tokens)` — regex `<kbd[\s>]` in JSX + class contains `kbd`; report usages missing the documented chip anatomy classes.
4. Add `--baseline <path>` CLI flag: load JSON, filter each extractor's output against baseline signatures, fail on new-signature or count-growth, silently accept reductions.
5. Wire the 3 new extractors into the main `check-design` runner.
6. Preserve v3 behavior for existing 4 extractors + iconography + z-layers.

**Est.** ~200 LOC additions.

**Verify.** `pnpm task check design` on clean `codex/design-md-v3` tip; then with `--baseline scripts/checks/baselines/design-drift.json` (once U5 seeds it) — expect 0 new signatures.

### U4. Codemod — `scripts/design/codemod/fix-tokens.mjs`

**Files.** `scripts/design/codemod/fix-tokens.mjs` (new file), directory to be created.

**Actions.**
1. Scaffold CLI: `#!/usr/bin/env node`, argument parser (`--write`, `--only=<rule>`, `--report-json=<path>`, positional file globs).
2. Rule `text-numeric`: load `typography.text-sizes` from `DESIGN.md` YAML; build mapping `{10:"text-xs",12:"text-xs",13:"text-sm",...}`; scan `apps/app/src/**/*.{ts,tsx}` for `text-\[(\d+)px\]`; produce unified-diff hunks.
3. Rule `icon-numeric`: load `iconography.sizes`; scan Lucide-icon usage sites (imports from `lucide-react` + `size=\{(\d+)\}`); build mapping 12→xs, 14→sm, 16→base, 20→lg, 24→xl; produce hunks.
4. Rule `hardcoded-hex`: load token→hex registry from CSS variables; scan `apps/app/src/**/*.{ts,tsx,css}` for `#[0-9a-fA-F]{6}` literals; on exact-match hex, replace with `hsl(var(--dls-*))` reference.
5. Default = dry-run: print colored unified diff to stdout.
6. `--write`: apply hunks in place.
7. `--report-json <path>`: emit `{ "rules": { "<rule>": { "candidates": N, "matched": M, "files": [...] } } }`.

**Est.** ~250 LOC.

**Verify.** `node scripts/design/codemod/fix-tokens.mjs` (dry-run) — prints candidate diff, exits 0. `node scripts/design/codemod/fix-tokens.mjs --report-json /tmp/codemod.json` — writes valid JSON.

### U5. Drift baseline JSON

**Files.** `scripts/checks/baselines/design-drift.json` (new file).

**Actions.**
1. Run `pnpm task check design` on clean `codex/design-md-v3` HEAD (or v4 branch tip before this file lands).
2. Capture the reported drift per extractor into the KTD6 shape.
3. Write the JSON, sorted by extractor → file → signature for stable diffs.
4. Add a comment-header `README` sibling if useful — otherwise inline JSON is enough; the Iteration Guide already tells contributors to only reduce counts.

**Est.** ~200 lines JSON (76 entries currently).

**Verify.** `pnpm task check design -- --baseline scripts/checks/baselines/design-drift.json` — exits 0.

### U6. CI workflow (HUMAN-GATE)

**Files.** `.github/workflows/design-check.yml` (new file, human-gated).

**Actions.**
1. Announce to user: "About to write `.github/workflows/design-check.yml` — human-gated per AGENTS.md."
2. Show the full YAML (per R12 preview) for review.
3. Wait for user go-ahead.
4. Write the file.

**Est.** ~30 LOC YAML.

**Verify.** GitHub Actions UI validates on PR push (real verification lives in PR CI). Locally: `yaml lint` if available.

### U7. Preview HTML additions

**Files.** `docs/design/preview.html`, `docs/design/preview-dark.html`.

**Actions.**
1. Add `<section id="state-machines">` after existing z-layer section — 4-column grid: loading skeleton (with shape-parity boxes), empty state (icon + title + body + CTA), error card (danger accent + retry CTA), success confirmation (success accent + dismiss glyph).
2. Add `<section id="notifications">` — mocked "app window" element with 4 stacked toasts in top-right at info/success/warn/error.
3. Add `<section id="kbd">` — inline chip row: `⌘K`, `⌘ + ⇧ + P`, `⌥1`, `↑ ↓ ← →`, chord notation demo.
4. Mirror all three into `preview-dark.html` with dark palette values.

**Est.** ~180 LOC HTML+CSS across both files.

**Verify.** Open both files in a browser and visually check. `git diff --check`.

### U8. Cross-doc pointers

**Files.** `docs/design/theme-system.md`, `AGENTS.md`.

**Actions.**
1. `theme-system.md` — add pointer sentence per R14.
2. `AGENTS.md` — extend UI-rule bullet per R14.

**Est.** ~10 LOC.

**Verify.** `git diff --check`. Read modified sections for coherence.

### U9. Final verification pass

**Files.** No edits.

**Actions.**
1. `pnpm check:type` — TypeScript baseline.
2. `pnpm task check design -- --strict --baseline scripts/checks/baselines/design-drift.json` — full design gate, must exit 0.
3. `git diff --check` — no whitespace / conflict markers.
4. Manual read of `DESIGN.md` diff against v3 tip — verify no accidental v3 content deletion.
5. Verify only allowlisted paths touched except `.github/workflows/design-check.yml` (human-gated, user pre-approved in U6).

**Verify.** All three commands exit 0.

---

## Sequencing

```text
U1 (DESIGN.md sections) ──►  U2 (YAML blocks)  ──►  U3 (extract-tokens)
                                                        │
                                                        ▼
                                                    U5 (baseline seed)
                                                        │
                                                        ▼
U4 (codemod)  ──── parallel ────►  U7 (preview HTML)  ──►  U6 (CI YAML, gated)
                                                                │
                                                                ▼
                                                            U8 (cross-doc)
                                                                │
                                                                ▼
                                                            U9 (final verify)
```

**Critical path.** U1 → U2 → U3 → U5 → U6 → U9. U4 (codemod) and U7 (preview) can run any time after U1 / U2. U8 runs after all others so pointers reference finalized section numbers.

---

## Test / Verification Strategy

Per-unit verification listed inline. Cross-cutting:

- **Type safety.** `pnpm check:type` after every unit that touches `.mjs` (U3, U4). `extract-tokens.mjs` is JSDoc-typed by v2 convention — preserve.
- **Design gate.** `pnpm task check design` after U1–U3 (report-only), `pnpm task check design -- --strict --baseline scripts/checks/baselines/design-drift.json` after U5.
- **CI dry-run.** After U6, push the branch and confirm GitHub Actions picks up the workflow and runs `--strict` against baseline. If baseline mismatch fires on first CI run, iterate baseline in U5 until CI passes.
- **Preview visual check.** Manual browser open of `preview.html` + `preview-dark.html` after U7. Both files must render all new sections without CSS breakage.
- **v3 content unchanged.** Diff `DESIGN.md` at v3 tip vs v4 tip — v3-shipped sections (Colors 5-subgroup, Typography Principles, Layout Grid, Depth z-layers, Shapes, Iconography, Signature Components, Iteration Guide, Known Gaps) must appear byte-identical except renumbering-free additions.

---

## Risk & Rollback

- **R1. CI workflow fails on first PR run because baseline mis-seeded.** Mitigation: seed U5 baseline from the exact commit that will be `main` at PR merge; re-seed if that commit moves. Rollback: patch the baseline JSON, push amendment.
- **R2. Codemod produces false-positive replacements on `--write` (nobody runs `--write` in this PR, but future author might).** Mitigation: dry-run default; require `--write` explicit; codemod prints diff before applying with `--write`; document in Iteration Guide that codemod output must be reviewed. Rollback: `git checkout -- <files>` after codemod `--write` regret.
- **R3. `extract-tokens.mjs` baseline mode breaks existing v3 report-only runs.** Mitigation: baseline mode is opt-in via `--baseline` flag; without flag, behavior identical to v3. Test both modes in U3.
- **R4. `.github/workflows/design-check.yml` triggers on paths that shouldn't gate (e.g. plan doc edits).** Mitigation: `paths:` list is narrow (DESIGN.md, docs/design/**, scripts/design/**, index.css, baseline JSON). `docs/plans/**` intentionally excluded.
- **R5. New DESIGN.md sections conflict with `apps/**` component naming.** Mitigation: sections describe contracts, not names — no primitive rename implied. `KbdChip` naming (if it becomes a primitive) deferred to v5+.
- **R6. YAML front matter grows large enough to break existing parsers.** Mitigation: `extract-tokens.mjs` uses `js-yaml`; test parse after U2. Any downstream consumer (theme-system.md automation) is nonexistent today.
- **R7. PR blocked on human-gate delay for CI YAML.** Mitigation: U6 batched at the end; U1–U5, U7, U8 all land without user interaction; U6 announced clearly with full YAML preview so approval is fast.

**Full rollback.** Doc-only sections (U1, U2, U7, U8): `git revert` per commit. Script additions (U3, U4): `git revert` — no runtime side effects because no `apps/**` code changed. CI workflow (U6): `git revert` the workflow file; PRs stop being gated.

**Partial rollback.** If v4 lands but the codemod (U4) later proves noisy, `rm scripts/design/codemod/fix-tokens.mjs` without touching DESIGN.md or the CI gate. If the CI gate is too strict, temporarily change the workflow `--strict` to report-only until baseline is refined.

---

## Out-of-Scope (explicit)

- Bucket B items (message roles, streaming, presence, tool-approval, session lifecycle, artifact palette) — v5.
- Storybook / MDX generator — post-v5.
- `formatShortcut()` runtime helper implementation — v5 or later.
- Running codemod `--write` as part of this PR.
- Editing `apps/**` component code (except the tiny possibility of adding `KbdChip.tsx`, which is deferred anyway per KTD9).
- Renumbering v3-shipped sections — v4 adds `4a / 4b / 5a / 9a` intentionally so v3 section numbers remain stable.

---

## Handoff Summary

- **PR branch.** `codex/design-md-v4` off `main` if PR #26 (v3) merged, otherwise stack on `codex/design-md-v3`.
- **PR title.** `feat(design): DESIGN.md v4 — universal UI contracts + governance floor`.
- **PR checklist.**
  - [ ] U1–U9 complete.
  - [ ] `pnpm check:type` passes.
  - [ ] `pnpm task check design -- --strict --baseline scripts/checks/baselines/design-drift.json` passes.
  - [ ] Preview HTML renders new sections in both light and dark.
  - [ ] `.github/workflows/design-check.yml` reviewed by owner before merge.
  - [ ] v3 section numbers unchanged.
- **Follow-up plans.**
  - v5 brainstorm: `docs/plans/2026-07-XX-006-feat-design-md-v5-brainstorm-*.md` (per roadmap 004 U2).
  - v5 plan: `docs/plans/2026-07-XX-007-feat-design-md-v5-*.md` (per roadmap 004 U3).
  - v6+ handoffs: `docs/plans/handoffs/2026-07-04-004-design-md-v6-plus-handoffs.md`.
