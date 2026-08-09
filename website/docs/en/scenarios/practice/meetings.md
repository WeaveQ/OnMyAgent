---
title: "Practice 8: Meeting Minutes and Action Items"
---

# Practice 8: Meeting Minutes and Action Items

Turn a transcript, exported chat, or agenda into **meeting minutes + an action table**, then save the result to the workspace.

Use the main interface to create the task and paste the record. When processing finishes, open the deliverable from **Files**.



## 1. Scenario and goal

| Input | Output |
|-------|--------|
| Meeting record text / md / docx | Structured meeting minutes |
| Exported multi-turn chat | Decisions + open questions |
| Tencent Meeting minutes, optional | Requires an authorized [tencent-meeting](/en/guide/skills)-style Skill |

## 2. One-request example

```text
Turn @notes/raw/weekly-meeting.txt into meeting minutes with:
topic, participants (if available), decisions, action items (owner + date),
and risks. Put action items in a table.
Write the result to notes/meeting/weekly-meeting-date.md.
```

## 3. If you have an audio recording

1. Obtain a transcript first, using a local transcription Skill or another tool
2. Import the transcript into the workspace and use the request above
3. If it should run automatically after every meeting, move it to [Automation](/en/scenarios/practice/daily-brief) once the input flow is stable

## 4. Tencent Meeting

If a **Tencent Meeting** Skill or connector is configured:

```text
List the Tencent Meetings that ended this week. For “Project Weekly Meeting,”
retrieve the key points from the smart minutes and merge them into
notes/meeting/tencent-meeting-weekly-summary.md.
```

Use the exact Skill name shown in Market in your version of the app.

## Related

- [Reports and meeting minutes](/en/scenarios/office-docs) · [Practice 1 · meeting-minutes section](/en/scenarios/practice/files) · [Files](/en/guide/files)
