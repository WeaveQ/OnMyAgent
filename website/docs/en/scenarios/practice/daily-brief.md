---
title: "Practice 5: Automate Daily and Weekly Briefs"
---

# Practice 5: Automate Daily and Weekly Briefs

Use **Automation** to generate scheduled morning briefs or weekly-report drafts. Prove the prompt manually before handing it over.

## 1. Scenario and goal

| Scenario | Goal |
|----------|------|
| Daily work brief | Generate a dated Markdown file at a fixed path |
| Friday weekly-report draft | Summarize this week's notes and save the result |
| Project inspection | Check whether key files were updated |


## 2. Steps

1. Run the same prompt successfully once in a normal [session](/en/guide/sessions)
2. Open main rail → **Automation** → **+ Add** or **Add from template**
3. Set the schedule, such as 08:30 daily or 17:00 every Friday, and enter the prompt
4. Set the task to **Enabled**
5. After it is due, verify the run history and the output in [Files](/en/guide/files)

## 3. Example prompts for Automation

```text
Generate today's work brief and save it under notes/daily/ using today's date
as the filename. Structure: three must-do items / blockers / risks at a glance.
Use concise Chinese sentences and no greeting.
```

```text
Every Friday, use this week's material under notes/ to draft a weekly report:
completed / in progress / blocked / next week. Save it under notes/weekly/.
Write for my direct manager and keep it under 800 Chinese characters.
```

## 4. Notes

- The schedule may be missed if the computer is asleep or powered off
- Email or IM delivery depends on connectors available in your environment; by default, treat the **file saved to disk** as the accepted result
- See [Automation](/en/guide/automation) and [Scheduled digests](/en/scenarios/automation-digest)

## Related

- [Tips for effective use · Automation](/en/guide/efficient-tips) · [create-automation Skill](/en/guide/skills)
