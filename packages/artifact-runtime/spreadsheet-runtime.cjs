"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  dependencyReport,
  emit,
  parseArgs,
  requireInput,
} = require("./runtime-common.cjs");

const CAPABILITIES = Object.freeze([
  "create",
  "read",
  "edit",
  "analyze",
  "formulas",
  "charts",
  "styles",
  "convert-to-xlsx",
  "inspect",
  "verify",
  "extract-sheets",
  "write-xlsx",
]);
const EXTENSIONS = new Set([
  ".xlsx", ".xlsm", ".xlsb", ".xltx", ".xltm", ".xls", ".csv", ".tsv", ".ods",
]);
const WORKBOOK_WRITE_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xls", ".csv", ".tsv"]);
const FORMULA_ERRORS = ["#VALUE!", "#DIV/0!", "#REF!", "#NAME?", "#NULL!", "#NUM!", "#N/A"];
const DEPENDENCIES = ["exceljs", "xlsx", "jszip", "fast-xml-parser"];
const DEFAULT_MAX_ROWS = 500;
const HARD_MAX_ROWS = 5000;
const COMMANDS = Object.freeze([
  "doctor",
  "inspect",
  "read",
  "verify",
  "extract-sheets",
  "write-xlsx",
]);

function loadWorkbook(source) {
  const XLSX = require("xlsx");
  return XLSX.readFile(source, {
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
    cellDates: true,
    dense: false,
  });
}

function inspectSpreadsheet(input) {
  const source = requireInput(input, EXTENSIONS, "spreadsheet inspection");
  const XLSX = require("xlsx");
  const workbook = loadWorkbook(source);
  const sheets = [];
  const formulaErrors = [];
  const formulasWithoutCachedValues = [];
  let formulaCount = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const range = sheet?.["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
    let nonemptyCells = 0;
    for (const [address, cell] of Object.entries(sheet ?? {})) {
      if (address.startsWith("!")) continue;
      if (cell?.v !== undefined && cell?.v !== null && cell.v !== "") nonemptyCells += 1;
      if (typeof cell?.f === "string" && cell.f.length > 0) {
        formulaCount += 1;
        if (cell.v === undefined || cell.v === null) {
          formulasWithoutCachedValues.push(`${name}!${address}`);
        }
      }
      if (typeof cell?.v === "string" && FORMULA_ERRORS.some((error) => cell.v.includes(error))) {
        formulaErrors.push({ sheet: name, cell: address, value: cell.v });
      }
    }
    sheets.push({
      name,
      rows: range ? range.e.r - range.s.r + 1 : 0,
      columns: range ? range.e.c - range.s.c + 1 : 0,
      nonempty_cells: nonemptyCells,
    });
  }
  return {
    status: "success",
    runtime: "spreadsheets",
    source,
    format: source.split(".").pop()?.toLowerCase(),
    sheet_count: sheets.length,
    sheets,
    formula_count: formulaCount,
    formula_errors: formulaErrors.slice(0, 100),
    formula_error_count: formulaErrors.length,
    formulas_without_cached_values: formulasWithoutCachedValues.slice(0, 100),
    formulas_without_cached_value_count: formulasWithoutCachedValues.length,
  };
}

function verifySpreadsheet(input) {
  const inspection = inspectSpreadsheet(input);
  const issues = [];
  if (inspection.sheet_count === 0) issues.push("workbook has no sheets");
  if (inspection.formula_error_count > 0) {
    issues.push(`${inspection.formula_error_count} formula error cells found`);
  }
  if (inspection.formulas_without_cached_value_count > 0) {
    issues.push(
      `${inspection.formulas_without_cached_value_count} formula cells lack cached values; OnMyAgent preserves formulas but does not claim full Excel-compatible recalculation`,
    );
  }
  return {
    status: issues.length ? "issues_found" : "success",
    runtime: "spreadsheets",
    inspection,
    issues,
  };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, HARD_MAX_ROWS);
}

/**
 * Read sheet rows as JSON objects (header row → keys). Prefer this over ad-hoc
 * agent scripts that `require("exceljs")` from a random cwd.
 */
