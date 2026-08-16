# domains/knowledge

Local Markdown vault (rail page + CodeMirror editor).

## Ownership
- Owns vault tree, tabs, editor/reader, search-hit parsing, and open-rail events.
- Does not own session transcript, composer, or rail chrome.

## Public surface
- Prefer `./index.ts` barrel (`KnowledgeVaultPage`, `subscribeOpenKnowledgeNote`, `openKnowledgeNoteInRail`, search-hit helpers).

## Lateral dependencies
- Allowed: `shared`, capabilities/artifacts (preview).
- Forbidden: `session` (no reverse import). Session hosts the page via the barrel.

## Do not
- Product features in `domains/shared`
- Import `shell/*` from this domain
- Add new files under `domains/session/knowledge/`
