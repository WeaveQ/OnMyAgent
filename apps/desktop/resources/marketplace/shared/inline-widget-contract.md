# Inline widget contract (export / preview skills)

Shared rules for marketplace experts that emit HTML **preview** via tool
command results. Client rendering reads the command result `inlineWidget`
JSON and hoists it; do **not** also paste widgets into the chat body.

## Required behaviors (must appear in skill prose)

1. Client reads the full `inlineWidget` JSON from the command result and renders it.
2. **Forbidden:** put the widget into a `show_widget` fence in the body.
3. **Forbidden:** emit `preview:` links for process HTML.
4. **Forbidden:** paste HTML source or truncated JSON fragments into the assistant text.
5. Process HTML under `.process/` is preview-only; deliver final Excel/PDF via `artifact:` tables when exporting.

## Client safety net

The app also dedupes hoisted widgets by title (then html) in transcript
turn-content — skills must still follow this contract so the safety net is
not the only line of defense.

## Enforcement

`apps/app/scripts/marketplace-inline-widget-contract.test.ts` greps export
skills for the required phrases below.
