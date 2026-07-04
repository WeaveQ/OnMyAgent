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

motion:
  duration:
    instant: 0
    fast: 120
    normal: 200
    slow: 320
  easing:
    standard: "cubic-bezier(0.2, 0, 0, 1)"
    decisive: "cubic-bezier(0.3, 0, 0.2, 1)"
    signal: "cubic-bezier(0.4, 0, 0.6, 1)"
  reduced-motion: respect

focus:
  ring-color:
    light: "#005DFF"
    dark: "#2F7BFF"
  ring-width: 2
  ring-offset: 2
  ring-style: solid
  keyboard-required: true

iconography:
  size:
    xs: 12
    sm: 14
    base: 16
    lg: 20
    xl: 24
  stroke-width: 1.5
  library: lucide-react
  paint: currentColor
  forbidden:
    - heroicons
    - phosphor-icons
    - radix-icons-fill

z-layers:
  base: 0
  sticky: 10
  dropdown: 100
  popover: 200
  dialog: 300
  toast: 400
  overlay-max: 999

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
  focus-ring-on-interactive-elements: required
  reduced-motion-respected: required
  icon-library: lucide-only
  z-layers-tokenized: required
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

Each color has a **job**, not just a hex. Below, every token names what it
does in the system — pick the semantic slot, not the shade.

### Brand & Accent

- **Primary** (`{colors.light.primary}` / `{colors.dark.primary}`) — the
  single decision blue. Solid fill on primary CTAs, dialog footer commits,
  and the active rail row highlight. Never used for status.
- **Primary Hover** (`{colors.light.primary-hover}` /
  `{colors.dark.primary-hover}`) — the hover / press step for the same
  primary surface. Do not use as an idle color.
- **Primary Soft** (`{colors.light.primary-soft}` /
  `{colors.dark.primary-soft}`) — the tinted backdrop for secondary
  decisions (`dls-decision-soft`), keyboard-shortcut chips, and selection
  contexts inside primary-scoped surfaces.
- **Signal** (`{colors.light.signal}` / `{colors.dark.signal}`) — the
  reserved cyan for online / running / activity marks. **Never** a
  primary action fill. Signal is a status, not a brand.

### Surface

- **Surface** (`{colors.light.surface}` / `{colors.dark.surface}`) — the
  content surface: cards, panels, dialogs, menus, the primary panel body.
  Highest in the surface ladder.
- **Surface Muted** (`{colors.light.surface-muted}` /
  `{colors.dark.surface-muted}`) — inset region below surface: nested
  cards, code-block backgrounds, quiet secondary containers.
- **Background** / **App-Bg** (`{colors.*.background}` /
  `{colors.*.app-bg}`) — the neutral floor the surface sits on. Slightly
  cooler than surface in both modes.
- **Sidebar** / **Rail-Bg** / **Rail-Active** / **Rail-Hover** — the
  rail surface ladder. Cold and quiet by design; the rail should feel
  like a distinct plane from content. Rail-active is `surface` in light
  mode (the row lifts *into* content) and a mid-neutral in dark mode.

### Text

- **Ink** (`{colors.light.ink}` / `{colors.dark.ink}`) — primary text.
  Every heading, body paragraph, and interactive label on light surfaces.
  Auto-swaps in dark mode via the `dls-text-primary` alias.
- **Slate** (`{colors.light.slate}` / `{colors.dark.slate}`) — secondary
  text. Sub-labels, meta text, inactive nav labels, timestamps.
- (Consumers should reach for the `dls-text-*` Tailwind aliases —
  `dls-text-primary`, `dls-text-secondary`, `dls-text-tertiary` — not
  raw ink / slate hex.)

### Hairlines & Borders

- **Mist** (`{colors.light.mist}` / `{colors.dark.mist}`) — 1px dividers
  and subtle separators; the softest border tier. Prefer `border-dls-mist`.
- **Border** (`{colors.light.border}` / `{colors.dark.border}`) — the
  default component border on cards, inputs, and dialogs.
