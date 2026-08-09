---
title: Your first task
---

# Your first task

Complete one full **one sentence → visible local result** loop: create a task, collaborate in the conversation, and verify the output file.

## Before you begin

- You have [installed and launched OnMyAgent](/en/quickstart)
- A working model is configured
- The workspace is writable

## Steps

### 1. Create a task

On Home, select **+ New task**, or type directly into the current session.


### 2. State the requirement clearly

A good prompt usually contains the **goal, source material, output format, and save location**.

**Example A · Create a text deliverable**

```text
Create notes/hello-onmyagent.md in the current workspace:
1. In three sentences, introduce a local-first office Agent workbench.
2. List two office scenarios I should try next.
```

**Example B · Organize existing files**

```text
Review the spreadsheets and documents in the workspace. Summarize the file types
as a bulleted list, then recommend the three highest-priority next actions.
Write the result to notes/workspace-review.md.
```

### 3. While it runs

- Continue the conversation or add constraints at any time
- If a higher-risk action is requested, follow the [approval](/en/guide/approvals) prompt
- Use the controls at the bottom to switch models and permission modes

### 4. Accept the result

1. Read the conclusion in the conversation.
2. Open **Files** and confirm that the file exists under `notes/`.
3. Double-click to preview it, or select **Open with default app** to edit it externally.


## Common problems

| Symptom | What to do |
|---------|------------|
| No output file | Explicitly say “write to this workspace path” in the prompt; check the permission mode |
| Model error | Check the key and network; see [Models](/en/guide/models) |
| File not found | Confirm the workspace path, then refresh Files |

## Next steps

- [Tips for working efficiently](/en/guide/efficient-tips), with ten habits for better results
- [Sessions](/en/guide/sessions), for deeper multi-turn collaboration
- [Skills](/en/guide/skills), for invoking capability packs with `/`
- [Scenario: reports and meeting minutes](/en/scenarios/office-docs)
