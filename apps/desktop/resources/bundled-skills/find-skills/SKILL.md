---
name: find-skills
display_name_zh: 发现技能
display_name_en: Find Skills
description: >-
  Discover which OnMyAgent skills are installed and when to use them. Use when
  the user asks what skills are available, how to find a skill for a task, or
  which installed skill covers writing, coding, analysis, office files, or
  automation. Prefer listing installed skills over inventing capabilities that
  are not installed. Do not use this as a substitute for actually performing a
  task — after finding the right skill, load or follow that skill.
description_zh: >-
  发现当前已安装的 OnMyAgent 技能及适用场景。当用户问有哪些技能、想找能写文档/
  编码/分析/办公/自动化的技能时使用。优先基于已安装列表回答，不要编造未安装能力。
  找到合适技能后应加载或遵循该技能，而不是只停留在罗列。
---

# Find Skills

## When to use

- User asks: "有什么技能" / "which skill should I use" / "能做什么"
- User wants a capability that might already be covered by an installed skill
- Before inventing a new workflow, check installed skills first

## How to help

1. Prefer the **installed** skill list from the current workspace / OnMyAgent skills root
   (typically under the user's OnMyAgent skills directory), not the full app package catalog.
2. Match the user goal to a skill by **name + description** (and locale display names when present).
3. Recommend **one primary skill** and at most one alternative.
4. If nothing fits, say so clearly and suggest installing from **内置** or **市场**, or using
   `skill-creator` / `create-automation` / `expert-manager` when appropriate.
5. After recommending, **use** that skill for the actual work when the user proceeds.

## Do not

- Treat this skill as a general-purpose do-anything tool
- Claim access to marketplace-only or uninstalled skills
- Dump the entire catalog unless the user asks for a full list

## Related product skills

| Goal | Typical skill |
|------|----------------|
| Create a new skill | `skill-creator` |
| Automate / schedule | `create-automation` |
| Experts | `expert-manager` |
| PowerPoint | `pptx` |
| Self-improvement notes | `self-improving` |