function readSpreadsheet(input, options = {}) {
  const source = requireInput(input, EXTENSIONS, "spreadsheet read");
  const XLSX = require("xlsx");
  const workbook = loadWorkbook(source);
  const maxRows = parsePositiveInt(options.maxRows, DEFAULT_MAX_ROWS);
  const requested = typeof options.sheet === "string" ? options.sheet.trim() : "";
  const names = requested
    ? [requested]
    : workbook.SheetNames.slice(0, 20);
  if (requested && !workbook.SheetNames.includes(requested)) {
    throw new Error(
      `Sheet not found: ${requested}. Available: ${workbook.SheetNames.join(", ")}`,
    );
  }

  const sheets = {};
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
      blankrows: false,
    });
    const truncated = rows.length > maxRows;
    sheets[name] = {
      row_count: rows.length,
      returned_rows: truncated ? maxRows : rows.length,
      truncated,
      rows: truncated ? rows.slice(0, maxRows) : rows,
    };
  }

  return {
    status: "success",
    runtime: "spreadsheets",
    source,
    sheet_names: workbook.SheetNames,
    sheets,
    max_rows: maxRows,
    note:
      "Prefer runtime `extract-sheets` / `write-xlsx` for exports. Ad-hoc helper scripts must live under os.tmpdir() or .opencode/tmp/ — never as user deliverables.",
  };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveOutputPath(raw, label) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${label} requires an output path`);
  }
  const resolved = path.resolve(raw.trim());
  const ext = path.extname(resolved).toLowerCase();
  if (!WORKBOOK_WRITE_EXTENSIONS.has(ext)) {
    throw new Error(
      `${label} output must be one of ${[...WORKBOOK_WRITE_EXTENSIONS].join(", ")} (got ${ext || "(none)"})`,
    );
  }
  return resolved;
}

function parseSheetList(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sanitizeSheetFileName(name) {
  const cleaned = String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "sheet";
}

function copySheet(XLSX, sourceSheet, name) {
  // Clone via JSON so extracted workbooks do not share mutable refs with the source.
  const cloned = JSON.parse(JSON.stringify(sourceSheet));
  return { sheet: cloned, name: name.slice(0, 31) || "Sheet1" };
}

/**
 * Extract one or more sheets into business deliverable workbooks.
 *
 * Modes:
 * - `--sheet Name --out file.xlsx` → single sheet workbook
 * - `--sheets a,b --out file.xlsx` → multi-sheet workbook
 * - `--sheets a,b --out-dir dir/` or `--all --out-dir dir/` → one xlsx per sheet
 */
function extractSheets(input, options = {}) {
  const source = requireInput(input, EXTENSIONS, "extract-sheets");
  const XLSX = require("xlsx");
  const workbook = loadWorkbook(source);
  const all = options.all === true || options.all === "true";
  const single = typeof options.sheet === "string" ? options.sheet.trim() : "";
  const many = parseSheetList(options.sheets);
  let names;
  if (all) {
    names = [...workbook.SheetNames];
  } else if (single) {
    names = [single];
  } else if (many.length) {
    names = many;
  } else {
    throw new Error(
      "extract-sheets requires --sheet <name>, --sheets a,b, or --all",
    );
  }

  for (const name of names) {
    if (!workbook.SheetNames.includes(name)) {
      throw new Error(
        `Sheet not found: ${name}. Available: ${workbook.SheetNames.join(", ")}`,
      );
    }
  }

  const outDirRaw = typeof options.outDir === "string" ? options.outDir.trim() : "";
  const outRaw = typeof options.out === "string" ? options.out.trim() : "";
  const outputs = [];

  if (outDirRaw || (!outRaw && names.length > 1)) {
    const outDir = path.resolve(outDirRaw || ".");
    fs.mkdirSync(outDir, { recursive: true });
    for (const name of names) {
      const { sheet, name: safeName } = copySheet(XLSX, workbook.Sheets[name], name);
      const dest = path.join(outDir, `${sanitizeSheetFileName(name)}.xlsx`);
      const next = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(next, sheet, safeName);
      XLSX.writeFile(next, dest);
      outputs.push({ sheet: name, path: dest, mode: "per-sheet" });
    }
  } else {
    const dest = resolveOutputPath(outRaw, "extract-sheets --out");
    ensureParentDir(dest);
    const next = XLSX.utils.book_new();
    for (const name of names) {
      const { sheet, name: safeName } = copySheet(XLSX, workbook.Sheets[name], name);
      XLSX.utils.book_append_sheet(next, sheet, safeName);
    }
    XLSX.writeFile(next, dest);
    outputs.push({
      sheet: names.join(","),
      path: dest,
      mode: names.length === 1 ? "single-sheet" : "multi-sheet",
    });
  }

  return {
    status: "success",
    runtime: "spreadsheets",
    source,
    outputs,
    wrote: outputs.map((item) => item.path),
    // Human markers so shell write-like scanners mint product cards for outputs only.
    message: outputs.map((item) => `Wrote ${item.path}`).join("\n"),
  };
}

function loadRowsFromJson(jsonPath) {
  const resolved = path.resolve(jsonPath);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`JSON rows file does not exist: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.rows)) return parsed.rows;
  throw new Error("JSON rows file must be an array or { rows: [...] }");
}

function loadRowsFromCsv(csvPath) {
  const resolved = path.resolve(csvPath);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`CSV file does not exist: ${resolved}`);
  }
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(resolved, { raw: false });
  const first = workbook.SheetNames[0];
  if (!first) throw new Error(`CSV has no sheets: ${resolved}`);
  return XLSX.utils.sheet_to_json(workbook.Sheets[first], {
    defval: "",
    raw: false,
    blankrows: false,
  });
}

