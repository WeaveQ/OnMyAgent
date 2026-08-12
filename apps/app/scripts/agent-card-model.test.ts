import { describe, expect, it } from "bun:test";
import { agentDisplayStatus } from "../src/react-app/domains/local-agents/agent-management/agent-card-model";

describe("agentDisplayStatus R1/R2", () => {
  it("maps missing status to missing", () => {
    expect(agentDisplayStatus({ status: "missing" })).toBe("missing");
  });

  it("maps offline + missing_binary errorInfo to missing", () => {
    expect(
      agentDisplayStatus({
        status: "offline",
        error: "spawn claude ENOENT",
        errorInfo: { code: "missing_binary" },
      }),
    ).toBe("missing");
  });

  it("keeps offline ACP failures as offline (installed)", () => {
    expect(
      agentDisplayStatus({
        status: "offline",
        error: "ACP handshake failed: session/new",
      }),
    ).toBe("offline");
  });

  it("keeps online and needs_auth", () => {
    expect(agentDisplayStatus({ status: "online" })).toBe("online");
    expect(agentDisplayStatus({ status: "needs_auth" })).toBe("needs_auth");
  });

  it("online list status wins over stale needs_auth healthResults", () => {
    expect(
      agentDisplayStatus(
        { status: "online" },
        {
          status: "needs_auth",
          at: Date.now(),
          runId: null,
          output: "authentication required",
          error: "login",
        },
      ),
    ).toBe("online");
  });

  it("passed health still lifts offline/needs_auth agent to online", () => {
    expect(
      agentDisplayStatus(
        { status: "needs_auth" },
        {
          status: "passed",
          at: Date.now(),
          runId: null,
          output: "ok",
          error: null,
        },
      ),
    ).toBe("online");
  });
});
