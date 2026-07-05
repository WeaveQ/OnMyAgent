---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan
execution: code
created: 2026-07-04
name: OnMyAgent DESIGN.md v5 — agent-native signatures
---

# OnMyAgent DESIGN.md v5 — Plan

## Goal Capsule

**Objective.** Lock OnMyAgent's identity-carrying visual contracts on top of the v3 canonical shell + v4 governance floor. v5 turns the brainstorm-locked Option A defaults (see doc 006) into `DESIGN.md` prose + YAML + extractor coverage + preview HTML for 4 agent-native decisions (message roles, streaming presentation, presence 6-state, tool-approval anatomy) plus 3 direct-draft additions (diff/code inline styles, session-lifecycle SessionCard variants, artifact-type palette).

**Product authority.** Adds 6 new `## 4c–4h` sub-sections + 1 new sub-palette (`artifact-hue`) + 5 new YAML blocks (`message-roles`, `streaming`, `presence`, `tool-approval`, `artifact-hue`) + code-diff inline style prose under § 4 Component Stylings. Extends `scripts/design/extract-tokens.mjs` with 5 more diff extractors and reseeds `scripts/checks/baselines/design-drift.json`. Preview HTML gains a full agent-native demo panel (7-role transcript + streaming cursor + presence badges row + tool-approval card + artifact-hue swatches).

**Open blockers.** PR #26 (v3) must merge → PR #28 (v4) must merge before v5 branch cut, so v5 does not stack three-deep. If both still open at U-kickoff, v5 stacks on `codex/design-md-v4`.

---

## Product Contract

### Problem Frame

v3/v4 covered every universal contract every design system carries. What's missing is the vocabulary that makes an OnMyAgent transcript identifiable: what does a `tool-call` look like vs a `thinking` block? How does a streaming assistant response signal "still working"? What are the 6 presence states beyond `online`? How much friction should a `destructive` tool approval carry?

Today the code has:
- 4 message roles (`user`/`assistant`/`system`/`tool`) with no visual distinction beyond avatar (`apps/app/src/app/lib/desktop-types.ts`).
- `isStreaming` booleans scattered across `session/surface/**/*.tsx` with each site rendering its own indicator.
- Presence limited to `online` + `signal` (green dot + cyan dot).
- Tool-approval cards drawn per call site, danger classification ad-hoc.

The brainstorm (doc 006) locked Option A for Q1–Q4, which favors reusing already-shipped v3/v4 tokens over introducing new base palettes. v5's job is to write those choices down and wire them into the drift gate.

### Primary Actor

**AI coding agents** authoring session-surface UI. Secondary: **project owner** reviewing PRs and running `pnpm task check design -- --strict --baseline`.

### Core Outcome

- `DESIGN.md` gains 6 new sub-sections (`## 4c` Message Roles, `## 4d` Streaming Presentation, `## 4e` Presence & Activity, `## 4f` Tool Approval, `## 4g` Code & Diff, `## 4h` Session & Artifact Variants) and 5 new YAML blocks + 4 new flags.
- New `artifact-hue.*` sub-palette exposed as CSS custom properties in `apps/app/src/app/index.css` (human-gated write per AGENTS.md).
- `extract-tokens.mjs` learns 5 new extractors (message-roles, streaming, presence, tool-approval, artifact-hue) and one reseeded baseline.
- Preview HTML gains an "Agent-native panel" section combining a 7-role transcript, streaming cursor demo, presence badges row, tool-approval card, session variants, and artifact-hue swatches. Both light and dark variants.
- `theme-system.md` gains a new "Agent-native identity" pointer paragraph; `AGENTS.md` UI rule extended to reference the new YAML blocks.
- `.loop/state/PROGRESS.md` local-only refresh reflecting v5 shipped.

### Positioning

- **Adds identity, does not change governance.** v4's baseline + codemod + CI gate keep enforcing. v5 grows the vocabulary the gate can enforce, does not re-scope the enforcement model.
- **Reuses v3/v4 tokens by default.** Only two new palettes:
  - `artifact-hue.*` (8 hues) for artifact-type accents (§ 11 Intentional Exceptions expansion).
  - No new base colors for messaging / presence / tool approval — those pull from `dls-*` + `semantic.*` already shipped.
