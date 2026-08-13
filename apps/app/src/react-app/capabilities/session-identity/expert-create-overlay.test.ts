import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expireExpertCreateOverlay,
  mergeExpertIdentityWithOverlay,
} from "./expert-create-overlay";

describe("expireExpertCreateOverlay", () => {
  it("drops overlay ids once the projection includes that session", () => {
    const next = expireExpertCreateOverlay(
      [{ sessionId: "ses-new", agentId: "agent-a" }],
      new Set(["ses-new"]),
    );
    assert.deepEqual(next, []);
  });

  it("keeps overlay ids that are not in the projection", () => {
    const next = expireExpertCreateOverlay(
      [{ sessionId: "ses-new", agentId: "agent-a" }],
      new Set(["ses-old"]),
    );
    assert.deepEqual(next, [{ sessionId: "ses-new", agentId: "agent-a" }]);
  });
});

describe("mergeExpertIdentityWithOverlay", () => {
  it("contributes overlay ids that are not yet in the projection", () => {
    const merged = mergeExpertIdentityWithOverlay({
      sessionIds: new Set(["ses-old"]),
      agentIdBySessionId: new Map([["ses-old", "agent-old"]]),
      overlay: [{ sessionId: "ses-new", agentId: "agent-a" }],
    });
    assert.equal(merged.agentIdBySessionId.get("ses-new"), "agent-a");
    assert.equal(merged.sessionIds.has("ses-old"), true);
    assert.equal(merged.sessionIds.has("ses-new"), true);
  });

  it("does not treat overlay as live after the projection includes the session", () => {
    const merged = mergeExpertIdentityWithOverlay({
      sessionIds: new Set(["ses-new"]),
      agentIdBySessionId: new Map([["ses-new", "agent-a"]]),
      overlay: [{ sessionId: "ses-new", agentId: "stale-agent" }],
    });
    assert.equal(merged.agentIdBySessionId.get("ses-new"), "agent-a");
    assert.deepEqual([...merged.sessionIds], ["ses-new"]);
  });
});
