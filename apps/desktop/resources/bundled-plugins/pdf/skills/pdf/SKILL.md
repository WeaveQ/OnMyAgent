---
name: pdf
description: Read, create, merge, split, rotate, fill, and verify local PDF files with the bundled JavaScript artifact runtime. Use for PDF attachments, forms, reports, page operations, and layout inspection.
---

# PDF

Use only the bundled Node.js artifact runtime. Do not install or invoke external document engines, remote document services, or live PDF applications.

## Required workflow

1. Treat the reported base directory as the skill root. Run `node runtime/artifact_runtime.cjs doctor` before the first operation.
2. Inspect every existing input with `node runtime/artifact_runtime.cjs inspect <input.pdf>` before transformation.
3. Use `pdf-lib` for creation, page operations, metadata, forms, merge/split/rotate, and watermark workflows.
4. Write task scripts as CommonJS (`.cjs`) so bundled dependencies resolve without workspace installation.
5. Save to a new output path unless the user explicitly asks to replace the input.
6. Open the final PDF through OnMyAgent's Chromium PDF preview and inspect every page at readable zoom.
7. Finish with `node runtime/artifact_runtime.cjs verify <output.pdf>` and report exact paths and unresolved issues.

## Quality contract

- Preserve page boxes, rotation, bookmarks, links, metadata, form field names, and reading order unless intentionally changed.
- For new PDFs, use deliberate page geometry, embedded fonts, consistent headers/footers, and sufficient contrast.
- For forms, inspect the field structure before filling. Prefer real field values; disclose annotation fallbacks.
- `pdf-lib` does not provide OCR or general-purpose paragraph reflow. Do not advertise either capability.
- Never execute embedded JavaScript or launch actions from an input PDF.
- Never claim visual verification from structural inspection alone; use the OnMyAgent preview.

## Runtime commands

- `--capabilities` or `capabilities`: machine-readable operations.
- `doctor`: bundled JavaScript dependency health.
- `inspect <pdf>`: page, metadata, encryption, and form summary.
- `verify <pdf>`: structural checks.
