# Formula Validation Guide

Validate workbook structure and formulas statically with the bundled checker:

```bash
python3 SKILL_DIR/scripts/formula_check.py /path/to/output.xlsx
```

Use `--json` when machine-readable diagnostics are required. Fix every reported
`#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, and malformed formula before delivery.

Static validation cannot calculate formulas whose cached values are empty. Keep
those formulas intact, report that their values require recalculation when the
workbook is opened in an Excel-compatible application, and never fabricate cache
values. Reopen the final file with the OnMyAgent preview to verify sheets, styles,
merged cells, widths, number formats, charts, and visible formula text.

## Delivery checklist

- The output opens successfully and preserves every required sheet.
- Formula references point to existing sheets and cells.
- No formula error token is already cached in the workbook.
- Existing formulas and styles outside the requested edit remain unchanged.
- Formula cells without cached results are disclosed to the user.
