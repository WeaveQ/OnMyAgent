# Theme System

OnMyAgent uses a flat product theme with clear hierarchy, blunt geometric shapes, and strong decision entry points. Light, dark, and system modes are driven by semantic CSS tokens.

## Design Direction

- Flat first: no component shadows; use borders, surface contrast, spacing, text weight, and active states for hierarchy.
- Decision first: create, run, approve, connect, submit, and destructive actions must be visually stronger than passive navigation.
- Blunt geometry: prefer rounded rectangles and simple filled icon containers; reserve pills for compact status chips and filters.
- Signal color: electric cyan is reserved for activity, online, running, and subtle signal marks, not primary actions.

## Palette

| Role | Light | Dark | Usage |
| --- | --- | --- | --- |
| Primary blue | `#005DFF` | `#2F7BFF` | Primary decisions and focused calls to action |
| Primary hover | `#004ED6` | `#5A95FF` | Primary decision hover states |
| Signal cyan | `#03FFDE` | `#03FFDE` | Running, online, activity, signal marks |
| Ink | `#0F172A` | `#F8FAFC` | Main readable text |
| Slate | `#64748B` | `#94A3B8` | Secondary text and passive icons |
| Mist | `#E5E7EB` | `#3A3A3A` | Borders and separators |
| Rail base | `#F3F6FB` | `#171717` | App rail and menu foundation |

## Semantic Tokens

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--ow-primary` | `#005DFF` | `#2F7BFF` | Product primary action color |
| `--ow-primary-hover` | `#004ED6` | `#5A95FF` | Product primary hover color |
| `--dls-app-bg` | `#F2F2F2` | `#262626` | App foundation |
| `--dls-background` | `#FAFAFA` | `#262626` | Page foundation |
| `--dls-surface` | `#FFFFFF` | `#1E1E1E` | Cards, popovers, panels |
| `--dls-surface-muted` | `#F8FAFC` | `#2A2A2A` | Secondary surfaces |
| `--dls-text-primary` | `#0F172A` | `#F8FAFC` | Main readable text |
| `--dls-text-secondary` | `#64748B` | `#94A3B8` | Secondary text and passive icons |
| `--dls-rail-bg` | `#F3F6FB` | `#171717` | Sidebar and rail surface |

## Type Scale

Font sizes use even-number tokens only. Do not add `11px`, `13px`, `15px`, or page-level `text-[Npx]` classes.

| Token | Tailwind | Size | Usage |
| --- | --- | --- | --- |
| `--dls-text-2xs` | `text-2xs` | `10px` | Badges, counters, dense meta |
| `--dls-text-xs` | `text-xs` | `12px` | Secondary labels and helper text |
| `--dls-text-sm` | `text-sm` | `14px` | Standard dense UI text |
| `--dls-text-base` | `text-base` | `16px` | Body and emphasized UI text |
| `--dls-text-lg` | `text-lg` | `18px` | Section titles |
| `--dls-text-xl` | `text-xl` | `20px` | Page titles |
| `--dls-text-2xl` | `text-2xl` | `24px` | Hero and page emphasis |
| `--dls-text-3xl` | `text-3xl` | `28px` | Display headings |
| `--dls-text-4xl` | `text-4xl` | `32px` | Empty-state compact hero headings |
| `--dls-text-5xl` | `text-5xl` | `48px` | Rare marketing or empty-state hero headings |

## Radius Scale

| Token | Tailwind | Value | Usage |
| --- | --- | --- | --- |
| `--dls-radius-xs` | `rounded-xs` | `3px` | Tiny indicators and checkboxes |
| `--dls-radius-sm` | `rounded-sm` | `6px` | Inputs, small buttons, menu controls |
| `--dls-radius-md` | `rounded-md` | `8px` | Icon containers and navigation items |
| `--dls-radius-lg` | `rounded-lg` | `10px` | Default buttons, cards, compact panels |
| `--dls-radius-xl` | `rounded-xl` | `14px` | Large CTAs, dialogs, large panels |
| `--dls-radius-pill` | `rounded-full` | `999px` | Status chips and filter pills only |