/**
 * Create a business xlsx/csv deliverable from JSON rows or a CSV source.
 *
 * write-xlsx --out out.xlsx --sheet Name --json rows.json
 * write-xlsx --out out.xlsx --sheet Name --csv data.csv
 */
function writeXlsx(options = {}) {
  const XLSX = require("xlsx");
  const out = resolveOutputPath(options.out, "write-xlsx --out");
  const sheetName = (typeof options.sheet === "string" && options.sheet.trim())
    ? options.sheet.trim().slice(0, 31)
    : "Sheet1";
  const jsonPath = typeof options.json === "string" ? options.json.trim() : "";
  const csvPath = typeof options.csv === "string" ? options.csv.trim() : "";
  if (!jsonPath && !csvPath) {
    throw new Error("write-xlsx requires --json <rows.json> or --csv <file.csv>");
  }
  if (jsonPath && csvPath) {
    throw new Error("write-xlsx accepts only one of --json or --csv");
  }

  const rows = jsonPath ? loadRowsFromJson(jsonPath) : loadRowsFromCsv(csvPath);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("write-xlsx rows are empty");
  }

  let worksheet;
  if (Array.isArray(rows[0])) {
    worksheet = XLSX.utils.aoa_to_sheet(rows);
  } else if (rows[0] && typeof rows[0] === "object") {
    worksheet = XLSX.utils.json_to_sheet(rows);
  } else {
    throw new Error("write-xlsx rows must be objects or arrays");
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  ensureParentDir(out);
  XLSX.writeFile(workbook, out);

  return {
    status: "success",
    runtime: "spreadsheets",
    path: out,
    sheet: sheetName,
    row_count: rows.length,
    wrote: [out],
    message: `Wrote ${out}`,
  };
}

async function runSpreadsheetRuntime(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const command = flags.has("capabilities") ? "capabilities" : positional[0];
  try {
    if (command === "capabilities") {
      return emit({
        status: "ready",
        runtime: "spreadsheets",
        language: "javascript",
        capabilities: CAPABILITIES,
        commands: [...COMMANDS],
        runtime_root: process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT || null,
        deliverable_contract: {
          prefer_runtime_commands: ["extract-sheets", "write-xlsx", "read", "inspect", "verify"],
          helper_scripts_dir: ["os.tmpdir()", ".opencode/tmp/"],
          never_deliver: ["*.cjs helper scripts", "session-uploads originals"],
        },
      });
    }
    if (command === "doctor") {
      const dependencies = dependencyReport(DEPENDENCIES);
      const ready = Object.values(dependencies).every(Boolean);
      const runtimeRoot =
        process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT?.trim() || path.resolve(__dirname);
      return emit({
        status: ready ? "ready" : "degraded",
        runtime: "spreadsheets",
        language: "javascript",
        dependencies,
        capabilities: CAPABILITIES,
        commands: [...COMMANDS],
        runtime_root: runtimeRoot,
        node_modules: path.join(runtimeRoot, "node_modules"),
        node_path_hint: path.join(runtimeRoot, "node_modules"),
      }, ready ? 0 : 1);
    }
    if (command === "inspect") return emit(inspectSpreadsheet(positional[1]));
    if (command === "read") {
      return emit(
        readSpreadsheet(positional[1], {
          sheet: flags.get("sheet"),
          maxRows: flags.get("max-rows") ?? flags.get("maxRows"),
        }),
      );
    }
    if (command === "verify") return emit(verifySpreadsheet(positional[1]));
    if (command === "extract-sheets") {
      const result = extractSheets(positional[1], {
        sheet: flags.get("sheet"),
        sheets: flags.get("sheets"),
        all: flags.get("all"),
        out: flags.get("out"),
        outDir: flags.get("out-dir") ?? flags.get("outDir"),
      });
      // Also print human Wrote lines after JSON for shell scanners that only
      // regex free text (emit already JSON-stringifies the payload).
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.message) process.stdout.write(`${result.message}\n`);
      process.exitCode = 0;
      return result;
    }
    if (command === "write-xlsx") {
      const result = writeXlsx({
        out: flags.get("out"),
        sheet: flags.get("sheet"),
        json: flags.get("json"),
        csv: flags.get("csv"),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.message) process.stdout.write(`${result.message}\n`);
      process.exitCode = 0;
      return result;
    }
    throw new Error(
      `A command is required: ${COMMANDS.join(", ")}, or capabilities`,
    );
  } catch (error) {
    return emit({
      status: "error",
      runtime: "spreadsheets",
      error: error instanceof Error ? error.message : String(error),
    }, 1);
  }
}

module.exports = {
  extractSheets,
  inspectSpreadsheet,
  readSpreadsheet,
  runSpreadsheetRuntime,
  verifySpreadsheet,
  writeXlsx,
};

if (require.main === module) {
  void runSpreadsheetRuntime();
}
