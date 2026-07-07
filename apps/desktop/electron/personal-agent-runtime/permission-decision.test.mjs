// HR2-A-05 unblock: ACP RequestPermissionResponse must wrap the selected
// optionId inside `outcome`, otherwise Claude/Codex ACP treats the answer as
// cancelled and reports "User refused permission to run tool".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { __test__ as acpGenericTest } from "./adapters/acp-generic.mjs";

const { permissionDecisionPayload } = acpGenericTest;

describe("permissionDecisionPayload", () => {
  it("wraps Claude Edit approval in outcome.selected using kind allow_once", () => {
    const params = {
      options: [
        { kind: "allow_always", name: "Always", optionId: "allow_always" },
        { kind: "allow_once", name: "Allow", optionId: "allow" },
        { kind: "reject_once", name: "Reject", optionId: "reject" },
      ],
    };
    const payload = permissionDecisionPayload(params, "accept");
    assert.deepEqual(payload.outcome, { outcome: "selected", optionId: "allow" });
    assert.equal(payload.optionId, "allow");
  });

  it("prefers allow_always for acceptForSession", () => {
    const params = {
      options: [
        { kind: "allow_always", name: "Always", optionId: "allow_always" },
        { kind: "allow_once", name: "Allow", optionId: "allow" },
        { kind: "reject_once", name: "Reject", optionId: "reject" },
      ],
    };
    const payload = permissionDecisionPayload(params, "acceptForSession");
    assert.deepEqual(payload.outcome, { outcome: "selected", optionId: "allow_always" });
  });

  it("maps decline to reject_once when available", () => {
    const params = {
      options: [
        { kind: "allow_once", name: "Allow", optionId: "allow" },
        { kind: "reject_once", name: "Reject", optionId: "reject" },
      ],
    };
    const payload = permissionDecisionPayload(params, "decline");
    assert.deepEqual(payload.outcome, { outcome: "selected", optionId: "reject" });
  });

  it("falls back to outcome.cancelled when no matching option exists", () => {
    const payload = permissionDecisionPayload({ options: [] }, "decline");
    assert.deepEqual(payload.outcome, { outcome: "cancelled" });
  });

  it("supports legacy Hermes/generic options with plain ids", () => {
    const params = {
      options: [
        { optionId: "reject", label: "Reject" },
        { optionId: "approve", label: "Approve" },
        { optionId: "approve_for_session", label: "Approve for session" },
      ],
    };
    const accept = permissionDecisionPayload(params, "accept");
    assert.equal(accept.outcome.optionId, "approve");
    const acceptSession = permissionDecisionPayload(params, "acceptForSession");
    assert.equal(acceptSession.outcome.optionId, "approve_for_session");
    const decline = permissionDecisionPayload(params, "decline");
    assert.equal(decline.outcome.optionId, "reject");
  });
});