- **Does not decide runtime helpers.** `formatShortcut()` from v4 remains deferred; a streaming cursor React component is a v5-adjacent implementation task, not a DESIGN.md contract.

### Scope

**In scope**
- 6 new `## 4c–4h` DESIGN.md sub-sections.
- 5 new YAML blocks: `message-roles:`, `streaming:`, `presence:`, `tool-approval:`, `artifact-hue:`.
- 4 new flags in the `flags:` block (`message-roles-tokenized: required`, `streaming-tokenized: required`, `presence-tokenized: required`, `tool-approval-tokenized: required`).
- New CSS variables `--dls-artifact-hue-*` (8 keys × 2 themes) — **human-gated** write to `apps/app/src/app/index.css`.
- 5 new `extract-tokens.mjs` extractors + reseeded `design-drift.json` baseline.
- Preview HTML "Agent-native panel" section in `preview.html` + `preview-dark.html`.
- Cross-doc pointer updates in `theme-system.md` + `AGENTS.md`.
- `## 14. Known Gaps` update: remove items covered (message roles, streaming, presence, tool-approval, session-lifecycle, artifact palette).

**Out of scope**
- Runtime helper implementations (`formatShortcut()`, streaming cursor component, tool-risk classifier).
- New `apps/app/src/**` component code beyond the required CSS variable declarations.
- Mono font family contract — remains a Known Gap.
- Any B6+ decision changes beyond Option A defaults; anything the brainstorm did not lock (chart palette, voice/tone, density, mobile) stays v6+.

---

## Key Technical Decisions

**KTD1. Message roles = 7 entries reusing existing surface / semantic tokens.** Per brainstorm Q1 Option A. No new palette. Roles encode identity via `border-left` accent + Lucide prefix icon, not via surface fills. Trade-off: less visually loud than tinted surfaces, matches DESIGN.md § 6 "flatness is a decision".

**KTD2. Streaming cursor = inline block glyph + ellipsis fallback.** Per brainstorm Q2 Option A. Cursor is a 6 × 12 px block filled with `dls-signal`, blinks at `motion.duration.slow` (320 ms) using `motion.easing.signal`. Pause fallback swaps in a `…` in `dls-text-tertiary` after `state-timings.short-ms` (1 s). Reduced-motion holds cursor visible, no blink. YAML `streaming:` block declares the contract; the React primitive is a follow-up.

**KTD3. Presence = 6 states over reused semantic tokens.** Per brainstorm Q3 Option A. `online` / `idle` / `typing` / `running` / `paused` / `disconnected` / `errored` (7 including `online`). Colors sourced from `dls-online`, `dls-text-tertiary`, `dls-signal`, `dls-primary`, `dls-warning`, `dls-slate`, `dls-danger`. Micro-motion optional: `typing` pulses at `duration.fast`, `running` at `duration.normal`, `errored` shakes once on entry. `StatusDot` primitive stays unchanged — states are a `state=` enum drift check, not a rewrite.

**KTD4. Tool-approval = 3-tier risk with inline diff for writes.** Per brainstorm Q4 Option A. Risk tiers: `safe` (no band, primary approve `dls-primary`), `careful` (2 px left border `dls-warning`, primary `dls-primary`), `destructive` (4 px left border `dls-danger`, primary approve variant is `danger`, secondary "Show diff" always visible). Param summary: first line only, `text-xs font-mono`, truncate at 80 chars. Inline diff auto-expanded ≤ 20 lines, auto-collapsed > 20 lines. `tool-approval:` YAML declares tier bands + thresholds.

**KTD5. Artifact hue = new sub-palette, gated to artifact cards.** 8 hues (image / code / document / data / plot / 3d / audio / video) picked from Radix palette shade 9 for consistent chroma across light + dark. **Does not leak into semantic use** (§ 11 Intentional Exceptions clarifies this). CSS custom properties `--dls-artifact-hue-<type>` in `apps/app/src/app/index.css`. **Human-gated write** because `apps/app/src/app/index.css` is not fully allowlisted.

