import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shouldRefreshLocalAgentStatus } from "../src/react-app/domains/local-agents/local-agent-status-rail";

const repoRoot = join(import.meta.dir, "../../..");

function read(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

const selectorSource = read("apps/app/src/react-app/domains/local-agents/host/personal-local-agent-model-selector.tsx");
const pageSource = read("apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page-sections.tsx");
const railSource = read("apps/app/src/react-app/domains/local-agents/local-agent-status-rail.tsx");
const hostHookSource = read("apps/app/src/react-app/domains/local-agents/host/use-personal-local-agent-page.ts");
const workspaceHookSource = read("apps/app/src/react-app/domains/local-agents/host/use-workspace-override.ts");
const assistantSource = read("apps/app/src/react-app/domains/session/pages/assistant.tsx");
const expertSource = read("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx");
const legacySessionSource = read("apps/app/src/react-app/domains/session/chat/session-page.tsx");

function personalLocalAgentMount(source: string) {
  const start = source.indexOf("<PersonalLocalAgentPage");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("/>", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Local Agent model/session and status rail safeguards", () => {
  test("model writes target the selected provider session and ignore stale responses", () => {
    expect(selectorSource).toContain("conversationId,");
    expect(selectorSource).toContain("sessionId: providerSessionId ?? resumeKey");
    expect(selectorSource).toContain("providerSessionId,");
    expect(selectorSource).toContain("resumeKey,");
    expect(selectorSource).toContain("latestRequestIdRef.current !== requestId");
    expect(selectorSource.match(/latestRequestIdRef\.current !== requestId/g)?.length).toBe(2);
    expect(selectorSource).toContain("useLayoutEffect(() => {");
    expect(selectorSource).toContain("latestRequestIdRef.current += 1");
    expect(selectorSource).toContain("value: value || null");
    expect(selectorSource).not.toContain("if (value && agent && acpModelInfo.supportsModelOverride)");
  });

  test("status refresh relevance is scoped to the visible workspace/conversation", () => {
    const target = { workspaceRoot: "/workspace", conversationId: "conversation-a" };
    expect(shouldRefreshLocalAgentStatus({ type: "run.finished", ...target }, target)).toBe(true);
    expect(shouldRefreshLocalAgentStatus({ type: "catalog.invalidated", ...target }, target)).toBe(true);
    expect(shouldRefreshLocalAgentStatus({ type: "run.delta", ...target, events: [{ type: "text", text: "chunk", at: 1 }] }, target)).toBe(false);
    expect(shouldRefreshLocalAgentStatus({ type: "run.delta", ...target, events: [{ type: "approval_request", text: "approve", at: 1 }] }, target)).toBe(true);
    expect(shouldRefreshLocalAgentStatus({ type: "run.delta", workspaceRoot: "/other", conversationId: "conversation-a" }, target)).toBe(false);
    expect(shouldRefreshLocalAgentStatus({ type: "run.delta", ...target, conversationId: "conversation-b" }, target)).toBe(false);
    expect(shouldRefreshLocalAgentStatus({ type: "process.changed", workspaceRoot: target.workspaceRoot, conversationId: null }, target)).toBe(true);
  });

  test("status rail uses single-flight dirty refreshes and honest loading", () => {
    expect(railSource).toContain("const inFlightRef = useRef(false)");
    expect(railSource).toContain("const dirtyRef = useRef(false)");
    expect(railSource).toContain("if (inFlightRef.current)");
    expect(railSource).toContain("dirtyRef.current = true");
    expect(railSource).toContain("aria-busy={loading || undefined}");
    expect(railSource).toContain('const countLabel = (value: number) => (data ? value : "—")');
    expect(railSource).toContain("personalAgentRuntime?.onEvent?.");
    expect(railSource).toContain("focus-visible:ring-dls-focus");
    expect(railSource).toContain('t("local_agent.status_rail_mcp_tools", { count: server.toolCount })');
    expect(railSource).toContain('t("local_agent.status_rail_mcp_hint")');
    expect(railSource).toContain("current.workspaceRoot !== input.workspaceRoot");
    expect(railSource).toContain("current.conversationId !== input.conversationId");
    expect(railSource).toContain("current.agent?.id !== inputAgentId");
    expect(railSource).toContain("useLayoutEffect(() => {");
    expect(railSource).toContain("inputRef.current = { workspaceRoot, agent, conversationId }");
    expect(railSource).not.toContain("\n  inputRef.current = { workspaceRoot, agent, conversationId };\n");
    expect(railSource).not.toContain("`${server.toolCount} tools`");

    const skillsPopover = railSource.slice(
      railSource.indexOf('title={t("local_agent.status_rail_skills")}'),
      railSource.indexOf('<Popover open={open === "mcp"}'),
    );
    expect(skillsPopover).toContain('hint={t("local_agent.status_rail_skills_hint")}');
    expect(skillsPopover).not.toContain('hint={t("local_agent.status_rail_mcp_hint")}');
    const mcpPopover = railSource.slice(
      railSource.indexOf('title={t("local_agent.status_rail_mcp")}'),
      railSource.indexOf('<Popover open={open === "permission"}'),
    );
    expect(mcpPopover).toContain('hint={t("local_agent.status_rail_mcp_hint")}');
    expect(mcpPopover).not.toContain('hint={t("local_agent.status_rail_skills_hint")}');
  });

  test("management affordance is omitted when the host does not expose it", () => {
    expect(pageSource).toContain("onOpenManagement={!isChannelView && onOpenAgentManagement ? () => onOpenAgentManagement(\"skills\") : undefined}");
    expect(railSource).toContain("onManage?: () => void");
    expect(railSource).toContain("{props.onManage ? (");
    expect(pageSource).toContain("conversationId={selectedConversation?.id ?? null}");
    expect(pageSource).toContain("providerSessionId={selectedConversation?.providerSessionId ?? null}");
    expect(pageSource).toContain("resumeKey={selectedConversation?.resumeKey ?? null}");
  });

  test("channel conversations keep every mutating transcript control read-only", () => {
    expect(pageSource).toContain("disabled={!selectedAgent || isChannelView}");
    expect(pageSource).toContain("showScheduledTasks && selectedAgent && !isChannelView");
    expect(pageSource).toContain("onResolveApproval={isChannelView ? undefined : resolveApproval}");
    expect(pageSource).toContain("onResolveTip={!isChannelView && onOpenAgentManagement");
    expect(pageSource).toContain("!isChannelView && chipEditable");
    expect(pageSource).toContain("disabled={isChannelView || running ||");
    expect(pageSource).toContain("workspaceRoot={displayWorkspaceRoot}");
    expect(hostHookSource).toContain("channelConversationLoadSequenceRef.current === requestSequence");
  });

  test("workspace transitions expose a cancellable single pending start before send", () => {
    expect(hostHookSource).toContain("const startPendingByChatRef");
    expect(hostHookSource).toContain("if (startPendingByChatRef.current[requestedChatKey]) return");
    expect(hostHookSource.indexOf("setStartingByAgent((current) => ({ ...current, [requestedChatKey]: true }))"))
      .toBeLessThan(hostHookSource.indexOf("runContext = await resolveWorkspaceRunContext()"));
    expect(hostHookSource.indexOf("if (isStartAbortRequested(startAbortByChatRef.current, requestedChatKey) || isStartAbortRequested(startAbortByChatRef.current, runChatKey))"))
      .toBeLessThan(hostHookSource.indexOf("const started = await personalLocalAgentAcpSend"));
    expect(hostHookSource).toContain("cancelAgentRun(started.runId, runChatKey, runWorkspaceRoot)");
    expect(workspaceHookSource).toContain("const previousRunContext = resolvedRunContextRef.current");
    expect(workspaceHookSource).toContain("selectedConversationIdRef.current === previousConversationId");
    expect(workspaceHookSource).toContain("pendingTransition.agentId !== selectedAgentId");
    expect(workspaceHookSource).toContain("pendingTransition.sourceConversationId !== selectedConversationId");
    expect(workspaceHookSource).toContain("transitionSequenceRef.current += 1");
    expect(workspaceHookSource).toContain("resolvedRunContextRef.current = previousRunContext");
    expect(workspaceHookSource).toContain("writeWorkspaceOverride(previousOverride)");
    expect(workspaceHookSource).toContain("useLayoutEffect(() => {");
  });

  test("host mounts expose only capabilities they can actually fulfill", () => {
    expect(hostHookSource).toContain("export type PersonalLocalAgentHostCapabilities");
    expect(hostHookSource).toContain("artifacts?: {");
    expect(hostHookSource).toContain("agentManagement?: {");
    expect(hostHookSource).toContain("archiveResume?: {");

    const assistantMount = personalLocalAgentMount(assistantSource);
    expect(assistantMount).toContain("artifacts:");
    expect(assistantMount).toContain("agentManagement:");
    expect(assistantMount).toContain("archiveResume:");

    const expertMount = personalLocalAgentMount(expertSource);
    expect(expertMount).toContain("artifacts:");
    expect(expertMount).toContain("archiveResume:");
    expect(expertMount).not.toContain("agentManagement:");

    const legacyMount = personalLocalAgentMount(legacySessionSource);
    expect(legacyMount).toContain("artifacts:");
    expect(legacyMount).not.toContain("agentManagement:");
    expect(legacyMount).not.toContain("archiveResume:");
  });
});
