---
name: spreadsheets
description: Create, edit, analyze, and verify local XLSX, XLS, CSV, and TSV files with the bundled JavaScript artifact runtime. Use for formulas, charts, formatting, cleanup, reconciliation, and tabular analysis.
---

# Spreadsheets

Work only with standalone local files. Do not claim control of a live Excel session or hand off to Google Sheets. Use only the bundled Node.js libraries; do not install or invoke external spreadsheet engines.

## Required workflow

1. Treat the reported base directory as the skill root. Run `node runtime/artifact_runtime.cjs doctor` before the first operation.
2. Inspect inputs with `node runtime/artifact_runtime.cjs inspect <path>` before modifying them.
3. Use `exceljs` for modern XLSX structure, formulas, styles, tables, charts, comments, validation, conditional formatting, print settings, and named ranges.
4. Use `xlsx` for CSV/TSV and legacy XLS import/export. Prefer saving edited legacy workbooks as `.xlsx` and disclose the conversion.
5. Write task scripts as CommonJS (`.cjs`) so bundled dependencies resolve without installing packages into the user's workspace.
6. Preserve formulas and cached results when possible. Never replace a requested formula model with unexplained hard-coded numbers.
7. Open the result in OnMyAgent's file preview and inspect every relevant sheet, merged range, table, chart, width, number format, and frozen pane.
8. Finish with `node runtime/artifact_runtime.cjs verify <output>` and report the exact output path.

## Formula boundary

OnMyAgent preserves and writes formulas but does not pretend to be a complete Excel-compatible calculation engine. Without a native spreadsheet calculation engine, volatile functions, external links, Power Query, data models, macros, and some advanced formulas cannot be recalculated with full fidelity. When formulas lack cached values:

- keep the formula intact;
- calculate only formulas whose semantics are explicitly implemented in the task script;
- disclose any cells that require recalculation when later opened in Excel-compatible software;
- never fabricate cached results.

## Quality contract

- Preserve existing styles and formulas unless the user asks for redesign.
- Use typed dates/numbers, appropriate number formats, frozen headers, filters, restrained colors, readable widths, and clear units.
- Charts must have truthful scales, titles, labels, and source ranges.
- CSV/TSV output must preserve delimiter, encoding, quoting, headers, and row shape; these formats cannot retain workbook styles or formulas.

## Runtime commands

- `--capabilities` or `capabilities`: machine-readable operations.
- `doctor`: bundled JavaScript dependency health.
- `inspect <file>`: workbook, sheet, formula, and error summary.
- `verify <file>`: structural, formula-error, and cached-value checks.

Visual rendering belongs to the OnMyAgent preview surface. The artifact runtime does not expose external recalculation or PDF-conversion commands.
