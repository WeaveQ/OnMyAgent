---
title: Knowledge
---

# Knowledge

The knowledge rail is a local Markdown folder: one file tree on the left, reading or source editing on the right. It is not Skills, Files, or Memory.

## 1. How it differs

| Area | What belongs there | Where |
| --- | --- | --- |
| **Knowledge** | Notes you want to look up later | Main rail **Knowledge** |
| **Skills** | How the agent does a job | Store · Skills |
| **Memory** | Who you are and confirmed facts | Settings · Memory |
| **Files** | Workspace copies and task outputs | Main rail **Files** |

Notes are not installed skills. Session `knowledge_search` only reads this local vault.

## 2. Entry

Main rail **Knowledge**. Desktop only. Default disk path is under `~/.onmyagent/data/user/knowledge/`. You can point the personal vault at an existing Obsidian folder.

## 3. Layout

Search and icon actions (new note/folder, open folder, expand/collapse, **sync index**) sit above the tree. Tabs open notes on the right. Reading renders Markdown. Editing defaults to **source | preview**; preview updates as you type. This is not a WYSIWYG canvas.

A first visit opens the getting-started note. An empty tab is not the same as an empty vault.

## 4. Citations in chat

Sessions use `knowledge_search` / `knowledge_read` / `knowledge_create` on the same disk notes as this rail (not the marketplace Obsidian skill). After a search or read, the transcript shows **From knowledge · note.md**. Click it to open that note.

## 5. Tips

- Search covers `.md` / `.txt` / `.csv`. Excel / Word / PDF are not indexed in this version.
- If search is stale after edits, click **Sync index** once.
- Do not copy secrets or customer originals into a folder you use for demos.

## 6. Related

- [Overview](/en/guide/overview) · [Files](/en/guide/files) · [Skills](/en/guide/skills) · [Memory](/en/guide/memory)
