---
title: "Practice 7: Keep Work Moving with Automation"
---

# Practice 7: Keep Work Moving with Automation

This is not an ongoing chat. Work advances **quietly after a schedule or trigger**, and you verify the deliverable. Entry point: main rail → **Automation**.


## 1. Scenario and goal

| Scenario | Goal |
|----------|------|
| Repeated daily or weekly reports | Generate a file when it is due |
| A rules-based inspection | Output an exception list |
| A fixed pipeline that uses an Expert | Prove it in a session, then move it to Automation |

## 2. Principles: stabilize before speeding up

1. Watch the full process in a desktop session before handing it over
2. Make the prompt self-contained; do not depend on “the conversation above”
3. Fix the output path so the result is easy to find in [Files](/en/guide/files)
4. For deletions and modifications, default to “report only, do not execute,” or require confirmation

## 3. Example: a self-running weekly report

```text
[Automation prompt]
Role: project assistant. Scan Markdown files modified in the last seven days
under notes/. Write notes/weekly/auto-weekly-report.md with: completed / risks /
three decisions needed from the owner. If there is no material, write
“No updates under notes/ this week.” Do not fabricate anything.
```

In main rail → **Automation**, schedule it for 17:00 every Friday. After enabling it, review only the file and run history.

## 4. Combine it with Experts and Skills

- For a complex method, first [create an Expert](/en/guide/experts) or Skill, then state the Expert's standard in the Automation prompt
- For browser collection, first validate the [browser capability](/en/guide/browser-computer-use) manually, then consider scheduling it and observe the site's terms of service

## Related

- [Practice 5 · Briefs](/en/scenarios/practice/daily-brief) · [Automation](/en/guide/automation) · [Approvals](/en/guide/approvals)
