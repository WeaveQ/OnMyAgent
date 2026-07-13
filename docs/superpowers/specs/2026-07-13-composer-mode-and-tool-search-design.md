# Composer collaboration modes and tool search

## Goal

Correct the collaboration-mode choices shown in the office scene and make long skill and connector lists searchable from the Composer quick-actions menu.

## Scope

- In the office scene, show only Craft, Ask, and Plan collaboration modes.
- Keep Plan mode and Pursue goal available in the code scene.
- Add search inputs to the Skills and Connectors secondary panels.
- Match against each item's name and description with case-insensitive fuzzy search.
- Add English, Simplified Chinese, and Traditional Chinese copy for search placeholders and empty results.

This change does not alter collaboration-mode runtime semantics, skill execution, connector configuration, or marketplace behavior.

## UI behavior

### Collaboration modes

The office variant's menu contains exactly three choices: Craft, Ask, and Plan. Pursue goal is not rendered in this variant. The legacy/code variant remains unchanged and continues to expose Plan mode and Pursue goal.

Existing selected-mode mapping remains intact. If persisted state contains an older office-mode value that does not map to Craft, Ask, or Plan, the menu shows no selected radio item rather than reintroducing Pursue goal.

### Search

The Skills and Connectors panel headers contain a shared visual pattern: a project `Input` with a Lucide search icon and an i18n placeholder. The Skills header retains its Configure action.

Filtering rules:

- An empty or whitespace-only query returns every item.
- Matching is case-insensitive and fuzzy.
- Skills match visible command or skill names and descriptions.
- Imported plugin skill files match their visible title and object type metadata.
- MCP servers match their name and visible connection detail.
- Composer extensions match their name and description.
- Results preserve the existing source grouping and item order.

When no item matches, the panel shows a short localized empty-result message. Loading behavior remains distinct from the empty-result state.

The query is cleared when the user switches between secondary sections or closes and reopens the quick-actions menu. Skill and connector queries are independent so filtering logic remains explicit and testable.

## Component and data design

The implementation stays inside the existing Composer surface:

- Keep collaboration-mode option construction as a small pure helper and remove `pursueGoal` from the office branch.
- Introduce pure filtering helpers for skill-like and connector-like menu entries. These helpers accept the current query and return filtered arrays without mutating loaded data.
- Store the two query strings as local Composer state.
- Reuse `@/components/ui/input` and existing `MenuRowButton` / `MenuRowSurface` primitives. Do not introduce a new generic search-menu abstraction for this two-panel change.
- Continue using the existing `fuzzysort` dependency already imported by the Composer.

No schema, server API, store, or persistence changes are required.

## Accessibility and design contract

- Search fields use localized placeholders and accessible labels.
- The existing `Input` focus treatment supplies the required keyboard focus ring.
- Search icons are decorative and hidden from assistive technology.
- Menu items retain their current keyboard focus and activation behavior.
- Styling uses existing DLS surface, border, spacing, radius, typography, and icon-size tokens; no new design token or `DESIGN.md` change is needed.
- Empty-result text uses the existing secondary text treatment.

## Testing

Follow test-first development:

1. Add a failing test proving the office option set excludes Pursue goal while the code/legacy option set still includes it.
2. Add failing pure-helper tests for empty-query behavior, name matches, description matches, case-insensitive fuzzy matches, and no matches.
3. Implement the smallest production changes that make those tests pass.
4. Run the focused Composer tests, App typecheck, i18n CJK gate, boundary check where applicable, UI primitive scan, and `git diff --check`.

## Acceptance criteria

- Office mode never renders Pursue goal in its collaboration-mode panel.
- Code mode still renders Pursue goal.
- Skills and Connectors panels each show a search input at the top.
- Searching by a partial name or description filters the correct list.
- Clearing the input restores all items.
- A localized empty state appears when there are no matches.
- Closing or changing the secondary panel clears the relevant visible search.
- Existing Configure, selection, connector status, and loading behavior continue to work.
