---
spec: stitch-design-md/v-alpha
product: OnMyAgent
platform: electron-desktop
authority: authoritative
maintenance: manual-event-driven
last-reviewed: 2026-07-18

colors:
  light:
    primary: "#005DFF"
    primary-hover: "#004ED6"
    primary-soft: "#EAF2FF"
    # signal (light) — migrated from #03FFDE (1.35:1 on white,
    # fails WCAG SC 1.4.11) to #00B39B (3.36:1 AA pass) while
    # preserving the cyan/teal semantic. Dark mode retains #03FFDE
    # where its contrast against near-black is AA.
    signal: "#00B39B"
    ink: "#0F172A"
    slate: "#64748B"
    # mist is the softest hairline tier — a step lighter than
    # `border` so `mist < border < border-strong` scans as three
    # levels. Distinct hex, not aliased to `border`.
    mist: "#EEF0F3"
    # Shell three-tier (WeChat light): rail < sidebar < background < surface.
    surface: "#FFFFFF"
    surface-muted: "#F4F4F5"
    background: "#FAFAFA"
    app-bg: "#F5F5F5"
    sidebar: "#F0F0F0"
    rail-bg: "#E8E8E8"
    rail-active: "#DEDEDE"
    rail-hover: "#E2E2E2"
    border: "#E5E7EB"
    border-strong: "#CBD5E1"
    hover: "#EEF4FF"
    active: "#DDEBFF"
    list-selected: "#E4E4E4"
    list-hover: "#E8E8E8"
    danger: "#EF4444"
    warning: "#D19A2A"
    success-fg: "#047857"
    online: "#28B276"
    # Artifact hue palette — Radix shade 9 in light for full chroma
    # against white surfaces. Values are indirected through Radix
    # `--<hue>-9` CSS variables so light/dark and P3 wide-gamut
    # fallbacks stay in sync with `apps/app/src/styles/colors.css`.
    # MUST NOT be used outside ArtifactCard — see § 11 Intentional
    # Exceptions.
    artifact-hue-image: "var(--violet-9)"
    artifact-hue-code: "var(--blue-9)"
    artifact-hue-document: "var(--slate-9)"
    artifact-hue-data: "var(--teal-9)"
    artifact-hue-plot: "var(--grass-9)"
    artifact-hue-3d: "var(--plum-9)"
    artifact-hue-audio: "var(--pink-9)"
    artifact-hue-video: "var(--crimson-9)"
  dark:
    primary: "#2F7BFF"
    primary-hover: "#5B96FF"
    primary-soft: "#102A5C"
    signal: "#03FFDE"
    ink: "#F8FAFC"
    slate: "#94A3B8"
    # mist (dark) — one step darker than `border` so the ladder
    # stays visible on dark surfaces.
    mist: "#2E2E2E"
    # Shell three-tier (WeChat dark): rail (deepest) < background (main)
    # < sidebar (list lift) < surface (cards). Keep ≥1 perceptual step
    # between each shell lane so the three-column shell does not flatten.
    surface: "#2C2C2C"
    surface-muted: "#333333"
    background: "#1F1F1F"
    app-bg: "#1F1F1F"
    sidebar: "#2A2A2A"
    rail-bg: "#141414"
    rail-active: "#2E2E2E"
    rail-hover: "#222222"
    border: "#3A3A3A"
    border-strong: "#4A4A4A"
    hover: "#323232"
    active: "#3A3A3A"
    list-selected: "#363636"
    list-hover: "#323232"
    danger: "#F87171"
    warning: "#FBBF24"
    success-fg: "#6EE7B7"
    online: "#28B276"
    # Artifact hue palette — Radix shade 4 in dark for perceptually
    # even chroma against dark surfaces without over-saturation.
    artifact-hue-image: "var(--violet-4)"
    artifact-hue-code: "var(--blue-4)"
    artifact-hue-document: "var(--slate-4)"
    artifact-hue-data: "var(--teal-4)"
    artifact-hue-plot: "var(--grass-4)"
    artifact-hue-3d: "var(--plum-4)"
    artifact-hue-audio: "var(--pink-4)"
    artifact-hue-video: "var(--crimson-4)"

typography:
  font-body: "Geist Variable"
  font-heading: "IBM Plex Sans Variable"
  # Monospace stack for code surfaces (§4c tool-call / tool-output,
  # §4g inline code + fenced code + diff, §5a kbd glyph parity). No
  # licensed face — system stack picks the platform-native mono. See
  # § 14 Known Gaps: v6 lowers this from "known gap" to "declared
  # fallback contract".
  font-mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Code', 'Roboto Mono', monospace"
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
  # OnMyAgent runs on a hybrid 2/4/7 pixel-cluster grid because dense
  # agent UI (row buttons, menu items, badges, kbd chips) needs 6 / 10
  # / 14 / 28 / 40 / 56 px rhythms that a strict multiple-of-4 scale
  # can't express. The scale is layered so codemods know which slot
  # each value belongs to.
  #
  # `scale` = macro section rhythm (multiples of 4)
  # `micro-scale` = row/chip rhythm (multiples of 2, whitelisted)
  # `button-heights` = row/button vertical scale (24 28 32 36 40 44 56)
  # `hero-scale` = empty-state / marketing padding (28 40 56 80 96)
  #
  # Anything outside these three lists is an orphan and gets flagged
  # by `scripts/design/codemod/snap-spacing.mjs`.
  scale:
    2xs: 4     # gap-1  / p-1
    xs: 8      # gap-2  / p-2
    sm: 12     # gap-3  / p-3
    base: 16   # gap-4  / p-4
    md: 20     # gap-5  / p-5 (dense card headers)
    lg: 24     # gap-6  / p-6 (card body / section divider)
    xl: 32     # gap-8  / p-8 (page section rhythm)
    2xl: 48    # gap-12 / p-12 (empty-state hero, marketing block)
    3xl: 64    # gap-16 / p-16 (top-level marketing rhythm)
  micro-scale:
    # Allowed .5-step Tailwind classes for dense-UI slots only.
    # Never use these for page-level padding or section rhythm.
    2xs: 2     # gap-0.5 / p-0.5 — chip inner padding
    xs: 6      # gap-1.5 / p-1.5 — MenuRow gap / dropdown vertical
    sm: 10     # gap-2.5 / p-2.5 — SessionCard hairline padding / send-button padding
    md: 14     # px-3.5 / size-3.5 — Icon xs / status-dot / kbd chip
    lg: 18     # px-4.5 / size-4.5 — Icon between sm(14) and base(16)
    xl: 22     # px-5.5 / size-5.5 — reserved
  button-heights:
    # Canonical h/size values usable for row-level UI. Buttons uses
    # xs/sm/default/lg from this list; sidebar-row / status-badge /
    # input-group xs use 28; large rows use 56; chrome tier (48) is
    # for shell chrome only — rail items, top titlebar/header bars,
    # composer footer rows, workspace-switcher rows — not for
    # in-content buttons.
    xs: 24     # h-6  — chip / status-badge
    sm-plus: 28  # h-7 — sidebar row, status-badge default, input-group xs
    sm: 32     # h-8  — compact toolbar
    default: 36 # h-9 — default in-page action
    lg: 40     # h-10 — primary CTA
    xl: 44     # h-11 — touch-target-safe CTA (also used for mobile)
    chrome: 48 # h-12 / min-h-12 — RailButton top / panel titlebar / composer footer chrome
    2xl: 56    # h-14 — "large row" (Level-3 nav, IconTile lg, avatar-lg)
  hero-scale:
    # Padding values for empty-state hero / marketing / plugin index
    # sections. NEVER use for row-level UI.
    2xs: 36    # p-9 / pl-9 / ml-9 — padding aligned to h-9 button icon slot
    xs: 28     # p-7 — small hero
    sm: 40     # p-10 — plugin page container padding
    md: 56     # p-14 — full-page empty state
    lg: 80     # p-20 — section pt/pb
    xl: 96     # p-24 — top-level marketing block
  # Slot presets — canonical strings for the 3 most reused density
  # regions. These are the only Tailwind strings the contract locks;
  # everything else picks from scale/micro-scale/button-heights/hero.
  row-padding: "px-3 py-2.5"           # ActionRow default row
  menu-row-padding: "px-3 py-2"        # MenuRowButton
  dialog-footer-gap: "gap-2"            # Dialog / AlertDialog footers
  # Codemod: `scripts/design/codemod/snap-spacing.mjs` flags anything
  # not in the four lists above (scale ∪ micro-scale ∪ button-heights
  # ∪ hero-scale). Dry-run by default; pass `--write` to apply.

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

