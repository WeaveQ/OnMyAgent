"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readSpreadsheet, inspectSpreadsheet } = require("./spreadsheet-runtime.cjs");

const XLSX = require("xlsx");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oma-ss-"));
const file = path.join(dir, "t.xlsx");
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]),
  "S1",
);
XLSX.writeFile(wb, file);

const inspection = inspectSpreadsheet(file);
assert.equal(inspection.sheet_count, 1);
assert.equal(inspection.sheets[0].name, "S1");

const read = readSpreadsheet(file, { sheet: "S1" });
assert.equal(read.sheets.S1.row_count, 1);
assert.deepEqual(read.sheets.S1.rows[0], { a: "1", b: "2" });

assert.throws(() => readSpreadsheet(file, { sheet: "missing" }), /Sheet not found/);
console.log("spreadsheet-runtime.test.cjs ok");
