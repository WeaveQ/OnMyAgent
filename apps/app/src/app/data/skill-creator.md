---
name: skill-creator
description: Guide for creating effective skills. Use when users want to create or update a skill that extends OpenCode with specialized knowledge, workflows, or tool integrations.
---

# Skill Creator

This skill is a template + checklist for creating skills that show up in OnMyAgent Market → Installed.

## What is a skill?

A skill is a folder anchored by `SKILL.md` with YAML frontmatter `name` + `description`.

## OnMyAgent write destination

- **Required finish line:** write the new skill to `~/.onmyagent/profiles/local/config/skills/<skill-name>/SKILL.md` (the product installed-skills root that Market → 已安装 / Installed lists).
- Use a file mutation tool (`write`, `edit`, or `apply_patch`) on that real path instead of pasting the whole skill into chat.
- Do **not** treat workspace-only `.opencode/skills`, Claude-eval, or `eval-viewer` as the done condition. Those are optional extras after the skill exists under installed-skills.

## Design goals

- Portable: safe to copy between machines
- Reconstructable: can recreate any required local state
- Self-building: can bootstrap its own config/state
- Credential-safe: no secrets committed; graceful first-time setup

## Recommended structure

```
~/.onmyagent/profiles/local/config/skills/
  my-skill/
    SKILL.md
    README.md
    templates/
    scripts/
```

## Trigger phrases (critical)

The description field is how the model decides when to use your skill.
Include 2-3 specific phrases that should trigger it.

Bad example:
"Use when working with content"

Good examples:
"Use when user mentions 'content pipeline', 'add to content database', or 'schedule a post'"
"Triggers on: 'rotate PDF', 'flip PDF pages', 'change PDF orientation'"

Quick validation:

- Contains at least one quoted phrase
- Uses "when" or "triggers"
- Longer than ~50 characters

## Frontmatter template

```yaml
---
name: my-skill
description: |
  [What it does in one sentence]

  Triggers when user mentions:
  - "[specific phrase 1]"
  - "[specific phrase 2]"
  - "[specific phrase 3]"
---
```

## Authoring checklist

1. Start with a clear purpose statement: when to use it + what it outputs.
2. Specify inputs/outputs and any required permissions.
3. Include “Setup” steps if the skill needs local tooling.
4. Add examples: at least 2 realistic user prompts.
5. Keep it safe: avoid destructive defaults; ask for confirmation.
6. Finish by writing the final `SKILL.md` to `~/.onmyagent/profiles/local/config/skills/<skill-name>/SKILL.md` so it appears under Market → Installed.