- **Border Strong** (`{colors.light.border-strong}` /
  `{colors.dark.border-strong}`) — emphasised border for focused inputs,
  active cards, or a divider that must cut through busy surfaces.

### Semantic

- **Danger** (`{colors.light.danger}` / `{colors.dark.danger}`) — the
  destructive-decision fill and the error state color. Paired with
  `-soft` (banner background), `-fg` (banner text), `-border` (banner
  edge) variants declared in code tokens — use those as a set, do not
  compose ad-hoc soft banners from raw danger + opacity.
- **Warning** (`{colors.light.warning}` / `{colors.dark.warning}`) —
  attention state (permission prompts, before-you-do-this notices).
  Same `-soft` / `-fg` / `-border` pairing.
- **Success-Fg** (`{colors.light.success-fg}` /
  `{colors.dark.success-fg}`) — success text and check-mark color inside
  approve / connected states. `-soft` background is defined at the
  component layer.
- **Online** (`{colors.light.online}` / `{colors.dark.online}`) — the
  live-presence and running-agent dot. Sibling to `signal`; use `online`
  for identity/presence, `signal` for activity/motion.

Key rules:

- Prefer `dls-*` semantic classes before raw Tailwind palette classes.
- Never write raw hex in page JSX. Hex only lives in token files
  (`styles/colors.css`, `app/index.css`) or in explicit brand / category
  registries (see § 11 Exceptions).
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

### Principles

The even-number scale exists to make agent-generated UI predictable. When
every size is a multiple of 2 starting at 10, an agent asked for "one step
smaller than body" has exactly one right answer (12). Fractional sizes
(11 / 13 / 15) produce visual drift because two agents disagree on which
side to round toward.

Hierarchy inside a single scale step is expressed by **weight** first
(`font-medium` at 500, `font-semibold` at 600) and **color** second
(`dls-text-primary` → `dls-text-secondary` → `dls-text-tertiary`). Do
not reach for a new size just to soften emphasis — reach for weight and
color inside the current step. This keeps the effective vocabulary small
without letting hierarchy collapse.

Two typefaces are enough. **Geist Variable** is the body voice — every
paragraph, every label, every button, every row. **IBM Plex Sans
Variable** carries headings and page titles because it reads calmer at
larger sizes. Introducing a third face (monospaced, condensed, display)
is a distinct DESIGN.md change, not a per-page choice.

### Note on Font Substitutes

Both faces are variable / open-source but not guaranteed to be installed
on every rendering surface. Fallback order:

- **Body** — `Geist Variable, Geist, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Inter is the closest metric match at 14px body; system-ui keeps the fallback native on non-Inter systems.
- **Headings** — `IBM Plex Sans Variable, "IBM Plex Sans", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Inter is the calmest substitute at 18–32px; Segoe/Roboto keep the fallback native on Windows/Android surfaces respectively.
- **Monospace** — not part of the v3 contract. When a code block or terminal-style label needs mono, use the system stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", "Roboto Mono", monospace`) and note the gap in § 14 Known Gaps.

Do not fall back to Arial, Helvetica, or Times without going through the
system-ui slot first — direct-named legacy faces are inconsistent across
Windows and Linux distros and break the visual voice.

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

### Signature Components

The 41 atoms + 5 composites + 3 row primitives are covered above and
in the YAML `components:` block — reach for them by default. **Signature
components** are the four OnMyAgent-native identity anchors: agents
generating these must not reinvent them, and any refactor to them
requires updating this section in the same PR.

- **`ChatMessage row`** — content-first row: 12px vertical rhythm,
  `AgentAvatarMesh` at 32px on the left, message body `text-sm` with
  `text-dls-text-primary`, timestamp `text-xs text-dls-text-tertiary`
  right-aligned. No card chrome; rows are separated by hairlines
  (`border-dls-mist`) only at grouping boundaries or on hover-selected
  state. Streaming state shows a `signal`-colored dot appended to the
  timestamp.
