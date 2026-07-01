# Skills Sync Strategy

OnMyAgent currently carries skills in three places:

| Location | Role | Packaging expectation |
| --- | --- | --- |
| `.codex/skills/` | Project-local Codex skills used by this repository. | Can stay small and repo-specific. |
| `.opencode/skills/` | OpenCode-compatible skills available in the workspace. | Can be a working copy for local development. |
| `apps/desktop/resources/bundled-skills/` | Skills bundled into the desktop app. | Must be materialized as real files for packaging. |

## Decision

Do not convert every skill directory to symlinks. Desktop packaging, npm archives, zip release assets, and Windows checkouts can handle symlinks differently, so bundled app resources should remain real files.

The preferred long-term shape is a single editable source tree plus deterministic sync scripts:

```text
.agent/skills/                         # future source of truth
.codex/skills/                         # synced subset for Codex
.opencode/skills/                      # synced subset for OpenCode
apps/desktop/resources/bundled-skills/ # materialized copy for packaged desktop
scripts/maintenance/sync-skills.mjs
scripts/maintenance/check-skills-sync.mjs
```

## Near-Term Policy

- Keep `.codex/skills/documentation-audit/` as the source for the new documentation audit workflow for now.
- Keep `.opencode/skills/documentation-audit/` synchronized with it so OpenCode agents can use the same documentation audit workflow.
- Keep existing `.codex/skills/frontend-primitive-refactor/` and `.codex/skills/ui-regression-audit/` synchronized with their `.opencode/skills/` copies.
- Do not migrate all bundled skills into `.agent/skills/` in this round.
- Do not symlink `apps/desktop/resources/bundled-skills/**`; use real files there.

## Future Migration Plan

1. Create `.agent/skills/` as the canonical source tree.
2. Move one low-risk skill first, then add a sync manifest that declares target destinations.
3. Add `scripts/maintenance/sync-skills.mjs` to copy source skills to `.codex`, `.opencode`, and desktop bundled resources.
4. Add `scripts/maintenance/check-skills-sync.mjs` to fail when generated targets drift from source.
5. Only after the script is stable, migrate larger bundled skill families.

## Validation

When touching skill docs, run:

```sh
git diff --check
find .codex/skills .opencode/skills apps/desktop/resources/bundled-skills -maxdepth 2 -name SKILL.md | sort
```

When sync scripts exist, prefer:

```sh
node scripts/maintenance/check-skills-sync.mjs
```