state-timings:
  instant-ms: 200
  short-ms: 1000
  long-ms: 10000

notifications:
  stack-cap: 5
  position: top-right
  duration-info-ms: 4000
  duration-success-ms: 4000
  duration-warn-ms: 6000
  duration-error: persistent
  motion: slide-in-from-right-fade-out
  reduced-motion: fade-only

kbd:
  separator: " + "
  separator-uses-hair-space: true
  chip-padding-x-px: 4
  chip-padding-y-px: 2
  chip-radius: sm
  platform-substitution: runtime

message-roles:
  user:
    surface: dls-surface
    type: text-sm
    border-left: none
    prefix-icon: none
    prefix-color: none
  assistant:
    surface: dls-surface
    type: text-sm
    border-left: none
    prefix-icon: none
    prefix-color: none
  tool-call:
    surface: dls-surface-muted
    type: text-xs-font-mono
    border-left: 2px-dls-primary
    prefix-icon: wrench
    prefix-color: dls-primary
  tool-output:
    surface: dls-surface-muted
    type: text-xs-font-mono
    border-left: 2px-dls-slate
    prefix-icon: terminal
    prefix-color: dls-slate
  thinking:
    surface: dls-surface
    type: text-xs-italic
    border-left: 2px-dls-signal
    prefix-icon: sparkles
    prefix-color: dls-signal
  system:
    surface: dls-app-bg
    type: text-xs
    border-left: none
    prefix-icon: info
    prefix-color: dls-text-secondary
  error:
    surface: dls-surface
    type: text-sm
    border-left: 2px-dls-danger
    prefix-icon: alert-circle
    prefix-color: dls-danger

streaming:
  cursor-shape: block
  cursor-width-px: 6
  cursor-height-px: 12
  cursor-color: dls-signal
  blink-duration-ms: 320
  blink-easing: signal
  pause-threshold-ms: 1000
  pause-glyph: horizontal-ellipsis
  pause-color: dls-text-tertiary
  reduced-motion: cursor-hold-no-blink

presence:
  online:
    color: dls-online
    motion: none
    icon: circle-filled
  idle:
    color: dls-text-tertiary
    motion: none
    icon: circle
  typing:
    color: dls-signal
    motion: pulse-fast
    icon: pencil
  running:
    color: dls-primary
    motion: pulse-normal
    icon: play
  paused:
    color: dls-warning
    motion: none
    icon: pause
  disconnected:
    color: dls-slate
    motion: none
    icon: cloud-off
  errored:
    color: dls-danger
    motion: shake-once
    icon: alert-circle

tool-approval:
  risk-tiers:
    safe:
      border-width-px: 0
      border-color: none
      primary-button-variant: primary
    careful:
      border-width-px: 2
      border-color: dls-warning
      primary-button-variant: primary
    destructive:
      border-width-px: 4
      border-color: dls-danger
      primary-button-variant: danger
  param-summary-max-chars: 80
  param-summary-full-max-lines: 200
  diff-inline-line-threshold: 20
  focus-default-safe: primary
  focus-default-destructive: deny

