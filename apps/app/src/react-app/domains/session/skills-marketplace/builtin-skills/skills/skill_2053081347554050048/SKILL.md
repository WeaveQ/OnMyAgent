---
name: apple-notes
description: "Manage Apple Notes via the `memo` CLI on macOS (create, view, edit, delete, search, move, and export notes). Use when a user asks to add a note, list notes, search notes, or manage note folders."
description_zh: "管理 Apple 备忘录（创建、搜索、导出）"
description_en: "Manage Apple Notes (create, search, export)"
version: 1.0.1
display_name: "Apple备忘录"
display_name_en: "Apple Notes"
visibility: "public"
---

# Apple Notes CLI

## Preflight Checks
Before executing any `memo` commands, you MUST perform the following checks:
1. **OS Check**: Run `uname -s`. If the output is not `Darwin`, immediately abort and inform the user that this skill only supports macOS.
2. **Dependency Check**: Run `command -v memo`. If not found, provide the installation command (`brew tap antoniorodr/memo && brew install antoniorodr/memo/memo`) but DO NOT execute it automatically.
3. **Permission Check**: Before the first read/write operation, ensure Automation permissions are granted. If any command returns a `-1743` or Automation error, guide the user to: `System Settings > Privacy & Security > Automation` to grant terminal access to Notes.app.

## Tool Call Policy
- **No Hallucination**: All read, search, and list operations MUST rely solely on the actual output of the `memo` CLI. Do not fabricate or guess note contents.
- **Error Handling**: If a tool call fails (non-zero exit code, non-empty stderr, or platform `invoke_model_error`), you MUST honestly report the failure reason to the user and suggest a retry. Do not generate fake data to cover up the error.
- **Write Verification**: After any write, modify, delete, or move operation, you MUST verify the result by running `memo notes -s "<query>"` or the corresponding list command.

## Editing & Format Safety
- **Backup First**: Before editing an existing note, you MUST read its full original HTML body and inform the user that the original content has been backed up in the context.
- **Full HTML Replacement**: DO NOT use character id range splicing to modify rich text. You must use full HTML replacement to avoid corrupting the note's structure.
- **Preserve Styles**: When appending or modifying content, ensure original HTML/CSS style tags are preserved.
- **Complex Notes**: For notes with complex formatting, strongly suggest creating a new note instead of modifying the existing one in place.

Use `memo notes` to manage Apple Notes directly from the terminal. Create, view, edit, delete, search, move notes between folders, and export to HTML/Markdown.

Setup
- Install (Homebrew): `brew tap antoniorodr/memo && brew install antoniorodr/memo/memo`
- Manual (pip): `pip install .` (after cloning the repo)
- macOS-only; if prompted, grant Automation access to Notes.app.

View Notes
- List all notes: `memo notes`
- Filter by folder: `memo notes -f "Folder Name"`
- Search notes (fuzzy): `memo notes -s "query"`

Create Notes
- Add a new note: `memo notes -a`
  - Opens an interactive editor to compose the note.
- Quick add with title: `memo notes -a "Note Title"`

Edit Notes
- Edit existing note: `memo notes -e`
  - Interactive selection of note to edit.

Delete Notes
- Delete a note: `memo notes -d`
  - Interactive selection of note to delete.

Move Notes
- Move note to folder: `memo notes -m`
  - Interactive selection of note and destination folder.

Export Notes
- Export to HTML/Markdown: `memo notes -ex`
  - Exports selected note; uses Mistune for markdown processing.

Limitations
- Cannot edit notes containing images or attachments.
- Interactive prompts may require terminal access.
- Apple Notes does not natively render Markdown; rich text editing requires full HTML replacement.

Notes
- macOS-only.
- Requires Apple Notes.app to be accessible.
- For automation, grant permissions in System Settings > Privacy & Security > Automation.
