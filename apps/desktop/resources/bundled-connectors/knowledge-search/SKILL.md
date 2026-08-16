---
name: knowledge-vault
description: >
  Operate the local OnMyAgent knowledge vault (Markdown notes). Use when the user
  mentions 知识库, notes, briefs, saved material, or asks to search / read /
  write / tag vault notes. Not skills, not memory, not workspace Files. Not the
  marketplace Obsidian skill.
---

# Knowledge vault

The vault is a folder of Markdown on disk. The Knowledge rail is the human editor.
Sessions use `knowledge_*` tools against the **same files**. Do not shell out to
`obsidian` or `obsidian-cli`.

## Targeting

- `vault` — space folder name. Default is the current personal space.
- `file` — wikilink style: note name only, no path or `.md` required.
- `path` — exact path from that vault root, e.g. `meetings/standup.md`.

If `file` matches more than one note, return the candidates. Do not guess.

## Routing

| User intent | Tool |
| --- | --- |
| 库里有没有 / 搜笔记 / 简报 | `knowledge_search` |
| 打开全文 / 引用这篇 | `knowledge_read` (`file` first) |
| 记下来 / 新建一篇 | `knowledge_create` |
| 补一句到某某笔记 | `knowledge_append` |
| 加标签 / 改标题属性 | `knowledge_property_set` |
| 打开知识库界面 | no tool — that is the rail |
| 用户说的是 Obsidian.app | marketplace skill `obsidian` |

Do not call create/append unless the user asked to write. Do not delete notes.
Use `silent` create (do not ask the UI to steal focus) unless they said to open it.

## Safety

- This is not Skills and not Memory.
- Do not copy secrets or customer originals into the vault unless asked.
- Prefer `knowledge_search` before inventing content that may already exist.
