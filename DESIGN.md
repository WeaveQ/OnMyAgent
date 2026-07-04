---
spec: stitch-design-md/v-alpha
product: OnMyAgent
platform: electron-desktop
authority: authoritative
maintenance: manual-event-driven
last-reviewed: 2026-07-04

colors:
  light:
    primary: "#005DFF"
    primary-hover: "#004ED6"
    primary-soft: "#EAF2FF"
    signal: "#03FFDE"
    ink: "#0F172A"
    slate: "#64748B"
    mist: "#E5E7EB"
    surface: "#FFFFFF"
    surface-muted: "#F8FAFC"
    background: "#FAFAFA"
    app-bg: "#F8FAFC"
    sidebar: "#F8FAFC"
    rail-bg: "#F3F6FB"
    rail-active: "#FFFFFF"
    rail-hover: "#E8EFFA"
    border: "#E5E7EB"
    border-strong: "#CBD5E1"
    hover: "#EEF4FF"
    active: "#DDEBFF"
    danger: "#EF4444"
    warning: "#D19A2A"
    success-fg: "#047857"
    online: "#28B276"
  dark:
    primary: "#2F7BFF"
    primary-hover: "#5B96FF"
    primary-soft: "#102A5C"
    signal: "#03FFDE"
    ink: "#F8FAFC"
    slate: "#94A3B8"
    mist: "#3A3A3A"
    surface: "#1E1E1E"
    surface-muted: "#2A2A2A"
    background: "#262626"
    app-bg: "#262626"
    sidebar: "#171717"
    rail-bg: "#171717"
    rail-active: "#333333"
    rail-hover: "#303030"
    border: "#3A3A3A"
    border-strong: "#4A4A4A"
    hover: "#2A2A2A"
    active: "#333333"
    danger: "#F87171"
    warning: "#FBBF24"
    success-fg: "#6EE7B7"
    online: "#28B276"

typography:
  font-body: "Geist Variable"
  font-heading: "IBM Plex Sans Variable"
  scale:
    2xs: 10
    xs: 12
    sm: 14
    base: 16
    lg: 18
    xl: 20
    2xl: 24
    3xl: 28
    4xl: 32
    5xl: 48
  leading:
    tight: 1.2
    normal: 1.45
  rule: even-sizes-only

rounded:
  xs: 3
  sm: 6
  md: 8
  lg: 10
  xl: 14
  pill: 999

spacing:
  base: 4
  row-padding: "px-3 py-2.5"
  menu-row-padding: "px-3 py-2"
  dialog-footer-gap: "gap-2"

buttons:
  xs: { height: 24, padding: "px-2", radius: lg, text: sm }
  sm: { height: 32, padding: "px-3", radius: lg, text: sm }
  default: { height: 36, padding: "px-3", radius: lg, text: sm }
  lg: { height: 40, padding: "px-6", radius: xl, text: sm, use: "primary CTA / dialog footer" }
  icon-xs: { size: 24, radius: lg }
  icon-sm: { size: 32, radius: lg }
  icon: { size: 36, radius: lg }
  icon-lg: { size: 40, radius: lg }
  width-policy: "auto by default; w-full only for form submits / mobile / full-row decisions"

components:
  atoms:
    location: apps/app/src/components/ui
    list:
      - accordion
      - action-row
      - alert
      - alert-dialog
      - autocomplete
      - button
      - card
      - checkbox
      - code-token
      - collapsible
      - command
      - context-menu
      - dialog
      - dropdown-menu
      - empty
      - field
      - input
      - input-group
      - label
      - loading-spinner
      - notice-box
      - popover
      - progress
      - radio-group
      - resizable
      - scroll-area
      - select
      - send-button
      - separator
      - sheet
      - sidebar
      - skeleton
      - status-badge
      - status-dot
      - switch
      - table
      - tabs
      - textarea
      - toggle
      - toggle-group
      - tooltip
  composites:
    location: apps/app/src/react-app/design-system
    list:
      - flyout-item
      - select-menu
      - text-input
      - extension-mesh-avatar
      - provider-icon
  row-primitives:
    location: apps/app/src/components/ui/action-row.tsx
    list:
      - MenuRowButton
      - NavTabButton
      - ActionRowButton

flags:
  shadows: forbidden
  arbitrary-text-px: forbidden
  arbitrary-hex-in-page-jsx: forbidden
  raw-h-w-for-icon-buttons: forbidden
  any-cast: forbidden
  mac-titlebar-no-drag: required-on-titlebar-and-sidebar-header-controls
  i18n: required-for-user-visible-strings
