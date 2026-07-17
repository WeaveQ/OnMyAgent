# Theme System

> **Tokens moved to `DESIGN.md`.** This file is the design-philosophy
> narrative — the "why" behind the tokens. Concrete color / typography /
> radius / button / row-primitive tables now live in
> [`DESIGN.md`](../../DESIGN.md) at the repo root, which is the
> authoritative visual contract for both AI agents and humans.

OnMyAgent uses a flat product theme with clear hierarchy, blunt geometric
shapes, and strong decision entry points. Light, dark, and system modes
are driven by semantic CSS tokens.

## Design Direction

- **Flat first.** No component shadows. Use borders, surface contrast,
  spacing, text weight, and active states for hierarchy.
- **Decision first.** Create, run, approve, connect, submit, and
  destructive actions must be visually stronger than passive navigation.
- **Blunt geometry.** Prefer rounded rectangles and simple filled icon
  containers. Reserve pills for compact status chips and filters.
- **Signal cyan is a status.** Electric cyan is reserved for activity,
  online, running, and subtle signal marks — never primary actions.
- **Shell lane hierarchy (WeChat three-column).** Rail → background →
  sidebar → surface. Rail is cold and deepest, background is the main
  canvas, sidebar is the list lane lifted above the canvas, surface is
  cards/composer. Keep ≥1 perceptual step between adjacent shell lanes.

## Component Contracts

Signature and primitive component shapes (`SettingsCard`, `RailButton`,
`SendButton`, `SegmentedTabGroup`, `Dialog`, `Input`, `ToggleChip`, …)
are now bound to token references inside `DESIGN.md`'s YAML front
matter under `components.contracts`. That block is the machine-readable
target — radius, height, surface, padding — for the 20 most-drifted
primitives. When adding or refactoring a signature component, edit
that block in the same PR.

Cross-cutting rules that surface most often in review:

- **Tab bars.** Use `<SegmentedTabGroup>` + `<NavTabButton size="tab" shape="tab">`. Do not hand-write `inline-flex rounded-lg border p-1` and stuff pill-shaped `NavTabButton` inside — that shape clash was the "样式不协调" root cause on the manage view. `SegmentedTabGroup` must keep a visible track (`border-dls-border` + muted fill) so active tabs do not read as free-floating pills.
- **`rounded-full` is a whitelist.** Only avatars, `NavTabButton shape="pill"` (compact filter chips), `SendButton`, and the pre-app `architecture-mismatch-gate.tsx` may use it. See `DESIGN.md` § 11.
- **Radius scale is flat.** `xs=3 sm=6 md=8 lg=10 xl=14 pill=999`. `2xl/3xl/4xl` are legacy aliases mapped to `xl=14` in Tailwind config so migration is safe, but new code must pick a named tier — not a legacy alias.
- **Composer host policy.** Global `SessionSurface` composer only on chat host views; never under manage / files / market / local-agent (local has its own ACP composer). See `DESIGN.md` § 11.
- **Marketplace dialect.** Expert/skill store card grids may stay avatar-forward; do not import that density into workbench panels.

## Canonical primitive table

When more than one component could fit, use this table. New code must not invent a third path.

| Need | Canonical | Do not |
|------|-----------|--------|
| Regional / list empty | `EmptyStateBox` (+ optional icon + one primary CTA) | Page-level long `border-dashed` blocks; third empty chrome |
| Full-panel empty | `Empty` compound (`Empty` + Header/Media/Title/Description/Content) | Using only `EmptyStateBox` when the main panel is empty; inventing a third hero |
| In-page persistent callout | `NoticeBox` (tones: neutral/info/warning/error) | Toast for sticky gates; ad-hoc tinted borders |
| Ephemeral feedback | Toast (§ 4b) | `NoticeBox` that auto-dismisses |
| In-page segmented control | `SegmentedTabGroup` + `NavTabButton shape="tab"` (or `SegmentedTabButton` inside the group) | Hand-written `inline-flex rounded-xl … p-1` tracks |
| Multi-panel content tabs | `components/ui/tabs` | Mixing pill Segmented styling with content Tabs |
| Local busy / refresh | `LoadingSpinner` (or Button with spinner child) | New bare `Loader2 className="animate-spin"` in page JSX |
| Destructive / confirm | `ConfirmModal` (wraps `AlertDialog`; footer `size="lg"`) | Ad-hoc Dialog footers for delete/reset |
| Single-line input | `Input` / `InputGroup` | New uses of `design-system/text-input` (**deprecated**) |
| Select list | Prefer `components/ui/select`; `SelectMenu` only for dense settings rows already on that path | New ad-hoc popover option lists outside composer |
| Tool approval | `ToolApprovalCard` risk tiers (safe / careful / destructive) | Untiered permission panels |
| Streaming caret | `StreamingCursor` | One-off blink spans in transcript pages |
| Keyboard chord display | `formatShortcut()` + kbd chip contract (§ 5a) | Hardcoded `⌘` / `Ctrl` strings in JSX |

