import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectOfficeCliDeliverablePaths,
  formatOfficeCliDeliverableMarkers,
  parseOfficeCliArgv,
} from "./officecli-deliverable.mjs";

test("parseOfficeCliArgv finds create file path", () => {
  assert.deepEqual(parseOfficeCliArgv(["create", "report.docx"]), {
    verb: "create",
    file: "report.docx",
  });
  assert.deepEqual(parseOfficeCliArgv(["--json", "create", "deck.pptx", "--force"]), {
    verb: "create",
    file: "deck.pptx",
  });
});

test("parseOfficeCliArgv finds set/add document path", () => {
  assert.deepEqual(
    parseOfficeCliArgv([
      "set",
      "data.xlsx",
      "/Sheet1/A1",
      "--prop",
      "value=Name",
    ]),
    { verb: "set", file: "data.xlsx" },
  );
});

test("collectOfficeCliDeliverablePaths emits create path on success", () => {
  const paths = collectOfficeCliDeliverablePaths({
    argv: ["create", "report.docx"],
    stdout: "Created: report.docx (kept open in background for faster subsequent commands)\n",
    exitCode: 0,
  });
  assert.deepEqual(paths, ["report.docx"]);
  assert.match(
    formatOfficeCliDeliverableMarkers(paths),
    /ONMYAGENT_DELIVERABLE: report\.docx/,
  );
});

test("collectOfficeCliDeliverablePaths skips failed runs and read-only verbs", () => {
  assert.deepEqual(
    collectOfficeCliDeliverablePaths({
      argv: ["create", "report.docx"],
      stdout: "error",
      exitCode: 1,
    }),
    [],
  );
  assert.deepEqual(
    collectOfficeCliDeliverablePaths({
      argv: ["get", "report.docx", "/body"],
      stdout: "ok",
      exitCode: 0,
    }),
    [],
  );
});

test("collectOfficeCliDeliverablePaths reads Created path from JSON stdout", () => {
  const paths = collectOfficeCliDeliverablePaths({
    argv: ["create", "out.pptx", "--json"],
    stdout: `${JSON.stringify({
      success: true,
      message: "Created: /tmp/out.pptx (kept open)",
    })}\n`,
    exitCode: 0,
  });
  assert.ok(paths.includes("out.pptx") || paths.some((p) => p.endsWith("out.pptx")));
});

test("parseOfficeCliArgv merge uses output path not template", () => {
  assert.deepEqual(
    parseOfficeCliArgv([
      "merge",
      "批准模板.docx",
      "合同输出/返点合同_A.docx",
      "--data",
      "row.json",
      "--force",
    ]),
    {
      verb: "merge",
      file: "合同输出/返点合同_A.docx",
      template: "批准模板.docx",
    },
  );
});

test("collectOfficeCliDeliverablePaths registers merge output from argv", () => {
  const paths = collectOfficeCliDeliverablePaths({
    argv: [
      "merge",
      "template.docx",
      "output/合同.docx",
      "--data",
      "row.json",
      "--force",
    ],
    stdout: "Merged 3 key(s)\n",
    exitCode: 0,
  });
  assert.deepEqual(paths, ["output/合同.docx"]);
  assert.match(
    formatOfficeCliDeliverableMarkers(paths),
    /ONMYAGENT_DELIVERABLE: output\/合同\.docx/,
  );
});

test("collectOfficeCliDeliverablePaths reads merge data.output from JSON", () => {
  const paths = collectOfficeCliDeliverablePaths({
    argv: ["merge", "t.docx", "out.docx", "--data", "{}", "--json"],
    stdout: `${JSON.stringify({
      success: true,
      data: { output: "/ws/experts/agent/ses/out.docx", replacedKeys: 3 },
      message: "Merged 3 key(s)",
    })}\n`,
    exitCode: 0,
  });
  assert.ok(paths.some((p) => p.endsWith("out.docx")));
  assert.ok(paths.includes("out.docx") || paths.some((p) => p.includes("/out.docx")));
});
