import { describe, expect, it } from "bun:test";
import {
  agentDisplayStatus,
  classifyAgentAvailability,
} from "../src/react-app/domains/local-agents/agent-management/agent-card-model";

describe("classifyAgentAvailability R1/R2", () => {
  it("maps missing status to missing", () => {
    expect(classifyAgentAvailability({ status: "missing" })).toBe("missing");
  });

  it("maps offline + missing_binary errorInfo to missing", () => {
    expect(
      classifyAgentAvailability({
        status: "offline",
        error: "spawn claude ENOENT",
        errorInfo: { code: "missing_binary" },
      }),
    ).toBe("missing");
  });

  it("keeps offline ACP failures as offline (installed)", () => {
    expect(
      classifyAgentAvailability({
        status: "offline",
        error: "ACP handshake failed: session/new",
      }),
    ).toBe("offline");
  });

  it("keeps online and needs_auth", () => {
    expect(classifyAgentAvailability({ status: "online" })).toBe("online");
    expect(classifyAgentAvailability({ status: "needs_auth" })).toBe(
      "needs_auth",
    );
  });

  it("live detect online is never overridden by persisted needs_auth/failed", () => {
    expect(
      classifyAgentAvailability(
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
    expect(
      classifyAgentAvailability(
        { status: "online" },
        {
          status: "failed",
          at: Date.now(),
          runId: null,
          output: "boom",
          error: "offline",
        },
      ),
    ).toBe("online");
  });

  it("passed stored test still lifts offline/needs_auth detect to online", () => {
    expect(
      classifyAgentAvailability(
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

  it("agentDisplayStatus stays an alias of the shipped classifier", () => {
    expect(agentDisplayStatus({ status: "missing" })).toBe(
      classifyAgentAvailability({ status: "missing" }),
    );
  });
});
