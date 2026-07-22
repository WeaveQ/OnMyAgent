#!/usr/bin/env node
"use strict";

const path = require("node:path");

const runtimeRoot = process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT?.trim()
  || path.resolve(__dirname, "../../../../../../packages/artifact-runtime");
const { runPresentationRuntime } = require(path.join(runtimeRoot, "presentation-runtime.cjs"));

void runPresentationRuntime();
