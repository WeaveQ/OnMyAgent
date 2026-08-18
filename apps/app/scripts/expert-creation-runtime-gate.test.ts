import { describe, expect, test } from "bun:test";
import type { OnMyAgentServerClient } from "../src/app/lib/onmyagent-server";
import { supportsNewExpertCreationSession } from "../src/react-app/capabilities/agent-runtime/expert-creation-gate";

function clientWithSelection(
  defaultRuntimeKind: "opencode" | "grok-build",
  workspaceOverrides: Record<string, "opencode" | "grok-build"> = {},
): OnMyAgentServerClient {
  return {
    getAgentRuntimeSelection: async () => ({
      revision: 1,
      config: {
        version: 1,
        revision: 1,
        defaultRuntimeKind,
        workspaceOverrides,
      },
    }),
  } as OnMyAgentServerClient;
}

describe("expert creation runtime gate", () => {
  test("allows OpenCode and fails closed for Grok before native session creation", async () => {
    expect(await supportsNewExpertCreationSession(
      clientWithSelection("opencode"),
      "workspace",
    )).toBe(true);
    expect(await supportsNewExpertCreationSession(
      clientWithSelection("grok-build"),
      "workspace",
    )).toBe(false);
  });

  test("uses the workspace override instead of the global default", async () => {
    expect(await supportsNewExpertCreationSession(
      clientWithSelection("opencode", { workspace: "grok-build" }),
      "workspace",
    )).toBe(false);
    expect(await supportsNewExpertCreationSession(
      clientWithSelection("grok-build", { workspace: "opencode" }),
      "workspace",
    )).toBe(true);
  });
});