- **`SessionCard`** — the primary session / chat entry in rail-adjacent
  lists: `bg-dls-surface`, `rounded-md` (8), border hairline on hover,
  active state uses `dls-active`. Title `text-sm font-medium`,
  subtitle `text-xs text-dls-text-secondary`, unread mark is a
  `signal`-colored dot right-aligned. Padding `px-3 py-2.5` (matches
  `spacing.row-padding`).
- **`AgentAvatarMesh`** — the brand-identity mesh gradient primitive
  for agent avatars. Renders at 32 / 40 / 64 px densities via the
  primitive's `size` prop — never raw `h-N w-N`. Uses a gradient
  derived from the agent's identity hash; opaque, no border, no
  shadow. This is *the* brand chrome moment (see § 6 Decorative
  Depth); do not decorate elsewhere.
- **`ArtifactCard`** — inline artifact preview card: `bg-dls-surface`,
  `border-dls-border`, `rounded-md` (8), `p-3`. 16:9 preview at the top
  (`aspect-video`, `object-cover`, `rounded-md`); filename `text-sm`,
  file-type badge as `StatusBadge` right-aligned. Click opens the
  artifact panel via the `Resizable` right-side panel.

Non-signature atoms remain governed by the primitive rules above —
extend a variant before adding a page-level override.

## 5. Layout

### Shell Composition

OnMyAgent is a **rail + panel** shell.

- Rail (left): app rail, workspace switcher, primary navigation.
  Uses `--dls-rail-bg` / `--dls-rail-active` / `--dls-rail-hover`.
- Header / titlebar: macOS uses `titleBarStyle="hiddenInset"` — a 28px drag
  strip is pinned at the top of the window. Any interactive control inside
  the titlebar or sidebar-header region MUST add `mac:titlebar-no-drag`
  (icon buttons, tabs, custom containers). Missing this utility causes the
  window to eat clicks and double-clicks. Windows / Linux use system
  frames (see § 10 Responsive & Platform for cross-platform titlebar).
- Content surface: single primary panel with optional right-side panel
  (settings, tools, artifacts, canvas). Panel resizers use the `Resizable`
  primitive.
- Dense but calm: minimum row height is the primitive default (24 / 32 /
  36). Do not shrink below the primitive's declared size for cosmetic
  purposes.

### Spacing System

- **Base unit**: `{spacing.base}` = 4px. Every gap, padding, and margin
  should resolve to a multiple of 4.
- **Common steps** (Tailwind aliases): `1` (4) · `2` (8) · `3` (12) ·
  `4` (16) · `5` (20) · `6` (24) · `8` (32) · `10` (40) · `12` (48).
- **Row padding**: `{spacing.row-padding}` (`px-3 py-2.5`) is canonical
  for action-row primitives. Menus use `{spacing.menu-row-padding}`
  (`px-3 py-2`) for a slightly denser feel.
- **Dialog footer**: `{spacing.dialog-footer-gap}` (`gap-2`) between
  buttons; footer buttons themselves are `size="lg"`.
- **Section gap** inside a panel: 24px (`gap-6`) between grouped rows,
  32px (`gap-8`) between subsections, 48px (`gap-12`) between major
  regions on hero / empty-state layouts.
- **Interior padding** inside cards / rows: tight (12 / 16). The tight
  interior + generous section gap combination is the "dense but calm"
  rhythm.

### Grid & Container

OnMyAgent is a desktop shell; there is no fluid marketing grid. Widths
come from the shell composition, not a container scale.

- **Rail width**: 240px expanded, 56px collapsed (managed by the sidebar
  primitive). Do not override.
- **Main panel**: fills remaining width between rail and optional
  right-side panel. No page-level `max-w-*` inside the panel — content
  breathes to the panel edges.
- **Right-side panel**: 320–560px, resizable via `Resizable`. Defaults
  vary by feature (settings 400, artifacts 480, canvas 560).
- **Dialogs**: 640px default (`Dialog.Content` default max-width); 800px
  when the dialog carries a two-column layout or a long form.