## Scrollbars

Global scrollbars should feel like a weak WeChat-style affordance: hidden by default, briefly visible while the pointer moves or the region scrolls, and never visually compete with content.

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--dls-scrollbar-thumb` | `rgb(15 23 42 / 0.10)` | `rgb(248 250 252 / 0.12)` | Passive transient thumb |
| `--dls-scrollbar-thumb-active` | `rgb(15 23 42 / 0.16)` | `rgb(248 250 252 / 0.18)` | Hovered thumb |

Rules:

- Do not add component-level scrollbar colors unless a native browser limitation requires it.
- Keep tracks transparent and thumbs rounded with weak opacity.
- Scrollbars may appear on pointer movement over a scrollable region or active scrolling; they should fade back to transparent afterward.

## Motion

Use motion sparingly to clarify state changes, not to add decoration. The app already depends on `motion`; do not add another animation library for ordinary UI transitions.

| Need | Preferred Tool | Rule |
| --- | --- | --- |
| Reorder, drag, layout transition | `motion/react` | Use shared motion helpers or local variants; always respect reduced motion. |
| Simple enter/exit reveal | `tw-animate-css` Tailwind classes | Use `animate-in`, `fade-in`, `slide-in-*`, and `duration-*`; avoid undefined arbitrary keyframe names. |
| Loading spinner, small running indicator | Tailwind or a named CSS keyframe | Keep local, semantic, and short; avoid page-specific global utilities. |
| Hover/focus feedback | CSS transition tokens/classes | No shadow-based hierarchy; prefer color, border, and opacity changes. |
| Marketing/brand illustration | Component-local CSS or `motion/react` | Keep outside global CSS unless reused across product surfaces. |

Rules:

- Global animation utilities are allowed only when used by multiple product surfaces.
- Component-specific animation names stay next to the component that owns them.
- New motion must define a reduced-motion behavior before shipping.
- Do not introduce `framer-motion`; use the existing `motion` package through `motion/react` and the existing `tw-animate-css` utility classes.

## Button Scale

Action buttons must use `apps/app/src/components/ui/button.tsx` variants as the source of truth. Page-level height and padding overrides are not allowed unless a component is a tab, menu row, or list row rather than an action button.

| Variant | Height | Text | Padding | Radius | Usage |
| --- | --- | --- | --- | --- | --- |
| `xs` | `24px` | `text-xs` | `px-2.5` | `rounded-lg` | Tiny inline table or row actions |
| `sm` | `32px` | `text-sm` | `px-3` | `rounded-lg` | Compact forms and dense toolbars |
| `default` | `36px` | `text-sm` | `px-3` | `rounded-lg` | Standard actions |
| `lg` | `40px` | `text-sm` | `px-6` | `rounded-xl` | Primary CTAs and dialog footer decisions |
| `icon-xs` | `24px` | icon | square | `rounded-lg` | Tiny icon actions |
| `icon-sm` | `32px` | icon | square | `rounded-lg` | Compact icon actions |
| `icon` | `36px` | icon | square | `rounded-lg` | Standard icon actions |
| `icon-lg` | `40px` | icon | square | `rounded-lg` | Large icon actions |

Width policy:

- Text buttons are auto width by default.
- Use `w-full` only for block form submits, mobile layouts, or full-row decision areas.
- Icon buttons must be square via `size="icon-*"`; avoid raw `h-* w-*` pairs.
- Tabs, menu rows, and list rows can stay raw or use dedicated row primitives; do not force them into action button sizing.
- `rounded-full` is not valid for ordinary actions or CTAs; reserve it for chips, filters, and status indicators.

## Row Button Primitives

Use `apps/app/src/components/ui/action-row.tsx` for controls that are clickable rows rather than ordinary actions.

| Primitive | Shape | Usage |
| --- | --- | --- |
| `MenuRowButton` | `w-full`, `rounded-xl`, `px-3 py-2.5`, text-left | Slash menus, tool menus, command palettes, mention pickers |
| `NavTabButton` | `rounded-full`, compact horizontal label | Tab switches and segmented filters |
| `ActionRowButton` | `w-full`, bordered row/card, text-left | Starter cards, selectable rows, large row actions |

Do not replace these rows with the standard `Button`; row primitives preserve layout semantics while sharing focus, hover, and disabled behavior.

## Rules

1. Prefer `dls` semantic classes before raw Tailwind colors.
2. Do not add new `text-[Npx]` classes; extend tokens only when the value is even and product-wide.
3. Avoid new `rounded-[Npx]`; use the radius scale unless geometry is intentionally custom.
4. Do not add `shadow-*`, `drop-shadow`, or custom `box-shadow` for hierarchy.
5. Keep primary decisions solid blue with white text; secondary decisions use flat tinted surfaces.
6. Define shared UI sizing in component variants before adding page-level overrides.

## Intentional Exceptions

Theme scans should classify these hits before editing. They are allowed when the color or arbitrary value encodes product meaning rather than page-level styling:

| Exception | Allowed Location | Why It Stays Custom |
| --- | --- | --- |
| Extension type colors | `extension-card.tsx` | Plugin, skill, and UI-control categories need stable visual distinction. |
| Agent skill category palette | `agent-management-skill-model.ts` | Category palettes are source data for the skill matrix, not page decoration. |
| Artifact file-type icon colors | `artifact-icon.tsx` | File extensions use familiar type colors for quick recognition. |
| Provider brand colors | `mcp-view.tsx` and provider icons | Linear, Sentry, Stripe, Telegram, Slack, and similar vendors keep brand identity. |
| Generated logo geometry | plugin/provider icon renderers | CSS triangles, exact letter tracking, and brand mark geometry can use precise arbitrary values. |
| Runtime layout math | virtual lists, drag handles, popover/menu positions, grid templates, sidebar CSS variables | These values come from measured runtime geometry or structural component contracts. |
| Performance containment | large message lists and composer surfaces | `contain`, `content-visibility`, and virtualizer transforms protect runtime performance. |

If a scan hit does not match one of these categories, prefer moving it to a `dls-*` token, a shared component variant, or a named local class map before leaving it in page JSX.

## Token Debt Guardrails

Current source-level targets for page styling:

| Check | Target | Command |
| --- | --- | --- |
| Numeric font classes | `0` | `rg 'text-\\[[0-9.]+px\\]' apps/app/src` |
| Arbitrary color classes | `0` | `rg '(bg|text|border|ring|from|to|via|fill|stroke)-\\[[^\\]]+\\]' apps/app/src` |
| Arbitrary radius classes | `0` | `rg 'rounded-\\[[^\\]]+\\]' apps/app/src` |
| Button height overrides | trending to `0` | `rg '<Button[^\n]*className=.*h-' apps/app/src` |
| Raw square icon buttons | trending to `0` | `rg '<button[^\n]*(h-[0-9]|w-[0-9]|size-)' apps/app/src` |
| Raw Tailwind palette hits | classify before editing | `rg '\b(bg\|text\|border\|ring\|from\|to\|via\|caret)-(slate\|gray\|zinc\|neutral\|stone\|blue\|sky\|cyan\|emerald\|green\|amber\|yellow\|orange\|red\|rose\|purple\|violet\|indigo)-' apps/app/src --glob '*.tsx' --glob '*.ts'` |
| Arbitrary layout utilities | classify before editing | `rg '[a-z-]+-\[[^\]]+\]' apps/app/src/react-app apps/app/src/components -g '*.tsx' -g '*.ts'` |
| Inline style objects | dynamic only | `rg 'style=\{\{' apps/app/src/react-app apps/app/src/components -g '*.tsx'` |

Raw hex is allowed only in token/palette files or business registry data, not page-level styling.