artifact-hue:
  image: radix-violet-9
  code: radix-blue-9
  document: radix-slate-9
  data: radix-teal-9
  plot: radix-grass-9
  3d: radix-plum-9
  audio: radix-pink-9
  video: radix-crimson-9

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
  # Two families. `xs/sm/default` are inline UI buttons that live inside
  # rows, cards, and dense panels — they share `radius: lg` on purpose so
  # they align vertically with adjacent inputs and dropdowns. `lg` steps
  # up to `radius: xl` because it's the CTA family, meant to visually
  # separate from surrounding controls (dialog footers, hero CTAs).
  # Never mix the two families inside the same container.
  xs:      { family: inline, height: 24, padding: "px-2", radius: lg, text: xs, use: "chip-scale action inside dense rows" }
  sm:      { family: inline, height: 32, padding: "px-3", radius: lg, text: sm, use: "compact action inside cards / toolbars" }
  default: { family: inline, height: 36, padding: "px-3", radius: lg, text: sm, use: "default in-page action" }
  lg:      { family: cta,    height: 40, padding: "px-6", radius: xl, text: sm, use: "primary CTA / dialog footer" }
  icon-xs: { family: inline, size: 24, radius: lg }
  icon-sm: { family: inline, size: 32, radius: lg }
  icon:    { family: inline, size: 36, radius: lg }
  icon-lg: { family: cta,    size: 40, radius: lg }
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
      - message-role
      - mono-log-box
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
      - streaming-cursor
      - switch
      - table
      - tabs
      - textarea
      - toggle
      - toggle-group
      - tool-approval-card
      - tooltip
  composites:
    location: apps/app/src/react-app/design-system
    list:
      - flyout-item
      - select-menu
      - text-input
      - extension-mesh-avatar
      - provider-icon
      - access-permission-select
      - accessible-root-row
      - agent-skill-icon
      - modals/confirm-modal
  row-primitives:
    location: apps/app/src/components/ui/action-row.tsx
    list:
      - MenuRowButton
      - NavTabButton
      - ActionRowButton
  # Component contracts — Cursor-style {token.ref} bindings for the
  # 20 signature/primitive shapes agents reach for most. Each entry is
  # the enforceable target: radius, height (or padding), surface, text,
  # border. Agents modifying these components MUST update this block in
  # the same PR. Codemod: `scripts/design/codemod/fix-tokens.mjs`
  # promotes contract-mismatched Tailwind strings to the target token.
  contracts:
    # --- Inline buttons (family: inline, radius: lg) -----------------
    button-xs:
      height: "{spacing.button-heights.xs}"          # 24
      radius: "{rounded.lg}"                          # 10
      text: "{typography.scale.xs}"                   # 12
      padding-x: "{spacing.scale.xs}"                 # 8 (px-2)
    button-sm:
      height: "{spacing.button-heights.sm}"          # 32
      radius: "{rounded.lg}"                          # 10
      text: "{typography.scale.sm}"                   # 14
      padding-x: "{spacing.scale.sm}"                 # 12 (px-3)
    button-default:
      height: "{spacing.button-heights.default}"     # 36
      radius: "{rounded.lg}"                          # 10
      text: "{typography.scale.sm}"                   # 14
      padding-x: "{spacing.scale.sm}"                 # 12 (px-3)
    # --- CTA buttons (family: cta, radius: xl) -----------------------
    button-lg:
      height: "{spacing.button-heights.lg}"          # 40
      radius: "{rounded.xl}"                          # 14
      text: "{typography.scale.sm}"                   # 14
      padding-x: "{spacing.scale.lg}"                 # 24 (px-6)
    # --- Chrome tier (family: chrome) --------------------------------
    rail-button:
      height: "{spacing.button-heights.chrome}"      # 48
      radius: "{rounded.md}"                          # 8
      surface: "{colors.rail-bg}"
      surface-active: transparent
      surface-hover: transparent
    # --- Inputs (all share radius: lg for vertical alignment) --------
    input:
      height: "{spacing.button-heights.lg}"          # 40
      radius: "{rounded.lg}"                          # 10
      surface: "{colors.surface}"
      border: "{colors.border}"
      text: "{typography.scale.sm}"                   # 14
      padding: "px-3 py-1"
    textarea:
      radius: "{rounded.lg}"                          # 10
      surface: "{colors.surface}"
      border: "{colors.border}"
      text: "{typography.scale.sm}"                   # 14
      min-height: 80
    select-menu:
      height: "{spacing.button-heights.lg}"          # 40
      radius: "{rounded.lg}"                          # 10
      surface: "{colors.surface}"
      border: "{colors.border}"
    # --- Cards (radius: xl for outer, lg for inner nested rows) ------
    settings-card:
      radius: "{rounded.xl}"                          # 14
      surface: "{colors.surface}"
      border: "{colors.border}"
      padding: "{spacing.scale.lg}"                   # 24
      section-title: "{typography.scale.lg}/600"      # 18
    layout-section:
      radius: "{rounded.xl}"                          # 14
      surface: "{colors.surface}"
      border: "{colors.border}"
      padding: "{spacing.scale.lg}"                   # 24
    settings-inset:
      # inner card nested inside settings-card — one radius tier down
      radius: "{rounded.lg}"                          # 10
      surface: "{colors.surface-muted}"
      border: "{colors.border}"
    action-row-button:
      radius: "{rounded.xl}"                          # 14
      surface: "{colors.surface}"
      border: "{colors.border}"
      padding: "p-3.5"
    session-card:
      radius: "{rounded.md}"                          # 8 (signature — see § 4)
      surface: "{colors.surface}"
      padding: "{spacing.row-padding}"
      title: "{typography.scale.sm}/500"
    chat-message-row:
      scope: "root session transcript only; nested transcripts retain their compact contract"
      max-content-width-default: 832
      max-content-width-rules: "<=1200:832; <=1600:65%; <=2000:60%; >2000:min(55%,1400)"
      content-inline-padding: 8
      initial-assistant-only-padding-top: 24
      assistant-avatar-size: 24
      assistant-name: "{typography.scale.sm}/600"
      assistant-body: "13px/19px"                    # § 11 WorkBuddy parity exception
      assistant-markdown-body: "14px/25px"           # § 11 WorkBuddy loose Markdown parity exception
      streaming-indicator: "separate activity row; no inline cursor" # § 11 WorkBuddy parity exception
      assistant-surface: transparent
      user-padding: "8px 12px"
      user-radius: "16px 16px 0 16px"                # § 11 WorkBuddy parity exception
      user-max-height: 310
      action-height: "{spacing.button-heights.xs}"   # 24
      action-gap: "{spacing.scale.xs}"               # 8
      action-radius: "{rounded.md}"                   # 8
      action-icon-size: "{iconography.sizes.md}"      # 16
      scroll-to-latest-size: "{spacing.button-heights.sm}" # 32
      scroll-to-latest-radius: "{rounded.pill}"        # § 11 WorkBuddy parity exception
      scroll-to-latest-icon-size: "{iconography.sizes.md}" # 16
      scroll-to-latest-bottom-offset: "{spacing.scale.lg}" # 24
      scroll-to-latest-elevation: "WorkBuddy 4% dual shadow" # § 11 scoped exception
      composer-coupling: "none; transcript refactors must not alter composer geometry"
    transcript-inline-visual:
      scope: "root session transcript only"
      radius: 16                                      # § 11 WorkBuddy parity exception
      border: "{colors.border}"
      header-padding: "6px 8px 6px 16px"
      body-padding: "12px 16px"
      body-min-height: 360
      body-max-height: "80vh"
    artifact-card:
      radius: "{rounded.md}"                          # 8 (signature — see § 4)
      surface: "{colors.surface}"
      border: "{colors.border}"
      padding: "{spacing.scale.sm}"                   # 12
    skill-card:
      radius: "{rounded.xl}"                          # 14
      surface: "{colors.surface}"
      border: "{colors.border}"
      padding: "{spacing.scale.lg}"                   # 24
    # --- Overlays ----------------------------------------------------
    dialog:
      radius: "{rounded.xl}"                          # 14
      surface: "{colors.surface}"
      border: "{colors.border}"
      title: "{typography.scale.lg}/600"              # 18
      footer-gap: "{spacing.dialog-footer-gap}"       # 8 (gap-2)
    popover:
      radius: "{rounded.lg}"                          # 10
      surface: "{colors.surface}"
      border: "{colors.border}"
      padding: "{spacing.scale.sm}"                   # 12
    dropdown-menu:
      radius: "{rounded.lg}"                          # 10
      surface: "{colors.surface}"
      border: "{colors.border}"
      row-padding: "{spacing.menu-row-padding}"       # px-3 py-2
    tooltip:
      radius: "{rounded.sm}"                          # 6
      surface: "{colors.ink}"
      text: "{typography.scale.xs}"                   # 12
      padding: "px-2 py-1"
    # --- Chips / pills -----------------------------------------------
    status-badge:
      height: "{spacing.button-heights.sm-plus}"     # 28
      radius: "{rounded.sm}"                          # 6
      text: "{typography.scale.xs}"                   # 12
    toggle-chip:
      # chip-family segmented button (SegmentedTabButton size=chip)
      height: "{spacing.button-heights.sm}"          # 32 (min-h-8)
      radius: "{rounded.lg}"                          # 10
      text: "{typography.scale.xs}"                   # 12
      padding-x: "{spacing.scale.sm}"                 # 12 (px-3)
    filter-chip:
      # Free-float category filter (FilterChip → SegmentedTabButton tone=chip size=chip)
      # Selected: soft gray wash — NOT elevated white surface-solid
      height: "{spacing.button-heights.sm}"          # 28 (h-7) compact
      radius: "{rounded.pill}"                        # full pill
      text: "{typography.scale.xs}"                   # 12 medium
      padding-x: "px-2.5"
      selected-surface: "{colors.list-selected}"      # light #E4E4E4 / dark #363636
      idle-surface: transparent
      idle-text: "{colors.slate}"
    kbd-chip:
      radius: "{rounded.sm}"                          # 6
      family: "{typography.font-mono}"
      text: "{typography.scale.xs}"                   # 12
    # --- Shell chrome (§ 4i) ----------------------------------------
    # NoticeBox — in-page persistent callout (not toast). Padding tracks
    # runtime `noticeBoxVariants` size slots, NOT hero empty padding.
    notice-box:
      radius: "{rounded.xl}"                          # 14
      border: "{colors.border}"
      text: "{typography.scale.xs}"                   # 12 (default / content)
      text-comfortable: "{typography.scale.sm}"       # 14
      padding-default: "px-3 py-2"                    # 12 / 8
      padding-content: "px-4 py-3"                    # 16 / 12
      padding-comfortable: "px-5 py-4"                # 20 / 16
      tones: [neutral, info, warning, error]
    # EmptyStateBox — regional / list empty (dashed). Co-exported from
    # notice-box.tsx today; contract is independent of NoticeBox pads.
    empty-state-box:
      radius: "{rounded.lg}"                          # 10
      border: "1px dashed {colors.border}"
      text: "{typography.scale.sm}"                   # 14 (default / comfortable / spacious)
      text-compact: "{typography.scale.xs}"           # 12
      padding-compact: "px-3 py-2"
      padding-default: "px-4 py-10"
      padding-comfortable: "px-4 py-7"
      padding-spacious: "px-6 py-14"
      tones: [muted, surface]                         # muted → surface-muted; surface → surface
    # Empty compound — full-panel hero empty (§ 4a five slots).
    empty:
      radius: "{rounded.xl}"                          # 14
      border: "1px solid {colors.border}"
      padding: "{spacing.scale.2xl}"                  # 48 (p-12)
      title: "{typography.scale.base}/500"            # 16 medium heading
      body: "{typography.scale.sm}"                   # 14 secondary
      media-icon: "{spacing.button-heights.chrome}"   # 48 outer / icon xl inside
    loading-spinner:
      size-sm: 14                                     # size-3.5
      size-default: 16                                # size-4
      border-width: 2
      tones: [muted, inverse]
    confirm-modal:
      radius: "{rounded.xl}"                          # 14 (AlertDialog content)
      surface: "{colors.surface}"
      padding: "{spacing.scale.lg}"                   # 24 (p-6)
      title: "{typography.scale.lg}/500"              # 18
      body: "{typography.scale.sm}"                   # 14
      media-size: 64                                  # size-16 rounded-full
      footer-gap: "{spacing.dialog-footer-gap}"       # 8
      footer-button-size: lg                          # matches § 4 dialog footer rule
      variants: [danger, warning]


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
  state-timings-tokenized: required
  notifications-tokenized: required
  kbd-tokenized: required
  kbd-platform-substitution: runtime
  message-roles-tokenized: required
  streaming-tokenized: required
  presence-tokenized: required
  tool-approval-tokenized: required
  artifact-hue-scoped-to-artifact-cards: required