- **Popovers / dropdown menus**: cap at 320px content width; wider
  popovers mean the affordance should be a Sheet or Dialog.
- **Sheets**: side-anchored, 400–560px depending on content. Do not
  full-screen a sheet unless it hosts a mobile-parity flow.
- **Empty states / hero regions**: content column max 640px, centered
  inside the panel. Everything else is anchored to the panel edges.

### Whitespace Philosophy

Dense but calm — tight interior padding paired with generous section
gaps. A card at `p-4` (16) with `gap-2` (8) between its rows sits inside
a panel with `gap-8` (32) between cards; the panel itself has 24–32px
top-of-content padding beneath the titlebar. The rail is quiet-cold with
minimal padding (`px-2 py-1`) — it should not compete with content for
visual real estate. When in doubt, tighten interiors, widen sections.

## 6. Depth

- **No component shadows.** `shadow-*`, `drop-shadow-*`, custom
  `box-shadow` for hierarchy are all forbidden.
- Elevation is expressed via surface color (`surface` on top of `background`
  on top of `app-bg`), borders, and hover / active states.
- Scrollbars are weak, WeChat-style: hidden by default, briefly visible on
  pointer movement or active scroll, fading back to transparent.
  Consume `--dls-scrollbar-thumb` / `--dls-scrollbar-thumb-active`; do not
  introduce component-level scrollbar colors unless the browser forces it.

### Decorative Depth

OnMyAgent explicitly rejects decorative depth. No gradients as
decoration, no glow, no noise textures, no glassmorphism blur outside
the composited-surface tokens the primitive layer already declares.
Flatness is a **decision**, not a limitation: hierarchy comes from
surface color, border, spacing, and weight — those are cheaper to
generate, cheaper to read, and portable across dark/light without any
per-mode fiddling. The one sanctioned "chrome" moment is
`AgentAvatarMesh` (see § 4 Signature Components), and it is
identity-only.

### Z-Layer Stack

Overlays follow a fixed 6-level stack sourced from the YAML `z-layers:`
block. Every new floating surface picks a level from this table — do not
invent numbers.

| Layer | Value | Use |
| --- | --- | --- |
| `base` | 0 | Content in the normal flow. Cards, rows, panel body. |
| `sticky` | 10 | Sticky headers, pinned toolbars, in-panel section headers that shadow. |
| `dropdown` | 100 | `DropdownMenu`, `Select` popup, autocomplete listbox. |
| `popover` | 200 | `Popover`, `HoverCard`, `Tooltip`. Higher than dropdown so a tooltip on a dropdown item remains visible. |
| `dialog` | 300 | `Dialog`, `AlertDialog`, `Sheet`. The modal plane. |
| `toast` | 400 | Toast / notice stack. Highest normal layer — always on top of a dialog. |

`overlay-max` (999) is reserved as an emergency ceiling for
drag-preview ghosts and system-level overlays; treat any use as a
review flag. shadcn / Radix primitives already ship z-index values
close to these — when composing custom overlays, match the level, not
the raw number, so future re-tuning is one place.

**Motion.** Motion clarifies state changes; it does not decorate. Durations
and easings are semantic tokens in the YAML `motion:` block above.

| Duration | Value | Typical use |
| --- | --- | --- |
| `instant` | 0ms | State swaps that must feel synchronous (theme toggle, tab active swap) |
| `fast` | 120ms | Hover / focus reveals, tooltip fade, small color changes |
| `normal` | 200ms | Popover / dropdown / sheet enter, dialog fade, tab content swap |
| `slow` | 320ms | Full-panel reveals, drag settle, empty-state hero entrance |

