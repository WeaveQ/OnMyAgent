---
name: spreadsheets
description: Create, edit, analyze, calculate, render, and verify local XLSX, XLS, CSV, and TSV files. Use for spreadsheet attachments, formulas, charts, formatting, cleanup, reconciliation, and tabular analysis.
---

# Spreadsheets

Work only with standalone local files. Do not claim control of a live Excel session or hand off to Google Sheets.

## Required workflow

1. Treat the base directory reported for this skill as the skill root. `runtime/` and `resources/` are direct children of that directory; do not walk upward or infer a plugin root. Use only the bundled Python environment when available.
2. Run `python3 runtime/artifact_runtime.py doctor` from the skill root. Stop or clearly degrade if workbook dependencies are missing.
3. Inspect inputs with `... inspect <path>` before modifying them. For large workbooks, examine sheets and ranges incrementally.
4. Use `openpyxl` for workbook structure, formulas, styles, tables, charts, comments, validation, conditional formatting, print settings, and named ranges. Use `pandas`/`numpy` for analysis, not as a replacement for workbook formatting.
5. Prefer formulas for derived values and keep source data, assumptions, calculations, and outputs auditable. Never replace a requested formula model with unexplained hard-coded numbers.
6. Recalculate with `... recalculate <workbook> --output-dir <dir>`, then run `... verify <recalculated.xlsx>` and resolve `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`, and related errors.
7. Render with `... render <workbook> --output-dir <dir>` and inspect the PDF for clipped columns, unreadable scale, broken page areas, hidden totals, and inconsistent formats.

## Quality contract

- Preserve existing styles and formulas unless the user asks for redesign.
- Use typed dates/numbers, appropriate number formats, frozen headers, filters, restrained colors, readable widths, and clear units.
- Cite analytical sources inside the workbook when external data is used.
- Charts must have truthful scales, titles, labels, and source ranges; do not use decorative charts that obscure the data.
- CSV/TSV output must preserve delimiter, encoding, quoting, headers, and row shape; explain that these formats cannot retain workbook styles or formulas.

## Runtime commands

- `--capabilities` or `capabilities`: machine-readable operations.
- `doctor`: Python and office renderer health.
- `inspect <file> [--data-only]`: structure, formula, and error summary.
- `recalculate <file> --output-dir <dir>`: LibreOffice recalculation into XLSX.
- `render <file> --output-dir <dir>`: PDF rendering for visual QA.
- `verify <file>`: formula-error and structural checks.

The skill-local `resources/scripts/office/` directory contains OOXML pack, unpack, and validation helpers for repairs that cannot be expressed safely through `openpyxl`. Resolve it directly from the reported skill base directory and never reference the retired `bundled-skills/spreadsheets` path.

Do not report workbook completion until the final file exists, formula verification passes, and the rendered layout has been checked when presentation matters.
