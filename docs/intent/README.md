# Accepted intent

Committed proto-specs for work that a product owner has accepted and that is ready to plan against.

| Path | Role |
| --- | --- |
| [`_TEMPLATE.md`](_TEMPLATE.md) | Fields every accepted intent must fill |
| `<kebab-slug>.md` | One accepted idea (problem, outcome, constraints, open questions) |
| Local `.loop/plans/` | Execution ledgers — gitignored, not an audit trail |

## When to add a file here

1. Originator describes the problem in their own words.
2. Draft from the template. Keep it short enough that the next stage can act on it.
3. Product owner corrects and accepts (merge or review).
4. Engineering starts from this file plus Architecture / DESIGN — not from chat memory.
5. Non-trivial PRs point at the intent in the Plan section.

Do **not** put run logs, feature drafts, or overnight ledgers here. Those stay in `.loop/`.

Do **not** write a second Architecture. Constraints link out; this file records what was asked for.