**KTD6. Diff/code inline styles use existing semantic-color alpha, not new tokens.** Addition background `hsl(var(--dls-success-fg) / 0.08)`, removal `hsl(var(--dls-danger) / 0.08)`. Line-number color `dls-text-tertiary`. Mono font remains a Known Gap — v5 does not resolve the mono contract, just uses the system-mono fallback declared in § 3.

**KTD7. Session lifecycle = 4 SessionCard variants over existing tokens.** `active` (default, shipped), `archived` (`opacity-60` + `dls-text-secondary`), `shared` (2 px left-border `dls-signal` + `link` glyph), `read-only` (`bg-dls-surface-muted` + `lock` glyph, hover disabled). No new tokens.

**KTD8. Baseline reseed at v5 kickoff.** v5 adds 5 new extractor buckets. Baseline JSON grows to include them; existing v4 counts (69 iconography + 7 z-layers + 13 state-timings + 0 notifications + 2 kbd = 91) stay unchanged if no code-side drift exists yet. Reseed command committed inline in the plan.

**KTD9. Extractors are report-only unless coded state exists.** Message-roles / streaming / tool-approval extractors flag drift when the code carries the pattern but not the tokens; if no code-side implementation exists yet (which is the case at v5 kickoff — this plan is docs-only), the extractors report 0 drift. This is intentional; the extractors gate against future drift, not against the absence of implementation.

**KTD10. CSS variable write is the only `apps/**` touch.** v5 does not introduce runtime primitives, does not modify existing message-list or tool-card React code, and does not add `MessageRole` type declarations. Runtime alignment lives in a v5-adjacent implementation task (not this plan). The only mandatory `apps/**` edit is the CSS custom-property declarations for `artifact-hue.*`, which is why the plan flags human-gate approval.

---

## Requirements

- **R1. New `## 4c. Message Roles` section.** Placed after `## 4b. Notifications`. Contains a 7-role table (surface / typography / border-left / prefix), a Rationale paragraph, and cross-references to `iconography.size.sm` for prefix icons.
- **R2. New YAML `message-roles:` block** — one entry per role (`user`, `assistant`, `tool-call`, `tool-output`, `thinking`, `system`, `error`) with keys `surface`, `type`, `border-left`, `prefix-icon`, `prefix-color`. All values reference existing `dls-*` tokens; no new base colors.
- **R3. New `## 4d. Streaming Presentation` section.** Contains: Cursor Glyph anatomy (6 × 12 px block), Blink Cadence (`motion.duration.slow` + `motion.easing.signal`), Pause Fallback (ellipsis after `state-timings.short-ms`), Reduced-Motion (cursor holds, no blink), No-Spinner rule (do NOT stack a spinner on pause).
- **R4. New YAML `streaming:` block** — `cursor-shape: block`, `cursor-width-px: 6`, `cursor-height-px: 12`, `cursor-color: dls-signal`, `blink-duration-ms: 320`, `blink-easing: signal`, `pause-threshold-ms: 1000`, `pause-glyph: horizontal-ellipsis`, `pause-color: dls-text-tertiary`, `reduced-motion: cursor-hold-no-blink`.
- **R5. New `## 4e. Presence & Activity` section.** Contains a 7-state table (color / motion / tooltip icon) covering `online`, `idle`, `typing`, `running`, `paused`, `disconnected`, `errored`. Explicit note that `StatusDot` primitive stays unchanged — state is a prop enum.
- **R6. New YAML `presence:` block** — one entry per state with `color` (token ref), `motion` (`none` / `pulse-fast` / `pulse-normal` / `shake-once`), `icon` (Lucide name).
- **R7. New `## 4f. Tool Approval` section.** Contains: Risk Tiers (`safe` / `careful` / `destructive` — anatomy per tier), Param Summary rules (mono, 80-char truncate, expandable), Diff Preview rules (inline ≤ 20 lines, collapsed > 20), Motion (no danger-band animation — friction is the point, not motion).
- **R8. New YAML `tool-approval:` block** — `risk-tiers` (map of tier → border width / border color / primary button variant), `param-summary-max-chars: 80`, `param-summary-full-max-lines: 200`, `diff-inline-line-threshold: 20`.
- **R9. New `## 4g. Code & Diff` section.** Under Component Stylings. Contains: diff line prefixes `+` / `−` (gutter, mono), addition / removal background alpha (`0.08` over `dls-success-fg` / `dls-danger`), line-number style (`text-2xs text-dls-text-tertiary`), collapsible-chunk affordance (`Show N more lines`). Explicit deferral: mono font family remains a Known Gap; use the system-mono fallback from § 3.
- **R10. New `## 4h. Session & Artifact Variants` section.** Extends the v3 Signature Components (`SessionCard`, `ArtifactCard`).
  - `SessionCard` variants: `active` (default), `archived` (`opacity-60` + `dls-text-secondary`), `shared` (2 px left-border `dls-signal` + `link` glyph), `read-only` (`bg-dls-surface-muted` + `lock` glyph, hover disabled).
  - `ArtifactCard` variants: 8 types, each 2 px left-border in the matching `artifact-hue.<type>` token; type badge (`StatusBadge` variant) in the same hue at 20 % alpha background + full-chroma text.