| Easing | Curve | Typical use |
| --- | --- | --- |
| `standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default UI motion — 90% of transitions |
| `decisive` | `cubic-bezier(0.3, 0, 0.2, 1)` | Primary CTA commit, submit / approve, destructive confirm |
| `signal` | `cubic-bezier(0.4, 0, 0.6, 1)` | Symmetric ambient pulses — activity, running, online dots |

Library / utility mapping:

- Reorder / drag / layout — `motion/react`; pass duration/easing tokens as `transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}` values, not hardcoded strings.
- Enter / exit reveals — `tw-animate-css` (`animate-in`, `fade-in`, `slide-in-*`, `duration-*`). Prefer `duration-[120ms]` / `duration-[200ms]` / `duration-[320ms]` matching the tokens, not `duration-150` etc.
- Spinners / running indicators — named CSS keyframes; keep local and short.
- Hover / focus — CSS transitions on the affected property only (opacity, color, border-color, background-color); do not transition `transform` for hover feedback.
- Always respect `prefers-reduced-motion`. When set, skip enter/exit reveals, disable transform-based motion, and fall back to instant state swaps. Opacity fades under `fast` are allowed to remain.

## 7. Shapes

### Border Radius Scale

Radii come from the YAML `rounded:` block. Every corner in the app
should resolve to one of these.

| Token | Value | Use |
| --- | --- | --- |
| `xs` | 3 | Status dots, tiny indicators, keyboard-shortcut chip corners. |
| `sm` | 6 | Status badges, filter chips, inline pill labels. |
| `md` | 8 | Cards, inputs, textareas, artifact previews, code-block backgrounds. |
| `lg` | 10 | Standard buttons (`default` / `sm` / `xs`), menu row buttons, list rows. |
| `xl` | 14 | Large buttons (`lg`), dialog panels, sheet panels. |
| `pill` | 999 | Status pills, filter chips (`NavTabButton`), presence dots outer ring. |

`rounded-full` on ordinary CTAs is forbidden — see § 8 Don'ts. Pills
belong to status / filter / identity chrome only. Corners smaller than
`xs` (arbitrary `rounded-[2px]` etc.) are drift.

### Iconography

Icon sizes come from the YAML `iconography:` block; stroke width is
uniformly 1.5 and paint inherits from `currentColor`. The library
contract is **`lucide-react` only**; `heroicons`, `phosphor-icons`, and
Radix filled-variant icon sets are forbidden (they introduce competing
stroke weights and metric mismatches at small sizes).

| Token | Value | Use |
| --- | --- | --- |
| `xs` | 12 | Inline hint icons inside chips, dropdown affordance chevrons. |
| `sm` | 14 | In-row action icons, meta-info glyphs, timestamp adornments. |
| `base` | 16 | Menu icons, default button icons, sidebar rail glyphs. |
| `lg` | 20 | Primary CTA leading icons, section-header decoration, empty-state secondary glyphs. |
| `xl` | 24 | Empty-state hero decoration, tour illustrations, mesh-avatar overlays. |

Icon color inherits from `currentColor` — set the text color on the
parent, do not pass `color` as an icon prop unless the icon must
contradict its parent (rare; usually a design smell). Never hardcode a
fill on a Lucide icon; if you need a filled glyph, compose it with a
`div` background token or reach for a signature component that owns
that look.

### Photography & Illustration Geometry

- **Avatar mesh**: 32 / 40 / 64 px densities defined by the
  `AgentAvatarMesh` primitive. Do not override with raw `h-N w-N` —
  reach for the primitive's `size` prop. Corners are handled by the
  primitive; do not add `rounded-*` at the call site.
- **User avatars**: 24 / 32 / 40 px squircle (`rounded-md`, 8px).
  Group / workspace avatars use the same scale.
- **Artifact previews**: 16:9 aspect (`aspect-video`), `rounded-md`
  (8px) corners, `object-cover` on media. Reserve the aspect at load
  time — do not let previews reflow the surrounding row.
- **Empty-state hero illustration**: intrinsic aspect, `rounded-lg`
  (10px), `max-h-60` (240px) ceiling. Illustrations sit above the
  headline, centered inside the empty-state column.
- **Screenshots inside docs / tour**: `rounded-md` corners with a 1px
  `border-dls-border` frame; no shadow.

## 8. Do's and Don'ts

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
  in ordinary UI. They are only allowed inside the exception categories in § 11.
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

## 9. Focus & Accessibility

OnMyAgent is a **keyboard-navigable Electron app**. A11y is a hard
requirement, not decoration.

**Focus ring.**

- Every interactive element (`button`, `[role="button"]`,
  `[role="menuitem"]`, `[role="tab"]`, `[tabindex="0"]`, native form
  controls) MUST show a visible focus ring on keyboard focus.
- Use the `focus:` YAML tokens: `ring-color` (light `#005DFF` / dark
  `#2F7BFF`), `ring-width` 2px, `ring-offset` 2px, `ring-style` solid.
  The primitive's own border-radius is the ring radius — do not
  override.
