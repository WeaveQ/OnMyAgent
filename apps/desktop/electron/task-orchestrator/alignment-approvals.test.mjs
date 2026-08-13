import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isContractProposalApproval, taskControlMcpCallForApproval } from "./alignment-approvals.mjs";

function fixture() {
  const workspaceRoot = "/tmp/task-center-alignment-approval";
  const toolCallId = "contract-call-1";
  return {
    task: { workspaceRoot, primary: { provider: "codex" } },
    approval: {
      id: "approval-1",
      provider: "codex",
      method: "session/request_permission",
      kind: "command",
      command: null,
      cwd: workspaceRoot,
      params: { toolCall: { toolCallId }, _meta: { is_mcp_tool_approval: true } },
    },
    snapshot: {
      events: [{
        type: "acp_tool_call",
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          rawInput: { server: "onmyagent-task-control", tool: "propose_contract", arguments: {} },
          _meta: { is_mcp_tool_call: true },
        },
      }],
    },
  };
}

describe("alignment contract approval classifier", () => {
  it("accepts only the exact task-scoped propose_contract call", () => {
    const valid = fixture();
    assert.equal(isContractProposalApproval(valid.task, valid.snapshot, valid.approval), true);
    assert.equal(taskControlMcpCallForApproval({ provider: "codex", workspaceRoot: valid.task.workspaceRoot }, valid.snapshot, valid.approval).tool, "propose_contract");

    for (const mutate of [
      (entry) => { entry.approval.cwd = "/tmp/outside"; },
      (entry) => { entry.approval.command = "cat /etc/passwd"; },
      (entry) => { entry.approval.params._meta.is_mcp_tool_approval = false; },
      (entry) => { entry.snapshot.events[0].update.rawInput.tool = "spawn_agent"; },
      (entry) => { entry.snapshot.events[0].update.rawInput.server = "untrusted-server"; },
      (entry) => { entry.snapshot.events[0].update.toolCallId = "different-call"; },
    ]) {
      const unsafe = fixture();
      mutate(unsafe);
      assert.equal(isContractProposalApproval(unsafe.task, unsafe.snapshot, unsafe.approval), false);
    }
  });
});
