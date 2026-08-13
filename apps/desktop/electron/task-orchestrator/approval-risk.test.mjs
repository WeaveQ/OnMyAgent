import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvalGateDetails,
  operationDetails,
  sanitizeOperationParams,
} from "./approval-risk.mjs";

describe("task orchestrator approval risk", () => {
  it("keeps an ordinary local write careful with exact bounded operation details", () => {
    const details = approvalGateDetails({
      method: "fs/write_file",
      kind: "file_change",
      title: "Write the focused fixture",
      summary: "Update one local file.",
      command: "printf fixture > src/fixture.txt",
      cwd: "/tmp/workspace",
      readonly: false,
      params: {
        path: "src/fixture.txt",
        options: { encoding: "utf8" },
      },
    });

    assert.equal(details.kind, "personal-runtime-approval");
    assert.equal(details.risk, "careful");
    assert.deepEqual(details.operation, {
      method: "fs/write_file",
      kind: "file_change",
      command: "printf fixture > src/fixture.txt",
      cwd: "/tmp/workspace",
      params: [
        { name: "path", value: "src/fixture.txt" },
        { name: "options.encoding", value: "utf8" },
      ],
      diff: null,
      readOnly: false,
    });
  });

  it("marks read-only approvals safe unless the operation has external side effects", () => {
    assert.equal(approvalGateDetails({
      method: "fs/read_file",
      kind: "file_change",
      readonly: true,
      params: { path: "README.md" },
    }).risk, "safe");

    const outbound = approvalGateDetails({
      method: "network/request",
      kind: "command",
      command: "curl https://example.test/status",
      readonly: true,
    });
    assert.equal(outbound.risk, "destructive");
    assert.equal(outbound.kind, "high-risk-action");
    assert.equal(approvalGateDetails({
      method: "network/request",
      readonly: true,
    }).risk, "destructive");
  });

  it("classifies destructive files, pushes, deploys, publishes, and outbound messages", () => {
    const approvals = [
      { method: "shell", command: "rm -rf build/output" },
      { method: "shell", command: "git push --force-with-lease origin main" },
      { method: "shell", command: "pnpm publish --access public" },
      { method: "release/deploy", params: { environment: "production" } },
      { method: "slack/send_message", params: { channel: "ops", text: "ship it" } },
      { method: "fs/delete_file", kind: "file_change", params: { path: "old.txt" } },
      { method: "fs/apply_patch", kind: "file_change", diff: "--- a/old.txt\n+++ /dev/null" },
    ];

    for (const approval of approvals) {
      const details = approvalGateDetails(approval);
      assert.equal(details.risk, "destructive", JSON.stringify(approval));
      assert.equal(details.kind, "high-risk-action", JSON.stringify(approval));
    }
  });

  it("redacts secrets across display text and every persisted operation field", () => {
    const secret = "super-secret-value";
    const details = approvalGateDetails({
      method: "http/request?access_token=super-secret-value",
      kind: "command",
      title: "Use token=super-secret-value",
      summary: "Authorization: Bearer super-secret-value",
      command: "curl -H 'Authorization: Bearer super-secret-value' 'https://user:super-secret-value@example.test?api_key=super-secret-value'",
      cwd: "/tmp/password=super-secret-value",
      diff: "+ API_TOKEN=super-secret-value",
      params: {
        accessToken: secret,
        nested: { password: secret, visible: "ok" },
        headers: { Authorization: `Bearer ${secret}` },
      },
    });
    const persisted = JSON.stringify(details);

    assert.equal(persisted.includes(secret), false);
    assert.match(persisted, /\[REDACTED\]/);
    assert.deepEqual(
      details.operation.params.filter((entry) => /token|password|authorization/i.test(entry.name)),
      [
        { name: "accessToken", value: "[REDACTED]" },
        { name: "nested.password", value: "[REDACTED]" },
        { name: "headers.Authorization", value: "[REDACTED]" },
      ],
    );
  });

  it("bounds flattened params and safely handles circular or pathological values", () => {
    const circular = { visible: "ok" };
    circular.self = circular;
    for (let index = 0; index < 80; index += 1) circular[`key-${index}`] = "x".repeat(5_000);
    const params = sanitizeOperationParams(circular);

    assert.equal(params.length, 50);
    assert.equal(params.some((entry) => entry.value === "[Circular]"), true);
    assert.equal(params.every((entry) => entry.name.length <= 160), true);
    assert.equal(params.every((entry) => entry.value.length <= 4_000), true);

    const operation = operationDetails({
      method: "m".repeat(200),
      command: "c".repeat(9_000),
      cwd: "w".repeat(5_000),
      diff: "d".repeat(25_000),
      params: { missing: undefined, symbol: Symbol("safe") },
    });
    assert.equal(operation.method.length, 120);
    assert.equal(operation.command.length, 8_000);
    assert.equal(operation.cwd.length, 4_096);
    assert.equal(operation.diff.length, 24_000);
    assert.deepEqual(operation.params, [
      { name: "missing", value: "[undefined]" },
      { name: "symbol", value: "Symbol(safe)" },
    ]);
  });

  it("redacts a long PEM even when its END marker is beyond the output and scan window", () => {
    const marker = "LONG_PRIVATE_KEY_SECRET_MARKER";
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      marker,
      "x".repeat(70_000),
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const redacted = approvalGateDetails({
      title: "Inspect key",
      summary: pem,
      readonly: true,
    }).summary;

    assert.equal(redacted.includes(marker), false);
    assert.equal(redacted.includes("BEGIN PRIVATE KEY"), false);
    assert.match(redacted, /\[REDACTED\]/);
  });
});
