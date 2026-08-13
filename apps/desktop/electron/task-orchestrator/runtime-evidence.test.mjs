import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runtimeEvidence } from "./runtime-evidence.mjs";

describe("task orchestrator runtime evidence", () => {
  it("deduplicates terminal tool updates without treating agent prose as observed evidence", () => {
    const evidence = runtimeEvidence({
      events: [
        {
          type: "tool",
          text: "start",
          toolCall: {
            id: "command-1",
            name: "Bash",
            kind: "execute",
            status: "running",
            input: "pnpm check:type",
          },
        },
        {
          type: "tool",
          text: "complete",
          toolCall: {
            id: "command-1",
            name: "Bash",
            status: "completed",
            output: "typecheck passed",
            exitCode: 0,
          },
        },
        {
          type: "acp_tool_call",
          text: "test failed",
          update: {
            tool_call_id: "test-1",
            title: "Test runner",
            kind: "execute",
            status: "failed",
            raw_input: { command: "pnpm test" },
            rawOutput: { formatted_output: "first attempt failed", exit_code: 5 },
          },
        },
        {
          type: "acp_tool_call",
          text: "test passed",
          update: {
            tool_call_id: "test-1",
            title: "Test runner",
            status: "completed",
            output: "second attempt passed",
          },
        },
        { type: "assistant", text: "I ran 900 tests and they all passed." },
        { type: "tool", text: "unstructured tool prose without an id" },
      ],
      fileChanges: [{ filePath: "src/feature.ts" }],
      artifacts: [],
    });

    assert.equal(evidence.length, 3);
    const command = evidence.find((item) => item.label.startsWith("Bash"));
    assert.equal(command.kind, "command");
    assert.equal(command.status, "passed");
    assert.equal(command.exitCode, 0);
    assert.match(command.value, /pnpm check:type/);
    const test = evidence.find((item) => item.label.startsWith("Test runner"));
    assert.equal(test.kind, "test");
    assert.equal(test.status, "passed");
    assert.equal(test.exitCode, null);
    assert.match(test.value, /pnpm test/);
    assert.match(test.value, /second attempt passed/);
    assert.equal(evidence.some((item) => item.value.includes("900 tests")), false);
    assert.equal(evidence.filter((item) => item.provenance === "runtime-observed").length, 3);
  });

  it("never fails stage completion for undefined or circular runtime values", () => {
    const circular = { path: "src/circular.ts" };
    Object.assign(circular, { self: circular });
    assert.doesNotThrow(() => runtimeEvidence({
      events: [],
      fileChanges: [undefined, circular],
      artifacts: [undefined, circular],
    }));
    const evidence = runtimeEvidence({
      events: [],
      fileChanges: [undefined, circular],
      artifacts: [undefined, circular],
    });
    assert.equal(evidence.length, 4);
    assert.equal(evidence.some((item) => item.value === "[object Object]"), true);
  });

  it("redacts terminal IO, file diffs, paths, and runtime artifacts before returning evidence", () => {
    const marker = "RUNTIME_EVIDENCE_SECRET_MARKER_42";
    const evidence = runtimeEvidence({
      events: [{
        type: "tool",
        toolCall: {
          id: "secret-command",
          name: "Bash",
          kind: "execute",
          status: "completed",
          input: `curl -H 'Authorization: Bearer ${marker}' https://example.test`,
          output: `response api_key=${marker}`,
          exitCode: 0,
        },
      }],
      fileChanges: [{
        filePath: `/tmp/password=${marker}/changed.txt`,
        diff: `+ password=${marker}`,
        tool: "edit",
      }],
      artifacts: [{
        name: `report token=${marker}`,
        path: `/tmp/api_key=${marker}/report.txt`,
        metadata: { authorization: `Bearer ${marker}` },
      }],
    });

    assert.equal(JSON.stringify(evidence).includes(marker), false);
    assert.equal(evidence.every((item) => !item.label.includes(marker)), true);
    assert.equal(evidence.every((item) => !item.value.includes(marker)), true);
    assert.equal(evidence.every((item) => !item.path?.includes(marker)), true);
    assert.match(JSON.stringify(evidence), /\[REDACTED\]/);
  });
});
