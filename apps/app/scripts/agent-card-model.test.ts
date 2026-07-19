import { describe, expect, it } from "bun:test";
import {
  formatAgentVersionDisplay,
  agentVersionLabel,
} from "../src/react-app/domains/local-agents/agent-management/agent-card-model";
import type { AgentManagementAgent } from "../src/app/lib/desktop";

function agent(overrides: Partial<AgentManagementAgent> & { id: string }): AgentManagementAgent {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    provider: overrides.provider ?? "custom",
    version: overrides.version ?? null,
    executablePath: overrides.executablePath ?? null,
  } as AgentManagementAgent;
}

describe("formatAgentVersionDisplay", () => {
  it("extracts compact semver from long product strings", () => {
    expect(formatAgentVersionDisplay("Hermes Agent v0.13.0 (2026.5.7)")).toBe("v0.13.0");
    expect(formatAgentVersionDisplay("Hermes Agent 0.13.0 (2026.5.7)")).toBe("v0.13.0");
  });

  it("normalizes bare semver with a v prefix", () => {
    expect(formatAgentVersionDisplay("1.17.8")).toBe("v1.17.8");
    expect(formatAgentVersionDisplay("v2.0.1")).toBe("v2.0.1");
  });

  it("keeps short prerelease tags", () => {
    expect(formatAgentVersionDisplay("1.0.0-beta.1")).toBe("v1.0.0-beta.1");
  });

  it("returns null for empty input", () => {
    expect(formatAgentVersionDisplay("")).toBeNull();
    expect(formatAgentVersionDisplay(null)).toBeNull();
  });
});

describe("agentVersionLabel", () => {
  it("uses formatted version when present", () => {
    expect(
      agentVersionLabel(agent({ id: "hermes", version: "Hermes Agent v0.13.0 (2026.5.7)" })),
    ).toBe("v0.13.0");
  });

  it("skips executable basename that only repeats agent id", () => {
    expect(
      agentVersionLabel(agent({ id: "claude", name: "Claude Code", executablePath: "/usr/bin/claude" })),
    ).toBeNull();
  });

  it("keeps path basename when it looks like a version", () => {
    expect(
      agentVersionLabel(agent({ id: "tool", name: "Tool", executablePath: "/opt/tool-1.2.3" })),
    ).toBe("v1.2.3");
  });
});