Shell chrome detail (sizes, tones, Confirm media): **`DESIGN.md` § 4i**.

## Palette, Semantic Tokens, Type Scale, Radius, Buttons, Rows

See [`DESIGN.md`](../../DESIGN.md) — sections 2 (Color Palette),
3 (Typography), 4 (Component Stylings, includes button scale + row
primitives + signature components), 4a (State Machines: loading /
empty / error / success anatomy + perceptual timing bands), 4b
(Notifications: toast anatomy, position, duration by severity),
4c–4h (agent-native signatures), **4i (Shell chrome: Empty /
EmptyStateBox / NoticeBox / LoadingSpinner / ConfirmModal)**,
5 (Layout), 5a (Keyboard Contract: kbd chip + platform substitution),
6 (Depth incl. Z-Layer Stack), 7 (Shapes: border-radius + iconography
+ photography geometry), 10 (Responsive & Platform incl.
Internationalization Space Budget), and the YAML front matter for
machine-readable values.

## Agent-Native Identity

`DESIGN.md` §§ 4c–4h capture what makes OnMyAgent read as an
agent workbench rather than a generic chat surface. Read them
before designing any transcript, activity, or artifact affordance:

- § 4c **Message roles** — seven roles (user, assistant, tool-call,
  tool-output, thinking, system, error) each with a fixed
  surface + border-left + prefix icon + prefix color. Roles are
  the seven that ship; never invent an eighth.
- § 4d **Streaming presentation** — 6 × 12 block cursor blinks at
  320 ms; after 1 s idle, swap to the pause glyph. Runtime primitive
  `StreamingCursor` lands in a follow-up PR; today's markup must
  still track the same tokens.
- § 4e **Presence & activity** — seven agent presence states with
  their own color + motion + icon. Contrast with human presence
  (online only) is intentional.
- § 4f **Tool approval** — three risk tiers (safe / careful /
  destructive) with 0 / 2 / 4 px left border and matching primary
  button variant. Destructive defaults keyboard focus to Deny.
- § 4g **Code & diff** — inline vs full-screen thresholds and the
  contract between diff surfaces and message-role backgrounds.
- § 4h **Session & Artifact variants** — SessionCard lifecycles
  and the isolated `artifact-hue.*` palette (see § 11 Intentional
  Exceptions). Hues MUST NOT be used outside `ArtifactCard`.

## Extension Workflow

When you need to extend the visual contract — a new token, a new
signature component, a Windows/Linux titlebar rule — do not edit code
first. Read `DESIGN.md` § 13 Iteration Guide for the ownership boundary
between this narrative and DESIGN.md's tokens/rules, then draft a plan
locally under `.loop/plans/` (gitignored) before touching tokens.

## Known Gaps

`DESIGN.md` § 14 Known Gaps is the honest list of what the contract
does *not* cover today — data-viz, copy voice, brand assets, marketing
surface, mono typography, domain composites v2, animation
choreography, Windows/Linux titlebar drag-region. State machines,
notifications, keyboard contract, CJK space budget, CI gate, and the
auto-fix codemod are v4 additions (see § 4a / § 4b / § 5a / § 10 and
`scripts/design/codemod/`).
Message roles, streaming cursor, presence, tool approval, code
+ diff, and session/artifact variants are v5 additions (see § 4c /
§ 4d / § 4e / § 4f / § 4g / § 4h and the `message-roles:` /
`streaming:` / `presence:` / `tool-approval:` / `artifact-hue:`
YAML blocks). Runtime primitives `StreamingCursor` and
`ToolApprovalCard` are tracked in Known Gaps until they ship.
Closing a gap is documented in § 13 Iteration Guide.

## Scrollbars

Global scrollbars feel like a weak WeChat-style affordance: hidden by
default, briefly visible while the pointer moves or the region scrolls,
and never visually competing with content.

Rules:

- Do not add component-level scrollbar colors unless a native browser
  limitation requires it.
- Keep tracks transparent and thumbs rounded with weak opacity.
- Scrollbars may appear on pointer movement over a scrollable region or
  during active scrolling; they should fade back to transparent
  afterward.

Concrete `--dls-scrollbar-thumb` / `--dls-scrollbar-thumb-active` values
are in [`DESIGN.md`](../../DESIGN.md) YAML.

## Motion

Use motion sparingly to clarify state changes, not to add decoration. The
app already depends on `motion`; do not add another animation library for
ordinary UI transitions.

**Concrete tokens live in [`DESIGN.md`](../../DESIGN.md) YAML `motion:`
block and § 6 Depth → Motion.** Durations: `instant` / `fast` (120ms) /
`normal` (200ms) / `slow` (320ms). Easings: `standard` / `decisive` /
`signal`. The narrative below explains **which library to use for which
kind of motion**; DESIGN.md defines **what values to use**.

- **Reorder, drag, layout transition** — `motion/react`. Use shared
  motion helpers or local variants; always respect reduced motion.
