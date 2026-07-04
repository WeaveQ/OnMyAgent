---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
created: 2026-07-04
name: OnMyAgent DESIGN.md v5 — agent-native signatures (brainstorm)
---

# OnMyAgent DESIGN.md v5 — Brainstorm

> This is a **requirements-only** unified plan produced by `ce-brainstorm`.
> It captures the product decisions that must be locked before v5 becomes
> an implementation-ready plan via `ce-plan`. Do not execute code from
> this doc — feed it to `ce-plan` first.

## Goal Capsule

**Objective.** Lock the product-shaped design decisions that v3/v4 intentionally deferred: message-role vocabulary, streaming presentation, presence 6-state model, and tool-approval anatomy. These four decisions carry OnMyAgent's identity — no exemplar to copy from. Options here are proposed with defaults chosen from Claude Desktop / Cursor / Zed patterns and OnMyAgent's existing v3/v4 tokens; owner confirms or picks alternatives, then `ce-plan` writes the implementation plan.

**Non-decisions in v5.** B8 (diff/code-block inline styles), B11 (session-lifecycle color coding), B12 (artifact-type palette) are pattern applications that reuse already-decided tokens. They land directly in the v5 implementation plan without brainstorm — noted at the end of this doc so `ce-plan` includes them.

**Open blockers.** None. Owner review is the gate.

---

## Product Contract

### Problem Frame

v3 (canonical 9 sections + Shapes/Iconography/Iteration/Known Gaps) and v4 (state machines / notifications / kbd / CJK + governance floor) shipped the universal contracts. The remaining gap is *identity*: what makes an OnMyAgent chat transcript feel like OnMyAgent rather than a generic Anthropic playground clone.

Today the code has:
- `role: "user" | "assistant" | "system" | "tool"` in `apps/app/src/app/lib/desktop-types.ts` — 4 roles, no visual distinction beyond avatar.
- Streaming state exposed via `isStreaming` booleans across `session/surface/*` — no shared cursor primitive, each surface renders its own indicator.
- Presence limited to `online` (green dot) + `signal` (cyan dot). No `idle` / `typing` / `running` / `paused` / `disconnected` / `errored` visual states — the code invents them per surface.
- Tool-call rendering exists (`tool-call.tsx` in some domains) but no shared card anatomy: danger classification is ad-hoc, param summaries are inconsistent, approve/deny buttons are hand-drawn per call site.

Without a locked vocabulary, agents adding a new tool card or a new presence state have no contract to consult and default to inventing. v4's `pnpm task check design` gate cannot catch this because the vocabulary itself does not exist.

### Primary Actor

**Project owner + AI coding agents.** Owner picks between the option sets in each Q. Agents consume the locked vocabulary in v5's implementation plan.

### Core Outcome

Four locked decisions, each with:
- **Chosen option** (default proposed, owner may override).
- **Rationale** — one sentence.
- **YAML token block name** that will appear in DESIGN.md front matter.
- **DESIGN.md section anchor** where the contract will live.
- **`extract-tokens.mjs` extractor sketch** — what code paths will be scanned to detect drift.

Plus a **direct-draft list** (B8/B11/B12) that skips brainstorm and goes straight into the v5 implementation plan.

### Positioning

- **Product decisions, not implementation.** No file edits, no runtime code, no extractor code — only vocabulary choices.
- **Anchors on v3/v4 tokens.** Every option must be expressible using already-shipped `dls-*` tokens plus at most one new sub-palette per decision. No new base colors unless the option explicitly says so.
- **Escape hatch.** For each Q, "custom" is always allowed — owner sketches an alternative and v5 plan adopts it verbatim.

### Scope

**In scope**
- Q1 message-role palette (7 roles × 4 visual attributes each).
- Q2 streaming presentation (cursor glyph + cadence + pause fallback + reduced-motion).
- Q3 presence 6-state vocabulary (color + motion + prefix icon).
- Q4 tool-approval card anatomy (danger classification + param summary + diff preview).
- List of direct-draft items (B8/B11/B12) that skip brainstorm.

**Out of scope**
- Deciding *when* to trigger any state (product logic).
- Writing extract-tokens code (v5 implementation plan).
- Runtime helpers (`formatShortcut`, streaming cursor component code).
- Data-viz palette, voice/tone, density modes, mobile companion — v6+ per roadmap 004.

---

## Q1 · Message-Role Palette

**Decision needed.** 7 roles × 4 visual attributes. Roles are:
`user`, `assistant`, `tool-call`, `tool-output`, `thinking`, `system`, `error`.
Attributes are: **surface**, **typography variant**, **left-border accent**, **prefix (icon or label)**.

### Option A — "Minimal chrome" (recommended default)

