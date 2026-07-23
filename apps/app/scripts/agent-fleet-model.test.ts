import { describe, expect, it } from "bun:test";
import type { AgentManagementAgent } from "../src/app/lib/desktop";
import {
  AUTO_MANAGE_AGENT_KEYS,
  collectUnavailableSkillAgents,
  isAutoManageKey,
  isDiscoverCandidate,
  isManagedFleetMember,
  isRuntimeFleetPickerAgent,
  isSkillAgentConfigTarget,
  partitionAgentsForFleet,
  shouldAutoAdoptToStore,
  visibleFleetConfigAgentKeys,
  visibleFleetSidebarAgents,
  visibleSkillMatrixAgents,
} from "../src/react-app/domains/local-agents/agent-management/agent-fleet-model";

type AgentFixture = Partial<AgentManagementAgent> & {
  id: string;
  agent_source?: string;
  nativeSkillsDirs?: string[];
};

function agent(overrides: AgentFixture): AgentManagementAgent {
  const {
    id,
    name = id,
    provider = "custom",
    status = "online",
    error = null,
    discoverable,
    agent_source,
    executablePath = "/usr/bin/tool",
    enabled = true,
    usage = { runs: 0 } as AgentManagementAgent["usage"],
    nativeSkillsDirs,
    ...rest
  } = overrides;
  return {
    id,
    name,
    provider,
    status,
    error,
    discoverable,
    agent_source,
    executablePath,
    enabled: enabled !== false,
    usage,
    nativeSkillsDirs,
    ...rest,
  } as AgentManagementAgent;
}

describe("AUTO_MANAGE_AGENT_KEYS", () => {
  it("still lists product skill-order keys (legacy helper; option 2 adopts all installed catalog)", () => {
    for (const key of ["opencode", "claude", "codex", "hermes", "openclaw", "gemini"]) {
      expect(isAutoManageKey(key)).toBe(true);
      expect(AUTO_MANAGE_AGENT_KEYS.includes(key as (typeof AUTO_MANAGE_AGENT_KEYS)[number])).toBe(true);
    }
    // Keys outside the historical set remain non-autoManageKey, but can still
    // enter the fleet when installed (see isManagedFleetMember option 2).
    expect(isAutoManageKey("snow")).toBe(false);
    expect(isAutoManageKey("trae")).toBe(false);
  });
});

describe("isManagedFleetMember", () => {
  it("puts installed product agents in the fleet", () => {
    const opencode = agent({ id: "opencode", provider: "opencode", status: "online", discoverable: false });
    expect(isManagedFleetMember(opencode)).toBe(true);
  });

  it("keeps missing product agents out of the fleet (discover)", () => {
    const claude = agent({ id: "claude", provider: "claude", status: "missing", discoverable: false });
    expect(isManagedFleetMember(claude)).toBe(false);
    expect(isDiscoverCandidate(claude)).toBe(true);
  });

  it("treats installed store-owned (mine) agents as managed", () => {
    const grok = agent({
      id: "grok",
      provider: "custom",
      status: "online",
      discoverable: false,
      agent_source: "custom",
    });
    expect(isManagedFleetMember(grok)).toBe(true);
    expect(isDiscoverCandidate(grok)).toBe(false);
  });

  it("kicks missing store-owned agents out of fleet into discover", () => {
    const broken = agent({
      id: "example-acp",
      provider: "custom",
      status: "missing",
      error: "spawn codex ENOENT",
      discoverable: false,
      agent_source: "custom",
    });
    expect(isManagedFleetMember(broken)).toBe(false);
    expect(isDiscoverCandidate(broken)).toBe(true);
  });

  it("keeps offline (installed) store agents in the fleet", () => {
    const offline = agent({
      id: "workbuddy",
      provider: "custom",
      status: "offline",
      discoverable: false,
      agent_source: "custom",
    });
    expect(isManagedFleetMember(offline)).toBe(true);
    expect(isDiscoverCandidate(offline)).toBe(false);
  });

  it("treats installed catalog drafts as fleet members (option 2)", () => {
    const gemini = agent({
      id: "gemini",
      provider: "custom",
      status: "online",
      discoverable: true,
    });
    expect(isManagedFleetMember(gemini)).toBe(true);
    expect(shouldAutoAdoptToStore(gemini)).toBe(true);
  });

  it("R3 option 2: any installed catalog (e.g. snow/workbuddy) enters fleet + auto-adopt", () => {
    const snow = agent({
      id: "snow",
      provider: "custom",
      status: "online",
      discoverable: true,
    });
    expect(isManagedFleetMember(snow)).toBe(true);
    expect(isDiscoverCandidate(snow)).toBe(false);
    expect(shouldAutoAdoptToStore(snow)).toBe(true);

    const workbuddy = agent({
      id: "workbuddy",
      provider: "custom",
      status: "online",
      discoverable: true,
    });
    expect(isManagedFleetMember(workbuddy)).toBe(true);
    expect(shouldAutoAdoptToStore(workbuddy)).toBe(true);
  });

  it("keeps offline installed (ACP fail) catalog in fleet", () => {
    const claude = agent({
      id: "claude",
      provider: "custom",
      status: "offline",
      error: "ACP handshake failed",
      discoverable: true,
    });
    expect(isManagedFleetMember(claude)).toBe(true);
    expect(isDiscoverCandidate(claude)).toBe(false);
    expect(shouldAutoAdoptToStore(claude)).toBe(true);
  });

  it("R1: missing_binary / not-installed stays out of fleet (discover only)", () => {
    const claude = agent({
      id: "claude",
      provider: "claude",
      status: "offline",
      error: "spawn claude ENOENT",
      errorInfo: { code: "missing_binary", message: "spawn claude ENOENT" },
      discoverable: false,
    });
    // agentDisplayStatus maps missing_binary → missing → not managed
    expect(isManagedFleetMember(claude)).toBe(false);
    expect(isDiscoverCandidate(claude)).toBe(true);
  });

  it("never auto-adopts missing catalog drafts", () => {
    const gemini = agent({
      id: "gemini",
      provider: "custom",
      status: "missing",
      discoverable: true,
    });
    expect(shouldAutoAdoptToStore(gemini)).toBe(false);
    expect(isDiscoverCandidate(gemini)).toBe(true);
  });
});

