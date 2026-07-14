# Assistant Code Icons Replacement Design

## Goal

Replace the two code icons highlighted in the assistant code workflow with the exact SVG artwork supplied by the user, without changing any other `Code2` usage.

## Scope

The change is limited to:

1. The icon to the left of the **Code** category tab in the assistant category switch.
2. The icon to the left of the **Code with OnMyAgent** heading on the assistant code new-task page.

Code-related icons in workspace toolbars, assistant configuration, settings, and other entry points remain unchanged.

## Implementation Design

Define one local presentational SVG component in each existing owner file:

- `assistant-sidebar-controls.tsx` owns the outlined 16 x 16 tab icon.
- `surface/chrome/avatars.tsx` owns the filled 36 x 36 new-task heading icon.

Each component will reproduce the supplied `viewBox` and path data exactly, paint with `currentColor`, accept the existing `className` sizing hook, and set `aria-hidden="true"` because the adjacent localized text already conveys its meaning.

The category switch continues to use its existing 14 px icon slot. The new-task heading continues to use its existing 24 px visual slot, scaling the supplied 36 x 36 artwork through its view box. No colors, spacing, labels, focus behavior, or click behavior change.

## Alternatives Considered

- A shared two-icon module would centralize the artwork but add an abstraction despite the icons having different geometry and no shared call site.
- Inline SVG at each render site would avoid named components but make the existing JSX harder to scan.

Local components provide the smallest clear change and prevent accidental replacement of unrelated `Code2` icons.

## Validation

- Run the app renderer type check.
- Run the frontend primitive scanner.
- Run `git diff --check`.
- Inspect the diff to confirm only the two requested icon call sites changed and no unrelated `Code2` usage was touched.

