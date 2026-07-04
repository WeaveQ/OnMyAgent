---
artifact_contract: ce-brainstorm-handoff/v1
created: 2026-07-04
name: DESIGN.md v6+ handoff notes — data-viz, voice/tone, density, mobile
source_plan: docs/plans/2026-07-04-004-feat-design-md-v4-v5-v6-roadmap-plan.md
---

# DESIGN.md v6+ — Handoff Notes

Roadmap 004 identified 4 strategic threads (bucket D) that are too large / cross-team for a single DESIGN.md plan. Each one wants its own `ce-brainstorm` session before any `ce-plan` is written. These notes exist so future owners / agents don't rediscover the same 4 items — they can jump straight to the brainstorm.

Each handoff below is one paragraph containing:
1. **Problem statement** (1 sentence).
2. **Why brainstorm not plan** (1 sentence).
3. **Suggested `ce-brainstorm` opening prompt**.
4. **Stub decision list** (3–5 bullets the brainstorm must resolve).
5. **Rough token/YAML block name** it would introduce.

---

## D-i · Data-Viz / Chart Palette

**Problem.** OnMyAgent currently ships no chart surface, but future features (usage analytics, agent-performance graphs, cost dashboards) will need a categorical + sequential + diverging scale that does not collide with `semantic.*` or `artifact-hue.*`.

**Why brainstorm.** The choice depends on which chart library lands (Recharts, Visx, D3 raw, ECharts) — palette selection differs per library's rendering model, and product signal on primary chart use cases (categorical bar vs. time-series line vs. heatmap) drives the sequential vs. diverging split.

**Suggested brainstorm prompt.** > "Design a data-viz palette for OnMyAgent: 8-color categorical scale + one sequential scale + one diverging scale. Constrain to values expressible via existing Radix palette or new tokens that do not collide with `semantic.*` / `artifact-hue.*`. Start from Vega / Observable / Tableau precedents."

**Stub decisions.**
- Chart library (Recharts vs Visx vs D3 raw).
- Categorical scale hue count (8 vs 12 vs cycled).
- Sequential scale endpoints (viridis-family vs brand-primary-family).
- Diverging pivot color (neutral vs `dls-text-tertiary`).
- Whether data-viz colors need dark-mode variants (yes — but different transformation than `semantic.*`).

**YAML block name.** `data-viz:` with sub-keys `categorical`, `sequential`, `diverging`.

---

## D-ii · Voice & Tone

**Problem.** i18n keys enforce string structure but not voice. Error messages read as terse Rails-style stack summaries; empty states read as ChatGPT-style filler; success confirmations read as debug output. There is no single OnMyAgent voice.

**Why brainstorm.** Voice is a content-design decision that crosses product / marketing / engineering. Cannot be planned as a token — needs example-driven authoring guidelines (like Stripe's or Slack's voice guide) plus per-severity examples.

**Suggested brainstorm prompt.** > "Draft OnMyAgent's voice & tone guide covering: assistant persona (what the model *sounds* like when it speaks), error phrasing (blunt vs helpful vs apologetic), empty-state voice (friendly vs neutral), confirmation phrasing. Include 3 before/after examples per category. Anchor against Stripe / Linear / Vercel voice guides."

**Stub decisions.**
- Assistant persona (concise-professional / warm-informal / minimal-terse).
- Error posture (blame-neutral vs suggest-recovery vs technical-detail).
- Empty-state voice (encouraging vs matter-of-fact).
- Confirmation phrasing pattern (past-tense-completed vs present-tense-status).
- CJK voice parity — translation guidelines beyond literal.

**Artifact.** New `docs/design/voice-and-tone.md`. Not a DESIGN.md YAML block — voice is prose.

---

## D-iii · Density Modes

**Problem.** DESIGN.md today assumes a single density (Comfortable — rail 240 px, row padding `px-3 py-2.5`, base text 14 px). Power users on 4K screens want Compact (rail 200 px, row `px-2 py-1.5`, base 13 px); presentation contexts (screen sharing, on-boarding) want Spacious (rail 280 px, row `px-4 py-3.5`, base 15 px).

**Why brainstorm.** Density forks every layout / spacing / text-size token by 2–3×. Needs user research on which workflows benefit (long-list scanning, dense-form editing, presentations) before touching tokens. Also decides whether density is per-workspace or per-user preference.

**Suggested brainstorm prompt.** > "Scope OnMyAgent density modes: Compact / Comfortable / Spacious. Decide which surfaces respect density (rail, main panel, dialogs? all?), how tokens fork (parallel `--dls-*-compact`? runtime scale multiplier? density-class root attribute?), and how to test drift when 3 modes ship."

**Stub decisions.**
- Number of modes (2 vs 3 vs 5).
- Fork mechanism (parallel tokens vs runtime scale multiplier vs CSS class root).
- Which surfaces respect density (rail always vs opt-in; main panel opt-in vs mandatory; dialogs never).
- Per-workspace or per-user preference.
- How `extract-tokens.mjs` extends to check density-forked tokens.

**YAML block name.** `density:` — a mode key + per-mode token overrides. Complex; requires v5-shape extractor extensions.

---

## D-iv · Mobile Companion

**Problem.** OnMyAgent today is Electron desktop-only (min window 900 px per DESIGN.md § 10). No mobile client exists. If a companion iOS / Android / responsive-web client lands, DESIGN.md's Breakpoints table (Narrow < 900 px) does not cover it.

**Why brainstorm.** Even the *decision to ship mobile at all* is upstream of the design token conversation. If mobile ships, touch-target minimums, safe-area insets, sheet-vs-dialog behavior, and navigation model all need product-level decisions before token forks.

**Suggested brainstorm prompt.** > "Scope a mobile companion for OnMyAgent: iOS SwiftUI native / Android Compose native / responsive PWA. Decide primary surface (chat only? full workbench?), which features port (session view, artifact panel, tool approvals?), and how DESIGN.md tokens fork for mobile (44 px touch floor, safe-area, sheet-instead-of-dialog)."

**Stub decisions.**
- Ship mobile at all (yes / no / not yet).
- Platform (native iOS + Android vs single responsive web).
- Feature scope (chat only vs full workbench).
- Touch-target policy (upgrade 24/32/36/40 → 32/40/44/48 on mobile).
- Whether desktop DESIGN.md forks a `mobile/DESIGN.md` sibling or grows a `platforms.mobile:` block.

**YAML block name.** `platforms.mobile:` (if a companion ships) — TBD.

---

## Sequencing

Each of D-i / D-ii / D-iii / D-iv is independent — they can be brainstormed in any order, or in parallel by different owners. None block v4 or v5. All should wait until v5 lands so agent-native signatures are stable before v6 layers on top.

## Follow-ups

When one of these becomes active work, `ce-brainstorm` with the suggested prompt, then hand the requirements-only plan to `ce-plan`. The DESIGN.md contract for that D-item then follows the same shape v3/v4/v5 took: YAML block + section + extractor + preview HTML + cross-doc pointer.
