#!/usr/bin/env node
"use strict";

const path = require("node:path");

const runtimeRoot = process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT?.trim()
  || path.resolve(__dirname, "../../../../../../../../packages/artifact-runtime");
const { runSpreadsheetRuntime } = require(path.join(runtimeRoot, "spreadsheet-runtime.cjs"));

void runSpreadsheetRuntime();