- **R11. New YAML `artifact-hue:` block** — 8 entries (`image`, `code`, `document`, `data`, `plot`, `3d`, `audio`, `video`), each mapped to a Radix shade-9 name (`violet-9`, `blue-9`, `slate-9`, `teal-9`, `grass-9`, `plum-9`, `pink-9`, `crimson-9`).
- **R12. New CSS custom properties.** In `apps/app/src/app/index.css` (**human-gate**), declare `--dls-artifact-hue-image / -code / -document / -data / -plot / -3d / -audio / -video` in both `:root` (light) and `[data-theme="dark"]` (dark) blocks. Values source from the existing Radix palette import at the required shade. Announce before writing; show final CSS diff for owner review.
- **R13. `extract-tokens.mjs` 5 new extractors.**
  - `diffMessageRoles(yaml, scan)` — best-effort scan of `apps/app/src/react-app/domains/session/**/*.tsx` for message-row-like components; flag `role=` values not in `message-roles.*`.
  - `diffStreaming(yaml, scan)` — scan `session/surface/**/*.tsx` for `isStreaming` state usages; flag any custom cursor/pulse markup outside a `StreamingCursor` primitive (best-effort regex on `<span class="…cursor…">` fragments).
  - `diffPresence(yaml, scan)` — scan `<StatusDot state=` / `<StatusBadge state=` sites; flag any state not in `presence.*`.
  - `diffToolApproval(yaml, scan)` — scan tool-approval-shaped components (heuristic: files matching `**/*tool*.tsx` + JSX containing `Approve` / `Deny`); flag any missing the risk-tier border anatomy.
  - `diffArtifactHue(yaml, scan)` — scan `**/*artifact*.tsx`; flag any hardcoded hue outside `artifact-hue.*`.
- **R14. Baseline reseed.** Run `pnpm task check design -- --json` on v5-branch tip, capture per-extractor signatures, rewrite `scripts/checks/baselines/design-drift.json` including 5 new buckets. Since v5 does not add code-side implementations, the new buckets seed at count 0. Document reseed in the commit message.
- **R15. Preview HTML `agent-native` panel.** In `docs/design/preview.html` + `preview-dark.html`, append a new section covering: 7-role transcript demo, streaming cursor demo (live-blinking with a mock pause after 3 s), presence badges row, tool-approval card (3 tiers side-by-side), SessionCard variants row (4 cards), ArtifactCard swatches row (8 types).
- **R16. YAML `flags:` additions.** `message-roles-tokenized: required`, `streaming-tokenized: required`, `presence-tokenized: required`, `tool-approval-tokenized: required`.
- **R17. Cross-doc pointer updates.**
  - `docs/design/theme-system.md` — new "Agent-native identity" paragraph listing §§ 4c–4h with one-sentence rationale each.
  - `AGENTS.md` — UI rule extended to reference the 5 new YAML blocks in the mandatory read list.
