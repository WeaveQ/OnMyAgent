---
name: excel-live-control
description: Use when a user asks to inspect or change a workbook already open in Microsoft Excel through the bundled Spreadsheets artifact plugin.
---

# Excel Live Control

## Overview

Treat the plugin runtime as the only evidence that a live Excel session can be reached. An open workbook, window title, or app manifest does not establish a readable or writable connection.

## Runtime contract

1. Resolve the plugin root as two directories above this `SKILL.md`.
2. Run `python3 <plugin-root>/runtime/artifact_runtime.py --capabilities` before claiming a live Excel connection.
3. Parse the JSON response and inspect `status` and `capabilities`.
4. Continue only when live workbook discovery, the requested read or write, and read-back verification are advertised.
5. On `not_implemented`, stop. Relay the runtime message and state that no workbook or application state was changed.

Do not infer connection state from the user's statement that Excel is open. Do not invent connector, add-in, UI automation, or workbook-session operations.

## Quick reference

| Runtime result | Action |
| --- | --- |
| `not_implemented` | Report no live connection and no change |
| Read or write capability absent | Explain the requested live operation is unavailable |
| Full operation advertised | Follow the returned runtime contract and verify by read-back |

## Example

For “Set B2 to 15% in my open workbook,” query capabilities first. If they are empty, explain that live Excel control is unavailable and that B2 was not changed.

## Common mistakes

- Treating an open Excel window as a connected session.
- Claiming a cell or chart changed without successful write and read-back responses.
- Naming connectors or automation tools not exposed by this plugin runtime.