Rows separated by hairlines only; surface stays `dls-surface` for all conversational roles; identity encoded via **left-border accent** + **prefix**, not surface fills. Closest to Claude Desktop / Zed's transcript feel; keeps long conversations calm.

| Role | Surface | Type | Border-left | Prefix |
| --- | --- | --- | --- | --- |
| `user` | `dls-surface` | `text-sm` | none | avatar 32 px (right-aligned row) |
| `assistant` | `dls-surface` | `text-sm` | none | `AgentAvatarMesh` 32 px |
| `tool-call` | `dls-surface-muted` | `text-xs font-mono` | 2 px `dls-primary` | Lucide `wrench` 14 px |
| `tool-output` | `dls-surface-muted` | `text-xs font-mono` | 2 px `dls-slate` | Lucide `terminal` 14 px |
| `thinking` | `dls-surface` | `text-xs italic` | 2 px `dls-signal` | Lucide `sparkles` 14 px |
| `system` | `dls-app-bg` | `text-xs` | none | Lucide `info` 14 px |
| `error` | `dls-surface` | `text-sm` | 2 px `dls-danger` | Lucide `alert-circle` 14 px |

Introduces no new base colors. `font-mono` remains a Known Gap in v3 §14; v5 uses the system-mono fallback until the mono contract lands.

### Option B — "Surface-tinted per role"

Each role gets a low-alpha surface tint (5–8 % of accent color). Louder visually — closer to Cursor's colored role tiles. Requires a new `role-surface.*` sub-palette (7 hues at 8 % opacity light / 12 % dark).

- Trades calm for scannability; helpful when the transcript is dense with tool traffic.
- Adds YAML `role-surface:` block, ~14 tokens (7 light + 7 dark).

### Option C — "User avatar-only"

Only `user` gets a surface variant (accent-tinted right-aligned bubble). Everything else is chrome-free. Closest to ChatGPT / iMessage. Fastest to scan for who spoke, but loses signal between `assistant` / `tool-call` / `thinking` — they all look identical.

- Simplest, cheapest to implement.
- Weakest for a workbench where users care whether a token came from the model or a tool.

**YAML block (all options).** `message-roles:` — one entry per role with `surface`, `type`, `border-left`, `prefix-icon`, `prefix-color`.

**DESIGN.md anchor.** `## 4c. Message Roles`, between § 4b Notifications and § 5 Layout.

**Extractor sketch.** Scan `apps/app/src/react-app/domains/session/**/*.tsx` for `role=` prop usages on message-row-like components; flag any usage without a matching `message-roles.<role>` reference.

**Default recommendation.** **Option A** — matches DESIGN.md's stated "flatness is a decision" philosophy (§ 6 Depth), avoids introducing 14 new color tokens, keeps § 11 Intentional Exceptions from expanding.

---

## Q2 · Streaming Presentation

**Decision needed.** Cursor **glyph**, **cadence**, **pause fallback**, **reduced-motion behavior**.

### Option A — "Inline block cursor" (recommended default)

- **Glyph** — a 6 × 12 px block (`▮`-shaped, filled with `dls-signal`), inline at the current caret position of the streaming text.
- **Cadence** — blink at `motion.duration.slow` (320 ms) using `motion.easing.signal` (`cubic-bezier(0.4, 0, 0.6, 1)`), 50 % duty cycle.
- **Pause fallback** — when no token arrives for >`state-timings.short-ms` (1 s), swap the cursor for an inline horizontal ellipsis `…` in `dls-text-tertiary`. Do NOT stack a spinner on top; the ellipsis alone reads as "still working".
- **Reduced-motion** — cursor stays visible but stops blinking; ellipsis fallback still applies.

Reuses motion tokens already shipped in v2. No new tokens beyond a `streaming:` YAML block.

### Option B — "Beam cursor with pulse"

- **Glyph** — a 2 × 14 px vertical beam (like a text-input caret), `dls-primary`.
- **Cadence** — pulse opacity 40 %→100 % at `duration.fast` (120 ms).
- **Pause fallback** — inline spinner at `iconography.size.xs` (12 px).
- **Reduced-motion** — beam holds at 100 % opacity, no pulse.

Closer to macOS system caret; may compete visually with input carets in composer.

### Option C — "No cursor, footer status"

- **Glyph** — none. Streaming state renders below the message row as a small `dls-text-tertiary` footer: "Assistant is responding…" with a spinner.
- **Pause fallback** — footer swaps to "Still working…" after 1 s.
- **Reduced-motion** — spinner replaced by static ellipsis.

Least visually noisy; loses the "words are landing right now" feel that drives engagement.

**YAML block.** `streaming:` — `cursor-shape`, `cursor-color`, `blink-duration-ms`, `blink-easing`, `pause-fallback-ms`, `pause-glyph`, `reduced-motion`.