- **R18. Known Gaps update.** Remove: message roles, streaming, presence, tool-approval, session-lifecycle, artifact palette. Add: "runtime helper implementations (formatShortcut, streaming cursor React primitive, tool-risk classifier metadata plumbing) — v6+ tooling / implementation scope, not DESIGN.md scope."
- **R19. Path allowlist and human-gate compliance.**
  - Allowlist edits: `DESIGN.md`, `docs/design/**`, `scripts/design/**`, `scripts/checks/baselines/**`, `AGENTS.md`, `docs/plans/**`.
  - **Human-gate edits**: `apps/app/src/app/index.css` (per AGENTS.md `apps/**` policy). U-work must announce, present final diff, and wait for owner approval before writing.
  - No changes to `.github/workflows/**` (v4's `design-check.yml` already covers v5's paths via the `DESIGN.md` + `docs/design/**` + `scripts/design/**` + baseline JSON + `index.css` triggers).

**Out-of-scope (deferred to v6+)**
- Runtime primitives (`StreamingCursor` React component, `ToolApprovalCard` component, `formatShortcut` helper).
- Mono font family contract.
- Data-viz palette, voice/tone, density modes, mobile companion — v6+ per roadmap.

---

## Implementation Units

### U1. DESIGN.md — §§ 4c/4d/4e/4f/4g/4h sections

**Files.** `DESIGN.md`.
**Actions.** Insert 6 new sub-sections after `## 4b. Notifications`, before `## 5. Layout`. Renumbering-free — v3/v4 § 5 onward stays byte-identical.
**Est.** ~600 LOC in DESIGN.md.
**Verify.** `pnpm task check design` (report-only, no baseline yet). `git diff --check`.

### U2. DESIGN.md — new YAML blocks + flags

**Files.** `DESIGN.md` (YAML front matter).
**Actions.** Add `message-roles:`, `streaming:`, `presence:`, `tool-approval:`, `artifact-hue:` blocks. Extend `flags:` with 4 new `*-tokenized: required` entries.
**Est.** ~90 LOC YAML.
**Verify.** `pnpm task check design` — YAML parse must succeed; new blocks visible in JSON output.

### U3. `apps/app/src/app/index.css` — `--dls-artifact-hue-*` (HUMAN-GATE)

**Files.** `apps/app/src/app/index.css` (human-gated per AGENTS.md).
**Actions.**
1. Announce: "About to add 16 CSS custom properties (`--dls-artifact-hue-{image,code,document,data,plot,3d,audio,video}` × 2 themes) to `apps/app/src/app/index.css`. This is a human-gate write per AGENTS.md."
2. Show final CSS diff for owner review (values pulled from Radix palette at shade 9 for light, shade 4 for dark to hit the dark-mode contrast band).
3. Wait for owner go-ahead.
4. Insert declarations under `:root` (light values) and `[data-theme="dark"]` (dark values).
**Est.** ~30 LOC CSS additions.
**Verify.** `pnpm dev -- app` renders without palette regressions (spot check). `pnpm task check design` — no new drift beyond the seeded baseline.

### U4. `extract-tokens.mjs` — 5 new extractors

**Files.** `scripts/design/extract-tokens.mjs`.
**Actions.**
1. Add `scanMessageRoles(rootDir)` + `diffMessageRoles(yaml, scan)`.
2. Add `scanStreamingSites(rootDir)` + `diffStreaming(yaml, scan)`.
3. Add `scanPresenceSites(rootDir)` + `diffPresence(yaml, scan)`.
4. Add `scanToolApproval(rootDir)` + `diffToolApproval(yaml, scan)`.
5. Add `scanArtifactHue(rootDir)` + `diffArtifactHue(yaml, scan)`.
6. Wire the 5 new extractors into the main runner, renderer, `totalDrift`, and baseline enforcement.
**Est.** ~350 LOC additions.
**Verify.** `pnpm task check design` — new extractors emit report; JSON output contains all 5 new bucket keys. `pnpm task check design -- --strict` — passes on clean tree if code carries no drift (expected at v5 kickoff).

### U5. Baseline reseed