- Prefer `focus-visible:` (keyboard focus) over `focus:` so the ring
  does not appear on mouse click. All shadcn primitives in
  `components/ui/` already follow this convention; extend it.
- Do not remove the ring for aesthetic reasons. If the ring collides
  with layout, adjust the layout, not the ring.

**Contrast.**

- WCAG AA minimums: 4.5:1 for body text (< 18px), 3:1 for large text
  (≥ 18px or bold ≥ 14px), 3:1 for UI component borders / icons that
  convey information.
- `dls-text-secondary` on `dls-surface` is the practical floor for
  secondary text. Do not put lighter grey text on light surfaces.
- Signal cyan on light `dls-surface` fails AA for text; use it as an
  indicator color (dots, borders, marks), never as body text.

**Keyboard navigation.**

- `Tab` / `Shift+Tab` moves focus in logical DOM order.
- `Enter` and `Space` activate buttons and links.
- `Escape` closes dialogs, popovers, dropdowns, sheets, and command
  palettes. Nested overlays close one at a time.
- Arrow keys navigate within `menu`, `listbox`, `tablist`, and
  `radiogroup`. Home / End jump to first / last.
- `⌘K` / `Ctrl+K` opens the command palette (product convention).
- Focus is trapped inside modal dialogs and drawers; on close, focus
  returns to the invoking element.

**Screen readers.**

- All icon-only buttons MUST carry `aria-label` (i18n-routed) or a
  visually-hidden text child. `<Button size="icon">` variants inherit
  no label; add one at the call site.
- Live regions (`role="status"`, `role="alert"`) announce running /
  error state changes; keep announcements terse.
- Decorative icons use `aria-hidden="true"`.
- Loading spinners inside actionable rows announce via
  `aria-busy="true"` on the parent, not per-icon labels.

**Reduced motion.**

- Respect `prefers-reduced-motion: reduce`. When set:
  - Skip enter / exit reveals (`animate-in`, `slide-in-*`).
  - Disable transform-based motion; state swaps become instant.
  - Opacity fades at `duration.fast` (120ms) remain — they are
    functional feedback, not decoration.
- Spinners and running-indicator pulses may keep animating; they
  encode state, not motion decoration.

---

## 10. Responsive & Platform

OnMyAgent is a **desktop-first Electron app**. Responsive rules exist
to keep the shell readable across the practical window-size range users
actually resize into, not to reach mobile.

### Breakpoints

| Name | Width | Key changes |
| --- | --- | --- |
| Narrow | < 900px | Rail collapses to icon-only (56px); right-side panel closes; dialogs may fullscreen at ≤ 640px (see Collapsing Strategy). |
| Default | 900–1440px | Full rail (240px) + main panel + optional right-side panel. Canonical layout. |
| Wide | > 1440px | Rail and panels keep their widths; main panel gets the extra space. No content-max reflow. |

- **No mobile surface.** Landing pages, cloud dashboards, and marketing
  web surfaces are out of scope for this file (see `apps/web/*` — not
  covered here). The Electron shell's minimum window width is 900px.

### Touch Targets

OnMyAgent is a pointer-primary desktop shell (mouse / trackpad /
keyboard). The 44 × 44 px WCAG target-size floor applies to
touch-primary surfaces; on a desktop pointer surface the effective
floor is smaller.