---

# OnMyAgent — Visual Design Contract

> This file is the authoritative visual language for OnMyAgent. AI coding
> agents (Codex, Claude, OpenCode-based agents) MUST read the YAML front
> matter above and the sections below before generating or modifying UI.
> When code disagrees with this file, code is wrong — fix the code, not the
> contract, unless the contract itself is demonstrably outdated (in that
> case update this file first, then align code).

## 1. Visual Theme

OnMyAgent is a **local-first agentic workbench** for engineers, tinkerers,
and knowledge workers who run agents on their own machines. It replaces the
web-chatbot metaphor with a **desktop console**: rail-first navigation,
strong decision entry points, dense but calm surfaces, no marketing gloss.

The visual voice is **precise and quiet, not playful**:

- **Flat first.** Hierarchy comes from borders, surface contrast, spacing,
  weight, and active states. Never from drop shadows.
- **Decision first.** Primary, create, connect, run, approve, submit, and
  destructive actions must be visibly stronger than passive navigation. Do
  not "soften" a decision by making it look like a filter chip.
- **Blunt geometry.** Rounded rectangles win. Pills belong to status,
  filters, and identity chips — never to primary CTAs.
- **Signal cyan is a status, not a brand.** Reserved for online / running /
  activity marks. Never a primary action fill.
- **Three-tier surface hierarchy.** `rail → background → surface`. Rail is
  cold and quiet, background is neutral, surface is where content lives.

## 2. Color Palette

Semantic tokens live in `apps/app/src/app/index.css` under the `:root` /
dark selectors as `--dls-*` / `--ow-*`. Use the Tailwind aliases (e.g.
`bg-dls-surface`, `text-dls-text-primary`, `border-dls-border`) instead of
raw hex or raw Tailwind palette colors. Full values are in the YAML above.

Key rules:

- Prefer `dls-*` semantic classes before raw Tailwind palette classes.
- Never write raw hex in page JSX. Hex only lives in token files
  (`styles/colors.css`, `app/index.css`) or in explicit brand / category
  registries (see § 8 Exceptions).
- Primary decisions are solid blue with white text. Secondary decisions use
  flat tinted surfaces (`dls-decision-soft`).
- Danger, warning, and success have paired `-soft` / `-fg` / `-border`
  variants so soft banners stay in-theme; do not compose them ad-hoc.

## 3. Typography

Sizes use an **even-number scale only**: 10 / 12 / 14 / 16 / 18 / 20 / 24 /
28 / 32 / 48. Anything else (11, 13, 15, `text-[Npx]`) is drift.

- Body text: Geist Variable, 14px (`text-sm`), 1.45 line height.
- UI labels: `text-xs` (12) or `text-sm` (14). Never `text-[11px]` or
  `text-[13px]`.
- Section titles: `text-lg` (18). Page titles: `text-xl` (20).
- Hero / empty-state: `text-3xl` or `text-4xl`. `text-5xl` is reserved for
  rare marketing / large empty-state moments.
- Headings use IBM Plex Sans Variable; body uses Geist Variable. Do not
  introduce a third face for regular UI.
- Prefer semantic weight (`font-medium`, `font-semibold`) over size to
  express hierarchy inside a single scale step.

## 4. Component Stylings

**Buttons** (`apps/app/src/components/ui/button.tsx`)

- `default` is 36px, `rounded-lg`, `text-sm`, `px-3`.
- `lg` (40px, `rounded-xl`, `px-6`) is for primary CTAs and dialog footer
  decisions.
- Icon buttons use `size="icon-*"` variants only. Do not write raw
  `h-N w-N` pairs for icon buttons.
- Text buttons are auto-width. Use `w-full` only for form submits, mobile
  layouts, or full-row decisions.
- `rounded-full` is invalid for ordinary CTAs; reserved for chips /
  filters / status.

**Row primitives** (`apps/app/src/components/ui/action-row.tsx`)

Use these for clickable rows — not the standard `Button`:

- `MenuRowButton`: `w-full`, `rounded-xl`, `px-3 py-2.5`, text-left.
  For slash menus, tool menus, command palettes, mention pickers.
- `NavTabButton`: `rounded-full`, compact horizontal label. For tab
  switches and segmented filters.
- `ActionRowButton`: `w-full`, bordered row/card, text-left. For starter
  cards, selectable rows, large row actions.

**Inputs**

