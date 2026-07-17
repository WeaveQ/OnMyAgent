---
name: spreadsheets
description: Use when a user asks to create, read, clean, analyze, calculate, convert, or edit XLSX, XLS, CSV, or TSV files through the bundled Spreadsheets artifact plugin.
---

# Spreadsheets

## Overview

Use the plugin runtime as the sole authority for spreadsheet file operations. Do not infer installed workbook libraries or office applications from the file extension.

## Runtime contract

1. Resolve the plugin root as two directories above this `SKILL.md`.
2. Run `python3 <plugin-root>/runtime/artifact_runtime.py --capabilities` before promising a spreadsheet result.
3. Parse the JSON response and inspect `status` and `capabilities`.
4. Continue only if the requested read, write, conversion, calculation, or verification operation is advertised.
5. On `not_implemented`, stop. Relay the runtime message and state that no spreadsheet file was created or changed.

Do not invent workbook-writing, formula-recalculation, rendering, or CSV conversion commands absent from the runtime contract.

## Quick reference

| Runtime result | Action |
| --- | --- |
| `not_implemented` | Report the limitation; claim no workbook output |
| Needed operation absent | Explain that the operation is unavailable |
| Needed operation present | Follow only the returned runtime contract |

## Example

For “Convert this CSV to XLSX with formulas,” query capabilities first. With `{"status":"not_implemented","capabilities":[]}`, explain that conversion and formula writing are unavailable and no XLSX exists.

## Common mistakes

- Assuming Python workbook packages or LibreOffice are callable.
- Claiming formulas were recalculated or a workbook was rendered without runtime evidence.
- Relying on package resources that the runtime has not advertised.
