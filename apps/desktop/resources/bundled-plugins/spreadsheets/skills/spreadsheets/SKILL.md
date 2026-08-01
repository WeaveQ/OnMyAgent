---
name: spreadsheets
description: Create, edit, analyze, and verify local XLSX, XLS, CSV, and TSV files with the bundled JavaScript artifact runtime. Use for formulas, charts, formatting, cleanup, reconciliation, and tabular analysis.
---

# Spreadsheets

Work only with standalone local files. Do not claim control of a live Excel session or hand off to Google Sheets. Use only the bundled Node.js libraries; do not install or invoke external spreadsheet engines.

## Deliverable contract (hard rules)

| Role | Allowed location | Product card |
|------|------------------|--------------|
| **Business deliverable** (`.xlsx` / `.csv` / `.tsv` / …) | Session / workspace folder (or `output/`) | Yes — via runtime write commands |
| **Process helper** (`.cjs` / `.py` / scratch scripts) | `os.tmpdir()` or `.opencode/tmp/` only | Never |
| **User upload** | `session-uploads/` / inbox (read-only) | Never |

- Prefer first-class runtime commands over inventing `extract_sheets.cjs` / `gen_xlsx.py`.
- Never write helper scripts into the session root or next to business outputs.
- After writing a business file: `verify` it. In the user reply, **briefly name the deliverable** (e.g. “已生成发货需求表与报价补充表”); **do not** print `文件路径：…` lines — the session product cards open the files.
- Never put helper script paths in the user-facing reply.

## Required workflow

1. Treat the reported base directory as the skill root. Run `node runtime/artifact_runtime.cjs doctor` before the first operation.
2. If the user uploaded a file, **use the absolute path from the upload instruction** (do not search the whole disk). Uploads are inputs, not deliverables.
3. Inspect structure: `node runtime/artifact_runtime.cjs inspect <path>`.
4. **Read sheet content** (preferred — do not invent ad-hoc exceljs scripts for simple reads):
   - All sheets (capped rows): `node runtime/artifact_runtime.cjs read <path>`
   - One sheet: `node runtime/artifact_runtime.cjs read <path> --sheet "发货需求"`
   - More rows: `node runtime/artifact_runtime.cjs read <path> --sheet "报价补充" --max-rows 2000`
5. **Export / create business files with runtime commands** (preferred over ad-hoc scripts):
   - One sheet → one file:
     ```bash
     node runtime/artifact_runtime.cjs extract-sheets <source.xlsx> --sheet "发货需求" --out "发货需求.xlsx"
     ```
   - Several sheets → several files:
     ```bash
     node runtime/artifact_runtime.cjs extract-sheets <source.xlsx> --sheets "发货需求,报价补充" --out-dir .
     ```
   - All sheets → one file each:
     ```bash
     node runtime/artifact_runtime.cjs extract-sheets <source.xlsx> --all --out-dir ./output
     ```
   - Build a new workbook from JSON rows or CSV:
     ```bash
     node runtime/artifact_runtime.cjs write-xlsx --out "报价建议.xlsx" --sheet "报价" --json /tmp/rows.json
     node runtime/artifact_runtime.cjs write-xlsx --out "清单.csv" --csv /tmp/list.csv
     ```
6. **Advanced create/edit only** (styles, charts, formulas, multi-file transforms that runtime commands cannot do): write CommonJS helpers under **tmp**, then run with NODE_PATH:
   ```bash
   HELPER="$(node -e "console.log(require('os').tmpdir())")/oma-ss-$$.cjs"
   # write helper to $HELPER only
   NODE_PATH="$ONMYAGENT_ARTIFACT_RUNTIME_ROOT/node_modules" node "$HELPER"
   rm -f "$HELPER"
   ```
   Prefer `require("xlsx")` for tabular values; use `exceljs` only for rich formatting/charts. Never `require("exceljs")` without `NODE_PATH` / `ONMYAGENT_ARTIFACT_RUNTIME_ROOT`.
7. Preserve formulas and cached results when possible. Never replace a requested formula model with unexplained hard-coded numbers.
8. Finish with `node runtime/artifact_runtime.cjs verify <business-output>`. Successful `extract-sheets` / `write-xlsx` print `ONMYAGENT_DELIVERABLE:` markers so the session product card can open the file; do not rely on prose claims alone. In the user reply, only briefly say what was generated (product cards handle open/download). **Do not** emit `文件路径：` lines. Follow-up turns that produce a new workbook must call `write-xlsx` again in that turn.

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

- `--capabilities` or `capabilities`: machine-readable operations + deliverable contract.
- `doctor`: dependency health + `runtime_root` / `node_path_hint`.
- `inspect <file>`: workbook, sheet, formula, and error summary.
- `read <file> [--sheet Name] [--max-rows N]`: sheet rows as JSON (default max 500 rows per sheet).
- `extract-sheets <file> (--sheet Name --out file.xlsx | --sheets a,b --out-dir dir | --all --out-dir dir)`: export business workbooks without ad-hoc scripts.
- `write-xlsx --out file.xlsx --sheet Name (--json rows.json | --csv file.csv)`: create a deliverable workbook from data.
- `verify <file>`: structural, formula-error, and cached-value checks.

Visual rendering belongs to the OnMyAgent preview surface. The artifact runtime does not expose external recalculation or PDF-conversion commands.
