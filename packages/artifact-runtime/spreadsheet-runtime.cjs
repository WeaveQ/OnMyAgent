"use strict";

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
]);
const EXTENSIONS = new Set([
  ".xlsx", ".xlsm", ".xlsb", ".xltx", ".xltm", ".xls", ".csv", ".tsv", ".ods",
]);
const FORMULA_ERRORS = ["#VALUE!", "#DIV/0!", "#REF!", "#NAME?", "#NULL!", "#NUM!", "#N/A"];
const DEPENDENCIES = ["exceljs", "xlsx", "jszip", "fast-xml-parser"];
const DEFAULT_MAX_ROWS = 500;
const HARD_MAX_ROWS = 5000;

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
      "Use `read` for content. For advanced edits write CommonJS scripts and run with NODE_PATH=$ONMYAGENT_ARTIFACT_RUNTIME_ROOT/node_modules.",
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
        commands: ["doctor", "inspect", "read", "verify"],
        runtime_root: process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT || null,
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
    throw new Error(
      "A command is required: capabilities, doctor, inspect, read, or verify",
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
  inspectSpreadsheet,
  readSpreadsheet,
  runSpreadsheetRuntime,
  verifySpreadsheet,
};

if (require.main === module) {
  void runSpreadsheetRuntime();
}