- Primitive minimum heights — 24 (`xs`), 32 (`sm`), 36 (`default`),
  40 (`lg`) — all meet the pointer-precision + keyboard-navigable
  floor.
- Do not shrink below 24px for cosmetic reasons; below that,
  keyboard focus rings clip and hover targets become fragile.
- If a surface goes touch-mode (future iPad / Sidecar rendering),
  primitives should reach for `default` or `lg` sizes rather than
  introducing new shrunk variants.

### Collapsing Strategy

- **Rail** collapses via the sidebar primitive (240 → 56 icon-only)
  at Narrow. State is persisted per workspace.
- **Right-side panel** closes at Narrow; on reopen it takes precedence
  over the main panel scroll position.
- **Dialogs** at ≤ 640px viewport width fullscreen via the
  `Dialog.Content` narrow-viewport behavior. Buttons in the footer
  stack vertically (`sm:flex-row` reversal).
- **Popovers / dropdowns** never fullscreen — they reposition against
  the viewport edge via Radix positioning.
- **Sheets** stay side-anchored down to the Narrow floor; below the
  Electron minimum (900px) the app itself would refuse to render.

### Image Behavior

- **Avatar mesh** primitives render at 32 / 40 / 64 px densities;
  scaling is handled by the primitive, not CSS transforms.
- **User avatars** at 24 / 32 / 40 px squircle preserve their aspect;
  no `object-fit: contain` — always `cover`.
- **Artifact previews** hold 16:9 (`aspect-video`); the row reserves
  the aspect at layout time to avoid reflow on load.
- **Empty-state hero illustrations** cap at 240px tall and center
  inside the empty-state column. Do not scale beyond intrinsic size.
- **Screenshots inside docs / tour** keep 1px `border-dls-border`
  frames; no drop shadows even on illustration surfaces.

### Cross-Platform Titlebar

The Electron shell renders on macOS, Windows, and Linux; each platform's
titlebar rules differ.

- **macOS.** `titleBarStyle="hiddenInset"` — a 28px drag strip pinned
  at the top of the window absorbs pointer events by default.
  Interactive controls (icon buttons, tabs, custom containers) inside
  the titlebar or sidebar-header regions MUST add
  `mac:titlebar-no-drag`; without it, the window swallows clicks and
  double-clicks. Enforced via the `mac-titlebar-no-drag` flag in the
  YAML `flags:` block.
- **Windows.** System frame with native window controls in the top-right
  (minimize / maximize / close). No drag strip absorbs clicks the way
  macOS does; the `windows:titlebar-no-drag` custom variant is declared
  for future-proofing (in case we ship a custom titlebar on Windows) but
  is not currently required. Sidebar-header controls do not need the
  variant.
- **Linux.** System frame with native GNOME / KDE / Sway window
  decorations. `linux:titlebar-no-drag` is declared analogously to
  Windows for symmetry; not currently required.

If we later adopt a custom titlebar on Windows or Linux (for a unified
look), the corresponding `*-titlebar-no-drag` utility becomes required
and the YAML `flags:` block should grow a matching rule.

## 11. Intentional Exceptions

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

## 12. Agent Prompt Guide

When an AI agent is asked to generate or modify OnMyAgent UI, it MUST:

1. **Read this file first.** Especially § 4 (component contracts), § 8
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
> § 4 component contracts, and § 8 Do's / Don'ts. Prefer primitives from
> `apps/app/src/components/ui/` and composites from
> `apps/app/src/react-app/design-system/`. Route all user-visible strings
> through i18n. Do not introduce shadows, arbitrary text-px, arbitrary
> hex in page JSX, or `any` casts."

## 13. Iteration Guide

DESIGN.md is a **living contract**, not a static export. When you (agent
or human) need to extend it, follow these rules in order.

