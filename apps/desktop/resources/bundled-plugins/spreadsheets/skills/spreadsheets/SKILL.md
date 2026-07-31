---
name: spreadsheets
description: Create, edit, analyze, and verify local XLSX, XLS, CSV, and TSV files with the bundled JavaScript artifact runtime. Use for formulas, charts, formatting, cleanup, reconciliation, and tabular analysis.
---

# Spreadsheets

Work only with standalone local files. Do not claim control of a live Excel session or hand off to Google Sheets. Use only the bundled Node.js libraries; do not install or invoke external spreadsheet engines.

## Required workflow

1. Treat the reported base directory as the skill root. Run `node runtime/artifact_runtime.cjs doctor` before the first operation.
2. If the user uploaded a file, **use the absolute path from the upload instruction** (do not search the whole disk).
3. Inspect structure: `node runtime/artifact_runtime.cjs inspect <path>`.
4. **Read sheet content** (preferred — do not invent ad-hoc exceljs scripts for simple reads):
   - All sheets (capped rows): `node runtime/artifact_runtime.cjs read <path>`
   - One sheet: `node runtime/artifact_runtime.cjs read <path> --sheet "发货需求"`
   - More rows: `node runtime/artifact_runtime.cjs read <path> --sheet "报价补充" --max-rows 2000`
5. For advanced **create/edit** (styles, charts, formulas, multi-file transforms), write CommonJS (`.cjs`) task scripts and run them with:
   ```bash
   NODE_PATH="$ONMYAGENT_ARTIFACT_RUNTIME_ROOT/node_modules" node your_task.cjs
   ```
   Prefer `require("xlsx")` for reading tabular values; use `exceljs` only when you need rich formatting/charts. Never `require("exceljs")` without `NODE_PATH` or `ONMYAGENT_ARTIFACT_RUNTIME_ROOT` set (doctor prints both).
   **Helper scripts must not live as user deliverables:** write them under `os.tmpdir()` or `.opencode/tmp/` (e.g. `/tmp/extract_sheets.cjs`), never as the only output in the workspace root. Only the business file (`.xlsx`/`.csv`/…) belongs in the session folder and in the “文件路径：” line.
6. Preserve formulas and cached results when possible. Never replace a requested formula model with unexplained hard-coded numbers.
7. Finish with `node runtime/artifact_runtime.cjs verify <output>` when you wrote a file, and report the exact **business** output path (not the `.cjs` helper).

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
- `doctor`: dependency health + `runtime_root` / `node_path_hint`.
- `inspect <file>`: workbook, sheet, formula, and error summary.
- `read <file> [--sheet Name] [--max-rows N]`: sheet rows as JSON (default max 500 rows per sheet).
- `verify <file>`: structural, formula-error, and cached-value checks.

Visual rendering belongs to the OnMyAgent preview surface. The artifact runtime does not expose external recalculation or PDF-conversion commands.
