---
title: "Scenario: Scheduled Digests"
---

# Scenario: Scheduled Digests

Give a proven aggregation, morning-brief, or weekly-report prompt to [Automation](/en/guide/automation) and produce a draft on a fixed schedule.

## 1. Goals

- Generate a digest file at a fixed time every workday or every week
- Keep the output path stable so it is easy to find in [Files](/en/guide/files)
- Inspect run history when something fails; execution does not depend on the app being open that day, but the computer must be online and the task enabled

## 2. Preparation

1. Run the same prompt successfully at least once in a normal [session](/en/guide/sessions)
2. Confirm that the output path is appropriate, such as `notes/daily/` or `notes/weekly/`
3. Make sure the model and workspace are available; see [Quickstart](/en/quickstart)

## 3. Steps

1. Open **Automation** from the main rail
2. Select **Add from template** if a suitable template exists, or select **+ Add**
3. Enter:
   - **Schedule**, such as 08:00 daily or 17:00 every Friday
   - **Prompt**, keeping it consistent with the manually proven version
   - **Output location**, using an explicit path so files do not scatter
4. Set the task to **Enabled**
5. After it is due, check the run count and history, then open and edit the deliverable in Files


## 4. Suggested schedules

| Cadence | Suggested schedule | Example output | Prompt focus |
|---------|--------------------|----------------|--------------|
| Workday morning brief | Daily at 08:00 | `notes/daily/YYYY-MM-DD.md` | Today's actions, risks, and people to follow up with |
| Operations morning brief | Daily at 08:00 | `notes/ops/morning.md` | Fixed sections; if data is missing, use a placeholder labeled “example” |
| Weekly-report draft | Friday at 16:30 | `notes/weekly/YYYY-Www.md` | Completed / in progress / blocked / next week |
| Source-material inspection | Daily at 18:00 | `notes/audit/stale-files.md` | List important workspace files not updated recently |

## 5. Example prompts for Automation

**Workday morning brief**

```text
Generate today's work brief and save it under notes/daily/ using today's date
as the filename. Structure:
1. Three things that must be completed today
2. Waiting for others / blockers
3. Risks at a glance
Use concise Chinese bullets with no greeting.
If notes/ contains a file from yesterday, briefly compare any unfinished items.
```

**Friday weekly-report draft**

```text
Using this week's sessions and related material under notes/, draft a weekly report:
completed / in progress / blocked / next week.
Write for my direct manager and keep it under 800 Chinese characters.
Save it under notes/weekly/ using the ISO week number as the filename.
```

## 6. Acceptance checklist

- [ ] A manual session has already produced the same kind of file
- [ ] The Automation task shows **Enabled** and the schedule is correct
- [ ] The run count increases when due, or run history contains a successful result
- [ ] The latest deliverable opens from Files and remains editable

## 7. Notes

- A task can miss its schedule if the computer is asleep or powered off for too long; keep a catch-up routine for important digests
- Use [Approvals](/en/guide/approvals) for high-risk or outbound actions
- If the workflow needs reminders in a group chat, consider [Pilot combination B (+ OnMyBuddy)](/en/platform/pilot-combos)

## Related

- [Automation](/en/guide/automation) · [Files](/en/guide/files) · [Reports and meeting minutes](/en/scenarios/office-docs) · [Team pilot](/en/scenarios/team-pilot)