**DESIGN.md anchor.** `## 4d. Streaming Presentation`, right after § 4c Message Roles.

**Extractor sketch.** Scan `apps/app/src/react-app/domains/session/surface/**/*.tsx` for `isStreaming` state usages; flag any that render custom cursor/pulse markup outside the shared streaming primitive.

**Default recommendation.** **Option A** — reuses existing `motion.*` + `dls-signal` tokens; ellipsis fallback matches the "chrome-free" § 6 Depth stance.

---

## Q3 · Presence 6-State Vocabulary

**Decision needed.** 6 states beyond today's `online`+`signal` — `idle`, `typing`, `running`, `paused`, `disconnected`, `errored`. Each needs a **color source**, an optional **micro-motion**, and a **prefix icon** for tooltip usage.

### Option A — "Reuse semantic tokens" (recommended default)

Uses only tokens already declared in v3 YAML. No new palette.

| State | Color | Motion | Icon (tooltip) |
| --- | --- | --- | --- |
| `online` | `dls-online` (existing) | none | `circle` filled |
| `idle` | `dls-text-tertiary` | none | `circle` outline |
| `typing` | `dls-signal` (existing) | pulse `duration.fast` | `pencil` |
| `running` | `dls-primary` | pulse `duration.normal` | `play` |
| `paused` | `dls-warning` | none | `pause` |
| `disconnected` | `dls-slate` | none | `cloud-off` |
| `errored` | `dls-danger` | shake once on entry | `alert-circle` |

Fits inside existing StatusDot primitive; no new primitive needed. Pulse uses the motion tokens already shipped in v2.

### Option B — "Dedicated `presence:` sub-palette"

Each state gets its own token (e.g. `presence-idle`, `presence-typing`, …), decoupled from semantic meaning. Makes future tuning easier (e.g. shift `typing` from cyan to lavender without also shifting `signal` on activity indicators).

- Trades reuse-simplicity for future-flexibility.
- Adds 12 tokens (6 light + 6 dark) to YAML.

### Option C — "3-state simplified"

Collapse the 6 states into 3: `active` (online/typing/running), `paused` (idle/paused), `broken` (disconnected/errored). Only 3 colors needed. Simpler for new users; loses granularity in the workbench where operators care whether an agent is thinking vs. blocked.

**YAML block.** `presence:` — one entry per state with `color`, `motion`, `icon`.

**DESIGN.md anchor.** `## 4e. Presence & Activity`, replacing today's brief mention in § 4 Component Stylings under "Status".

**Extractor sketch.** Scan `apps/app/src/react-app/domains/**/*.tsx` for `<StatusDot state=` / `<StatusBadge state=` usages; flag any state not in `presence.*`.

**Default recommendation.** **Option A** — reuses shipped tokens, `StatusDot` primitive stays as-is, keeps DESIGN.md's "tokens are reused before invented" spirit (§ 13 Iteration Guide).

---

## Q4 · Tool-Approval Card Anatomy

**Decision needed.** Card **danger classification** (how many risk tiers), **param-summary truncation** (chars? lines? code fence?), **diff-preview inclusion rule** (when to show, when to link out).

### Option A — "3-tier risk, mono param, always-diff-when-writing" (recommended default)

- **Danger classification.** 3 tiers driven by tool metadata:
  - `safe` — read-only (list_files, get_workspace). Card: no danger band, primary approve button in `dls-primary`.
  - `careful` — writes local state (edit_file, create_file, run_command). Card: 2 px left-border `dls-warning`, primary approve button in `dls-primary`.
  - `destructive` — deletes, force-pushes, network calls with side effects (rm, force-push, deploy). Card: 4 px left-border `dls-danger`, primary approve button in `dls-danger`, secondary "Show diff" always visible.
- **Param summary.** First line only, `text-xs font-mono`, truncate at 80 chars (`text-ellipsis`). Full params behind a "Show all" toggle that expands to a `<pre>` block capped at 200 lines with a "Copy" button.
- **Diff preview.** Always shown for `careful` and `destructive` file-writing tools; collapsible ≤ 20 lines auto-expanded, > 20 lines auto-collapsed with a "Show diff (N lines)" summary.

### Option B — "Binary safe/danger, no diff inline"

- 2 tiers: `safe` / `danger`.
- Diff always behind an "Open diff" button that launches the artifact panel — never inline in the card.
- Card stays compact; diff panel takes over the right side.

Cleaner cards; slower approve flow because every write-tool requires opening the panel.

### Option C — "5-tier with sub-classifications"

- 5 tiers: `safe`, `read-external`, `write-local`, `write-external`, `destructive`.
- Fine-grained but requires every tool author to classify precisely; likely mis-classified in practice and drifts.

