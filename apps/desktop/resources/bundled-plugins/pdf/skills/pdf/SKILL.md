---
name: pdf
description: Read, create, extract, merge, split, rotate, fill, render, and verify local PDF files. Use for PDF attachments, forms, reports, page operations, text extraction, and layout inspection.
---

# PDF

Use the local bundled Python runtime. Do not depend on a Codex cache path or a remote document service.

## Required workflow

1. Treat the base directory reported for this skill as the skill root. `runtime/` and `resources/` are direct children of that directory; do not walk upward or infer a plugin root. Run `python3 runtime/artifact_runtime.py doctor` from the skill root.
2. Inspect every existing input with `... inspect <input.pdf>` before transformation.
3. Use `pypdf` for page operations, metadata, forms, attachments, encryption inspection, merge/split/rotate/watermark workflows; `pdfplumber` for text/table extraction; `reportlab` for new PDFs; PyMuPDF for raster rendering.
4. Render the final PDF with `... render <output.pdf> --output-dir <dir> --dpi 160`. Inspect every page for clipping, collisions, font substitution, missing glyphs, bad page breaks, and unreadable content.
5. Finish with `... verify <output.pdf> --output-dir <dir>`. Report exact paths and any unresolved issues.

## Quality contract

- Preserve page boxes, rotation, bookmarks, links, metadata, form field names, and reading order unless intentionally changed.
- For new PDFs, use deliberate page geometry, reusable styles, embedded fonts, consistent headers/footers, and sufficient contrast.
- For extraction, distinguish missing selectable text from an empty document; OCR is not advertised unless an OCR dependency is added and diagnosed.
- For forms, inspect the actual field structure before filling. Prefer real field values; use annotations only when the PDF has no usable fields and disclose that choice.
- Never claim visual verification from text extraction alone.

## Runtime commands

- `--capabilities` or `capabilities`: machine-readable operations.
- `doctor`: bundled Python dependency health.
- `inspect <pdf>`: page, metadata, encryption, and form summary.
- `render <pdf> --output-dir <dir> [--dpi N]`: one PNG per page.
- `verify <pdf> [--output-dir <dir>]`: structural checks plus optional rendering.

For form-heavy tasks, first read the skill-local `resources/forms.md` and use the matching helpers under `resources/scripts/` to inspect fields, validate fillability, fill real fields, or add disclosed annotations. `resources/reference.md` documents the packaged PDF workflows. Resolve all paths directly from the reported skill base directory; never reference the retired `bundled-skills/pdf` path.

Do not claim success until the output exists and verification completes without an error.