Reuse `Input` / `Textarea` / `SelectMenu` / `TextInput` primitives. Do not
compose raw `<input className="…">` in pages.

**Dialogs / sheets / popovers**

Use `Dialog`, `Sheet`, `Popover`, `DropdownMenu` primitives. Dialog footer
buttons are `size="lg"`, right-aligned, with `gap-2`.

**Empty states**

Use the `Empty` primitive. Compact hero heading is `text-4xl`; description
is `text-sm text-dls-text-secondary`.

**Status**

Use `StatusBadge` for chips and `StatusDot` for presence / activity. Both
consume `dls-status-*` and `dls-online` / `dls-signal` tokens.

## 5. Layout

OnMyAgent is a **rail + panel** shell.

- Rail (left): app rail, workspace switcher, primary navigation.
  Uses `--dls-rail-bg` / `--dls-rail-active` / `--dls-rail-hover`.
- Header / titlebar: macOS uses `titleBarStyle="hiddenInset"` — a 28px drag
  strip is pinned at the top of the window. Any interactive control inside
  the titlebar or sidebar-header region MUST add `mac:titlebar-no-drag`
  (icon buttons, tabs, custom containers). Missing this utility causes the
  window to eat clicks and double-clicks.
- Content surface: single primary panel with optional right-side panel
  (settings, tools, artifacts, canvas). Panel resizers use the `Resizable`
  primitive.
- Dense but calm: minimum row height is the primitive default (24 / 32 /
  36). Do not shrink below the primitive's declared size for cosmetic
  purposes.

## 6. Depth

- **No component shadows.** `shadow-*`, `drop-shadow-*`, custom
  `box-shadow` for hierarchy are all forbidden.
- Elevation is expressed via surface color (`surface` on top of `background`
  on top of `app-bg`), borders, and hover / active states.
- Scrollbars are weak, WeChat-style: hidden by default, briefly visible on
  pointer movement or active scroll, fading back to transparent.
  Consume `--dls-scrollbar-thumb` / `--dls-scrollbar-thumb-active`; do not
  introduce component-level scrollbar colors unless the browser forces it.
- Motion clarifies state changes; it does not decorate.
  - Reorder / drag / layout: `motion/react`.
  - Enter / exit reveals: `tw-animate-css` utilities
    (`animate-in`, `fade-in`, `slide-in-*`, `duration-*`).
  - Spinners / running indicators: named CSS keyframes, kept local and
    short.
  - Hover / focus: CSS transitions.
  - Always respect reduced motion.

## 7. Do's and Don'ts

**Do**

- Use `dls-*` semantic tokens for color and typography.
- Reuse the atom / composite / row primitives above; extend a variant
  before adding a page-level override.
- Give primary decisions visual weight: solid `--ow-primary`, white text,
  `size="lg"` on dialog footers.
- Add `mac:titlebar-no-drag` to any interactive control inside macOS
  titlebar or sidebar-header regions.
- Route all user-visible strings through the i18n layer. Do not hardcode
  Chinese or English text in JSX.
- Keep even-scale typography. If you need a size that is not in the scale,
  the answer is almost always "use the nearest even size".
- Prefer `size="icon-*"` for icon buttons; never raw `h-N w-N`.
- Keep hover / active / focus visible via the shared primitive states, not
  ad-hoc utility overrides.
- Treat `signal` as a status color: activity, online, running,
  subtle indicator marks.

**Don't**

- Do not use `text-[Npx]` or `rounded-[Npx]` in page JSX.
- Do not write raw hex in page JSX. Hex belongs to token or registry files.
- Do not use raw Tailwind palette classes (`text-blue-9`, `bg-emerald-3`)
  in ordinary UI. They are only allowed inside the exception categories in
  § 8.
- Do not add `shadow-*`, `drop-shadow`, or custom `box-shadow` for
  component hierarchy.
- Do not use `rounded-full` on standard CTAs. Pills are for chips /
  filters / status only.
- Do not use `any`, `as any`, or `as unknown as` in code that touches
  these tokens. `pnpm check:forbidden-types` will fail; the baseline can
  only shrink.
- Do not compose raw `<input>` / `<button>` / `<div>` styled to look like
  primitives. Reach for the atom.
- Do not force menu rows or nav tabs into the standard `Button` sizing;
  use the row primitives.
- Do not remove or "clean up" `mac:titlebar-no-drag` — its presence is
  functional, not stylistic.
- Do not introduce a second animation library for ordinary UI. `motion` +
  `tw-animate-css` cover the surface.

## 8. Responsive & Platform

