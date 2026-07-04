---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-07-04
name: OnMyAgent DESIGN.md v3 — canonical 9 + extensions
---

# OnMyAgent DESIGN.md v3 — Plan

## Goal Capsule

**Objective.** Bring `DESIGN.md` from v2 (motion + focus + `extract-tokens` shipped in PR #24 / PR #25) up to full parity with the getdesign.md canonical 9-section spec **and** the extension conventions observed across Apple / Vercel / Notion / Figma exemplars. v3 does not invent new visual rules — it deepens the sections that were thin (`Colors`, `Typography`, `Layout`, `Components` prose) and adds the six sections OnMyAgent currently lacks: `Shapes`, `Iconography`, `Signature Components`, `Iteration Guide`, `Known Gaps`, and a `Note on Font Substitutes`. Elevation & Depth grows a z-index / z-layer table. Responsive & Platform grows `Breakpoints / Touch Targets / Collapsing Strategy / Image Behavior` sub-structure and covers Windows / Linux titlebar behavior.

**Product authority.** Documentation-only contract change plus small extensions to `scripts/design/extract-tokens.mjs` so newly-added token blocks (iconography, z-layer) participate in drift detection. No runtime code behavior changes in `apps/**`.

**Open blockers.** None. User confirmed the v3-full scope (gap-analysis turn earlier in this session).

---

## Product Contract

### Problem Frame

`DESIGN.md` v2 covers all 9 canonical getdesign.md sections at *some* depth, but a side-by-side against 4 exemplars (Apple / Vercel / Notion / Figma) showed:

- **Colors** exists but is not sub-grouped (Brand & Accent / Surface / Text / Hairlines / Semantic) and no color carries a one-sentence *role rationale*. Every exemplar does both.
- **Typography** has hierarchy but no `Principles` paragraph and no `Note on Font Substitutes` — a hard requirement when the brand faces (Geist Variable, IBM Plex Sans Variable) are non-system.
- **Layout** covers spacing but omits `Grid & Container` (max-width, gutter, column patterns) and `Whitespace Philosophy`. Every exemplar carries both.
- **Depth** bans shadows but does not expose the **z-index / elevation stack** (dialog > popover > tooltip > toast). Agents currently invent z-indexes.
- **Component prose** covers 5–6 of 41 atoms + 3 row primitives, with no *signature components* (chat message row, session card, agent avatar mesh, artifact card) — the ones that carry OnMyAgent's identity.
- **Responsive & Platform** is macOS-only and lacks the standard four-part shape (Breakpoints table, Touch Targets, Collapsing Strategy, Image Behavior). Windows and Linux titlebar/frame behavior is undocumented despite the app shipping on all three.
- **Shapes** does not exist as an independent section. Border-radius scale lives only inside YAML; there is no `Photography Geometry` or icon-shape guidance.
- **Iconography** is undefined. Icon sizes, stroke width, and library (Lucide subset) are not tokenized.
- **Iteration Guide** does not exist. When an agent needs to add a new token or component, there is no documented workflow to consult.
- **Known Gaps** does not exist. Every exemplar closes with an honest list of what the file *doesn't* cover; ours implies false completeness.

The v2 authority model (`DESIGN.md > code`) is now robust, but the *content* the model authorizes still has canonical gaps that let agents fall back to guessing.

### Primary Actor

**AI coding agents** (Codex, Claude, OpenCode) generating or modifying UI, with **project owner** as the secondary consumer running `pnpm task check design` and reviewing DESIGN.md-driven PRs.

### Core Outcome

- `DESIGN.md` grows two YAML blocks (`iconography`, `z-layers`) and eight prose sub-additions across existing sections.
- Six new top-level or sub sections appear: `Shapes`, `Iconography`, `Signature Components` (as a sub of `Component Stylings`), `Iteration Guide`, `Known Gaps`, `Note on Font Substitutes` (as a sub of `Typography`).
- `Elevation & Depth` grows a z-layer table with 6 declared levels.
- `Responsive & Platform` grows to four canonical sub-sections and covers Windows / Linux titlebar.
- `extract-tokens.mjs` learns to diff the new `iconography` and `z-layers` blocks; `pnpm task check design` continues to pass on clean tree.
- Preview HTML gains an Icon size grid + z-layer visualization block.
- `docs/design/theme-system.md` gets pointer sentences for the new sections; `AGENTS.md` UI rule references v3 additions.

### Positioning

DESIGN.md remains the single source of truth for the visual contract. v3 does **not** introduce new visual rules, does **not** change token values already shipped in v1/v2, and does **not** re-scope the authority model — it only fills documented gaps against the canonical getdesign.md spec and the exemplar patterns observed in Apple / Vercel / Notion / Figma. `theme-system.md` continues to hold the *why* narrative and defers tokens to DESIGN.md. `AGENTS.md` continues to hold the engineering contract. This is a **depth pass**, not a rewrite.

### Scope

**In-scope (v3)**

- **R1. Colors depth.** Restructure `## 2. Color Palette` into five sub-headings — `### Brand & Accent`, `### Surface`, `### Text`, `### Hairlines & Borders`, `### Semantic` — with each token given a one-sentence rationale ("what job does this color do in the system?"). No new hex; every value stays canonical to the shipped YAML.
- **R2. Typography depth.** Under `## 3. Typography`, add `### Principles` (why the even-scale, why weight-first hierarchy, why two faces) and `### Note on Font Substitutes` (fallbacks for Geist Variable and IBM Plex Sans Variable so agents rendering without the licensed faces do not silently pick Arial).
- **R3. Layout depth.** Under `## 5. Layout`, add `### Spacing System` (formalize the existing prose against the YAML `spacing.base` token), `### Grid & Container` (max content width, gutters, column patterns for shell / dialogs / rail), and `### Whitespace Philosophy` (dense-but-calm, tight interior + generous section gaps).
- **R4. Elevation depth + z-layers.** Under `## 6. Depth`, add `### Decorative Depth` (state OnMyAgent's stance: no gradients, no glow, no noise — flatness is a decision) and `### Z-Layer Stack` (6-level table: base=0, sticky=10, dropdown=100, popover=200, dialog=300, toast=400; tie to a new YAML `z-layers:` block). Cross-reference the shadcn / Radix z-index conventions the primitives already assume.
- **R5. New `## 7. Shapes` section.** Split from § 6. Contains `### Border Radius Scale` (surface the YAML `rounded:` block with per-use guidance: buttons `lg`, cards `md`, dialogs `xl`, chips `pill`), `### Iconography` (icon sizes 12/14/16/20/24; stroke width 1.5; library = Lucide subset; forbidden-icon-libraries list), and `### Photography & Illustration Geometry` (aspect ratios for avatars, artifact previews, empty-state hero; corner treatment on media).
- **R6. New YAML `iconography:` block** in front matter — sizes `xs/sm/base/lg/xl`, `stroke-width: 1.5`, `library: lucide-react`, `paint: currentColor`. Wire this token block into `extract-tokens.mjs` R11.
- **R7. New YAML `z-layers:` block** in front matter — `base/sticky/dropdown/popover/dialog/toast` values. Wire into `extract-tokens.mjs` R11.
- **R8. Component prose expansion.** Under `## 4. Component Stylings`, add `### Signature Components` covering the 4 OnMyAgent-native identity components: `ChatMessage row`, `SessionCard`, `AgentAvatarMesh` (the mesh identity primitive), `ArtifactCard`. Each entry = one paragraph naming surface / typography / padding / radius / interactive state using `{token.refs}`. Non-signature atoms remain covered by "defer to shadcn primitives" one-liner already present.
- **R9. Responsive & Platform depth.** Under `## 9`, restructure into four sub-headings: `### Breakpoints` (narrow / default / wide, based on Electron min-window 900px), `### Touch Targets` (Electron desktop is mouse/trackpad-primary — 24 / 32 / 36 primitives explicitly meet the 24 px keyboard-navigable floor; add note on why 44 px WCAG floor does not apply on desktop pointer surfaces), `### Collapsing Strategy` (rail collapse via sidebar primitive; right panel closes; dialog fullscreen threshold), `### Image Behavior` (avatar mesh renders at 32/40/64 densities; artifact previews maintain 16:9). Cover Windows / Linux titlebar in a `### Cross-Platform Titlebar` sub — `windows:titlebar-*` and `linux:titlebar-*` variants; system frames on non-macOS, no `mac:titlebar-no-drag` needed but analogous `windows:titlebar-no-drag` / `linux:titlebar-no-drag` must not be silently omitted.
- **R10. New top-level `## 13. Iteration Guide` section.** Explains the *process* to extend DESIGN.md: when to add a new token vs. reuse; when to add a signature component; how to run `pnpm task check design`; how to update the preview HTML; the ownership boundary between `DESIGN.md` (tokens + rules) and `theme-system.md` (narrative). Points at v1/v2/v3 plan docs as examples.
- **R11. `extract-tokens.mjs` extension.** Add two extractors: one that reads the new `iconography:` block and diffs against the icon-usage sites in `apps/app/src/**/*.tsx` (best-effort regex over `lucide-react` imports and `size=` props on icon components), and one that reads `z-layers:` and diffs against `--dls-z-*` CSS variables in `apps/app/src/app/index.css`. Both are **report-only additions**; `--strict` continues to gate on any drift. Preserve v2 behavior for existing 62 tokens.
- **R12. New top-level `## 14. Known Gaps` section.** Honest list of what v3 still does not cover: data-viz / chart palette, copy voice / tone, brand assets (logo variants, wordmark), marketing surface (deferred — no marketing surface exists yet), CI gate (human-gated per AGENTS.md), auto-fix codemod, per-domain composites v2 catalog, animation choreography beyond duration/easing tokens.
- **R13. Preview HTML additions.** In `docs/design/preview.html` + `preview-dark.html`, add an Icon-size grid section (5 sizes × 3 stroke widths visualization) and a Z-Layer stack demo (visual overlay showing dialog > popover > tooltip > toast). Keep the v2 Motion + Focus sections untouched.
- **R14. Cross-doc pointer updates.** In `docs/design/theme-system.md`, add pointer sentences to the new sections (§ 7 Shapes, § 12 Iteration Guide, § 13 Known Gaps). In `AGENTS.md`, update the UI rule to reference v3 additions (icon sizes, z-layers). In `docs/README.md`, no change needed (already points at DESIGN.md as canonical).
- **R15. PR path.** Land v3 on a new branch `codex/design-md-v3` off `main` (after PR #25 merges) or off `codex/design-md-v2` if PR #25 is still open. Open a fresh PR. Do not stack on top of v2 unless #25 is still open at U-kickoff.

**Out-of-scope (deferred to v4 or beyond)**

- Data-viz / chart palette — belongs in a separate visual-language pass with product owner.
- Copy voice / tone guide — needs product / marketing signoff; not agent-first work.
- Brand asset system (logo variants, wordmark, favicon) — visual brand identity is a separate track.
- CI gate wiring for `pnpm task check design` in `.github/workflows/**` — human-gated per AGENTS.md.
- Auto-fix codemod for drift — v2 detection is enough for now; codemod is future work.
- Marketing / landing surface tokens — no marketing surface exists in scope.
- Domain composites v2 catalog — expansion of `apps/app/src/react-app/design-system/` beyond the 5 existing composites is a `frontend-primitive-refactor` skill task, not a DESIGN.md task.

**Deferred to Follow-Up Work** (planned but not this PR)

- Adding actual `--dls-z-*` CSS variables in `apps/app/src/app/index.css` (human-gated file). v3 declares the tokens in DESIGN.md YAML; the CSS variable addition + a `frontend-primitive-refactor` sweep on z-index literals lands in a separate PR after v3 merges.
- Adding a `--dls-icon-*` size token family if we want icon-size tokens to be CSS-consumable (v3 keeps them TSX-consumable via primitive props).
- The 5 `text-[13px]` / `text-[11px]` sites from v2's audit — still open, still a `frontend-primitive-refactor` task.

### Success Criteria

- `DESIGN.md` grows to ~13 sections + Related documents block, all conforming to the canonical getdesign.md 9-section shape.
- `pnpm task check design` passes on clean tree with new `iconography:` + `z-layers:` extractors wired.
- `pnpm task check design -- --strict` reports drift honestly (fine if it flags newly-declared tokens not yet in CSS — that goes into "Deferred to Follow-Up Work" per R7).
- Preview HTML files parse cleanly and render both new sections.
- Gap-analysis table (from the "还有什么" turn) shows all `❌` and `⚠️` rows become `✅` after v3 ships, except the 4 out-of-scope items honestly listed in `## 14. Known Gaps`.
- No changes to `apps/**`, `packages/**`, `.github/**`, `package.json`, `pnpm-lock.yaml`.

---

## Key Technical Decisions

### KTD1. Two new YAML blocks, not one

`iconography:` and `z-layers:` land as **separate** YAML blocks under front matter, not merged into `components:` or `spacing:`. Rationale: `extract-tokens.mjs` currently extracts by top-level YAML key; keeping them as siblings preserves the extractor architecture. It also mirrors the exemplar convention (Apple / Vercel / Notion / Figma all declare iconography and z-index/elevation as top-level YAML groups, not nested).

### KTD2. Z-layers declared as tokens, CSS variables land later

DESIGN.md v3 authorizes the z-layer values but does **not** commit to a specific CSS-variable naming (`--dls-z-*` vs `--ow-z-*` vs Tailwind theme extension). The CSS wire-up is a `codex/design-tokens-css-z` follow-up PR that human-gates on `apps/app/src/app/index.css`. This keeps v3 as a docs-only change while still declaring the contract.

### KTD3. Signature Components list stays small (4)

Only `ChatMessage row`, `SessionCard`, `AgentAvatarMesh`, `ArtifactCard` earn signature-component status. Rationale: exemplars use signature components as *brand identity anchors*, not as a component catalog. 4 is the ceiling that keeps the section scannable. The other 41 atoms + composites remain covered by the existing "reuse the primitive" prose.

### KTD4. Icon library is Lucide, stroke 1.5, not the Radix icon set

We already ship `lucide-react`. Declaring it as the contract locks out agents that would otherwise reach for `@radix-ui/react-icons` (thinner, filled variants exist), `@heroicons/react`, or `phosphor-icons`. Stroke 1.5 matches the current default; 2.0 (Lucide default) is too heavy against 14px body.

### KTD5. Windows / Linux titlebar variants added but not enforced with a flag

`windows:titlebar-no-drag` and `linux:titlebar-no-drag` custom variants are declared in DESIGN.md v3 as the *expected* naming, but the hard flag stays macOS-only (`mac-titlebar-no-drag: required-on-titlebar-and-sidebar-header-controls`). Rationale: system-frame titlebars on Windows/Linux do not currently steal clicks the way macOS `hiddenInset` does; the utility exists for future-proofing but is not enforced.

### KTD6. Preview HTML gets new sections, not a rewrite

`preview.html` / `preview-dark.html` retain the v1 + v2 sections verbatim. v3 appends two new demo blocks (Icon grid + Z-layer stack) at the bottom, before the closing `</body>`. No refactor of the existing color / typography / motion / focus demos.

### KTD7. Iteration Guide is a process doc, not a checklist

`## 13. Iteration Guide` is 3–5 prose paragraphs explaining *when* to extend DESIGN.md vs. patch a primitive vs. write a plan doc. It is not a step-by-step checklist — checklists rot; principles rot slower. Points at v1/v2/v3 plan docs as worked examples.

---

## Alternatives Considered

- **Single monolithic YAML rewrite.** Considered merging all new blocks (iconography, z-layers) into a single `theme:` root object. Rejected — breaks v2's `extract-tokens.mjs` top-level-key architecture and gives no downstream benefit.
- **Adopt shadcn's default z-index constants directly (no YAML block).** Considered — shadcn primitives already ship a z-index convention. Rejected because it leaves the contract implicit; agents generating custom overlays would still invent numbers.
- **Skip Signature Components section, expand atom prose to all 41.** Considered — but produces a 200-line component catalog that duplicates `apps/app/src/components/ui/`. Signature-only stays scannable and brand-identity-focused, matching exemplar convention.
- **Delete `theme-system.md`, fold narrative into DESIGN.md.** Rejected — separation of *contract* (DESIGN.md) from *rationale* (theme-system.md) is intentional. v3 preserves the boundary.
- **Publish v3 as two PRs (docs-only + extract-tokens change).** Considered for smaller reviewer diffs. Rejected because `extract-tokens.mjs` needs the new YAML blocks to test against; splitting causes half-landed state.

---

## Implementation Units

### U1. YAML front matter — add `iconography:` and `z-layers:` blocks

**Goal.** Extend `DESIGN.md` front matter with two new token blocks so downstream extractor + prose sections can reference `{iconography.base}` and `{z-layers.dialog}`.

**Requirements.** R6, R7.

**Dependencies.** None.

**Files.**

- `DESIGN.md` (front matter only, lines ~1–210)

**Approach.**

- Add `iconography:` block after `focus:`. Keys: `size.xs: 12`, `size.sm: 14`, `size.base: 16`, `size.lg: 20`, `size.xl: 24`; `stroke-width: 1.5`; `library: lucide-react`; `paint: currentColor`; `forbidden: [heroicons, phosphor-icons, radix-icons-fill]`.
- Add `z-layers:` block after `iconography:`. Keys: `base: 0`, `sticky: 10`, `dropdown: 100`, `popover: 200`, `dialog: 300`, `toast: 400`, `overlay-max: 999`.
- Keep alphabetical / logical ordering with existing blocks; do not reorder v1/v2 blocks.
- Update the `flags:` block with `icon-library: lucide-only` (new required flag).

**Patterns to follow.** Existing `motion:` and `focus:` YAML shape (v2).

**Test scenarios.** N/A — front-matter data change. Covered by U8 script test.

**Verification.**

- `head -220 DESIGN.md | grep -c '^iconography:'` returns 1.
- `head -220 DESIGN.md | grep -c '^z-layers:'` returns 1.
- Existing tokens unchanged: `head -220 DESIGN.md | grep -c '^motion:'` returns 1, `focus:` returns 1.

### U2. Colors section — restructure into 5 sub-groups with per-token rationale

**Goal.** Rewrite `## 2. Color Palette` prose from 20 lines of flat rules into 5 named sub-sections, each with role-tagged bullets.

**Requirements.** R1.

**Dependencies.** U1 (not strictly, but committed together for reviewer coherence).

**Files.**

- `DESIGN.md` (§ 2 body, roughly lines 226–244 pre-edit → ~90 lines post-edit)

**Approach.**

- Sub-sections in order: `### Brand & Accent` (primary, primary-hover, signal), `### Surface` (surface, surface-muted, background, app-bg, sidebar, rail-*), `### Text` (ink, slate, and dls-text-* narrative), `### Hairlines & Borders` (mist, border, border-strong), `### Semantic` (danger, warning, success-fg, online + soft/fg/border variants).
- Each color entry format: `**Name** ({colors.{light|dark}.token}) — one-sentence role. Used on X because Y.` Follow exemplar phrasing.
- Preserve the "Key rules" paragraph at the end of the section, unchanged.
- Do not restate hex values inline — reference via `{colors.light.primary}` / `{colors.dark.primary}` per canonical convention (YAML holds the value).

**Patterns to follow.** Vercel `## Colors` sub-grouping (see `/tmp/dm-vercel.md` from research phase). Do not import their content — mirror the shape only.

**Test scenarios.**

- Every hex value declared in YAML `colors.light:` or `colors.dark:` gets at least one prose reference in the new sub-sections (visual check via `rg`).
- No inline hex values in the § 2 prose body.

**Verification.**

- `awk '/^## 2\./,/^## 3\./' DESIGN.md | grep -c '^### '` returns 5.
- `awk '/^## 2\./,/^## 3\./' DESIGN.md | grep -Ec '#[0-9A-Fa-f]{6}'` returns 0.

### U3. Typography section — add Principles + Note on Font Substitutes

**Goal.** Under `## 3. Typography`, add two new sub-sections without touching the shipped hierarchy rules.

**Requirements.** R2.

**Dependencies.** None (independent of U1/U2).

**Files.**

- `DESIGN.md` (§ 3, roughly lines 244–260 pre-edit → +40 lines)

**Approach.**

- Add `### Principles` after the current bullet list: 2 paragraphs explaining (a) why even-scale-only (agent generation stability), (b) why weight-first hierarchy over size proliferation, (c) why two faces (heading vs body) and not one.
- Add `### Note on Font Substitutes` at end: fallbacks in order — Geist Variable → Inter → system-ui → -apple-system → sans-serif; IBM Plex Sans Variable → Inter → system-ui → -apple-system → sans-serif. Note: mono is deferred (no mono contract yet — surface in Known Gaps).
- Preserve every existing bullet in § 3.

**Patterns to follow.** Vercel `### Principles` + `### Note on Font Substitutes` prose shape.

**Test scenarios.** N/A — pure prose. Covered by U11 preview render.

**Verification.**

- `awk '/^## 3\./,/^## 4\./' DESIGN.md | grep -c '^### Principles'` returns 1.
- `awk '/^## 3\./,/^## 4\./' DESIGN.md | grep -c '^### Note on Font Substitutes'` returns 1.

### U4. Layout section — add Spacing System + Grid & Container + Whitespace Philosophy

**Goal.** Under `## 5. Layout`, restructure into three named sub-sections and add container/grid guidance the exemplars all carry.

**Requirements.** R3.

**Dependencies.** None.

**Files.**

- `DESIGN.md` (§ 5, roughly lines 305–323 pre-edit → +50 lines)

**Approach.**

- `### Spacing System`: surface YAML `spacing.base: 4` as authoritative; enumerate common step values (4/8/12/16/24/32/48) as agent-facing shorthand. Reference the existing `row-padding` / `menu-row-padding` / `dialog-footer-gap` tokens as canonical usage.
- `### Grid & Container`: shell = rail (240px collapsible) + main panel + optional right panel (320–560px resizable). Dialogs cap at 640px default, 800px large. Popovers cap at 320px. No page-level `max-w-*` overrides.
- `### Whitespace Philosophy`: dense-but-calm — tight interior padding (12/16px) inside cards and rows, generous gap between sections (24/32px), section-boundary gap 48px. Rail is quiet-cold; content surface has room to breathe.
- Preserve the existing prose about rail / titlebar / content surface — move it under a new `### Shell Composition` sub-section so nothing is dropped.

**Patterns to follow.** Vercel `### Spacing System` + `### Grid & Container` + `### Whitespace Philosophy` shape.

**Test scenarios.** N/A — prose.

**Verification.**

- `awk '/^## 5\./,/^## 6\./' DESIGN.md | grep -c '^### '` returns >= 4 (Shell Composition + Spacing + Grid & Container + Whitespace).
- Existing rail / titlebar text is present verbatim (spot-check `mac:titlebar-no-drag` still mentioned).

### U5. Depth section — add Decorative Depth + Z-Layer Stack table

**Goal.** Under `## 6. Depth`, add two sub-sections that expose OnMyAgent's flatness stance and the z-index contract.

**Requirements.** R4.

**Dependencies.** U1 (needs `z-layers:` YAML block).

**Files.**

- `DESIGN.md` (§ 6, roughly lines 323–358 pre-edit → +30 lines)

**Approach.**

- `### Decorative Depth`: 1 paragraph stating that OnMyAgent explicitly rejects decorative depth — no gradients-as-decoration, no glow, no noise textures, no glassmorphism blur outside the shipped `blur-*` composited surface tokens. Flatness is a decision, not a limitation.
- `### Z-Layer Stack`: 6-row table (Layer / Value / Use) sourced from the YAML `z-layers:` block. Cross-reference the shadcn / Radix implicit convention (`data-[state=open]:z-*` on popovers).
- Preserve existing motion + scrollbar prose in § 6.

**Patterns to follow.** Existing motion table shape (v2).

**Test scenarios.** N/A — prose + table.

**Verification.**

- `awk '/^## 6\./,/^## 7\./' DESIGN.md | grep -c '^### Z-Layer Stack'` returns 1.
- `awk '/^## 6\./,/^## 7\./' DESIGN.md | grep -c '^### Decorative Depth'` returns 1.
- Existing "No component shadows" bullet still present.

### U6. New `## 7. Shapes` section

**Goal.** Introduce a new top-level section covering border-radius scale, iconography, and photography/illustration geometry. Renumber v2's `## 7. Do's and Don'ts` → `## 8`, and cascade all subsequent § numbers by +1.

**Requirements.** R5, R6.

**Dependencies.** U1 (needs `iconography:` YAML).

**Files.**

- `DESIGN.md` (new § 7 inserted; §§ 7–11 renumbered to §§ 8–12)

**Approach.**

- `### Border Radius Scale`: surface YAML `rounded:` block as a table. Per-use guidance: `xs (3)` for status dots and tiny indicators, `sm (6)` for status badges and chips, `md (8)` for cards and inputs, `lg (10)` for standard buttons, `xl (14)` for large buttons and dialog panels, `pill (999)` for status pills and filter chips. Explicitly forbid `rounded-full` on standard CTAs (already in Do's/Don'ts — cross-reference it).
- `### Iconography`: surface YAML `iconography:` block as a table (size × use). `xs (12)` inline hint icons, `sm (14)` in-row action icons, `base (16)` menu icons and default buttons, `lg (20)` primary CTAs and section headers, `xl (24)` empty-state hero decoration. Stroke width 1.5 across the board. Library = `lucide-react` only; forbidden alternates listed. Icon color inherits from `currentColor`; do not hardcode icon fill.
- `### Photography & Illustration Geometry`: avatar mesh = 32/40/64 px densities (defined by primitive; do not override); artifact preview = 16:9 aspect, `rounded-md` corners; empty-state hero illustration = intrinsic aspect, `rounded-lg`, max-height 240px.
- Renumber all subsequent `## N.` headings and internal cross-references in the same edit. Update the "Agent Prompt Guide" (formerly § 11, now § 12) reference to § 4 / § 7 accordingly.

**Patterns to follow.** Figma `## Shapes` + `### Border Radius Scale` + `### Photography Geometry` structure.

**Test scenarios.**

- All internal `§ N` references in the file resolve to their new numbers.
- The "Related documents" tail is still present unchanged.

**Verification.**

- `grep -c '^## 7\. Shapes' DESIGN.md` returns 1.
- `grep -c '^## 8\. Do' DESIGN.md` returns 1.
- `grep -c '^## 14\. Known Gaps' DESIGN.md` returns 1 (after U10).
- No dangling `§ 4` / `§ 7` / `§ 10` references pointing at the wrong content — spot-check via `grep -n '§ ' DESIGN.md`.

### U7. Component Stylings — add Signature Components sub-section

**Goal.** Under `## 4. Component Stylings`, add a new `### Signature Components` sub covering the 4 identity components.

**Requirements.** R8.

**Dependencies.** None (independent).

**Files.**

- `DESIGN.md` (§ 4 body, +40 lines)

**Approach.**

- Insert `### Signature Components` after the existing "Status" sub-section, before the section ends.
- Entries (paragraph each, using `{token.refs}`):
  - **`ChatMessage row`** — content-first row: 12px vertical rhythm, avatar 32px on the left, message body `text-sm` with `text-dls-text-primary`, timestamp `text-xs text-dls-text-tertiary` right-aligned. No card chrome; row is separated by a hairline only on hover-selected or grouping boundaries.
  - **`SessionCard`** — the primary session/chat entry in the rail-adjacent list: `rounded-md` (8px), `bg-dls-surface`, `border` on hover, active state uses `dls-active`. Title `text-sm font-medium`, subtitle `text-xs text-dls-text-secondary`, unread signal-cyan dot on the right.
  - **`AgentAvatarMesh`** — brand-identity mesh gradient primitive for agent avatars. Renders at 32/40/64px densities via primitive props (not raw h/w). Uses a derived gradient from the agent's identity hash; opaque, no border. This is *the* brand chrome moment; do not decorate elsewhere.
  - **`ArtifactCard`** — inline artifact preview card: `rounded-md`, `border-dls-border`, `p-3`, 16:9 preview at top, filename `text-sm`, type badge as `StatusBadge`. Click opens the artifact panel via the resizable primitive.
- Preserve all existing component prose in § 4.

**Patterns to follow.** Notion `### Signature Components` + Figma `### Color-Block Sections (signature)` shape.

**Test scenarios.** N/A — prose.

**Verification.**

- `awk '/^## 4\./,/^## 5\./' DESIGN.md | grep -c '^### Signature Components'` returns 1.
- All 4 signature component names appear as bold-code entries.

### U8. `extract-tokens.mjs` — add iconography + z-layers extractors

**Goal.** Extend the v2 script so it diffs the two new YAML blocks against code sources. Preserve all v2 behavior for existing 62 tokens.

**Requirements.** R11.

**Dependencies.** U1 (needs the new YAML blocks to extract).

**Files.**

- `scripts/design/extract-tokens.mjs` — extend with two new extractor functions.
- (Read-only) `apps/app/src/app/index.css` — scan for `--dls-z-*` variables.
- (Read-only) `apps/app/src/**/*.tsx` — best-effort scan for `lucide-react` imports and icon `size=` props.

**Approach.**

- Add `extractIconographyTokens(designMd)` — parses the `iconography:` YAML block, returns a normalized `{ sizes: {xs, sm, base, lg, xl}, strokeWidth, library, paint }` object.
- Add `extractZLayerTokens(designMd)` — parses the `z-layers:` block, returns `{ base, sticky, dropdown, popover, dialog, toast, overlay-max }`.
- Add `scanIconUsage(rootDir)` — best-effort grep for `size={N}` and `size="N"` on components imported from `lucide-react`; classify each hit against the token sizes, flag mismatches as `drift`.
- Add `scanZLayerUsage(cssPath)` — grep `--dls-z-` lines in `apps/app/src/app/index.css`; produce a `{ tokenName: value }` map; diff against the DESIGN.md contract.
- Wire both into the report: two new categories (`iconography-drift`, `z-layer-drift`). Report-only by default; `--strict` continues to exit 1 on any drift including these.
- Preserve `--json` output: add `iconography` and `zLayers` sub-objects.

**Patterns to follow.** Existing extractor architecture in v2 (see the module's exported `extractColorTokens` / `extractTypographyTokens`).

**Test scenarios.**

- Happy path: run script on a clean tree; new extractors report 0 drift for existing tokens; existing 62 tokens still match.
- Iconography drift: temporarily change `iconography.size.base: 16` → `18` in DESIGN.md; script flags `iconography.size.base: expected 18, code sites reference 16`.
- Z-layer drift: adjust `z-layers.dialog: 300` → `301`; script reports the delta (CSS variable if present, else "missing-in-code — declare `--dls-z-dialog`").
- `--strict` mode still exits 1 when any category has drift, 0 when clean.
- `--json` output parses as valid JSON with `iconography` and `zLayers` top-level keys.

**Verification.**

- `node scripts/design/extract-tokens.mjs --json | jq '.iconography, .zLayers'` returns both objects.
- `node scripts/design/extract-tokens.mjs` exit 0 on clean tree.
- Manual drift-injection test (per test scenarios above) captured in PR body.

### U9. New `## 13. Iteration Guide` section

**Goal.** New top-level section explaining the process of extending DESIGN.md.

**Requirements.** R10.

**Dependencies.** None.

**Files.**

- `DESIGN.md` (new section inserted after § 11 → renumbered to § 12 per U6's cascade)

**Approach.**

- 3–4 paragraphs:
  1. When to add a new token vs. reuse an existing one — the "1 site" (reuse), "2–3 sites" (variant on existing primitive), "4+ sites or brand-identity moment" (new token in DESIGN.md YAML) rule.
  2. When to add a new signature component vs. compose with primitives — signature = OnMyAgent-native brand identity; everything else stays composed.
  3. The workflow: (a) write a plan doc in `docs/plans/YYYY-MM-DD-NNN-feat-design-md-vN-plan.md`, (b) update DESIGN.md YAML + prose, (c) extend `extract-tokens.mjs` if new YAML block added, (d) run `pnpm task check design`, (e) update `preview.html` if the token is visualizable, (f) update pointer sentences in `theme-system.md` and this file's `## 14. Known Gaps` if newly covered.
  4. Point at v1 / v2 / v3 plan docs as worked examples.

**Patterns to follow.** Apple `## Iteration Guide` structure.

**Test scenarios.** N/A — prose.

**Verification.**

- `grep -c '^## 13\. Iteration Guide' DESIGN.md` returns 1.
- Points explicitly at the three plan-doc paths.

### U10. New `## 14. Known Gaps` section

**Goal.** New top-level tail section listing what v3 explicitly does not cover.

**Requirements.** R12.

**Dependencies.** U6 (renumbering cascade must have run so this lands at § 13).

**Files.**

- `DESIGN.md` (new section, ~30 lines)

**Approach.**

- Bulleted list, each item = 1–2 sentences, no fluff:
  - Data-viz / chart palette — no chart surface exists yet; agents rendering charts should surface a proposal PR before shipping.
  - Copy voice / tone guide — deferred to product/marketing signoff.
  - Brand assets (logo variants, wordmark, favicon) — brand identity is a separate track.
  - Marketing / landing surface — no marketing surface in scope; `apps/web/*` is out.
  - Mono font contract — no code-block or terminal component ships in the current UI; deferred.
  - CI gate for `pnpm task check design` — human-gated per AGENTS.md.
  - Auto-fix codemod for drift — v2/v3 detection is sufficient; codemod is future work.
  - Domain composites v2 catalog — expansion beyond the 5 existing composites is a `frontend-primitive-refactor` task.
  - Animation choreography beyond duration/easing — sequenced multi-element transitions are agent-local decisions.
- End with 1 sentence pointing at the Iteration Guide for how to close a gap.

**Patterns to follow.** Every exemplar's closing `## Known Gaps` section.

**Test scenarios.** N/A — prose.

**Verification.**

- `grep -c '^## 14\. Known Gaps' DESIGN.md` returns 1.
- All 8 gap items listed above are present.

### U11. Preview HTML — Icon grid + Z-layer stack demo

**Goal.** Append two new demo sections to `docs/design/preview.html` and `preview-dark.html`.

**Requirements.** R13.

**Dependencies.** U1 (needs YAML token values to visualize).

**Files.**

- `docs/design/preview.html` — append 2 sections before `</body>`.
- `docs/design/preview-dark.html` — same append.

**Approach.**

- Icon grid: static SVG demonstration using Lucide's public SVG paths for `check`, `chevron-right`, `settings`, `search`, `plus` icons rendered at 12/14/16/20/24 px with stroke-width 1.5. Grid layout: 5 icons × 5 sizes = 25 cells; label sizes above columns.
- Z-layer stack: absolute-positioned overlays with `z-index: 10/100/200/300/400` and labels ("sticky", "dropdown", "popover", "dialog", "toast"), showing stack order. Use `--dls-*` background colors so dark preview inverts correctly.
- Match v2's Motion + Focus section styling (borders, headings, `Geist Variable`, dark-preview color inversions).

**Patterns to follow.** v2 Motion / Focus preview sections.

**Test scenarios.**

- Both HTML files parse without console errors when opened directly in Chrome / Firefox.
- Dark preview inverts colors correctly (icons render in light stroke on dark background).
- Icons render at correct pixel sizes (visual check).

**Verification.**

- Both files open in browser without errors.
- Screenshots attached to PR body.

### U12. Responsive & Platform — restructure into 4 sub-sections + Windows/Linux titlebar

**Goal.** Rewrite `## 9. Responsive & Platform` (or `## 10.` after U6 renumbering) into canonical 4-part structure and cover Windows / Linux.

**Requirements.** R9.

**Dependencies.** U6 (section number cascade).

**Files.**

- `DESIGN.md` (§ 9 or § 10 body, ~40 lines pre-edit → ~90 lines post-edit)

**Approach.**

- Restructure into: `### Breakpoints` (narrow < 900 / default 900–1440 / wide > 1440), `### Touch Targets` (Electron desktop = pointer-primary; 24/32/36 primitives meet keyboard-navigable floor; note WCAG 44px floor is a touch-device rule and does not gate desktop pointer surfaces), `### Collapsing Strategy` (rail collapse, right panel close, dialog fullscreen threshold at narrow), `### Image Behavior` (avatar mesh densities, artifact 16:9, empty-state hero aspect).
- Add `### Cross-Platform Titlebar` sub covering macOS (existing `hiddenInset` + `mac:titlebar-no-drag`), Windows (system frame, `windows:titlebar-*` variants declared for future use, no drag-swallowing today), Linux (system frame, `linux:titlebar-*` variants declared).
- Preserve the existing "no mobile design surface" statement — move it under `### Breakpoints` as a final bullet.

**Patterns to follow.** Notion `### Breakpoints` / `### Touch Targets` / `### Collapsing Strategy` / `### Image Behavior` shape.

**Test scenarios.** N/A — prose.

**Verification.**

- The section contains all 5 sub-headings above.
- `mac:titlebar-no-drag` is still mentioned; `windows:titlebar-no-drag` and `linux:titlebar-no-drag` are now mentioned.

### U13. Cross-doc pointer updates

**Goal.** Update `docs/design/theme-system.md` and `AGENTS.md` to point at v3 additions.

**Requirements.** R14.

**Dependencies.** U1–U12.

**Files.**

- `docs/design/theme-system.md` — add 3–5 pointer sentences under existing sections (do not restructure).
- `AGENTS.md` — extend the UI rule at "后续新增的用户可见功能..." with a reference to `iconography` + `z-layers` token blocks.

**Approach.**

- `theme-system.md`: add pointer sentences to `## 7. Shapes`, `## 13. Iteration Guide`, `## 14. Known Gaps`. Format: "For [X], see DESIGN.md § N." Do not restate content.
- `AGENTS.md`: extend the UI rule with a single-line addition — "Icon sizes and z-index values MUST come from the `iconography:` / `z-layers:` YAML blocks in DESIGN.md; do not invent." — keep the current bullet structure.
- Do not touch `docs/README.md` — v2 already points at DESIGN.md as canonical.

**Test scenarios.**

- `theme-system.md` links resolve (no broken `#anchor` references).
- `AGENTS.md` UI rule still parses cleanly.

**Verification.**

- `rg -l 'DESIGN.md § 7' docs/design/theme-system.md` returns the file.
- `rg 'iconography:' AGENTS.md` returns 1 hit.
- `pnpm check:boundaries` still passes (unrelated but worth confirming).

### U14. Verify + capture drift-detection output (v2 AC3-equivalent)

**Goal.** Run the extended `extract-tokens.mjs` in all three modes on a clean tree and capture output for the PR body.

**Requirements.** All (integration test for U1–U8).

**Dependencies.** U1, U2, U8. (U6/U9/U10/U12 can be interleaved.)

**Files.** No file changes — verification only.

**Execution note.** This unit is the manual verification pass, analog to v2's U7. Do not automate; capture output verbatim in the PR body.

**Approach.**

1. Confirm clean tree via `git status --short`.
2. `pnpm task check design` — expect exit 0, report may show `iconography-drift` / `z-layer-drift` categories if code sites do not yet reference the tokens (fine — those are Deferred to Follow-Up Work items).
3. `pnpm task check design -- --strict` — outcome depends on drift; both exit 0 and exit 1 are acceptable per v2 pattern. Note the outcome.
4. `pnpm task check design -- --json` — verify `iconography` and `zLayers` keys parse.
5. Drift injection: temporarily change `iconography.size.base: 16` → `18` in `DESIGN.md`, run `--strict`, confirm exit 1 with clear message pointing at the mismatch. Revert with `git checkout -- DESIGN.md`. Verify tree clean via `git status --short`.

**Test scenarios.** N/A — this unit *is* the test scenario for the whole plan.

**Verification.**

- All 5 steps completed; outcomes captured in PR body.
- Tree clean after drift-injection revert.

### U15. Commits + open PR

**Goal.** Land v3 as a coherent PR on a fresh branch.

**Requirements.** R15.

**Dependencies.** U1–U14.

**Files.** No file changes — git operation only.

**Approach.**

- If PR #25 (v2) has merged: create branch `codex/design-md-v3` off `main`.
- If PR #25 is still open at U15-kickoff: create branch `codex/design-md-v3` off `codex/design-md-v2` and note the dependency in PR body.
- Commit strategy — group by cohesion, not per U-ID: (1) YAML + Colors + Typography + Layout + Depth prose depth passes [U1–U5], (2) Shapes + Component signature + Iteration Guide + Known Gaps section additions [U6–U10], (3) Responsive + Cross-Platform titlebar [U12], (4) `extract-tokens.mjs` extension [U8], (5) Preview HTML [U11], (6) Cross-doc pointers [U13], (7) Plan doc + PR body [U15]. ≈7 commits.
- Push to `origin/codex/design-md-v3`, open PR with body containing: v2 → v3 change summary, the gap-analysis table from the "还有什么" turn with v3 status checkmarks, U14 drift-detection output.

**Test scenarios.** N/A — git operation.

**Verification.**

- `gh pr view <PR#> --json state,headRefName` shows OPEN and `codex/design-md-v3`.
- `git log --oneline main..HEAD` shows the expected commit series.
- PR body contains the gap-analysis table update.

---

## System-Wide Impact

- **`apps/**` runtime:** Zero. All changes are in `DESIGN.md`, `docs/design/preview*.html`, `docs/design/theme-system.md`, `AGENTS.md`, and `scripts/design/extract-tokens.mjs`.
- **`packages/**`:** Zero.
- **CI / build:** Zero. `pnpm task check design` remains a low-frequency task-CLI target, not a `pnpm check:*` gate.
- **AI agents downstream:** After merge, agents reading `DESIGN.md` gain 6 new sections + 2 new YAML blocks to consult. The `iconography` and `z-layers` blocks give agents specific values to reference instead of inventing.
- **Drift detection:** New extractors may surface `missing-in-code` warnings for the newly-declared tokens on first run. This is expected and documented in "Deferred to Follow-Up Work" — the CSS variables land in a follow-up PR.

## Risks & Dependencies

- **R1. Section renumbering fanout.** U6 cascades § numbers from 7 through 13. Missing an internal `§ N` cross-reference in the same commit produces a broken pointer. **Mitigation:** U6 verification explicitly greps `§ ` after the edit. U13 also cross-verifies theme-system pointers.
- **R2. Extractor false-positives on icon scan.** `scanIconUsage` is best-effort regex over `lucide-react` imports; wrapped components (e.g., `<IconButton icon={Search} />`) may not be detected. **Mitigation:** Report-only for iconography category on first release; upgrade to `--strict` gate in v4 after real-world tuning.
- **R3. PR #25 not yet merged when v3 starts.** U15 has a branch-base fork; document the decision in the PR body. **Mitigation:** Explicit branch-fork logic in U15.
- **R4. Preview HTML dark-mode inversion drift.** New Icon + Z-layer sections could accidentally reference `#ffffff` etc. and break in the dark preview. **Mitigation:** Reuse `--dls-*` variables that v2 already declared; visual QA in U11 verification.
- **R5. `theme-system.md` pointer drift.** If v3 renames a sub-section post-U6, pointer sentences added in U13 could rot. **Mitigation:** U13 runs after U6 finalizes numbering; pointer sentences use section numbers, not anchor slugs.

## Verification Contract

- `rg '^iconography:' DESIGN.md` returns 1.
- `rg '^z-layers:' DESIGN.md` returns 1.
- `rg '^## 7\. Shapes' DESIGN.md` returns 1.
- `rg '^## 13\. Iteration Guide' DESIGN.md` returns 1.
- `rg '^## 14\. Known Gaps' DESIGN.md` returns 1.
- `rg '### Signature Components' DESIGN.md` returns 1.
- `rg '### Note on Font Substitutes' DESIGN.md` returns 1.
- `rg '### Breakpoints' DESIGN.md` returns 1.
- `rg '### Cross-Platform Titlebar' DESIGN.md` returns 1.
- `rg 'windows:titlebar-no-drag|linux:titlebar-no-drag' DESIGN.md` returns >= 1.
- `pnpm task check design` exit 0 on clean tree.
- `pnpm task check design -- --json | jq '.iconography, .zLayers'` returns both objects.
- `git diff --check` clean.
- No files under `apps/**`, `packages/**`, `.github/**`, `package.json`, or `pnpm-lock.yaml` are modified.
- `pnpm check:boundaries` still passes.
- `pnpm check:forbidden-types` still passes.

## Definition of Done

- All 15 U-IDs completed.
- Verification Contract fully green.
- ~7 commits pushed to `origin/codex/design-md-v3`.
- PR opened with v2→v3 change summary, gap-analysis update table, and U14 drift-detection output in the body.
- Preview HTML screenshots (light + dark, Icon grid + Z-layer stack) attached to PR body.
- Plan doc (`docs/plans/2026-07-04-003-feat-design-md-v3-plan.md`) landed in U1's commit as the v3 origin.
- Tree clean; no leaked drift-injection edits.
- Follow-up ticket / issue drafted (not required to be filed) for the CSS-variable wire-up work deferred in "Deferred to Follow-Up Work".

## Scope Boundaries

### Deferred to Follow-Up Work

- Add `--dls-z-*` CSS variables to `apps/app/src/app/index.css` — human-gated file; separate PR after v3 merges.
- Add `--dls-icon-size-*` CSS variables if we want icon sizes to be CSS-consumable — currently primitive-consumable via `size=` prop, sufficient for now.
- `frontend-primitive-refactor` sweep to replace any hardcoded `z-index: 999` / `z-[50]` literals in `apps/app/src/**` with the new z-layer tokens.
- v2's still-open `text-[13px]` / `text-[11px]` audit items (from `.loop/plans/ui-drift-audit.md`) — not blocked on v3.
- Icon-usage scan tuning after v3 lands with real-world data — potentially graduate iconography drift from report-only to `--strict` gate in v4.

### Outside this product's identity

- Data-viz / chart palette — separate visual-language pass, needs product owner.
- Copy voice / tone guide — product / marketing signoff.
- Brand asset system — separate brand-identity track.
- CI gate wiring — human-gated per AGENTS.md rules.
- Auto-fix codemod — v4+ decision.
- Marketing / landing surface tokens — no marketing surface exists in scope.
- Domain composites v2 catalog — `frontend-primitive-refactor` skill task, not DESIGN.md.

## Sources & Research

- getdesign.md canonical spec: `https://getdesign.md/what-is-design-md.md` (fetched raw markdown; 9 canonical sections + extension conventions).
- Exemplar DESIGN.md files from `VoltAgent/awesome-design-md`:
  - `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/apple/DESIGN.md`
  - `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/vercel/DESIGN.md`
  - `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/notion/DESIGN.md`
  - `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/figma/DESIGN.md`
- Gap-analysis table produced in the "https://getdesign.md/ 在对比下我现在的 design 还缺哪些" turn earlier in this session.
- v1 plan: `docs/plans/2026-07-04-001-feat-design-md-plan.md`.
- v2 plan: `docs/plans/2026-07-04-002-feat-design-md-v2-plan.md`.
- v2 delivery: PR #25 (branch `codex/design-md-v2`).
- Existing extractor: `scripts/design/extract-tokens.mjs` (v2 shipped).
- Existing preview: `docs/design/preview.html` + `preview-dark.html` (v2 sections in place).
- Repo AGENTS.md — UI rule + path allowlist / human-gate conventions.
