# Goal Continue Button Design

## Context

The pursue-goal runtime header currently renders its resume action as a solid blue button with a `Play` icon. The requested visual reference uses a compact neutral icon aligned with the adjacent edit and delete actions.

## Design

- Keep the existing resume action, disabled state, tooltip, and accessible label unchanged.
- Continue using the shared `Button` primitive with `size="icon-xs"`.
- Change the button to the neutral `ghost` variant.
- Replace the filled `Play` icon with the outlined `CirclePlay` icon at the existing 14 px icon scale.
- Use the existing secondary-text token and the standard hover text treatment so the action matches the neighboring header controls.
- Do not change the pause button, delete button, goal state policy, resume callback, or translated copy.

## Validation

- Add a focused source contract test that verifies the goal resume action uses `CirclePlay`, the ghost button variant, and the shared icon-button size.
- Run the focused session test, app typecheck, production build, design/i18n/boundary gates, and `git diff --check`.
- Capture the pursue-goal paused state when the local UI can reach the required runtime state; otherwise report the state prerequisite explicitly.