**Files.** `scripts/checks/baselines/design-drift.json`.
**Actions.**
1. Run `pnpm task check design -- --json` on v5 branch tip after U1–U4.
2. Extend the baseline JSON with 5 new bucket entries (`messageRoles`, `streaming`, `presence`, `toolApproval`, `artifactHue`); each seeds at count 0 if no code-side drift found, or captures existing drift signatures otherwise.
3. Preserve v4 counts (iconography 69 / zLayers 7 / stateTimings 13 / notifications 0 / kbd 2) unless the reseed run legitimately reduces them.
**Est.** +5 bucket entries in the baseline JSON.
**Verify.** `pnpm task check design -- --strict --baseline scripts/checks/baselines/design-drift.json` — exits 0.

### U6. Preview HTML — agent-native panel

**Files.** `docs/design/preview.html`, `docs/design/preview-dark.html`.
**Actions.**
1. Append `<section id="agent-native">` before `</main>` in both files.
2. Sub-panels: (a) 7-role transcript demo (mocked rows using each role), (b) streaming cursor demo (block cursor with CSS blink + 3 s timer that swaps to ellipsis), (c) presence badges row (7 states side-by-side), (d) tool-approval cards (3 tiers side-by-side), (e) SessionCard variants row (4 cards), (f) ArtifactCard swatches row (8 hues).
**Est.** ~250 LOC across both files.
**Verify.** Open both files in a browser; visually confirm every sub-panel renders in light + dark.

### U7. Cross-doc pointers

**Files.** `docs/design/theme-system.md`, `AGENTS.md`.
**Actions.**
1. `theme-system.md` — new "Agent-native identity" paragraph with §§ 4c–4h pointers.
2. `AGENTS.md` — extend the UI rule bullet to list `message-roles` / `streaming` / `presence` / `tool-approval` / `artifact-hue` YAML blocks in the mandatory-read list.
**Est.** ~20 LOC.
**Verify.** `git diff --check`.

### U8. Known Gaps trim

**Files.** `DESIGN.md` (§ 14).
**Actions.** Remove the 6 items now covered; add the runtime-helper deferral entry.
**Est.** ~10 LOC.
**Verify.** Read modified § 14 for coherence.

### U9. Final verification pass

**Files.** No edits.
**Actions.**
1. `pnpm check:type` — TS baseline.
2. `pnpm task check design -- --strict --baseline scripts/checks/baselines/design-drift.json` — full gate.
3. `pnpm check:boundaries` + `pnpm check:forbidden-types` — architecture + type gates.
4. `git diff --check`.
5. Manually re-render preview HTML in browser (light + dark).
6. Diff `DESIGN.md` at v4 tip vs v5 tip — verify no v3/v4 content deletion (v3 sections 1–14, v4 sub-sections 4a/4b/5a stable).
**Verify.** All commands exit 0; preview HTML renders.

---

## Sequencing

```text
U1 (DESIGN.md sections) ──►  U2 (YAML blocks + flags)
                                    │
                                    ▼
                              U4 (extract-tokens 5 extractors)
                                    │
                                    ▼
                              U3 (index.css hues, HUMAN-GATE)
                                    │
                                    ▼
                              U5 (baseline reseed)
                                    │
                                    ├─── U6 (preview HTML, parallel-safe)
                                    │
                                    ▼
                              U7 (cross-doc pointers)
                                    │
                                    ▼
                              U8 (Known Gaps trim)
                                    │
                                    ▼
                              U9 (final verify)
```

**Critical path.** U1 → U2 → U4 → U3 → U5 → U9. U6 (preview HTML) can run any time after U2. U7 + U8 run after all others so pointers reference finalized section numbers.

---

## Test / Verification Strategy

- **Type safety.** `pnpm check:type` after U4 (extract-tokens is JSDoc-typed).
- **Design gate.** `pnpm task check design` after U1–U2 (report-only), `pnpm task check design -- --strict --baseline` after U5.
- **CI dry-run.** Push branch; verify PR CI runs the v4 `design-check.yml` workflow against v5's baseline updates without regression.
- **Preview visual check.** Manual browser open of `preview.html` + `preview-dark.html`. All 6 sub-panels must render in both themes; streaming cursor demo must blink then swap to ellipsis after 3 s.
- **v3/v4 content unchanged.** `git diff codex/design-md-v4..codex/design-md-v5 -- DESIGN.md | rg "^-[^-]"` should show no deletions in v3/v4-shipped sections.
- **Human-gate compliance.** `apps/app/src/app/index.css` write is announced, previewed, and owner-approved before commit.

