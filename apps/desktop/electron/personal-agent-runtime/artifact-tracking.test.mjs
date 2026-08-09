import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRunTimeoutMs, sanitizeAcpToolCallEvent } from "./artifact-tracking.mjs";

test("normalizeRunTimeoutMs keeps overnight turns within a finite 12-hour ceiling", () => {
  const twelveHours = 12 * 60 * 60 * 1000;
  assert.equal(normalizeRunTimeoutMs(undefined), twelveHours);
  assert.equal(normalizeRunTimeoutMs(60_000), 60_000);
  assert.equal(normalizeRunTimeoutMs(24 * 60 * 60 * 1000), twelveHours);
});

test("sanitizeAcpToolCallEvent preserves short output whitespace and marks long previews", () => {
  const shortOutput = "  indented\r\nline  \r\n";
  const shortEvent = sanitizeAcpToolCallEvent({
    type: "acp_tool_call",
    update: { rawOutput: shortOutput },
  });
  assert.equal(shortEvent.update.rawOutput, shortOutput);
  assert.equal(shortEvent.update.outputTruncated, undefined);

  const longEvent = sanitizeAcpToolCallEvent({
    type: "acp_tool_call",
    update: { rawOutput: { formatted_output: "x".repeat(5_000), exit_code: 0 } },
  });
  assert.equal(longEvent.update.outputTruncated, true);
  assert.equal(longEvent.truncated, true);
  assert.equal(longEvent.update.rawOutput.formatted_output.length < 4_100, true);
});

test("sanitizeAcpToolCallEvent bounds deeply nested and wide tool payloads", () => {
  const deepEvent = sanitizeAcpToolCallEvent({
    type: "acp_tool_call",
    update: { rawOutput: { a: { b: { huge: "x".repeat(250_000) } } } },
  });
  assert.equal(deepEvent.update.outputTruncated, true);
  assert.equal(deepEvent.truncated, true);
  assert.equal(JSON.stringify(deepEvent).length < 20_000, true);

  const wideEvent = sanitizeAcpToolCallEvent({
    type: "acp_tool_call",
    update: { content: Array.from({ length: 10_000 }, (_, index) => `item-${index}`) },
  });
  assert.equal(wideEvent.update.outputTruncated, true);
  assert.equal(wideEvent.truncated, true);
  assert.equal(wideEvent.update.content.length <= 256, true);
  assert.equal(JSON.stringify(wideEvent).length < 20_000, true);
});
