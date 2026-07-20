import { describe, expect, it } from "bun:test";
import { agentSubtitle } from "../src/react-app/domains/local-agents/host/personal-local-agent-page-helpers";
import type { PersonalLocalAgent } from "../src/app/lib/desktop";

function agent(overrides: Partial<PersonalLocalAgent> & { id: string }): PersonalLocalAgent {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    provider: overrides.provider ?? "custom",
    executablePath: overrides.executablePath ?? "/bin/agent",
    status: overrides.status ?? "online",
    version: overrides.version ?? null,
    connectionMode: overrides.connectionMode ?? null,
    error: overrides.error ?? null,
  } as PersonalLocalAgent;
}

describe("agentSubtitle", () => {
  it("shows compact version instead of Custom for online agents", () => {
    expect(
      agentSubtitle(
        agent({
          id: "grok",
          name: "Grok Build",
          version: "grok 0.2.106 (bde89716f679)",
          connectionMode: "Custom ACP session",
        }),
      ),
    ).toBe("0.2.106");
  });

  it("never surfaces bare Custom as the list version line", () => {
    expect(
      agentSubtitle(
        agent({
          id: "mimo",
          name: "MiMo Code",
          version: null,
          connectionMode: "Custom ACP session",
        }),
      ),
    ).not.toMatch(/custom/i);
  });

  it("keeps bare semver for agents that already report it", () => {
    expect(
      agentSubtitle(
        agent({
          id: "workbuddy",
          name: "WorkBuddy",
          version: "2.106.4",
          connectionMode: "WorkBuddy ACP session",
        }),
      ),
    ).toBe("2.106.4");
  });
});
