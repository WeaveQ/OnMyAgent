---
name: documents
description: Create, read, edit, review, render, and verify local DOCX files. Use for Word documents, reports, contracts, redlines, comments, tracked changes, tables, headers, footers, TOCs, forms, and document attachments.
---

# Documents

Work only with local files. Do not hand off to Google Docs or claim control of a live Word application.

## Required workflow

1. Treat the base directory reported for this skill as the skill root. `runtime/` and `resources/` are direct children of that directory; do not walk upward or infer a plugin root. Use the bundled Python environment when available and never rely on a Codex cache path.
2. Run `python3 runtime/artifact_runtime.py doctor` from the skill root before the first operation. A `degraded` result means only the capabilities whose dependencies are available may be used.
3. Inspect an existing input with `... inspect <input.docx>` before editing it.
4. Use `python-docx`, `lxml`, and `defusedxml` for creation and OOXML-safe changes. Preserve unrelated package parts and relationships when making low-level edits.
5. Render with `... render <input.docx> --output-dir <dir>` after every material layout change. Inspect every produced page, iterate on overflow, clipping, collisions, orphan headings, awkward page breaks, and unreadable tables.
6. Finish with `... verify <input.docx> --output-dir <dir>` and report the exact output path. Do not claim success when the runtime returns `error` or `issues_found`.

## Quality contract

- Use deliberate page size, margins, hierarchy, typography, spacing, headers/footers, and page numbering.
- Prefer real Word styles over repeated direct formatting; keep headings navigable and tables semantically structured.
- Preserve comments, tracked changes, footnotes/endnotes, bookmarks, captions, hyperlinks, content controls, and field codes unless the user asks to remove them.
- For redlines, use genuine OOXML insert/delete markup and author/date metadata. For comments, create valid comment relationships and anchors.
- For accessibility, set document language, meaningful link text, table header rows, image alternative text, and logical reading order when applicable.
- For privacy-sensitive delivery, inspect core/custom properties, comments, revisions, hidden text, embedded objects, and relationship targets.

## Runtime commands

- `--capabilities` or `capabilities`: machine-readable operations.
- `doctor`: dependency and renderer health.
- `inspect <docx>`: OOXML integrity and structural summary.
- `render <docx> --output-dir <dir>`: deterministic PDF rendering.
- `verify <docx> [--output-dir <dir>]`: structural checks plus optional render.

## Packaged advanced helpers

The skill-local `resources/scripts/` directory is part of the same package and may be used when the task needs OOXML operations beyond `python-docx`:

- `comment.py` creates and manages genuine Word comments and anchors.
- `accept_changes.py` accepts tracked revisions in a controlled copy.
- `office/unpack.py`, `office/pack.py`, and `office/validate.py` support safe OOXML round-trips and schema validation.
- `office/validators/` contains DOCX and redline-specific checks; `templates/` contains the required comments/people parts.

Resolve the runtime and helpers directly from the reported skill base directory. Never reference the retired `bundled-skills/documents` path.

Do not promise that a document was created or edited until the output exists and verification succeeds.