OnMyAgent is a **desktop-first Electron app**. Responsive rules are
narrow:

- Rail: collapses at narrow widths via the sidebar primitive; other rail
  behavior stays fixed.
- Titlebar: macOS `hiddenInset` with a 28px pinned drag strip; Windows /
  Linux use system frames. Platform utilities are `mac:` / `windows:` /
  `linux:` custom variants declared in `apps/app/src/app/index.css`.
- Modal / panel widths follow the primitive's default. Do not introduce
  page-level max-width overrides.
- There is no mobile design surface for the desktop shell. Landing pages,
  cloud dashboards, and marketing web surfaces are out of scope for this
  file (see `apps/web/*` — not covered here).

## 9. Intentional Exceptions

These categories are allowed to use raw palette classes or explicit hex
because the color encodes **product meaning**, not page styling. They live
in dedicated registry files, not in ordinary JSX:

- **Extension type palette** — `extension-card.tsx`. Plugin / skill /
  ui-control categories need stable visual distinction.
- **Agent skill category palette** — `agent-management-skill-model.ts`.
  Source data for the skill matrix.
- **Artifact file-type icons** — `artifact-icon.tsx`. Familiar file-type
  colors aid recognition.
- **Provider brand colors** — `mcp-view.tsx` and provider icons. Linear,
  Sentry, Stripe, Telegram, Slack, and similar vendors keep brand
  identity.
- **Generated logo geometry** — plugin / provider icon renderers. CSS
  triangles, exact letter tracking, brand mark geometry can use precise
  arbitrary values.
- **Runtime layout math** — virtual lists, drag handles, popover / menu
  positions, grid templates, sidebar CSS variables. Values come from
  measured runtime geometry.
- **Performance containment** — large message lists, composer surfaces:
  `contain`, `content-visibility`, virtualizer transforms.

If a scan hit does not match one of these, prefer moving it to a `dls-*`
token, a shared variant, or a named local class map before leaving it in
page JSX.

## 10. Agent Prompt Guide

When an AI agent is asked to generate or modify OnMyAgent UI, it MUST:

1. **Read this file first.** Especially § 4 (component contracts), § 7
   (Do's / Don'ts), and the YAML `flags` block.
2. **Pick a primitive before a `<div>`.** If no atom fits, check
   composites in `apps/app/src/react-app/design-system/`, then row
   primitives in `action-row.tsx`.
3. **Pull tokens from the YAML above** or from Tailwind `dls-*` classes.
   Never invent hex values.
4. **Match the current theme.** Semantic tokens auto-swap between light
   and dark; do not branch on theme manually unless the primitive itself
   already does.
5. **Wrap all user-visible strings in the i18n helper.** Match the file's
   existing translation key convention.
6. **Assume non-technical end-users.** Copy is direct, decisions are
   obvious, defaults are safe.
7. **Verify against the flags block.** Every value in `flags: forbidden`
   must be absent from the diff; every value in `flags: required` must be
   present where applicable.
8. **If DESIGN.md and code disagree, code is wrong** — unless this file is
   demonstrably outdated. In that case, ask the human to update DESIGN.md
   first, then align code.

### Suggested prompt fragment

> "You are modifying UI in the OnMyAgent Electron app. Read `DESIGN.md`
> at the repo root before writing code. Follow the YAML `flags` block,
> § 4 component contracts, and § 7 Do's / Don'ts. Prefer primitives from
> `apps/app/src/components/ui/` and composites from
> `apps/app/src/react-app/design-system/`. Route all user-visible strings
> through i18n. Do not introduce shadows, arbitrary text-px, arbitrary
> hex in page JSX, or `any` casts."

---

## Related documents

- `docs/design/theme-system.md` — design-philosophy narrative and
  intentional-exceptions catalog. `DESIGN.md` is the single source of
  truth for tokens; `theme-system.md` explains **why** those tokens exist.
- `docs/design/ui-primitive-refactor-best-practices.md` — practical
  refactor guidance when consolidating drift found by the
  `frontend-primitive-refactor` skill audits.
- `AGENTS.md` — engineering contract for AI agents. `DESIGN.md` is the
  visual contract; `AGENTS.md` is the code / process contract.
- `apps/app/src/react-app/ARCHITECTURE.md` — React UI domain architecture.
- `docs/design/preview.html` / `docs/design/preview-dark.html` — static
  visual catalog of the tokens and top components below, in light and
  dark themes. Snapshot for reviewers; DESIGN.md is the authority.
