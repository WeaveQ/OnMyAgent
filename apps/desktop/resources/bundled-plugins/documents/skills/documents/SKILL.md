---
name: documents
description: Create, read, edit, review, and verify local DOCX files with the bundled JavaScript artifact runtime. Use for Word documents, reports, contracts, redlines, comments, tracked changes, tables, headers, footers, TOCs, forms, and document attachments.
---

# Documents

Work only with local files. Do not hand off to Google Docs or claim control of a live Word application. This skill uses the bundled Node.js artifact runtime; do not install or invoke Python, LibreOffice, Microsoft Office, or WPS.

## Required workflow

1. Treat the reported base directory as the skill root. Run `node runtime/artifact_runtime.cjs doctor` before the first operation.
2. Inspect an existing input with `node runtime/artifact_runtime.cjs inspect <input.docx>` before editing it.
3. For new documents, write a temporary CommonJS script and use `require("docx")`.
4. For existing documents, use `jszip` plus `fast-xml-parser` for targeted OOXML changes. Preserve every unrelated ZIP part, relationship, content type, namespace, identifier, and unknown extension.
5. Save to a new output path unless the user explicitly asks to replace the input. Use atomic replacement when overwriting.
6. Open the output in OnMyAgent's file preview and inspect page flow, tables, images, headers, footers, and typography after every material layout change.
7. Finish with `node runtime/artifact_runtime.cjs verify <output.docx>` and report the exact output path. Do not claim success when verification returns `error` or `issues_found`.

## JavaScript editing contract

- `docx` is preferred for generating new DOCX packages.
- `jszip` and `fast-xml-parser` are preferred for preserving and patching existing packages.
- Use CommonJS (`.cjs`) for task scripts so the bundled runtime dependencies resolve without project installation.
- Do not rebuild a complex existing document from extracted text; that destroys layout, styles, comments, fields, and embedded parts.
- Never execute embedded macros or external relationships.

## Quality contract

- Use deliberate page size, margins, hierarchy, typography, spacing, headers/footers, and page numbering.
- Prefer real Word styles over repeated direct formatting; keep headings navigable and tables semantically structured.
- Preserve comments, tracked changes, footnotes/endnotes, bookmarks, captions, hyperlinks, content controls, and field codes unless the user asks to remove them.
- For accessibility, set document language, meaningful link text, table header rows, image alternative text, and logical reading order when applicable.
- For privacy-sensitive delivery, inspect core/custom properties, comments, revisions, hidden text, embedded objects, and external relationship targets.

## Runtime commands

- `--capabilities` or `capabilities`: machine-readable operations.
- `doctor`: bundled JavaScript dependency health.
- `inspect <docx>`: OOXML integrity and structural summary.
- `verify <docx>`: structural checks.

Visual rendering belongs to the OnMyAgent preview surface, not a document conversion subprocess. Do not create an intermediate PDF merely to preview a DOCX.