- **Simple enter/exit reveal** — `tw-animate-css` Tailwind classes
  (`animate-in`, `fade-in`, `slide-in-*`, `duration-*`). Avoid undefined
  arbitrary keyframe names.
- **Loading spinner / small running indicator** — Tailwind or a named CSS
  keyframe. Keep local, semantic, and short; avoid page-specific global
  utilities.
- **Hover / focus feedback** — CSS transitions.

## Focus & Accessibility

Focus ring token, WCAG AA contrast targets, keyboard-navigation
contracts, screen-reader label mandates, and reduced-motion behavior
live in [`DESIGN.md`](../../DESIGN.md) § 8. This file does not duplicate
those rules; treat DESIGN.md as authoritative.

## Intentional Exceptions

The following categories are allowed to use raw palette classes or
explicit hex because the color encodes **product meaning** rather than
page-level styling. Theme scans should classify these before editing.

- **Extension type colors** — `extension-card.tsx`. Plugin, skill, and
  UI-control categories need stable visual distinction.
- **Agent skill category palette** — `agent-management-skill-model.ts`.
  Category palettes are source data for the skill matrix, not page
  decoration.
- **Artifact file-type icon colors** — `artifact-icon.tsx`. File
  extensions use familiar type colors for quick recognition.
- **Provider brand colors** — `mcp-view.tsx` and provider icons. Linear,
  Sentry, Stripe, Telegram, Slack, and similar vendors keep brand
  identity.
- **Generated logo geometry** — plugin / provider icon renderers. CSS
  triangles, exact letter tracking, and brand mark geometry can use
  precise arbitrary values.
- **Runtime layout math** — virtual lists, drag handles, popover / menu
  positions, grid templates, sidebar CSS variables. These values come
  from measured runtime geometry or structural component contracts.
- **Performance containment** — large message lists and composer
  surfaces (`contain`, `content-visibility`, virtualizer transforms).

If a scan hit does not match one of these categories, prefer moving it
to a `dls-*` token, a shared component variant, or a named local class
map before leaving it in page JSX.

## Rules of Thumb

1. Prefer `dls` semantic classes before raw Tailwind colors.
2. Do not add new `text-[Npx]` classes; extend tokens only when the
   value is even and product-wide.
3. Avoid new `rounded-[Npx]`; use the radius scale unless geometry is
   intentionally custom.
4. Do not add `shadow-*`, `drop-shadow`, or custom `box-shadow` for
   hierarchy.
5. Keep primary decisions solid blue with white text; secondary
   decisions use flat tinted surfaces.
6. Define shared UI sizing in component variants before adding
   page-level overrides.

## Token Debt Guardrails

Current source-level targets for page styling (run these `rg` checks as
part of a `frontend-primitive-refactor` audit; see
[`.agents/skills/frontend-primitive-refactor/SKILL.md`](../../.agents/skills/frontend-primitive-refactor/SKILL.md)):

For token-level drift between `DESIGN.md` YAML and the code-side sources
(colors / typography / radii), run `pnpm task check design`. Add `-- --strict`
to make drift fail the check (future CI seam).

| Check | Target | Command |
| --- | --- | --- |
| Numeric font classes | `0` | `rg 'text-\[[0-9.]+px\]' apps/app/src` |
| Arbitrary color classes | `0` | `rg '(bg\|text\|border\|ring\|from\|to\|via\|fill\|stroke)-\[[^\]]+\]' apps/app/src` |
| Arbitrary radius classes | `0` | `rg 'rounded-\[[^\]]+\]' apps/app/src` |
| Button height overrides | trending to `0` | `rg '<Button[^\n]*className=.*h-' apps/app/src` |
| Raw square icon buttons | trending to `0` | `rg '<button[^\n]*(h-[0-9]\|w-[0-9]\|size-)' apps/app/src` |
| Raw Tailwind palette hits | classify before editing | `rg '\b(bg\|text\|border\|ring\|from\|to\|via\|caret)-(slate\|gray\|zinc\|neutral\|stone\|blue\|sky\|cyan\|emerald\|green\|amber\|yellow\|orange\|red\|rose\|purple\|violet\|indigo)-' apps/app/src --glob '*.tsx' --glob '*.ts'` |
| Arbitrary layout utilities | classify before editing | `rg '[a-z-]+-\[[^\]]+\]' apps/app/src/react-app apps/app/src/components -g '*.tsx' -g '*.ts'` |
| Inline style objects | dynamic only | `rg 'style=\{\{' apps/app/src/react-app apps/app/src/components -g '*.tsx'` |

Raw hex is allowed only in token / palette files or business registry
data, not page-level styling.

## Preview

`preview.html` and `preview-dark.html` in this folder render the palette,
typography, radii, button scale, and top components in light and dark
themes. They are a fixed HTML snapshot for reviewers; if the preview
drifts from `DESIGN.md`, `DESIGN.md` wins.