**YAML block.** `tool-approval:` — `risk-tiers` (list), per-tier `border-width`, `border-color`, `primary-button-variant`; `param-summary-max-chars`, `diff-inline-line-threshold`.

**DESIGN.md anchor.** `## 4f. Tool Approval`, after § 4e Presence & Activity.

**Extractor sketch.** Scan `apps/app/src/react-app/domains/session/**/*.tsx` for tool-approval-shaped components; flag any card missing the danger-band pattern when the tool metadata says `careful` or `destructive`.

**Default recommendation.** **Option A** — 3 tiers is enough granularity for practical safety without over-taxing tool authors; inline diff for writes matches how Cursor / Aider present tool actions; danger button variant for destructive ops adds a friction point where friction is desirable.

---

## Direct-Draft Items (skip brainstorm, go straight to v5 plan)

These are pattern applications, not decisions. `ce-plan` should include them in the v5 implementation plan without further owner review.

### B8 · Diff & Code Block Inline Styles

- Diff line prefixes `+`/`-` in the gutter, `text-xs font-mono`.
- Addition background `hsl(var(--dls-success-fg) / 0.08)`, removal `hsl(var(--dls-danger) / 0.08)`.
- Line numbers optional, `text-2xs text-dls-text-tertiary`.
- Chunks > 20 lines collapse behind a "Show N more lines" affordance.
- Mono font family remains a Known Gap in DESIGN.md § 14 — use the system-mono fallback declared in § 3 Note on Font Substitutes. v5 does not decide the mono contract.

### B11 · Session Lifecycle Color Coding

Extends `SessionCard` (already a Signature Component in v3 § 4) with 4 variants — no new tokens required:

- `active` (default) — as shipped.
- `archived` — `opacity-60`, `dls-text-secondary` for title.
- `shared` — 2 px left-border `dls-signal`, adds a `link` glyph 12 px in the right slot.
- `read-only` — `bg-dls-surface-muted`, `lock` glyph 12 px in the right slot, disables hover state.

### B12 · Artifact-Type Palette

Extends § 11 Intentional Exceptions with an explicit enumeration. Introduces one new sub-palette `artifact-hue:` for consistent border-accent hues across artifact cards. 8 types, each mapped to an accent color inspired by Radix palette (declared as tokens, not raw hex):

| Type | Border-accent |
| --- | --- |
| `image` | `radix.violet.9` |
| `code` | `radix.blue.9` |
| `document` | `radix.slate.9` |
| `data` | `radix.teal.9` |
| `plot` | `radix.grass.9` |
| `3d` | `radix.plum.9` |
| `audio` | `radix.pink.9` |
| `video` | `radix.crimson.9` |

`artifact-hue:` block sits alongside `iconography:` in YAML; these hues do **not** leak into semantic use (no toast, no button, no status uses them).

---

## Locked Decisions (owner fills in)

Once owner reviews Q1–Q4, replace the placeholders below and hand this file to `ce-plan`.

- **Q1 chosen:** _[A / B / C / custom]_ — Option A (Minimal chrome) proposed as default.
- **Q2 chosen:** _[A / B / C / custom]_ — Option A (Inline block cursor) proposed as default.
- **Q3 chosen:** _[A / B / C / custom]_ — Option A (Reuse semantic tokens) proposed as default.
- **Q4 chosen:** _[A / B / C / custom]_ — Option A (3-tier risk, mono param, always-diff-when-writing) proposed as default.

### Custom-alternative slot

If owner picks "custom" for any Q, sketch it here in one paragraph. `ce-plan` will treat the sketch as the requirement.

---

## Handoff to `ce-plan`

- **Input file.** This doc.
- **Command.** `ce-plan docs/plans/2026-07-04-006-feat-design-md-v5-agent-native-signatures-brainstorm-plan.md`.
- **Expected output.** `docs/plans/2026-07-XX-007-feat-design-md-v5-agent-native-signatures-plan.md` with `artifact_readiness: implementation-ready`.

**What `ce-plan` should produce**
- Turn each locked Q into a concrete unit: DESIGN.md prose section + YAML block + extract-tokens extractor + preview HTML demo.
- Bundle B8/B11/B12 into 3 additional units without further deliberation.
- Add cross-doc pointer units for `theme-system.md` + `AGENTS.md`.
- Estimate ~600 LOC in DESIGN.md, ~200 LOC in extract-tokens.mjs, ~250 LOC in preview HTML.
- Branch: `codex/design-md-v5`, off `main` if PR #26 + PR #28 merged, otherwise stack on `codex/design-md-v4`.

**Prerequisites at v5 kickoff**
- PR #26 (v3) merged.
- PR #28 (v4) merged.
- This doc reviewed by owner with Q1–Q4 answers filled in.
