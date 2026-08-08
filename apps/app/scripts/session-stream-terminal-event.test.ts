import { describe, expect, it } from "bun:test";

import { isTerminalSessionStreamEvent } from "../src/react-app/domains/session/sync/usechat-adapter";

describe("session stream terminal events", () => {
  it("finishes for the legacy session.idle event", () => {
    expect(isTerminalSessionStreamEvent({
      type: "session.idle",
      properties: { sessionID: "ses_target" },
    }, "ses_target")).toBe(true);
  });

  it("finishes for the current session.status idle event", () => {
    expect(isTerminalSessionStreamEvent({
      type: "session.status",
      properties: { sessionID: "ses_target", status: { type: "idle" } },
    }, "ses_target")).toBe(true);
  });

  it("does not finish while the session is busy or retrying", () => {
    expect(isTerminalSessionStreamEvent({
      type: "session.status",
      properties: { sessionID: "ses_target", status: { type: "busy" } },
    }, "ses_target")).toBe(false);
    expect(isTerminalSessionStreamEvent({
      type: "session.status",
      properties: { sessionID: "ses_target", status: { type: "retry" } },
    }, "ses_target")).toBe(false);
  });

  it("ignores terminal events from another session", () => {
    expect(isTerminalSessionStreamEvent({
      type: "session.status",
      properties: { sessionID: "ses_other", status: { type: "idle" } },
    }, "ses_target")).toBe(false);
  });
});
