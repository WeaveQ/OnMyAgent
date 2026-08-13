import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectOfficeCliDeliverablePaths,
  formatOfficeCliDeliverableMarkers,
  materializeDeliverablesIntoSession,
  parseOfficeCliArgv,
  resolveOfficeCliSessionDeliverables,
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

test("materializeDeliverablesIntoSession copies outside-session edits into cwd", () => {
  const sessionCwd = "/tmp/oma-expert-session";
  const uploadPath = "/tmp/oma-uploads/template.docx";
  const copied = [];
  const paths = materializeDeliverablesIntoSession(
    [uploadPath],
    sessionCwd,
    {
      exists: (p) => p === uploadPath || p === `${sessionCwd}/template.docx`,
      stat: () => ({ isFile: () => true }),
      copyFile: (src, dest) => {
        copied.push([src, dest]);
      },
    },
  );
  assert.deepEqual(copied, [[uploadPath, `${sessionCwd}/template.docx`]]);
  assert.deepEqual(paths, ["template.docx"]);
});

test("materializeDeliverablesIntoSession keeps in-session paths relative", () => {
  const sessionCwd = "/tmp/oma-expert-session";
  const paths = materializeDeliverablesIntoSession(
    [`${sessionCwd}/合同输出/a.docx`, "合同输出/b.docx"],
    sessionCwd,
    {
      exists: () => true,
      stat: () => ({ isFile: () => true }),
      copyFile: () => {
        throw new Error("should not copy in-session files");
      },
    },
  );
  assert.deepEqual(paths, ["合同输出/a.docx", "合同输出/b.docx"]);
});

test("resolveOfficeCliSessionDeliverables marks merge output under session", () => {
  const sessionCwd = "/tmp/oma-expert-session";
  const { paths, markers } = resolveOfficeCliSessionDeliverables({
    argv: ["merge", "t.docx", `${sessionCwd}/合同输出/out.docx`, "--data", "r.json"],
    stdout: "Merged 1 key(s)\n",
    exitCode: 0,
    sessionCwd,
  });
  assert.deepEqual(paths, ["合同输出/out.docx"]);
  assert.match(markers, /ONMYAGENT_DELIVERABLE: 合同输出\/out\.docx/);
});