---

## Risk & Rollback

- **R1. Baseline reseed accidentally lowers counts because reseed ran on a mid-edit tree.** Mitigation: reseed only after U1–U4 commit; run reseed on a clean tree.
- **R2. CSS variable write breaks light/dark visual regressions.** Mitigation: U3 preview step; owner reviews rendered swatches before merge. Rollback: `git revert` the index.css commit only.
- **R3. New extractors produce false positives on legacy files.** Mitigation: extractors are best-effort regex and default to report-only. Baseline captures the initial state; only *new* drift fails strict.
- **R4. `artifact-hue.*` colors leak into semantic surfaces.** Mitigation: § 11 Intentional Exceptions explicitly enumerates artifact-hue as artifact-card-only; `diffArtifactHue` extractor flags any usage outside `**/*artifact*.tsx`.
- **R5. v5 stacks on v4 which stacks on v3 — 3-deep PR chain becomes unmergeable.** Mitigation: v5 kickoff blocks on PR #26 (v3) + PR #28 (v4) merging first. If both open at kickoff, cut v5 branch off `codex/design-md-v4` and rebase onto `main` before opening PR.
- **R6. Preview HTML streaming cursor demo interferes with reduced-motion.** Mitigation: wrap the blink CSS in `@media (prefers-reduced-motion: no-preference) { … }` so the demo respects the user's system pref.
- **R7. B12 artifact hues clash with existing extension-card / provider-icon exceptions in § 11.** Mitigation: v5 U-work reads § 11 Intentional Exceptions first and confirms non-collision; artifact-hue is a NEW exception category, not a replacement for the existing extension-type / brand-color entries.

**Full rollback.** DESIGN.md sections + preview HTML + cross-doc pointers: `git revert` each commit. Script additions (U4): `git revert` — no runtime side effects. CSS hues (U3): `git revert` — palette returns to pre-v5 state. Baseline (U5): `git revert` back to v4 baseline; CI `design-check.yml` continues to pass against v4 baseline.

**Partial rollback.** Any individual sub-section (§ 4c through § 4h) can be reverted independently by removing the section prose + its YAML block + its extractor without cascading. This is by design — the 7 additions are additive, not interdependent.

---

## Out-of-Scope (explicit)

- Runtime primitives (`StreamingCursor` React component, `ToolApprovalCard` component, `formatShortcut()` helper).
- Mono font family contract (remains a Known Gap).
- Bucket D items (data-viz palette, voice/tone, density modes, mobile companion) — v6+.
- Changing v3/v4 shipped tokens or renumbering v3/v4 sections.
- Any `apps/**` runtime code change beyond the human-gated `index.css` write.
- Extending the CI workflow — v4's `design-check.yml` triggers already cover v5 paths.

---

## Handoff Summary

- **Branch.** `codex/design-md-v5`, cut off `codex/design-md-v4` if PR #28 still open, otherwise off `main`.
- **PR title.** `feat(design): DESIGN.md v5 — agent-native signatures (message roles / streaming / presence / tool-approval / code+diff / session+artifact variants)`.
- **PR base.** `codex/design-md-v4` (or `main` after #28 merges).
- **PR checklist.**
  - [ ] U1–U9 complete.
  - [ ] `pnpm check:type` passes.
  - [ ] `pnpm task check design -- --strict --baseline scripts/checks/baselines/design-drift.json` passes.
  - [ ] `pnpm check:boundaries` + `pnpm check:forbidden-types` pass.
  - [ ] Preview HTML renders in both themes with streaming cursor blinking + ellipsis fallback.
  - [ ] `apps/app/src/app/index.css` write reviewed by owner before merge (U3 human-gate).
  - [ ] v3 + v4 section numbering unchanged.
- **Follow-ups.**
  - Runtime alignment: build `StreamingCursor` + `ToolApprovalCard` primitives in a separate PR that consumes the v5 tokens.
  - v6+ handoff notes remain in `docs/plans/handoffs/2026-07-04-004-design-md-v6-plus-handoffs.md`; each becomes its own brainstorm when product signal lands.
  - `.loop/state/PROGRESS.md` refresh after v5 PR merges.