---

# OnMyAgent — Visual Design Contract

> This file is the authoritative visual language for OnMyAgent. AI coding
> agents (Codex, Claude, OpenCode-based agents) MUST read the YAML front
> matter above and the sections below before generating or modifying UI.
> When code disagrees with this file, code is wrong — fix the code, not the
> contract, unless the contract itself is demonstrably outdated (in that
> case update this file first, then align code).

## Task router (30 seconds)

| You are changing… | Read |
| --- | --- |
| Colors, signal, surfaces, artifact hues | YAML `colors` + § 2 |
| Fonts, type scale, mono | YAML `typography` + § 3 |
| Buttons, tabs, cards, badges, empty states | § 4 + YAML `components` / `components.contracts` |
| Loading / disabled / error timing | YAML `state-timings` + § 4a |
| Toasts / notifications | YAML `notifications` + § 4b |
| User / assistant / tool / system message chrome | YAML `message-roles` + § 4c |
| Streaming cursor / partial output | YAML `streaming` + § 4d |
| Presence / activity dots | YAML `presence` + § 4e |
| Tool approval surfaces | YAML `tool-approval` + § 4f |
| Code / diff blocks | § 4g |
| Session / artifact cards | YAML `artifact-hue` + § 4h |
| Shell rail, titlebar, composer host density | YAML shell chrome + **§ 4i** |
| Layout / spacing | YAML `spacing` + § 5 |
| Keyboard chips (`⌘K`) | YAML `kbd` + § 5a |
| Elevation / z-index | YAML `z-layers` + § 6 |
| Radii / shapes (`rounded-full` rules) | YAML `rounded` + § 7–8 |
| Focus rings / a11y | YAML `focus` + § 9 |
| CJK / i18n space budget | § 10 |
| Intentional exceptions | § 11 |

Drift check: `pnpm task check design`. Philosophy narrative only: `docs/design/theme-system.md`. Doc map: `docs/README.md`.

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
- **Shell lane hierarchy (WeChat three-column).** `rail → background →
  sidebar → surface`. Rail is cold and deepest, background is the main
  canvas, sidebar is the list lane lifted above the canvas, surface is
  cards/composer floating on the canvas. Keep ≥1 perceptual step between
  adjacent shell lanes so the three-column layout does not flatten.

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

Two typefaces plus a system monospace stack carry the workbench.
**Geist Variable** is the body voice — every paragraph, every label,
every button, every row. **IBM Plex Sans Variable** carries headings
and page titles because it reads calmer at larger sizes. The
monospace stack (declared in `typography.font-mono`) is the code
voice — tool-call / tool-output rows, inline + fenced code, diff
bodies, and `<kbd>` glyph parity — and is a **system fallback stack
only**, no licensed face. Introducing a fourth face (condensed,
display, alt-mono) is a distinct DESIGN.md change, not a per-page
choice.

### Note on Font Substitutes

Both faces are variable / open-source but not guaranteed to be installed
on every rendering surface. Fallback order:

- **Body** — `Geist Variable, Geist, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Inter is the closest metric match at 14px body; system-ui keeps the fallback native on non-Inter systems.
- **Headings** — `IBM Plex Sans Variable, "IBM Plex Sans", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Inter is the calmest substitute at 18–32px; Segoe/Roboto keep the fallback native on Windows/Android surfaces respectively.
- **Monospace** — declared in v6 as `typography.font-mono` (see YAML front matter). System stack only: `ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", "Roboto Mono", monospace`. Rendered as `font-mono` (Tailwind) or `var(--dls-font-mono)` (CSS). Guarantees identical glyph metrics across tool-call, code, diff, and `<kbd>` surfaces on any single OS — different OSes still substitute the platform-native face (SF Mono / Cascadia / DejaVu Sans Mono).

Do not fall back to Arial, Helvetica, or Times without going through the
system-ui slot first — direct-named legacy faces are inconsistent across
Windows and Linux distros and break the visual voice.

## 4. Component Stylings

> Machine-readable target shapes live in the YAML front matter under
> `components.contracts`. When adding or refactoring a signature
> component, edit that block in the same PR so `pnpm task check design`
> can enforce the target radius / height / surface tokens.

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

Dual-track — see § 4i. Regional / list empties use `EmptyStateBox`
(dashed). Full-panel hero empties use the `Empty` compound
(`Empty` + `EmptyHeader` / `EmptyMedia` / `EmptyTitle` /
`EmptyDescription` / `EmptyContent`) and follow § 4a five-slot anatomy.
Description is always `text-sm text-dls-text-secondary`. Do not hand-write
page-level `border-dashed` blocks.

**Status**

Use `StatusBadge` for chips and `StatusDot` for presence / activity. Both
consume `dls-status-*` and `dls-online` / `dls-signal` tokens.

### Signature Components

The 41 atoms + 5 composites + 3 row primitives are covered above and
in the YAML `components:` block — reach for them by default. **Signature
components** are the four OnMyAgent-native identity anchors: agents
generating these must not reinvent them, and any refactor to them
requires updating this section in the same PR.

- **`ChatMessage row`** — root session transcripts group one user prompt
  and its following assistant / system / tool output into a turn. The
  transcript is centered and uses the responsive width rules in
  `components.contracts.chat-message-row`. The user prompt is a compact,
  content-width bubble aligned right, with no user avatar or label. The
  assistant identity appears once per turn with a 24px avatar; assistant
  copy stays transparent and card-free. Execution metadata may collapse,
  but final text, artifacts, and pending approvals never do. Nested
  transcripts retain their existing compact layout. Transcript work must
  not change the composer host or composer geometry.
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

## 4a. State Machines

Every screen has four canonical states: **Loading**, **Empty**, **Error**,
**Success**. Draw them from the same anatomy so users learn one shape
and agents don't reinvent per-screen scaffolds.

### Anatomy

Each state carries five slots. Missing slots collapse; do not fill with
filler content.

- **Icon or illustration slot** — `Empty` uses an illustration or a
  Lucide glyph at `iconography.size.xl`; `Error` uses `danger`-colored
  glyph at `iconography.size.lg`; `Loading` and `Success` are usually
  chrome-free (`Loading` uses a spinner or skeleton; `Success` an
  inline check glyph in the confirmation surface).
- **Heading** — `text-lg font-medium` in `dls-text-primary`. Present
  in Empty and Error. Omitted for Loading and Success unless the
  container demands one.
- **Body** — `text-sm text-dls-text-secondary`. One or two sentences
  max; long copy belongs in help documentation.
- **Primary CTA** — `Button size="default"` (or `size="lg"` when the
  state occupies the full main panel). Empty and Error should always
  offer one; Loading offers `Cancel` when the operation is
  interruptible; Success offers `Dismiss` when persistent.
- **Secondary action** — text link or `variant="ghost"` button, right
  of primary or beneath it in narrow containers.

