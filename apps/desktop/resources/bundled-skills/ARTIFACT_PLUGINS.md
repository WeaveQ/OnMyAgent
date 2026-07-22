# Artifact plugins and JavaScript runtime

Documents, Spreadsheets, and PDF are packaged under `resources/bundled-plugins`; Presentations remains a curated bundled skill. Each skill includes a CommonJS launcher under `runtime/artifact_runtime.cjs`.

The launchers resolve the packaged `@onmyagent/artifact-runtime`, which contains pinned JavaScript libraries:

- Documents: `docx`, `jszip`, `fast-xml-parser`.
- Spreadsheets: `exceljs`, the maintained `@e965/xlsx` publication, `jszip`, `fast-xml-parser`.
- Presentations: `pptxgenjs`, `jszip`, `fast-xml-parser`.
- PDF: `pdf-lib`.

Every runtime exposes `capabilities`, `doctor`, `inspect`, and `verify` as single-line JSON commands. Agent task scripts must be CommonJS so the packaged modules resolve through `NODE_PATH` without a workspace install.

Human preview is independent from the editing libraries: Chromium opens PDF directly through a validated local `file://` URL, while a sandboxed local Office viewer renders Word, spreadsheet, and presentation files. Both preview paths are restricted to registered local workspace roots.

Formula preservation is supported, but the JavaScript spreadsheet runtime does not claim complete Excel-compatible recalculation for volatile functions, external links, macros, Power Query, or data models. Visual preview and structural verification are separate required checks.
