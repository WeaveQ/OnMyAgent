---
title: "Scenario: Reports and Meeting Minutes"
---

# Scenario: Reports and Meeting Minutes

Turn “write a report” or “organize meeting minutes” from a chat draft into an editable file you can preview in the **workspace**.

## 1. Goals

- Generate a work report or meeting minutes from one request or a small amount of source material
- Save the deliverable at a fixed path for versioning and later editing
- Reference existing material with `@` when needed instead of writing without evidence

## 2. Preparation

1. [Install the app and configure a model](/en/quickstart)
2. Make sure the workspace is writable
3. Optionally [import files](/en/guide/files) such as a meeting transcript, agenda, or exported email

## 3. Steps

### 3.1 Create a task

On Home, select **+ New task**, or open an existing session and continue. See [Your first task](/en/first-task).

### 3.2 State the four essentials

A useful prompt normally includes:

| Element | Example |
|---------|---------|
| **Audience** | Direct manager / project team / customer |
| **Structure** | Decisions, actions, risks; or background–progress–next steps |
| **Length** | One page / under 800 Chinese characters |
| **Output path** | `notes/meeting-summary.md` |

If you already have source material, import it first, then reference the file or folder with `@` in the composer.

### 3.3 Execute and refine

- Ask for a different tone, named action owners, or a shorter bullet format
- When an existing file may be overwritten, review [Approvals and permissions](/en/guide/approvals)
- Choose the model and permission mode at the bottom of the composer

### 3.4 Verify the deliverable

1. Check that the conclusion in the conversation is complete
2. Open **Files** from the main rail and confirm the target path exists
3. Preview the file in OnMyAgent, or select “Open in app” to edit it with a system application


## 4. Example prompts

**Meeting minutes with source material**

```text
Using the workspace material related to “Weekly Meeting” (reference it with @),
prepare one-page minutes with:
1. decisions and owners
2. action items with owner + due date
3. risks and items that need escalation
Write to notes/meeting-summary.md in Chinese, using bullets where possible.
```

**Weekly report without a source file; complete it through the conversation**

```text
Help me draft this week's work report with: completed / in progress / blocked /
next week. Write for my direct manager and keep it under 800 Chinese characters.
Use the points I add below, then save it to notes/weekly/2026-W32.md.

Points:
- …
```

**Turn scattered notes into a report**

```text
Read the Markdown files under notes/ related to this week and merge them into
an externally readable progress report. Save it to notes/status-report.md.
Lead with conclusions, then details, and list three questions that need decisions.
```

## 5. Troubleshooting

| Symptom | What to do |
|---------|------------|
| The answer exists only in the conversation | State “write to `notes/….md`” in the prompt and check the permission mode |
| The source material was not referenced | Import it first, then use `@`, or state its path relative to the workspace |
| The format is too loose | Request bullets, a table, or a fixed heading structure |

## Related

- [Files and deliverables](/en/guide/files) · [Sessions](/en/guide/sessions) · [Your first task](/en/first-task)
- [Scheduled digests](/en/scenarios/automation-digest), to run a weekly-report flow automatically