### Perceptual Timing

Async work resolves in three visual bands driven by the YAML
`state-timings:` block. Do not pick timings by taste; pick by band.

| Band | Duration | Presentation |
| --- | --- | --- |
| Instant | `< instant-ms` (200 ms) | Render nothing. No spinner flash. |
| Short indeterminate | `instant-ms` – `short-ms` (200 ms – 1 s) | `LoadingSpinner`, no layout reservation. |
| Long indeterminate | `> short-ms` (1 s) | `Skeleton` with shape parity to the final content. |
| Long known-progress | Any duration ≥ `instant-ms` where progress is measurable | `Progress` primitive (`<progress>` semantics). |

The `long-ms` (10 s) mark is the escalation threshold: past 10 s a
loading state should offer a secondary action (Cancel, Retry, Report)
because the user has moved on and needs a way back.

### Skeleton vs Spinner vs Progress vs Direct Content

Pick from the shortest form that still gives feedback.

- **Direct content** — the operation resolves synchronously or under
  `instant-ms`. Do not render a placeholder.
- **Spinner** — resolves in `instant-ms` – `short-ms` and there is no
  layout to preserve. Use `LoadingSpinner` centered in the container.
- **Skeleton** — resolves after `short-ms` **or** the layout is
  visible before data arrives. Shape-match the eventual content
  (row heights, column count, avatar circles) so the transition is a
  fade, not a reflow.
- **Progress** — the operation exposes a determinate percentage or
  step count (upload, install, migration). Use the `Progress` primitive;
  update at least every `short-ms` interval.

## 4b. Notifications

Toasts are ephemeral, non-modal feedback. Everything that needs a
decision belongs in a `Dialog` or `Sheet`; toasts confirm, warn, or
report and then leave.

### Toast Anatomy

Reuse the `sonner`-backed toast primitive. Each toast carries:

- **Severity icon** — Lucide glyph at `iconography.size.sm`, painted
  with the matching semantic color (`success-fg` / `warning` /
  `danger` / `dls-text-secondary` for info).
- **Title** — `text-sm font-medium`, single line, truncates with
  ellipsis at container edge.
- **Body** — optional, `text-xs text-dls-text-secondary`, up to two
  lines. Wrap i18n keys, don't concatenate raw strings.
- **Action** — optional inline text button (`variant="ghost"`,
  `size="xs"`). One action max; multiple actions belong in a Dialog.
- **Dismiss glyph** — `X` icon at `iconography.size.xs`, right-aligned.
  All toasts are dismissible; error toasts require explicit dismiss.

### Position & Stacking

- **Position** — `top-right` on desktop. Matches macOS notification
  convention and stays clear of the composer at the bottom of the
  primary chat surface.
- **Stack cap** — `notifications.stack-cap` (5). When a sixth toast
  arrives, the oldest non-error toast drops silently. Error toasts are
  preserved unless dismissed.
- **Motion** — slide-in from the right, fade-out on dismiss. When
  `prefers-reduced-motion: reduce` is set (see § 9), degrade to
  fade-only with no slide.

### Duration by Severity

Duration is fixed per severity from the YAML `notifications:` block.
Do not override per call unless the call carries an explicit user
justification (e.g. a copy that requires reading a long path).

| Severity | Token | Duration |
| --- | --- | --- |
| Info | `duration-info-ms` | 4000 ms |
| Success | `duration-success-ms` | 4000 ms |
| Warning | `duration-warn-ms` | 6000 ms |
| Error | `duration-error` | `persistent` — until user dismiss |

Persistent error toasts survive route transitions. If the same error
recurs, dedupe by key rather than restacking.

## 4c. Message Roles

The chat transcript is OnMyAgent's identity surface. Seven roles carry
distinct visual weight while sharing the same base row anatomy — no
role introduces new base colors; identity is encoded via **left-border
accent** + **prefix icon**, not surface fills. Rows separated by
hairlines only (see § 4 `ChatMessage row`).

| Role | Surface | Type | Border-left | Prefix (14 px Lucide) |
| --- | --- | --- | --- | --- |
| `user` | `dls-surface` | `text-sm` | none | avatar 32 px (right-aligned row) |
| `assistant` | `dls-surface` | `text-sm` | none | `AgentAvatarMesh` 32 px |
| `tool-call` | `dls-surface-muted` | `text-xs font-mono` | 2 px `dls-primary` | `wrench` in `dls-primary` |
| `tool-output` | `dls-surface-muted` | `text-xs font-mono` | 2 px `dls-slate` | `terminal` in `dls-slate` |
| `thinking` | `dls-surface` | `text-xs italic` | 2 px `dls-signal` | `sparkles` in `dls-signal` |
| `system` | `dls-app-bg` | `text-xs` | none | `info` in `dls-text-secondary` |
| `error` | `dls-surface` | `text-sm` | 2 px `dls-danger` | `alert-circle` in `dls-danger` |

### Rationale

Every role must be expressible using tokens shipped in v3/v4. Surface
tinting was considered (see brainstorm 006 Option B) and rejected —
adding 14 tint tokens fights § 6 Depth's flatness stance and pushes
long conversations into visual noise. Border-left is the cheapest
identity signal that still scans at a glance.

Monospace typography for `tool-call` / `tool-output` resolves to
`typography.font-mono` (`ui-monospace, SFMono-Regular, Menlo, ...`)
via the `font-mono` Tailwind utility. See § 3 Note on Font
Substitutes for the full stack; the v6 mono contract closes the
earlier "known gap" and ensures tool-call, tool-output, code, diff,
and `<kbd>` surfaces share one font family per OS.

Prefix icons come from `iconography.size.sm` (14 px). Icon paint is
`currentColor` — the role's `border-left` color is the intended tint,
inherited via the row-scoped text-color rule.

## 4d. Streaming Presentation

The streaming state must feel like words landing right now without
adding chrome. One primitive shape, one motion, one fallback.

- **Cursor glyph.** A 6 × 12 px block (`▮`-shaped), filled with
  `dls-signal`, inline at the current caret position of the streaming
  assistant response. No box-shadow, no glow, no gradient — a solid
  rectangle that inherits the row's text color when `dls-signal` is
  unavailable.
- **Blink cadence.** `motion.duration.slow` (320 ms) using
  `motion.easing.signal` (`cubic-bezier(0.4, 0, 0.6, 1)`), 50 % duty
  cycle. Reuses the motion tokens shipped in v2 — do not invent a
  new duration.
- **Pause fallback.** When no token arrives for `state-timings.short-ms`
  (1 s), swap the cursor for an inline horizontal ellipsis `…` in
  `dls-text-tertiary`. Do NOT stack a spinner or progress bar on top;
  the ellipsis alone reads as "still working" and avoids the two-signal
  problem (see § 4a Perceptual Timing).
- **Reduced-motion.** When `prefers-reduced-motion: reduce` is set,
  the cursor stays visible but stops blinking. The ellipsis fallback
  still applies at the same 1 s threshold.
- **No cursor after completion.** The cursor vanishes on the last
  token; it does NOT linger, morph into a period, or fade. The
  message row transitions to its non-streaming state immediately.

Streaming state is a `data-streaming="true"` attribute on the message
row; the cursor + fallback logic is a shared primitive
(`StreamingCursor`, out of v5 scope but pre-declared here so agents
consume the primitive instead of drawing their own indicator).

The root session transcript is the scoped WorkBuddy-parity exception:
it keeps the independent activity row beneath the live answer and does
not append `StreamingCursor` inside Markdown. Nested/local-agent
transcripts retain the shared cursor contract above.

## 4e. Presence & Activity

`StatusDot` and `StatusBadge` primitives (see § 4 Status) carry a
`state=` enum. Six states beyond `online` cover the workbench
operator's need to see whether an agent is idle, thinking, blocked,
or broken. Every state reuses tokens shipped in v3 — no new palette.

