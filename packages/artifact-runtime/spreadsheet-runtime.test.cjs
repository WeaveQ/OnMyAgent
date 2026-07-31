"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  extractSheets,
  inspectSpreadsheet,
  readSpreadsheet,
  writeXlsx,
} = require("./spreadsheet-runtime.cjs");

const XLSX = require("xlsx");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oma-ss-"));
const file = path.join(dir, "source.xlsx");
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]),
  "发货需求",
);
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([["c"], [3]]),
  "报价补充",
);
XLSX.writeFile(wb, file);

const inspection = inspectSpreadsheet(file);
assert.equal(inspection.sheet_count, 2);
assert.equal(inspection.sheets[0].name, "发货需求");

const read = readSpreadsheet(file, { sheet: "发货需求" });
assert.equal(read.sheets["发货需求"].row_count, 1);
assert.deepEqual(read.sheets["发货需求"].rows[0], { a: "1", b: "2" });

assert.throws(() => readSpreadsheet(file, { sheet: "missing" }), /Sheet not found/);

const singleOut = path.join(dir, "发货需求.xlsx");
const extractedOne = extractSheets(file, { sheet: "发货需求", out: singleOut });
assert.equal(extractedOne.status, "success");
assert.equal(extractedOne.deliverable, true);
assert.equal(extractedOne.outputs.length, 1);
assert.equal(extractedOne.outputs[0].path, singleOut);
assert.deepEqual(extractedOne.wrote, [singleOut]);
assert.ok(fs.existsSync(singleOut));
assert.match(extractedOne.message, /Wrote /);

const outDir = path.join(dir, "split");
const extractedMany = extractSheets(file, {
  sheets: "发货需求,报价补充",
  outDir,
});
assert.equal(extractedMany.outputs.length, 2);
assert.ok(fs.existsSync(path.join(outDir, "发货需求.xlsx")));
assert.ok(fs.existsSync(path.join(outDir, "报价补充.xlsx")));

const rowsJson = path.join(dir, "rows.json");
fs.writeFileSync(
  rowsJson,
  JSON.stringify([{ 品名: "冻货", 重量kg: 1200 }, { 品名: "干货", 重量kg: 800 }]),
  "utf8",
);
const written = path.join(dir, "新建报价.xlsx");
const created = writeXlsx({
  out: written,
  sheet: "报价",
  json: rowsJson,
});
assert.equal(created.status, "success");
assert.equal(created.deliverable, true);
assert.deepEqual(created.wrote, [written]);
assert.ok(fs.existsSync(written));
const roundTrip = readSpreadsheet(written, { sheet: "报价" });
assert.equal(roundTrip.sheets["报价"].row_count, 2);

// CLI path must print ONMYAGENT_DELIVERABLE markers for product-card registration.
const { spawnSync } = require("node:child_process");
const cli = spawnSync(
  process.execPath,
  [
    path.join(__dirname, "spreadsheet-runtime.cjs"),
    "write-xlsx",
    "--out",
    path.join(dir, "cli-deliverable.xlsx"),
    "--sheet",
    "报价",
    "--json",
    rowsJson,
  ],
  { encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
assert.match(cli.stdout, /ONMYAGENT_DELIVERABLE:/);
assert.match(cli.stdout, /cli-deliverable\.xlsx/);
assert.match(cli.stdout, /"deliverable":true/);

console.log("spreadsheet-runtime.test.cjs ok");
