import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const marketplaceRoot = join(
  repoRoot,
  "apps/app/src/react-app/domains/session/expert-marketplace",
);
const builtinPluginsRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins",
);
const retiredMinimaxDocxSkillRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/skills/skills/skill_2053082396193849344",
);

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readMarketplaceFile(path: string): string {
  return readFileSync(join(marketplaceRoot, path), "utf8");
}

function builtInPackageNames(): string[] {
  return readdirSync(builtinPluginsRoot)
    .filter((name) => statSync(join(builtinPluginsRoot, name)).isDirectory())
    .sort();
}

describe("expert marketplace UI contract", () => {
  test("does not ship the retired minimax-docx marketplace capability", () => {
    expect(existsSync(retiredMinimaxDocxSkillRoot)).toBe(false);

    for (const packageName of builtInPackageNames()) {
      const packageRoot = join(builtinPluginsRoot, packageName);
      expect(existsSync(join(packageRoot, "skills/minimax-docx"))).toBe(false);
      expect(
        readFileSync(join(packageRoot, ".expert-plugin/plugin.json"), "utf8"),
      ).not.toContain("minimax-docx");
      for (const agentFile of readdirSync(join(packageRoot, "agents"))) {
        expect(readFileSync(join(packageRoot, "agents", agentFile), "utf8")).not.toContain(
          "minimax-docx",
        );
      }
    }
  });

  test("keeps OnMyAgent expert packages as complete package folders", () => {
    const packageNames = builtInPackageNames();

    expect(packageNames.length).toBeGreaterThanOrEqual(10);
    for (const packageName of packageNames) {
      const packageRoot = join(builtinPluginsRoot, packageName);
      expect(existsSync(join(packageRoot, ".expert-plugin/plugin.json"))).toBe(true);
      expect(existsSync(join(packageRoot, "agents"))).toBe(true);
    }

    expect(packageNames).toEqual(
      expect.arrayContaining([
        "ai-engineer",
        "browser-use-agent",
        "gaokao-advisor",
        "viral-topic-master",
      ]),
    );
    const browserUseManifest = JSON.parse(
      readFileSync(
        join(builtinPluginsRoot, "browser-use-agent/.expert-plugin/plugin.json"),
        "utf8",
      ),
    );
    expect(browserUseManifest.agentName).toBe("browser-use-agent");
    expect(browserUseManifest.runtime).toBe("browser-use-agent");
    expect(existsSync(join(
      builtinPluginsRoot,
      "browser-use-agent/skills/browser-use-agent/SKILL.md",
    ))).toBe(true);
    const marketplaceData = readMarketplaceFile("data.ts");
    const pendingAgent = readMarketplaceFile("pending-agent.ts");
    const pendingStore = readWorkspaceFile(
      "apps/app/src/react-app/domains/agents/pending-agent-store.ts",
    );
    expect(marketplaceData).toContain("runtime: normalizeExpertRuntime(manifest.runtime)");
    expect(pendingAgent).toContain("runtime: expert.runtime");
    expect(pendingStore).toContain('runtime?: "browser-use-agent"');
  });

  test("parses details from package files with folder-name fallback and duplicate-safe ids", () => {
    const data = readMarketplaceFile("data.ts");

    expect(data).toContain("titleFromReadme(agentMarkdown, packageName)");
    expect(data).toContain("BUILTIN_EXPERT_AVATAR_URLS[packageName]");
    expect(data).toContain("id: `${manifest.name?.trim() || packageName}:${packageName}`");
    expect(data).toContain("packagePath: `builtin-experts/plugins/${packageName}`");
    expect(data).toContain("systemPrompt: agentMarkdown || readme");
  });

  test("renders marketplace, my experts, create card, detail dialog, and summon CTA contracts", () => {
    const dialog = readMarketplaceFile("expert-marketplace-dialog.tsx");

    expect(dialog).toContain('export type ExpertMarketplaceView = "market" | "mine"');
    expect(dialog).toContain("BUILTIN_MARKETPLACE_EXPERTS.filter");
    expect(dialog).toContain("props.query ??");
    expect(dialog).toContain("myExperts: ExpertMarketplaceEntry[]");
    expect(dialog).toContain("onOpen={setSelectedExpert}");
    expect(dialog).toContain('t("session.create_expert")');
    expect(dialog).toContain('t("session.summon_expert"');
    expect(dialog).not.toContain("MyExpertCard");
    expect(dialog).not.toContain("AgentRecord");
    expect(dialog).not.toContain("onSummonMyExpert");
  });

  test("store page hosts the expert marketplace and expert icon jumps there", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");
    const assistantPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const storePage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/components/shared-pages/side-panel-pages.tsx",
    );
    const installHelper = readMarketplaceFile("install.ts");
    const pendingAgent = readMarketplaceFile("pending-agent.ts");

    expect(storePage).toContain('export type StorePrimaryTab = "experts" | "skills"');
    expect(storePage).toContain("function StorePrimaryTabs");
    expect(storePage).toContain("<ExpertMarketplacePage");
    expect(storePage).toContain('t("store.experts_marketplace")');
    expect(storePage).toContain('t("store.all_experts")');
    expect(storePage).toContain('t("store.add_skill")');
    expect(expertPage).toContain("const openExpertMarket = useCallback");
    expect(expertPage).toContain("onOpenAgents={openExpertMarket}");
    expect(expertPage).toContain("activeTab={storeActiveTab}");
    expect(expertPage).toContain("onSummonMarketplaceExpert={handleStartMarketplaceExpert}");
    expect(expertPage).toContain("installSummonedMarketplaceExpert(expert)");
    expect(assistantPage).toContain("installSummonedMarketplaceExpert(expert)");
    expect(installHelper).toContain('expert.source !== "builtin"');
    expect(installHelper).toContain('marketplace: "experts"');
    expect(expertPage).toContain("props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)");
    expect(expertPage).not.toContain("agentEditRequest");
    expect(expertPage).not.toContain("onOpenAgentSettings={");
    expect(expertPage).not.toContain("<ExpertMarketplaceDialog");
    expect(expertPage).toContain('listExpertPackages("my-experts")');
    expect(pendingAgent).toContain('const source = expert.source === "mine" ? "mine" : "builtin"');
    expect(pendingAgent).toContain('avatarOptionId: "marketplace-expert"');
    expect(pendingAgent).toContain("systemPrompt: expert.systemPrompt");
    expect(pendingAgent).toContain("packagePath: expert.packagePath");
  });

  test("expert store create expert opens a fresh assistant draft before prefill", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");

    expect(expertPage).toContain("props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)");
    expect(expertPage).toContain("setComposerDraftAfterNewTask(props.selectedWorkspaceId, CREATE_EXPERT_PROMPT)");
    expect(expertPage).toContain('props.onNavigateToMode("assistant")');
  });

  test("marketplace summon opens a fresh expert draft before agent activation", () => {
    const assistantPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");

    expect(assistantPage).toContain("props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)");
    expect(assistantPage).toContain("setAgent(buildPendingAgentFromMarketplaceExpert(expert))");
    expect(expertPage).toContain("const openFreshExpertDraft = useCallback");
    expect(expertPage).toContain("openFreshExpertDraft();");
    expect(expertPage).toContain("activateDraftAgent(buildPendingAgentFromMarketplaceExpert(expert))");
  });

  test("browser-use expert routes its prompt to the dedicated runtime", () => {
    const surfaceHook = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route-surface-props-hook.ts",
    );
    expect(surfaceHook).toContain('agentRuntime === "browser-use-agent"');
    expect(surfaceHook).toContain(
      "draft.messageID ?? `msg_${crypto.randomUUID()}`",
    );
    expect(surfaceHook).toContain("browserUseAgentStart({");
    expect(surfaceHook).toContain("noReply: true");
    expect(surfaceHook).toContain("ownerId: `expert:${sessionId}`");
    expect(surfaceHook).toContain("sessionId,");
    expect(surfaceHook).toContain("userMessageId:");
    expect(surfaceHook).toContain('queryKey: ["browser-use-agent-history", sessionId]');
    const desktopBridge = readWorkspaceFile("apps/app/src/app/lib/desktop.ts");
    expect(desktopBridge).toContain("export function browserUseAgentHistory(");
    expect(desktopBridge).toContain('"browserUseAgentHistory"');
    const electronMain = readWorkspaceFile("apps/desktop/electron/main.mjs");
    expect(electronMain).toContain("createBrowserUseRunStore({");
    expect(electronMain).toContain('case "browserUseAgentHistory"');
    const sessionSurface = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/session-surface.tsx",
    );
    expect(sessionSurface).toContain("browserUseAgentHistory(props.sessionId)");
    expect(sessionSurface).toContain("mergeBrowserUseTimeline(");
    expect(sessionSurface).not.toContain("<BrowserUseAgentStatus");
    const messageList = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/message-list.tsx",
    );
    expect(messageList).toContain('part.tool === "browser_use_operation"');
    expect(messageList).toContain("<ToolApprovalCard");
    expect(messageList).toContain("browserUseAgentCancel(runId)");
    expect(messageList).toContain("browserUseAgentApprove({");
    expect(messageList).toContain("function browserActionLabel(");
    expect(messageList).toContain("function browserResultSummary(");
    expect(messageList).not.toContain('part.tool === "browser_use_activity"');
    expect(messageList).toContain('t("session.browser_use_operation_goal")');
    expect(messageList).not.toContain("formatStructuredValue(output.results)");
    const browserUseTimeline = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/browser-use/browser-use-timeline.ts",
    );
    expect(browserUseTimeline).toContain('parts: [{ type: "text", text, state: "streaming" }]');
    const zhSession = readWorkspaceFile("apps/app/src/i18n/locales/zh/session.ts");
    const enSession = readWorkspaceFile("apps/app/src/i18n/locales/en/session.ts");
    const zhTWSession = readWorkspaceFile("apps/app/src/i18n/locales/zh-TW/session.ts");
    for (const locale of [zhSession, enSession, zhTWSession]) {
      expect(locale).toContain('"session.browser_use_action_navigate"');
      expect(locale).toContain('"session.browser_use_action_click"');
      expect(locale).toContain('"session.browser_use_action_input"');
      expect(locale).toContain('"session.browser_use_action_screenshot"');
      expect(locale).toContain('"session.browser_use_operation_result_summary"');
    }
  });

  test("vite regenerates marketplace manifests from desktop resources", () => {
    const viteConfig = readWorkspaceFile("apps/app/vite.config.ts");

    expect(viteConfig).toContain("generate-marketplace-manifests.mjs");
    expect(viteConfig).toContain("apps/desktop/resources/marketplace");
    expect(viteConfig).toContain("buildStart()");
    expect(viteConfig).toContain("server.watcher.add(marketplaceResourcesRoot)");
  });

  test("marketplace manifests stay lightweight and reference generated Vite assets", () => {
    const generator = readWorkspaceFile("apps/app/scripts/generate-marketplace-manifests.mjs");
    const expertManifest = readMarketplaceFile("builtin-experts.manifest.json");
    const expertAssets = readMarketplaceFile("builtin-expert-assets.ts");
    const skillManifest = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/skills-marketplace/builtin-skills.manifest.json",
    );
    const skillAssets = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/skills-marketplace/builtin-skill-assets.ts",
    );
    const skillData = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/skills-marketplace/data.ts",
    );

    expect(generator).toContain("writeAssetMap");
    expect(generator).toContain("?url");
    expect(expertManifest).toContain("avatarAssetPath");
    expect(expertAssets).toContain("BUILTIN_EXPERT_AVATAR_URLS");
    expect(expertAssets).toContain("../../../../../../desktop/resources/marketplace");
    expect(skillManifest).toContain("iconAssetPath");
    expect(skillAssets).toContain("BUILTIN_SKILL_ICON_URLS");
    expect(skillAssets).toContain("../../../../../../desktop/resources/marketplace");
    expect(skillData).toContain("BUILTIN_SKILL_ICON_URLS[packageName]");
    expect(expertManifest).not.toContain("data:image");
    expect(skillManifest).not.toContain("data:image");
  });

  test("expert chat keeps selected marketplace expert identity across header and new sessions", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");
    const surface = readWorkspaceFile("apps/app/src/react-app/domains/session/surface/session-surface.tsx");

    expect(expertPage).toContain("const activeAgentContext = useMemo<PendingAgentContext | null>");
    expect(expertPage).toContain("findBuiltinMarketplaceExpertById(");
    expect(expertPage).toContain("activeAgentContext?.id ??");
    expect(expertPage).toContain("agentContext={activeAgentContext}");
    expect(expertPage).toContain("assistantFeatureCategoryId={activeExpertFeatureCategoryId}");
    expect(expertPage).not.toContain("DEFAULT_AGENT_TEMPLATE_ID");
    expect(surface).toContain("agentContext?: PendingAgentContext | null");
    expect(surface).toContain(": props.agentContext");
    expect(surface).toContain("assistantFeatureCategoryId");
  });

  test("expert draft tabs keep multiple unsent experts selectable", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/agent-session-tabs.tsx");
    const panel = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/agent-conversation-panel.tsx");

    expect(expertPage).toContain("draftAgentContexts");
    expect(expertPage).toContain("`draft:${props.selectedWorkspaceId}:${agent.id}`");
    expect(expertPage).toContain("onOpenDraftSession={handleOpenDraftSession}");
    expect(expertPage).toContain("draftAgentGroups={draftAgentGroups}");
    expect(expertPage).toContain("selectedAgentId={activeConversationAgentId}");
    expect(expertPage).toContain("onOpenSession={handleOpenExpertSession}");
    expect(tabs).toContain("onOpenDraftSession?: (sessionId: string) => void");
    expect(tabs).toContain("if (isDraft) props.onOpenDraftSession?.(session.id)");
    expect(panel).toContain("draftAgentGroups?: AgentConversationGroup[]");
  });

  test("expert conversation list keeps the selected agent highlighted for draft tabs", () => {
    const list = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/agent-conversation-list.tsx");
    const item = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/agent-conversation-item.tsx");
    const panel = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/agent-conversation-panel.tsx");

    expect(panel).toContain("selectedAgentId?: string | null");
    expect(panel).toContain("selectedAgentId={props.selectedAgentId}");
    expect(list).toContain("selectedAgentId?: string | null");
    expect(list).toContain("item.agentId === props.selectedAgentId");
    expect(item).toContain(
      'itemTitle: "min-w-0 flex-1 truncate text-xs leading-5 text-dls-text"',
    );
    expect(item).toContain(
      'props.selected ? "font-medium" : "font-normal"',
    );
  });

  test("expert page feeds selected route expert sessions back into the left conversation panel", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");
    const visibility = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/agent-session-visibility.ts");
    const barrel = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/index.tsx");

    expect(visibility).toContain("export function ensureSelectedAgentSessionVisible");
    expect(visibility).toContain("export function ensureSelectedAgentSessionGroupVisible");
    expect(visibility).toContain("selectedAgentId: string | null");
    expect(visibility).toContain("selectedSessionId: string | null");
    expect(barrel).toContain("ensureSelectedAgentSessionGroupVisible");
    expect(barrel).toContain("ensureSelectedAgentSessionVisible");
    expect(expertPage).toContain("const rawWorkspaceSessions = useMemo");
    expect(expertPage).toContain("const workspaceSessions = useMemo");
    expect(expertPage).toContain("const sidebarWorkspaceSessionGroups = useMemo");
    expect(expertPage).toContain("groups={sidebarWorkspaceSessionGroups}");
  });

  test("expert side panel reuses assistant office and code workspace panel", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");

    expect(expertPage).toContain("CodeWorkspaceSidePanel");
    expect(expertPage).toContain('setCurrentSidePanel("codeMenu")');
    expect(expertPage).toContain('activeSidePanel === "review"');
    expect(expertPage).toContain('activeSidePanel === "terminal"');
    expect(expertPage).toContain('activeSidePanel === "browser"');
    expect(expertPage).toContain('activeSidePanel === "artifacts"');
    expect(expertPage).toContain('activeExpertFeatureCategoryId === "office"');
    expect(expertPage).toContain('["review", "terminal"]');
    expect(expertPage).not.toContain("<BrowserPanel");
    expect(expertPage).not.toContain("<ArtifactPanel");
  });

  test("expert session tab menu auto-closes when pointer leaves the menu", () => {
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/agent-session-tabs.tsx");

    expect(tabs).toContain("const menuRef = useRef<HTMLDivElement>(null)");
    expect(tabs).toContain('window.addEventListener("pointermove", handlePointerMove)');
    expect(tabs).toContain("triggerBottom: rect.bottom");
    expect(tabs).toContain("const safeBottom = Math.max(rect.bottom, menuState.triggerBottom) + padding");
    expect(tabs).toContain("onMouseLeave={() => setMenuState(null)}");
    expect(tabs).toContain("onPointerLeave={() => setMenuState(null)}");
  });

  test("expert session tabs keep pending selection visible while route catches up", () => {
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/agent-session-tabs.tsx");
    const actionRow = readWorkspaceFile("apps/app/src/components/ui/action-row.tsx");

    expect(tabs).toContain("const [pendingSessionId, setPendingSessionId]");
    expect(tabs).toContain("const activeSessionId = pendingSessionId ?? props.selectedSessionId");
    expect(tabs).toContain("tabRefs.current[activeSessionId]?.scrollIntoView");
    expect(tabs).toContain("window.setTimeout");
    expect(tabs).toContain("setPendingSessionId(session.id)");
    expect(tabs).toContain("const active = session.id === activeSessionId");
    expect(actionRow).toContain("border-dls-accent bg-dls-decision-soft font-medium text-dls-accent");
  });

  test("assistant automation session rows do not expose pinning", () => {
    const sections = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/assistant-conversation-sections.tsx");
    const taskItem = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/assistant-task-item.tsx");

    expect(taskItem).toContain("pinnable?: boolean");
    expect(taskItem).toContain("const pinnable = props.pinnable ?? true");
    expect(taskItem).toContain("{pinnable ? (");
    expect(sections).toContain("pinnable={false}");
  });

  test("session route cleans local expert and assistant indexes after deletion", () => {
    const sessionRoute = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route-page-view.tsx",
    );

    expect(sessionRoute).toContain("removeAssistantSession(sessionId)");
    expect(sessionRoute).toContain("removeExpertSession(sessionId)");
    expect(sessionRoute).toContain("writeCustomAgentIdForSession(sessionId, null)");
    expect(sessionRoute).toContain("writeSessionAgentSnapshot(sessionId, null)");
    expect(sessionRoute).toContain("removeAutomationSessionRecord(");
    expect(sessionRoute).toContain("removeAssistantSessionWorkspace(sessionId)");
  });

  test("keeps built-in package installation delayed until a real session exists", () => {
    const sessionRoute = [
      readWorkspaceFile("apps/app/src/react-app/shell/session-route-page-view.tsx"),
      readWorkspaceFile("apps/app/src/react-app/shell/session-route-surface-props-hook.ts"),
      readWorkspaceFile("apps/app/src/react-app/shell/session-route-intent.ts"),
    ].join("\n");
    const agentContext = readWorkspaceFile("apps/app/src/react-app/shell/session-route-agent-context.ts");

    expect(sessionRoute).toContain("installMarketplaceExpertAfterSessionCreated");
    expect(sessionRoute).toContain('marketplaceExpert.source !== "builtin"');
    expect(sessionRoute).toContain("installExpertPackage({");
    expect(sessionRoute).toContain("bindPendingAgentToSession({");
    expect(sessionRoute).toContain("writeCustomAgentIdForSession(sessionId, pendingAgentSnapshot.id)");
    expect(sessionRoute).toContain("writeSessionAgentSnapshot(sessionId, pendingAgentSnapshot)");
    expect(sessionRoute).toContain("await installMarketplaceExpertAfterSessionCreated");
    expect(sessionRoute).toContain("boundSessionId: newSession.id");
    expect(agentContext).toContain("boundSessionId: input.sessionId");
  });

  test("expert sessions persist agent metadata snapshots for restart restore", () => {
    const sessionRoute = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route-page-view.tsx",
    );
    const store = readWorkspaceFile("apps/app/src/react-app/domains/agents/agent-registry-store.ts");
    const model = readWorkspaceFile("apps/app/src/react-app/domains/session/components/shared-pages/conversation-model.ts");

    expect(sessionRoute).toContain("writeSessionAgentSnapshot(newSession.id, pendingAgentSnapshot)");
    expect(store).toContain("onmyagent:customAgentSnapshotBySessionId");
    expect(store).toContain("export function readSessionAgentSnapshot");
    expect(store).toContain("export function writeSessionAgentSnapshot");
    expect(model).toContain("readSessionAgentSnapshot(session.id)");
    expect(model).toContain("sessionAgentSnapshot?.name");
  });

  test("browser use expert carries its dedicated runtime into every prompt", () => {
    const expertPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/expert.tsx",
    );
    const sessionRoute = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route-surface-props-hook.ts",
    );

    expect(expertPage).toContain("agentRuntime: activeAgentContext?.runtime");
    expect(sessionRoute).toContain("resolvePendingAgentForPrompt({");
    expect(sessionRoute).toContain(
      "persistedRuntime: readSessionAgentSnapshot(sessionId)?.runtime",
    );
  });

  test("exposes a lightweight expert registry separate from full card details", () => {
    const types = readMarketplaceFile("types.ts");
    const data = readMarketplaceFile("data.ts");
    const desktop = readWorkspaceFile("apps/app/src/app/lib/desktop.ts");
    const main = readWorkspaceFile("apps/desktop/electron/main.mjs");

    expect(types).toContain("export type ExpertRegistryRecord");
    expect(types).toContain("packageName: string");
    expect(types).toContain("packagePath: string");
    expect(data).toContain("export const BUILTIN_EXPERT_REGISTRY");
    expect(desktop).toContain("export function listExpertRegistryRecords");
    expect(main).toContain('case "listExpertRegistryRecords"');
  });
});
