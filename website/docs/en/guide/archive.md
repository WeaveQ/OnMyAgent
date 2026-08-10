---
title: Archive, search, and import
---

# Archive, search, and import

OnMyAgent has two kinds of history that are easy to confuse: the Session Archive for main sessions and archived tasks in Settings. Both help recover work, but their sources and deletion semantics differ.

## 1. Two kinds of archive

| | Session Archive | Archived tasks |
|--|-----------------|----------------|
| Content | Sessions, messages, usage, and analysis from supported sources | Assistant or automation tasks archived from a task list |
| Common entry | Session view under Agent management, plus search/analysis views | Settings → Data → Archived |
| Data source | OpenCode and known Agent/import formats | Task records in the current workspace |
| Actions | Search, star, pin messages, export, move to Trash, and more | Filter, restore, or permanently delete |

Personal Local Agent conversation storage is separate from OpenCode's main Session Archive. Similar-looking interfaces do not imply that they write to the same database.

## 2. Supported sources and limitations

- A built-in allowlist and known on-disk formats can be discovered and synchronized.
- An unknown custom Agent does not automatically enter the main archive merely because it has a log file.
- Claude.ai and ChatGPT data are import sources; the user must first obtain an export file.
- The Postgres and DuckDB/Quack backends are currently **Blocked**. Do not use or demonstrate them as connected archive backends.

## 3. Search, stars, and analysis

The archive can provide a session list, message search, usage, stars, pinned messages, analysis, and insights. Analysis is derived from the local archive read model; results may be incomplete while synchronization is unfinished or a source is unsupported.

After finding a session, verify its source Agent, workspace, and time before restoring or exporting it. This avoids selecting another project's session with the same title.

## 4. Import and export

1. Obtain the official export file from the source product.
2. Keep a backup of the original export in an isolated directory.
3. Import it with OnMyAgent and inspect the recognized source and item counts.
4. Sample-check message order, attachments, and timestamps.
5. When sharing is required, export to an auditable format such as Markdown and inspect it again for private data.

A successful import only means the format was accepted. It does not guarantee one-to-one restoration of every third-party metadata field, tool call, or attachment.

## 5. Trash and permanent deletion

- Archiving or moving an item to Trash is usually reversible. Do not expect the same entry to restore a permanently deleted item.
- Before a bulk deletion, filter by project/type and verify the item count.
- Never permanently delete real user data or empty Trash during a product demonstration.
- Deleting a Personal conversation, a main Session Archive entry, and workspace files are separate actions; confirm each separately.

## 6. Data consistency

The main Archive path uses SQLite, a long-lived store pool, a change bus, and SSE to keep lists updated. If the UI briefly shows old data, wait for synchronization or refresh it. Do not write Personal-runtime data into the main archive as a workaround.

## 7. Related

- [Sessions](/en/guide/sessions) · [Agent chat](/en/guide/agent-chat) · [Agent management](/en/guide/agent-management)
- [Settings](/en/guide/settings) · [Security and data](/en/security)
