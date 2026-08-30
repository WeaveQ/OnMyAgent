---
title: Knowledge
---

# Knowledge

Local notes: grouped vaults on the left, reading or block editing on the right. Not Skills, Files, or Memory.

## 1. How it differs

| Area | What belongs there | Where |
| --- | --- | --- |
| **Knowledge** | Notes you want to look up later | Main rail **Knowledge** |
| **Skills** | How the agent does a job | Store · Skills |
| **Memory** | Who you are and confirmed facts | Settings · Memory |
| **Files** | Workspace copies and task deliverables | Main rail **Files** |

Session `knowledge_search` only reads this local vault. Notes are not installed skills.

## 2. Entry and layout

Main rail **Knowledge**, desktop only. Default path is `~/.onmyagent/data/user/knowledge/`. A personal vault can point at an existing Obsidian folder.

| Area | What it does |
| --- | --- |
| Left | Search, new/upload, sync index; **My vaults / Project library / Expert library**; **Recent**; file tree |
| Right | Read or block-edit. Type `/` to insert a block, or switch to source. `.html` is read-only |

**Add/remove folder** only changes the list; files on disk stay. Project and expert libraries show **Not available yet** when there is no matching scope.

## 3. What you can do

| Action | Notes |
| --- | --- |
| Block editor | Default for `.md`; switch to source to edit markup |
| New / upload | Notes, tables, file or folder upload, **Add link** |
| Save to knowledge | Session header writes the current conversation as a note |
| Open from chat | **From knowledge · note.md** jumps to that note |

## 4. Tips

- Search covers `.md` / `.txt` / `.csv`. Excel / Word / PDF are not indexed
- If search is stale, click **Sync index** once
- Do not copy secrets or customer originals into a demo folder

## 5. Related

- [Overview](/en/guide/overview) · [Sessions](/en/guide/sessions) · [Files](/en/guide/files) · [Skills](/en/guide/skills) · [Memory](/en/guide/memory)