| State | Color | Micro-motion | Tooltip icon |
| --- | --- | --- | --- |
| `online` | `dls-online` | none | `circle` filled |
| `idle` | `dls-text-tertiary` | none | `circle` outline |
| `typing` | `dls-signal` | pulse `duration.fast` (120 ms) | `pencil` |
| `running` | `dls-primary` | pulse `duration.normal` (200 ms) | `play` |
| `paused` | `dls-warning` | none | `pause` |
| `disconnected` | `dls-slate` | none | `cloud-off` |
| `errored` | `dls-danger` | shake once on entry | `alert-circle` |

- **StatusDot primitive stays unchanged.** State is a prop enum — do
  not fork the primitive per state. The primitive reads `state` and
  applies the token + motion locally.
- **Micro-motion is optional decoration, not identity.** The state
  reads correctly without motion (color + shape carry meaning). When
  `prefers-reduced-motion: reduce` is set, all pulses and shakes are
  suppressed.
- **Tooltip icon** appears in the on-hover tooltip label, not on the
  dot itself. The dot stays a solid disc; the icon disambiguates on
  hover for accessibility.
- **Presence lives on rows, not inline in body copy.** A message row
  may show a `typing` badge on the sender's avatar; body copy that
  describes state uses text ("the agent is running"), not a dot.

## 4f. Tool Approval

Tool-approval cards gate any assistant-initiated write. Three risk
tiers carry different friction: safe tools approve with one click, a
destructive tool requires a red button and an inline diff. Risk tier
is metadata on the tool definition, not a per-call decision.

### Risk Tiers

| Tier | Border-left | Primary button | Diff preview |
| --- | --- | --- | --- |
| `safe` | none | `variant="primary"` (`dls-primary`) | none |
| `careful` | 2 px `dls-warning` | `variant="primary"` (`dls-primary`) | inline when writing files |
| `destructive` | 4 px `dls-danger` | `variant="danger"` (`dls-danger`) | always inline for writes; secondary "Show diff" for reads |

- `safe` — read-only tools (list_files, get_workspace, search).
- `careful` — writes local state (edit_file, create_file, run_command
  without network side effects).
- `destructive` — deletes files, force-pushes, deploys, network calls
  with external side effects.

### Anatomy

- **Header.** Tool name in `text-sm font-medium`, tier chip
  (`StatusBadge` variant) right-aligned.
- **Param summary.** First line only, `text-xs font-mono`, truncate
  at `tool-approval.param-summary-max-chars` (80). Overflow shows an
  ellipsis and a "Show all" toggle.
- **Expanded params.** When expanded, render params in a `<pre>`
  block, `text-xs font-mono`, capped at `tool-approval.param-summary-full-max-lines`
  (200). Adds a "Copy" button (`Button size="xs" variant="ghost"`).
- **Diff preview.** For `careful` and `destructive` tools that write
  files: inline diff auto-expanded when ≤ `tool-approval.diff-inline-line-threshold`
  (20 lines); auto-collapsed with a "Show diff (N lines)" summary
  above the threshold. Diff renders per § 4g Code & Diff.
- **Action row.** `Deny` (`variant="ghost"`) + primary approve
  button, right-aligned, `gap-2`. `Enter` submits primary; `Esc`
  submits deny. Focus lands on the primary button after mount for
  `safe`, on `Deny` for `destructive` (friction by focus placement).

### Motion

Cards do NOT animate the danger band. Friction is the point, not
motion. The card slides in with the parent transcript row, no
per-tier flourish.

## 4g. Code & Diff

Inline code and diff blocks appear inside message rows and tool cards.
No new tokens — reuses `dls-*` semantic colors at low alpha for
addition/removal bands. Mono font resolves to `typography.font-mono`
via the `font-mono` Tailwind utility; see § 3 Note on Font
Substitutes for the full system stack.

### Inline code

- Text: `text-xs font-mono` in `dls-text-primary`.
- Background: `dls-surface-muted` at 100 % opacity.
- Padding: `px-1 py-0.5`.
- Radius: `rounded-xs` (3).
- Do not add borders; the surface tint carries the boundary.

### Fenced code block

- Container: `bg-dls-surface-muted`, `rounded-md` (8), `p-3`,
  `overflow-x-auto`.
- Text: `text-xs font-mono` in `dls-text-primary`.
- Line-height: 1.5 (Latin default from § 3); CJK-mixed lines inherit
  the 1.6 bump from § 10 Internationalization Space Budget.
- Optional filename header: `text-xs text-dls-text-tertiary`,
  `border-b border-dls-border`, `pb-2 mb-2`.

### Diff

- Line prefixes `+` / `−` in the gutter, `text-xs font-mono`,
  `text-dls-text-tertiary`, `w-4` fixed-width.
- Addition background: `hsl(var(--dls-success-fg) / 0.08)`. Text
  color unchanged.
- Removal background: `hsl(var(--dls-danger) / 0.08)`. Text color
  unchanged.
- Line numbers optional. When present: `text-2xs
  text-dls-text-tertiary`, right-aligned, `pr-2`, `w-8` fixed-width,
  separated from content by a `border-r border-dls-border`.
- Collapsible chunks: any contiguous run of unchanged context lines
  larger than 6 collapses behind a `text-xs text-dls-text-tertiary`
  "Show N more lines" affordance.
- Do not use `dls-primary` or `dls-signal` in diff surfaces; those
  colors already carry meaning elsewhere (identity accent + streaming
  cursor).

## 4h. Session & Artifact Variants

Extends the v3 Signature Components (`SessionCard`, `ArtifactCard`)
with lifecycle and type variants. All variants reuse existing tokens
except `ArtifactCard`, which introduces the `artifact-hue.*`
sub-palette (see § 11 Intentional Exceptions expansion).

### SessionCard variants

| Variant | Surface | Text | Accent | Right slot |
| --- | --- | --- | --- | --- |
| `active` (default) | `dls-surface` | `dls-text-primary` | none | unread signal dot |
| `archived` | `dls-surface` at `opacity-60` | `dls-text-secondary` | none | none |
| `shared` | `dls-surface` | `dls-text-primary` | 2 px `dls-signal` left | `link` 12 px |
| `read-only` | `dls-surface-muted` | `dls-text-primary` | none | `lock` 12 px |

- `archived` disables hover state (no `dls-hover` background).
- `read-only` disables hover state and pointer cursor.
- `shared` retains hover; active state (selected) uses `dls-active`
  as v3 shipped.
- The variant is a `variant=` prop on the primitive; do not compose
  variants inline in JSX.

### ArtifactCard variants

Each artifact type carries a 2 px left border in its matching
`artifact-hue.<type>` token. The type badge is a `StatusBadge` in
the same hue at 20 % alpha background + full-chroma text.

| Type | `artifact-hue.<type>` | Example |
| --- | --- | --- |
| `image` | `--dls-artifact-hue-image` | screenshots, generated art |
| `code` | `--dls-artifact-hue-code` | code files, snippets |
| `document` | `--dls-artifact-hue-document` | markdown, PDFs |
| `data` | `--dls-artifact-hue-data` | CSV, JSON, tables |
| `plot` | `--dls-artifact-hue-plot` | charts, graphs |
| `3d` | `--dls-artifact-hue-3d` | GLTF, USDZ, meshes |
| `audio` | `--dls-artifact-hue-audio` | WAV, MP3 |
| `video` | `--dls-artifact-hue-video` | MP4, MOV, screen recordings |

Hues are pulled from the Radix palette at shade 9 (light) / shade 4
(dark) for consistent chroma across themes. The concrete CSS
variables are declared in `apps/app/src/app/index.css`; DESIGN.md
declares only the mapping.

**Isolation from semantic use.** `artifact-hue.*` MUST NOT be used
on toasts, buttons, status dots, tool cards, or any surface outside
`ArtifactCard`. See § 11 Intentional Exceptions.

