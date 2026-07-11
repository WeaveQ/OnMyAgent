---
name: skills-audit
description: >
  Audit .agents/skills SKILL.md files for duplicates, overlapping triggers,
  stale paths, broken references, and missing frontmatter. Use when reviewing
  the project skill catalog, after adding/renaming skills, or on a periodic
  skills health check.
user-invocable: true
---

# Skills Audit

Periodic review of the project-local skill set under `.agents/skills/`.
Goal: catch drift before the catalog becomes confusing.

**Cadence:** after any week with skill add/rename, or when the user asks to clean skills.

## Procedure

### 1 — Inventory

```bash
find -L .agents/skills -name SKILL.md | sort
find -L .agents/skills -name SKILL.md -exec wc -l {} \; | sort -rn
```

Confirm tool symlinks still point at the source tree:

```bash
readlink .codex/skills .claude/skills .grok/skills
# expected: ../.agents/skills (each)
```

### 2 — Frontmatter census

For each skill, verify:

| Field | Rule |
| --- | --- |
| `name` | kebab-case, matches directory name |
| `description` | States **when** to use (triggers); not empty |
| Optional locale | `display_name_zh` / `display_name_en` if present |

```bash
for f in .agents/skills/*/SKILL.md; do
  echo "=== $(basename "$(dirname "$f")") ==="
  awk '/^---$/{c++; next} c==1' "$f" | head -20
done
```

### 3 — Overlap

Within the same domain, flag:

- Nearly identical `description` → merge or delete one
- Shared trigger phrases with no clear split → tighten descriptions
- Body that only restates `AGENTS.md` → fold into AGENTS or slim skill to the delta

Do **not** merge unrelated domains (e.g. docs audit vs UI primitive refactor).

### 4 — Broken references

```bash
# paths mentioned as .codex/skills or outdated docs/plans
rg -n "\.codex/skills/|docs/plans/|docs/features/|docs/superpowers" .agents/skills --glob '**/SKILL.md' || true
```

Prefer `.agents/skills/...` in skill bodies. Symlink paths (`.codex/skills/...`) are OK only when documenting harness discovery.

### 5 — Report

Return a short table:

| Skill | Status | Notes |
| --- | --- | --- |
| name | ok / fix / merge-candidate | … |

Then apply only user-approved deletes or merges.
