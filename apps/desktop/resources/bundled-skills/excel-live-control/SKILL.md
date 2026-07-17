---
name: excel-live-control
description: "Inspect or edit a workbook that is already open in the Microsoft Excel desktop app, but only when the current OnMyAgent session exposes a real Excel, connected-document, or Computer Use tool surface. Do not use for standalone spreadsheet files; use spreadsheets instead."
display_name_zh: "Excel 实时控制"
display_name_en: "Excel Live Control"
description_zh: "在当前会话真实具备桌面控制能力时操作已打开的 Excel 工作簿"
description_en: "Control an open Excel workbook when the session has a real desktop-control capability"
---

# Excel Live Control

This skill routes requests that target a workbook already open in Microsoft Excel. It does not create a connected session by itself.

## Hard capability gate

Before reading or changing a workbook, confirm all of the following from actual tool results:

1. Microsoft Excel is available and a workbook grid is open.
2. The target workbook is unambiguous.
3. The current session exposes a real Excel, connected-document, or Computer Use tool capable of reading and writing workbook state.
4. The tool can identify the active workbook or returns a session identifier that matches it.

If any gate fails, stop and tell the user exactly which capability is missing. Do not switch to local file editing unless the user agrees, and never claim that a workbook was connected or changed based only on its window title.

## Safe execution

- Read the relevant cells, formulas, objects, and formatting before editing.
- Make the smallest change that satisfies the request.
- Never send commands to another open workbook when the target is unclear.
- Preserve formulas, validations, conditional formatting, tables, charts, hidden sheets, and workbook protections unless the request requires changing them.
- Use stable operation identifiers when the available tool supports idempotency.
- Do not install add-ins, sign in, enter credentials, bypass workbook protection, enable macros, or change Excel/OS settings on the user's behalf.

## Verification

After each write, read the affected range again. For charts, dashboards, or material formatting changes, capture a visual view through the available tool and inspect it for clipping, blank charts, unreadable values, and formula errors.

The task is complete only when the requested change is visible in the intended workbook and the affected values or formulas have been read back successfully.