## 4i. Shell Chrome

Workbench hygiene primitives — not brand-identity signatures
(§ 4 Signature Components / §§ 4c–4h). Agents reach for these instead
of inventing third paths. Machine targets live in YAML
`components.contracts` under `notice-box`, `empty-state-box`, `empty`,
`loading-spinner`, and `confirm-modal`. Preview catalog:
`docs/design/preview.html` section **Shell · DESIGN § 4i**.

### When to use which

| Need | Canonical | Do not |
| --- | --- | --- |
| List / table / card-grid empty | `EmptyStateBox` | Long hand-written `border-dashed` blocks |
| Full main-panel empty | `Empty` compound (§ 4a five slots) | Nesting `EmptyStateBox` as a fake page hero without slots |
| In-page persistent callout | `NoticeBox` | Toast for sticky form/page state; ad-hoc tinted borders |
| Ephemeral feedback | Toast (§ 4b) | `NoticeBox` that auto-dismisses |
| Short indeterminate busy | `LoadingSpinner` | Bare `Loader2 className="animate-spin"` in page JSX |
| Destructive / irreversible confirm | `ConfirmModal` | Ad-hoc `Dialog` footers for delete/reset |

### `EmptyStateBox`

Runtime: `components/ui/notice-box.tsx` (`EmptyStateBox`).

- **Shape.** `rounded-lg` (10), `border border-dashed border-dls-border`,
  centered text. Tones: `muted` → `bg-dls-surface-muted`, `surface` →
  `bg-dls-surface`.
- **Sizes.** `compact` | `default` | `comfortable` | `spacious` — see
  YAML `empty-state-box` padding slots. Prefer `compact` inside dense
  matrices; `spacious` only when the box owns a full content column.
- **CTA.** At most one primary CTA (optional secondary outline). Do not
  stack three equal-weight buttons.
- **Slots.** Children-only bag today — put icon + title + body + CTA
  inside. Do not reimplement the dashed chrome in page CSS.

### `Empty` compound

Runtime: `components/ui/empty.tsx`.

- **Shape.** `rounded-xl` (14), solid `border-border`, `p-12`, flex
  column center — full-panel hero, not a dashed inset.
- **Slots.** `EmptyHeader` / `EmptyMedia` / `EmptyTitle` /
  `EmptyDescription` / `EmptyContent`. Missing slots collapse; do not
  fill with filler. Aligns with § 4a anatomy (icon, heading, body,
  primary CTA, secondary action).
- **Title.** `font-heading text-base font-medium` by default on the
  primitive. Full-viewport marketing empties may step up one type
  tier; do not invent a third empty chrome.

### `NoticeBox`

Runtime: `components/ui/notice-box.tsx` (`NoticeBox`).

- **Shape.** `rounded-xl` (14), `border`, size-driven padding/text
  (YAML `notice-box`). Not hero padding — never reuse
  `spacing.hero-scale` here.
- **Tones.** `neutral` | `info` | `warning` | `error` with matching
  soft border/background tokens. Copy stays short; long remediation
  belongs in help docs or a dedicated error surface.
- **vs Toast.** Notice is sticky in the content flow until the
  condition clears. Toast is corner-stacked and time-bounded (§ 4b).
  Never use Notice for "Saved" flashes; never use Toast for
  "permission required before you can continue" gates.

### `LoadingSpinner`

Runtime: `components/ui/loading-spinner.tsx`.

- **Sizes.** `sm` = 14 px, `default` = 16 px. Border 2 px; spin via
  `animate-spin`. Respect `prefers-reduced-motion` (static ring).
- **Tones.** `muted` (default on light chrome), `inverse` (on solid
  primary / danger buttons).
- **Timing.** Only for § 4a **short indeterminate** band
  (`instant-ms`–`short-ms`). Longer work → `Skeleton` or `Progress`.

### `ConfirmModal`

Runtime: `design-system/modals/confirm-modal.tsx` (wraps `AlertDialog`).

- **Variants.** `danger` (destructive confirm button) | `warning`
  (non-destructive but irreversible / reset). Cancel is `outline`.
- **Media.** `AlertDialogMedia` default: `size-16` (64),
  `rounded-full`, soft status fill (`danger-soft` / `warning-soft`).
  Do not invent a second square-tile media style in pages or preview.
- **Footer.** Buttons `size="lg"`, right-aligned, `gap-2` — same rule
  as § 4 Dialog footers.
- **Copy.** Title is the decision; body is one or two sentences of
  consequence. Confirm label is a verb (`Delete`, `Reset`), not `OK`.

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

## 5a. Keyboard Contract

Keyboard shortcuts are first-class affordances in an agent workbench.
Render them consistently in command palettes, menus, tooltips, and
help surfaces so users learn one shape.

### `kbd` Chip Visual

- **Container** — inline element, `border-dls-border` hairline,
  `rounded-sm` (matches `kbd.chip-radius`), `bg-dls-surface-muted`,
  padding `px-1 py-0.5` (matches `kbd.chip-padding-*`).
- **Typography** — `text-xs` (12 px) in `dls-text-secondary`; use the
  monospace fallback stack from § 3 Note on Font Substitutes when a
  mono glyph is required for parity (`⌘`, `⌥`, `⇧`, `⌃`).
- **Spacing** — chips in a row use `gap-1`; do not lean on adjacency.

### Platform Mapping

Author declaratively with the mac glyphs (`⌘`, `⌥`, `⇧`, `⌃`,
`⌫`, `↩`, `⎋`). At render time, a small helper substitutes the
platform-native form:

- **macOS** — glyphs render as authored (`⌘K`).
- **Windows / Linux** — substitute to spelled form (`Ctrl+K`,
  `Alt+K`, `Shift+K`). The helper's intended signature is
  `formatShortcut(key: string, platform?: Platform): string`; the
  runtime helper implementation lives outside v4 scope but the
  contract locks the authoring shape today.

Never fork the author-side string per platform. `⌘K` in source →
platform substitution in render is the only sanctioned flow.

### Where Allowed

- **Command palette** — required for every command that carries a
  shortcut. Chips align right of the label.
- **Menus** — allowed. `DropdownMenu.Item` and `ContextMenu.Item`
  render the chip inside the trailing slot.
- **Tooltips** — allowed. Chip renders in the tooltip body under the
  human label.
- **Inline body copy** — discouraged. Prose that describes a
  shortcut ("press ⌘K") should still wrap the glyph in a chip.

### Chord Notation

- Separator — ` + ` (space + `+` + space; `kbd.separator`). The
  space uses a hair space (`kbd.separator-uses-hair-space`) so long
  chords do not break awkwardly on wrap.
- Order — modifier keys first (`⌘`, `⌥`, `⇧`, `⌃`), then the
  activation key. `⌘ + ⇧ + P`, not `P + ⌘ + ⇧`.
- Sequences (press-then-press, e.g. Emacs-style `⌃X ⌃S`) render as
  two adjacent chip groups with a single space between; do not join
  with `+`.

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
- Follow the **canonical primitive table** in
  `docs/design/theme-system.md` and **§ 4i Shell Chrome**
  (EmptyStateBox / Empty dual-track, NoticeBox, LoadingSpinner,
  ConfirmModal, plus SegmentedTabGroup, FilterChip, Input/InputGroup,
  ToolApprovalCard, StreamingCursor, formatShortcut).
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
- Do not hand-write segmented tab tracks (`inline-flex rounded-xl … p-1`
  around tab buttons). Use `SegmentedTabGroup`.
- Do not style free-float category filters as elevated white pills
  (`bg-dls-surface-solid` + shadow). Use `FilterChip` with
  `bg-dls-list-selected` when selected.
- Do not add new bare `Loader2 animate-spin` in page JSX; use
  `LoadingSpinner`.
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

### Internationalization Space Budget

