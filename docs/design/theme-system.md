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
- **Three-tier surface hierarchy.** Rail → background → surface. Rail is
  cold and quiet, background is neutral, surface is where content lives.

## Palette, Semantic Tokens, Type Scale, Radius, Buttons, Rows

See [`DESIGN.md`](../../DESIGN.md) — sections 2 (Color Palette),
3 (Typography), 4 (Component Stylings, includes button scale + row
primitives), and the YAML front matter for machine-readable values.

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

- **Reorder, drag, layout transition** — `motion/react`. Use shared
  motion helpers or local variants; always respect reduced motion.
- **Simple enter/exit reveal** — `tw-animate-css` Tailwind classes
  (`animate-in`, `fade-in`, `slide-in-*`, `duration-*`). Avoid undefined
  arbitrary keyframe names.
- **Loading spinner / small running indicator** — Tailwind or a named CSS
  keyframe. Keep local, semantic, and short; avoid page-specific global
  utilities.
- **Hover / focus feedback** — CSS transitions.

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
[`.codex/skills/frontend-primitive-refactor/SKILL.md`](../../.codex/skills/frontend-primitive-refactor/SKILL.md)):

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
