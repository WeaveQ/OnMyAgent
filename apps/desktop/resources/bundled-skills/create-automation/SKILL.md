---
name: create-automation
description: Create accurate OnMyAgent scheduled or one-time automation proposals from expert or ordinary conversations. Use when the user asks to automate, schedule, repeat, remind, periodically run, or execute a task later, including daily/weekly/monthly intervals and one-time runs.
---

# Create OnMyAgent Automation

Create a proposal file that OnMyAgent can review with the user and convert into a real automation task. Never claim the task is installed merely because the proposal file exists.

## Workflow

1. Determine the task goal and the smallest self-contained prompt needed when it runs without the current chat history.
2. Determine the schedule. Ask only for required details that cannot be inferred safely.
3. Read [references/proposal-schema.md](references/proposal-schema.md).
4. Write one JSON file to `automations/proposals/<descriptive-slug>.json` inside the current session's selected folder.
5. Tell the user that the proposal is ready for OnMyAgent confirmation. Do not ask them to edit JSON manually.

## Context boundary

- Omit `sourceSessionId` and `workspaceDirectory`. OnMyAgent injects the trusted source conversation and its selected folder.
- Omit `model` unless the user explicitly requests a different model. OnMyAgent otherwise inherits the current conversation model.
- Do not copy secrets, tokens, or transient chat text into `prompt`.
- Refer to files relative to the selected folder whenever possible.
- Make `prompt` runnable in a fresh conversation: include the objective, required inputs, expected outputs, and any important safety constraints.

## Multiple tasks

Write one proposal file per independently schedulable task. Use distinct titles and filenames. Do not combine tasks with different schedules into one proposal.

## Validation

Before finishing, verify that the JSON parses and that every required field matches the schema. If the schedule is ambiguous, ask the user instead of inventing a time or timezone.