The i18n system is enforced (see YAML `flags: i18n`), but rendered
width is not. Chinese glyphs occupy ~70 % of the width of the
corresponding English string at the same visual rhythm; without a
budget, buttons look under-filled or menus mis-align when the locale
switches.

- **Design at English width.** Sketch buttons, menu labels, tabs, and
  toast titles against the English string. Chinese naturally shrinks
  into that budget; the reverse (design at Chinese width) causes
  English overflow at runtime.
- **Truncation rules.** Menu labels, session titles, and tag chips
  truncate with an ellipsis at the container edge. Body copy and
  dialog descriptions never truncate — they wrap. Button labels
  neither truncate nor wrap; if a button label overflows in any
  locale, tighten the copy, do not add ellipsis.
- **CJK line-height.** Lines containing any CJK glyph use
  `leading-relaxed` (line-height ≈ 1.6) — the base body leading is
  1.45 (see § 3), which is too tight for CJK stroke density. Apply
  via the `[lang="zh"] &`, `[lang="ja"] &`, `[lang="ko"] &` selectors
  where present, or attach the `cjk` class to the surrounding block.
- **Chip and badge width.** `StatusBadge` and tag chips render
  variable-width; do not pin them to fixed widths that assume Latin
  content.
- **RTL.** Not on the roadmap; Hebrew / Arabic locales are not
  currently supported. When they land, mirror layout via CSS
  `direction: rtl` and the design tokens do not need re-authoring.

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
- **`artifact-hue.*` sub-palette** — `ArtifactCard` type accents only
  (see § 4h). The 8 hues (image / code / document / data / plot / 3d
  / audio / video) map to Radix palette shades exposed as
  `--dls-artifact-hue-<type>` CSS custom properties. These MUST NOT
  leak into semantic surfaces (toasts, buttons, status dots, tool
  cards) — the `diffArtifactHue` extractor gates this.
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
- **WorkBuddy root-transcript parity geometry** — the root session
  `ChatMessage row` may use the measured 13px/19px assistant body and the
  asymmetric `16px 16px 0 16px` user-bubble radius declared in
  `components.contracts.chat-message-row`. Its final loose Markdown may use
  the measured 14px/25px body rhythm. The root transcript's inline visual may
  use WorkBuddy's measured 16px radius and renderer geometry declared in
  `components.contracts.transcript-inline-visual`. These values are scoped to
  root transcripts and are not additions to the global typography or radius
  scales. Its live state is rendered as a separate activity row below content,
  so root Markdown suppresses the shared inline streaming cursor while nested
  transcript surfaces keep it. Implement these exceptions through named transcript styles or CSS variables,
  never page-level `text-[13px]` / arbitrary-radius Tailwind classes.
  Generated-content surfaces in this scope also use WorkBuddy's neutral light
  hierarchy: `#F7F7F7` table/header/quote surfaces, `#FFFFFF` table cells,
  `#EBEBEB` borders, and `#F2F2F2` artifact cards. These values must remain
  transcript-scoped CSS variables; they must not replace the global
  `surface-muted` token or leak into settings and navigation surfaces.
- **WorkBuddy root-transcript scroll-to-latest affordance** — the root
  session may render one 32 px circular surface button, 24 px above the
  transcript bottom, with the measured 16 px chevron and WorkBuddy's subtle
  4% dual shadow. It appears only after the user leaves follow-latest mode and
  restores follow-latest immediately on activation. This named transcript-only
  control is the sole workbench exception to both the circular-CTA and
  no-component-shadow rules; it must not become a generic `Button` variant.
- **Pre-app boot / gate screens** — `architecture-mismatch-gate.tsx`.
  Full-screen dark hero shown before the app can launch. Its CTAs
  intentionally use `rounded-full` and a self-contained palette because
  the gate cannot render inside the workbench chrome; it uses its own
  landing-page dialect. Do not copy `rounded-full` CTAs into any surface
  that mounts after the gate.
- **`SendButton`** — the composer send affordance
  (`apps/app/src/components/ui/send-button.tsx`). Signature circular
  primitive at `size="icon-lg"` (40 px), `rounded-full`, brand-blue
  filled. It is a designed identity moment for message send — the
  only `rounded-full` allowed inside the workbench chrome. Do not
  extract this shape into a generic `Button` variant, and do not
  re-derive circular CTAs elsewhere.
- **Expert marketplace grid** — `StorePage` / expert marketplace cards
  may use avatar-forward card grids, soft category chips, and denser
  marketing-adjacent card rhythm. This is a deliberate **marketplace
  dialect** separate from the dense workbench. It still uses `dls-*`
  surfaces and borders; do not copy marketplace card density into
  session / manage / settings surfaces.
- **Composer host policy** — `SessionSurface` (global assistant
  composer) mounts only on chat host views (`activeSidebarView` is
  `chat` or `assistant`) in `assistant.tsx` / `expert.tsx`. Local ACP
  chat uses `PersonalLocalAgentPage` + `LocalAgentDraftComposer` and
  must never stack the global composer. Manage / files / market /
  devices / channels / billing never host a composer. Violating this
  reintroduces the dual-composer / chrome-leak regression.

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

1. Optional local plan under `.loop/plans/` (gitignored). Do **not** commit
   plan ledgers under `docs/plans/`, `docs/archive/`, `docs/features/`, or `docs/superpowers/` (all gitignored).
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

v4 shipped: state machines (§ 4a), notifications (§ 4b), keyboard
contract (§ 5a), CJK space budget (§ 10 Internationalization Space
Budget), CI gate for `pnpm task check design` (governed by the
`design-check` workflow), auto-fix codemod at `scripts/design/codemod/`,
and drift baseline at `scripts/checks/baselines/design-drift.json`.

v5 shipped: message roles (§ 4c), streaming presentation (§ 4d),
presence & activity 6-state (§ 4e), tool approval 3-tier (§ 4f),
code & diff inline styles (§ 4g), SessionCard + ArtifactCard
variants (§ 4h), and the `artifact-hue.*` sub-palette (§ 11
Intentional Exceptions).

v6 shipped: z-layer CSS variables (§ 6), semantic Tailwind aliases
for `dls-primary` / `dls-danger` / `dls-warning` / `dls-mist` /
`dls-slate` / `dls-app-bg` / `dls-rail-bg` / `dls-text-tertiary` /
`dls-artifact-hue-*` so the § 2 contract renders as authored,
monospace stack contract (§ 3 `typography.font-mono` + `font-mono`
Tailwind utility → `--dls-font-mono` CSS variable), and the
`snap-icon-sizes` codemod that pins Lucide `size={N}` to the
§ 7 iconography scale.

v5 still does **not** cover the following. Agents needing these
should surface a proposal rather than invent silently.

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
- **Domain composites v2 catalog.** Expansion beyond the listed
  composites (incl. `modals/confirm-modal`) is a
  `frontend-primitive-refactor` skill task, not a DESIGN.md task.
  Shell chrome contracts themselves ship in § 4i.
- **Animation choreography.** Sequenced multi-element transitions,
  interruptible timelines, and stagger patterns beyond
  duration/easing tokens are agent-local decisions.
- **Windows / Linux titlebar drag-region behavior.** Declared as
  variants in § 10 for future-proofing; not currently enforced by a
  hard flag because system-frame titlebars on non-macOS do not steal
  clicks the way `hiddenInset` does.
- **Runtime helper implementations.** First landings exist:
  `StreamingCursor` (`components/ui/streaming-cursor.tsx`, used from
  markdown streaming), `ToolApprovalCard`
  (`components/ui/tool-approval-card.tsx`, permission panel + local
  agent approvals), `formatShortcut()` (`lib/format-shortcut.ts`),
  and shared `MessageRoleRow` chrome (`components/ui/message-role.tsx`).
  Broader session-permission modal restyle and full seven-role coverage
  across every transcript path remain follow-up.

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
