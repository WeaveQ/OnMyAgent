---
title: "Practice 1: Identify and Organize Files"
---

# Practice 1: Identify and Organize Files

Use OnMyAgent to understand local files in bulk, standardize names, and archive them—with a **preview before execution**.

## 1. Scenario and goal

| Scenario | Target result |
|----------|---------------|
| Inconsistent names across contracts, receipts, or screenshots | Rename to a consistent “date + topic + type” pattern |
| Scattered meeting notes or exported chats | Structured minutes with topics, decisions, and actions |
| Foreign-language material needs Chinese highlights | Summary + glossary, when subtitles or text are available |

When reading or changing local files, choose a stricter [permission mode](/en/guide/approvals) and confirm high-risk actions first.


## 2. Bulk rename: preview first

### Example request

```text
Read the content or metadata of files under inbox/ in the workspace and propose
new names using the rule “date + topic + type.” First show a table of old and
new names. Do not rename anything until I reply “Confirm and execute.”
Skip system files, encrypted files, and files currently in use.
```

### Preparation

1. Add the target folder to the [workspace](/en/guide/files), or import a copy
2. Make a full backup of important directories
3. Test the workflow on three to five sample files

### Acceptance checks

- [ ] The before/after table is readable and follows the intended rule
- [ ] Renaming happens only after your explicit confirmation
- [ ] Every skipped item has an explanation

## 3. Organize meeting minutes

### Example request

```text
Turn the meeting record I provide (pasted text or @notes/raw-meeting.txt) into
formal minutes with the topic, key decisions, action items, owners, and due dates.
Mark disputed points as “Open.” Write to notes/meeting-YYYYMMDD.md and put the
action items in a table.
```

Audio must be transcribed first. If no Whisper-style Skill is available locally, transcribe it with another tool and then import the text. See [Meeting practice](/en/scenarios/practice/meetings) and [Reports and meeting minutes](/en/scenarios/office-docs).

## 4. Recommendations

- State the output format up front: Markdown, table, or before/after list
- Before bulk writes: back up + preview + say “Confirm and execute”
- Do not run an unreviewed bulk operation across sensitive or financial directories

## Related

- [Tips for effective use · backups and small steps](/en/guide/efficient-tips) · [Files](/en/guide/files) · [Skills · Office](/en/guide/skills)
