---
title: Files and deliverables
---

# Files and deliverables

Files manages **workspace source material and AI deliverables**: import, browse, search, preview, and edit externally.


## 1. Source tabs

Common tabs include:

| Tab | Meaning |
|-----|---------|
| **Files / My files** | Source material imported by the user into the workspace |
| **Tasks** | Files with a task-source marker that can be traced to a primary session |
| **Experts** | Deliverables associated with expert sessions |
| **Projects** | Currently disabled and Coming Soon; this is not a usable category |

> The product is converging these three active source categories. Deliverables from local Agents and Automation do not yet always receive the Tasks attribution. If a file is missing, also inspect the workspace directory and the corresponding run history.

## 2. Common operations

| Operation | Description |
|-----------|-------------|
| Import or upload | Copy a local file into the workspace |
| Search | Filter files and folders by name |
| Type filter | Limit the list to spreadsheets, presentations, images, and other types |
| Open or preview | Preview in the app or open in a system application |
| Sort | Sort by name, type, updated time, or size |
| New folder | Create a folder inside the current authorized directory |
| Favorite | Mark a frequently used file as a favorite |
| Move | Move an item within the permitted workspace scope |
| Copy path | Copy a workspace path to reference in a session |
| Add to task | Add the file to the primary-session context |
| Ask agent | Start a related task directly from the file |
| Open source session | Return to the known session that created the deliverable |
| Delete | Requires confirmation; distinguish the workspace copy from the original file first |

## 3. Preview and open behavior

| Type | Typical behavior |
|------|------------------|
| Markdown, text, and code | Read in the app, with syntax or diff presentation for some formats |
| Images | Preview in the app |
| HTML and web deliverables | Safe preview or browser open, depending on the content |
| Spreadsheets | In-app table preview or a system application |
| Word, presentations, and PDF | Product preview when supported; otherwise open externally or download |
| Audio and video | Native media preview or a system player |

A successful preview does not prove that the content is correct. Reopen important documents, spreadsheets, and presentations in an independent application, then inspect page count, formulas, fonts, charts, and media playback.

## 4. Work with an Agent

1. Import the source material into the workspace.
2. Reference it with `@` or describe its path in a session.
3. After generation, return to Files and accept the output.
4. For corrections, continue from the source session or use **Ask agent** to start a clear new task.

Do not say only “process this file.” Include the target output, content that must not change, save location, and acceptance method.

## 5. File safety and conflicts

- An import normally operates on a **workspace copy**, not an arbitrary path elsewhere on disk.
- The Server permits only paths under authorized roots. Read-only mode, collaborator permissions, and approvals can block writes.
- When writes, renames, deletes, and bulk operations use revision or conflict protection, a changed file must be reread rather than overwritten blindly.
- For large files, consider disk space, remote upload time, and sync-tool activity. Use a download or system application when inline preview is unsupported.
- Never copy tokens, `.ssh`, browser profiles, customer originals, or system directories into a demo workspace used in a public video.

## 6. Attribution and recovery limits

- The Tasks source mainly corresponds to OpenCode primary sessions and files with completed source attribution.
- Personal Local Agent uses an independent conversation store; its deliverables do not automatically become file records in the primary Session Archive.
- Automation uses independent task directories and run history; Files may not yet express every source completely.
- Deleting a file, archiving a task, deleting a session, and clearing Archive are four different actions with different recovery boundaries.

## 7. Related documentation

- [Sessions](/en/guide/sessions) · [Workspaces](/en/guide/workspaces) · [Archive, search, and import](/en/guide/archive)
- [Scenario: reports and meeting minutes](/en/scenarios/office-docs)
