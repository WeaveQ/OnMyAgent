import { describe, expect, it } from "bun:test";
import type { OnMyAgentSessionArchiveSession } from "../src/app/lib/onmyagent-server";
import {
  agentLabel,
  archiveAgentIconId,
  buildResumeRequest,
  groupSessionsByAgent,
  humanizeArchiveTitle,
  isVisibleArchiveAgent,
  RESUMABLE_AGENTS,
} from "../src/react-app/domains/session/chat/session-page-session-archive-page";

function session(overrides: Partial<OnMyAgentSessionArchiveSession> & { id: string; agent: string }): OnMyAgentSessionArchiveSession {
  return {
    id: overrides.id,
    project: overrides.project ?? "/tmp/proj",
    machine: overrides.machine ?? "host",
    agent: overrides.agent,
    first_message: overrides.first_message === undefined ? "hello" : overrides.first_message,
    display_name: overrides.display_name === undefined ? null : overrides.display_name,
    started_at: overrides.started_at ?? null,
    ended_at: overrides.ended_at ?? null,
    message_count: overrides.message_count ?? 1,
    user_message_count: overrides.user_message_count ?? 1,
  } as OnMyAgentSessionArchiveSession;
}

describe("session archive page helpers", () => {
  it("groups sessions by agent and sorts by size desc", () => {
    const groups = groupSessionsByAgent([
      session({ id: "a1", agent: "codex" }),
      session({ id: "b1", agent: "opencode" }),
      session({ id: "a2", agent: "codex" }),
      session({ id: "c1", agent: "claude" }),
      session({ id: "a3", agent: "codex" }),
    ]);
    expect(groups.map((g) => g.agent)).toEqual(["codex", "opencode", "claude"]);
    expect(groups[0].sessions.length).toBe(3);
  });

  it("builds resume request only for resumable providers", () => {
    const codex = session({ id: "sess-1", agent: "codex", display_name: "Codex run" });
    const request = buildResumeRequest(codex);
    expect(request).not.toBeNull();
    expect(request?.providerSessionId).toBe("sess-1");
    expect(request?.agent).toBe("codex");
    expect(request?.title).toBe("Codex run");
  });

  it("returns null for non-resumable providers", () => {
    const cursor = session({ id: "sess-2", agent: "cursor" });
    expect(buildResumeRequest(cursor)).toBeNull();
    expect(RESUMABLE_AGENTS.has("cursor")).toBe(false);
    expect(RESUMABLE_AGENTS.has("opencode")).toBe(true);
  });

  it("returns null when input is null or has empty id", () => {
    expect(buildResumeRequest(null)).toBeNull();
    const empty = session({ id: "", agent: "codex" });
    expect(buildResumeRequest(empty)).toBeNull();
  });

  it("falls back to first message then agent/project for title", () => {
    const s = session({ id: "sid", agent: "opencode", display_name: null, first_message: "greet" });
    expect(buildResumeRequest(s)?.title).toBe("greet");
    const noMsg = session({
      id: "sid2",
      agent: "opencode",
      display_name: null,
      first_message: null,
      project: "/tmp/proj",
    });
    expect(buildResumeRequest(noMsg)?.title).toBe("OpenCode · proj");
  });

  it("humanizeArchiveTitle drops jsonrpc first messages", () => {
    expect(
      humanizeArchiveTitle(
        session({
          id: "h1",
          agent: "hermes",
          display_name: null,
          first_message: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
          project: "/Users/work/sample-project",
        }),
      ),
    ).toBe("Hermes · sample-project");
  });

  it("agentLabel returns friendly name or agent id", () => {
    expect(agentLabel("codex")).toBe("Codex");
    expect(agentLabel("mimocode")).toBe("MiMo Code");
    expect(agentLabel("unknown-provider")).toBe("unknown-provider");
  });

  it("surfaces backend-scanned agents (option A — no tight whitelist)", () => {
    expect(isVisibleArchiveAgent("mimocode")).toBe(true);
    expect(isVisibleArchiveAgent("codex")).toBe(true);
    expect(isVisibleArchiveAgent("kiro")).toBe(true);
    expect(isVisibleArchiveAgent("unknown")).toBe(false);
    expect(isVisibleArchiveAgent("")).toBe(false);
  });

  it("maps archive agent keys to brand icon ids", () => {
    expect(archiveAgentIconId("mimocode")).toBe("mimo");
    expect(archiveAgentIconId("codex")).toBe("codex");
    expect(archiveAgentIconId("grok")).toBe("grok");
    expect(archiveAgentIconId("vscode-copilot")).toBe("vscode-copilot");
  });

  it("labels grok and vscode-copilot friendly names", () => {
    expect(agentLabel("grok")).toBe("Grok Build");
    expect(agentLabel("workbuddy")).toBe("WorkBuddy");
    expect(archiveAgentIconId("workbuddy")).toBe("workbuddy");
    expect(agentLabel("vscode-copilot")).toBe("VS Code Copilot");
  });
});