describe("partitionAgentsForFleet", () => {
  it("splits managed vs discover vs extension", () => {
    const agents = [
      agent({ id: "opencode", provider: "opencode", status: "online" }),
      agent({ id: "claude", provider: "claude", status: "missing" }),
      agent({ id: "snow", provider: "custom", status: "missing", discoverable: true }),
      agent({ id: "mimo", provider: "custom", status: "online", agent_source: "custom", discoverable: false }),
      agent({ id: "ext:demo", provider: "custom", status: "online", agent_source: "extension" }),
    ];
    const { managed, discover, extension } = partitionAgentsForFleet(agents);
    expect(managed.map((a) => a.id).sort()).toEqual(["mimo", "opencode"]);
    expect(discover.map((a) => a.id).sort()).toEqual(["claude", "snow"]);
    expect(extension.map((a) => a.id)).toEqual(["ext:demo"]);
  });
});

describe("isSkillAgentConfigTarget", () => {
  it("allows config only for managed + installed skill keys", () => {
    const agents = [
      agent({ id: "opencode", provider: "opencode", status: "online" }),
      agent({ id: "claude", provider: "claude", status: "missing" }),
      agent({ id: "snow", provider: "custom", status: "online", discoverable: true }),
      agent({ id: "hermes", provider: "hermes", status: "online", enabled: false }),
    ];
    expect(isSkillAgentConfigTarget("opencode", agents)).toBe(true);
    expect(isSkillAgentConfigTarget("claude", agents)).toBe(false);
    // Option 2: installed catalog drafts are fleet members (online ⇒ skill matrix target).
    expect(isSkillAgentConfigTarget("snow", agents)).toBe(true);
    expect(isSkillAgentConfigTarget("hermes", agents)).toBe(false);
    // Host product skill root is always a matrix target (no fleet row required).
    expect(isSkillAgentConfigTarget("onmyagent", agents)).toBe(true);

    const unavailable = collectUnavailableSkillAgents(
      ["opencode", "claude", "gemini", "hermes", "onmyagent"] as const,
      agents,
    );
    expect(unavailable.has("opencode")).toBe(false);
    expect(unavailable.has("claude")).toBe(true);
    expect(unavailable.has("gemini")).toBe(true);
    expect(unavailable.has("onmyagent")).toBe(false);

    expect(
      visibleFleetConfigAgentKeys(
        ["onmyagent", "opencode", "claude", "hermes", "codex"] as const,
        agents,
      ),
    ).toEqual(["onmyagent", "opencode"]);
  });

  it("fleet with opencode+hermes only exposes those config keys (not full catalog)", () => {
    const fleet = [
      agent({ id: "opencode", provider: "opencode", status: "online" }),
      agent({ id: "hermes", provider: "hermes", status: "online" }),
      agent({
        id: "grok",
        provider: "custom",
        status: "online",
        agent_source: "custom",
        discoverable: false,
      }),
      agent({
        id: "mimo",
        provider: "custom",
        status: "online",
        agent_source: "custom",
        discoverable: false,
      }),
    ];
    const keys = visibleFleetConfigAgentKeys(
      ["onmyagent", "opencode", "codex", "claude", "gemini", "hermes", "openclaw"] as const,
      fleet,
    );
    // onmyagent is always included as the host skill root (and listed first).
    expect(keys).toEqual(["onmyagent", "opencode", "hermes"]);
  });

  it("skill matrix includes custom fleet agents that declare nativeSkillsDirs", () => {
    const fleet = [
      agent({ id: "opencode", provider: "opencode", status: "online" }),
      agent({ id: "hermes", provider: "hermes", status: "online" }),
      agent({
        id: "grok",
        provider: "custom",
        status: "online",
        agent_source: "custom",
        discoverable: false,
        nativeSkillsDirs: ["/Users/me/.grok/skills"],
      }),
      agent({
        id: "mimo",
        provider: "custom",
        status: "online",
        agent_source: "custom",
        discoverable: false,
        // no skill dirs → no matrix column
      }),
    ];
    expect(
      visibleSkillMatrixAgents(
        ["onmyagent", "opencode", "codex", "claude", "gemini", "hermes", "openclaw"],
        fleet,
      ),
    ).toEqual(["onmyagent", "opencode", "hermes", "grok"]);
  });

  it("skill matrix omits offline agents even when skill folders remain", () => {
    const fleet = [
      agent({ id: "opencode", provider: "opencode", status: "online" }),
      agent({ id: "hermes", provider: "hermes", status: "offline" }),
      agent({
        id: "grok",
        provider: "custom",
        status: "offline",
        agent_source: "custom",
        discoverable: false,
        nativeSkillsDirs: ["/Users/me/.grok/skills"],
      }),
      agent({ id: "claude", provider: "claude", status: "needs_auth" }),
    ];
    expect(
      visibleSkillMatrixAgents(
        ["onmyagent", "opencode", "codex", "claude", "gemini", "hermes", "openclaw"],
        fleet,
      ),
    ).toEqual(["onmyagent", "opencode"]);
    expect(isSkillAgentConfigTarget("hermes", fleet)).toBe(false);
    expect(isSkillAgentConfigTarget("grok", fleet)).toBe(false);
    expect(isSkillAgentConfigTarget("claude", fleet)).toBe(false);
  });

  it("MCP / provider sidebars list full managed fleet including custom agents", () => {
    const fleet = [
      agent({ id: "opencode", provider: "opencode", status: "online" }),
      agent({ id: "hermes", provider: "hermes", status: "online" }),
      agent({
        id: "grok",
        provider: "custom",
        status: "online",
        agent_source: "custom",
        discoverable: false,
      }),
      agent({
        id: "mimo",
        provider: "custom",
        status: "online",
        agent_source: "custom",
        discoverable: false,
      }),
    ];
    expect(
      visibleFleetSidebarAgents(
        ["onmyagent", "opencode", "codex", "claude", "gemini", "hermes", "openclaw"],
        fleet,
      ),
    ).toEqual(["opencode", "hermes", "grok", "mimo"]);
  });

  it("runtime picker only includes store/product fleet, not bare catalog drafts", () => {
    expect(
      isRuntimeFleetPickerAgent(
        agent({ id: "opencode", provider: "opencode", status: "online" }),
      ),
    ).toBe(true);
    // Catalog rows stay out of the runtime picker until auto-adopt persists them as mine.
    expect(
      isRuntimeFleetPickerAgent(
        agent({ id: "snow", provider: "custom", status: "online", discoverable: true }),
      ),
    ).toBe(false);
    expect(
      isRuntimeFleetPickerAgent(
        agent({
          id: "mimo",
          provider: "custom",
          status: "online",
          agent_source: "custom",
          discoverable: false,
        }),
      ),
    ).toBe(true);
  });
});
