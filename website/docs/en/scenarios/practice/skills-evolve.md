---
title: "Practice 6: Create and Improve Skills"
---

# Practice 6: Create and Improve Skills

Turn a repeated workflow into a callable Skill and let the system remember your preferences. The entry point is main rail → **Market → Skills**; you can also invoke a Skill with `/`.


## 1. Scenario and goal

| Scenario | Goal |
|----------|------|
| The same prompt repeats every week | Turn it into a Skill or an Automation proposal |
| You do not know which capability to use | Run Find Skills before execution |
| You repeatedly correct the same preference | Save it to Personal / Memory or use self-improving |

## 2. Path A: find an existing Skill

```text
I need to collect webpages, capture screenshots, and summarize them.
Use find-skills to list suitable installed Skills, and explain the difference
between browser-automation and browser-skill.
```

See [Skills](/en/guide/skills) and [Browser and Computer Use](/en/guide/browser-computer-use).

## 3. Path B: create or improve a Skill

Use the bundled **skill-creator** when it appears in Market or the Skills list:

```text
Help me create a Skill. Its input is the path to a brand information package;
its output is a Markdown “three-dimensional product diagnosis” template.
Draft SKILL.md first, then give me three test prompts.
```

## 4. Path C: self-improvement and Memory

- **self-improving**: retain lessons after a task fails or you correct it
- [Settings · Personal / Memory](/en/guide/memory): preferred name, custom instructions, and factual memory

```text
Remember: external customer communication should default to Chinese,
lead with the conclusion, and avoid empty jargon such as “empower.”
Save this to my personal preferences or Memory.
```

## 5. Acceptance checks

- [ ] The new Skill can be invoked with `/` or natural language
- [ ] At least one test prompt succeeds
- [ ] The preference still applies in a new session

## Related

- [Skills](/en/guide/skills) · [Create an Expert](/en/guide/experts) · [Tips for effective use](/en/guide/efficient-tips)
