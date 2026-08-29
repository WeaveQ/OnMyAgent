---
title: Knowledge
---

# Knowledge

The knowledge rail is a set of local note folders: grouped vaults on the left, reading or block editing on the right. It is not Skills, Files, or Memory.

## 1. How it differs

| Area | What belongs there | Where |
| --- | --- | --- |
| **Knowledge** | Notes you want to look up later | Main rail **Knowledge** |
| **Skills** | How the agent does a job | Store · Skills |
| **Memory** | Who you are and confirmed facts | Settings · Memory |
| **Files** | Workspace copies and task deliverables | Main rail **Files** |

Notes are not installed skills. Session `knowledge_search` only reads this local vault.

## 2. Entry

Main rail **Knowledge**. Desktop only. Default notes live under `~/.onmyagent/data/user/knowledge/`. You can point a personal vault at an existing Obsidian folder.

## 3. Layout

| Area | What it does |
| --- | --- |
| Search and toolbar | Search, **New** (note / table / upload), open folder, expand/collapse, **Sync index** |
| Groups | **My vaults / Project library / Expert library**; add or remove a local folder |
| **Recent** | Notes you have opened |
| File tree | Folders and notes in one tree; drag, rename, move, or delete from the context menu |
| Tabs | Several notes at once; switch between view and edit |
| Reading | Rendered Markdown; `.html` is a read-only preview |
| Editing | Block editor by default. Type `/` to insert a block; switch to source when needed |

A first visit opens the getting-started note. An empty tab is not the same as an empty vault.

## 4. What you can do

### Multiple vaults and Recent

**Add folder** only adds a directory to the list; files on disk stay put. **Remove folder** is the same. Notes you open appear under **Recent** (a short local recents list).

**Project library** and **Expert library** show **Not available yet** when there is no matching workspace or expert. Do not treat them as a second vault you can always create.

### Block editor and properties

`.md` notes open in a block editor. `/` inserts a paragraph, headings, lists, to-dos, quotes, or a code block. Note properties cover title, tags, and related notes. Extra fields you added in the note header are kept on save.

Switch to **source** when you need to edit the markup by hand.

### New, upload, and bookmarks

**New** can create a note or a table, or **Upload files** / **Upload folder**. `.html` is a sanitized read-only preview, not an editor. **Add link** saves a web page as Markdown and stores the URL in properties.

### Save from a session

**Save to knowledge** in the session header writes the current conversation as a note. You can change the file name and pick where it is saved. Desktop only. After save, that note opens in Knowledge.

## 5. Citations in chat

Sessions use `knowledge_search` / `knowledge_read` / `knowledge_create` on the same disk notes as this rail (not the marketplace Obsidian skill). After a search or read, the transcript shows **From knowledge · note.md**. Click it to open that note.

## 6. Tips

- Search covers `.md` / `.txt` / `.csv`. Excel / Word / PDF are not indexed in this version.
- If search is stale after edits, click **Sync index** once.
- Do not copy secrets or customer originals into a folder you use for demos.

## 7. Related

- [Overview](/en/guide/overview) · [Sessions](/en/guide/sessions) · [Files](/en/guide/files) · [Skills](/en/guide/skills) · [Memory](/en/guide/memory)