**When to add a new token vs. reuse.** Reuse an existing token if the
value already appears anywhere in the file. If a value is needed at 2–3
sites, add a **variant** to the nearest primitive (e.g., a new `size`
on `Button`, a new `variant` on `StatusBadge`) — not a top-level
DESIGN.md token. Only when a value is needed at **4+ sites**, or when
it carries brand-identity meaning (a signature color, a mesh
gradient), does it earn a place in the YAML front matter as a token.
The bar is intentionally high — every new token is one more thing an
agent must remember.

**When to add a new signature component.** Signature status is
reserved for OnMyAgent-native brand-identity anchors — components that
if reinvented would erode the visual voice. Today there are four
(`ChatMessage row`, `SessionCard`, `AgentAvatarMesh`, `ArtifactCard`).
Adding a fifth requires (a) demonstrating that agents repeatedly
reinvent it, and (b) that the reinventions produce visible drift. New
domain components (settings pages, integration cards, wizard steps)
usually compose from atoms and stay covered by the "reuse the
primitive" rule.

**The extension workflow.** For any non-trivial DESIGN.md change:

1. Write a plan doc: `docs/plans/YYYY-MM-DD-NNN-feat-design-md-vN-plan.md`.
   Use the compound-engineering `ce-plan` skill; v1, v2, and v3 plans
   under `docs/plans/` are worked examples.
2. Update `DESIGN.md` — YAML front matter first, then the narrative
   section that consumes it. Keep the two in lockstep so
   `extract-tokens.mjs` can diff cleanly.
3. Extend `scripts/design/extract-tokens.mjs` if a new YAML block was
   added, so the drift check covers it.
4. Run `pnpm task check design` locally. Expect 0 drift on the tokens
   you already ship in code; new tokens may legitimately report
   `missing-in-code` until the follow-up CSS wire-up PR lands.
5. Update `docs/design/preview.html` and `preview-dark.html` if the
   token is visualizable (color, radius, motion, icon, z-layer).
6. Update pointer sentences in `docs/design/theme-system.md` and,
   when the change closes a gap, remove the item from § 14 Known Gaps.

**Ownership boundary.** DESIGN.md holds **tokens + rules**;
`theme-system.md` holds **narrative + why**; `AGENTS.md` holds **code
process**. If a change would fit in two of the three, do the token /
rule half here and the narrative half in `theme-system.md`. Do not
duplicate content between them — link.

## 14. Known Gaps

v3 does **not** cover the following. Agents needing these should
surface a proposal rather than invent silently.

- **Data-viz / chart palette.** No chart surface ships today; when it
  does, the palette needs a dedicated pass with product signoff.
- **Copy voice / tone guide.** Product-writing style (formal vs.
  friendly, error-message posture, empty-state voice) is not
  documented. i18n keys enforce structure, not voice.
- **Brand assets.** Logo variants, wordmark, favicon, product-mark
  usage rules are a separate brand-identity track.
- **Marketing / landing surface.** No marketing surface exists in
  scope; `apps/web/*` and any future landing pages are out of this
  contract.
- **Monospace typography.** No terminal / code-block component exists
  in the shipped UI. When one lands, mono needs its own scale + face
  contract; the § 3 Note on Font Substitutes documents the current
  stack.
- **CI gate.** `pnpm task check design` is a local check;
  `.github/workflows/**` wire-up is human-gated per `AGENTS.md`.
- **Auto-fix codemod.** The drift detector reports; it does not fix.
- **Domain composites v2 catalog.** Expansion beyond the 5 existing
  composites is a `frontend-primitive-refactor` skill task, not a
  DESIGN.md task.
- **Animation choreography.** Sequenced multi-element transitions,
  interruptible timelines, and stagger patterns beyond
  duration/easing tokens are agent-local decisions.
- **Windows / Linux titlebar drag-region behavior.** Declared as
  variants in § 10 for future-proofing; not currently enforced by a
  hard flag because system-frame titlebars on non-macOS do not steal
  clicks the way `hiddenInset` does.

Closing a gap is documented in § 13 Iteration Guide — plan doc,
YAML + narrative update, extractor extension, preview HTML, cross-doc
pointer, and remove the item here.

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
