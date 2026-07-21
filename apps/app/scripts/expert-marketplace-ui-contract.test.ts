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
        "gaokao-advisor",
        "viral-topic-master",
        "logistics-ops-navigator",
        "logistics-line-haul",
        "logistics-urban-delivery",
        "logistics-cold-chain",
      ]),
    );
  });

  test("ships Logistics marketplace category and four logistics expert packages under 14-Logistics", () => {
    const categories = readMarketplaceFile("categories.ts");
    expect(categories).toContain('id: "14-Logistics"');
    expect(categories).toContain("session.expert_marketplace_category_logistics");
    expect(categories).toMatch(/物流/);
    expect(categories).toMatch(/logistics/i);

    const localeRoots = [
      join(repoRoot, "apps/app/src/i18n/locales/en/session.ts"),
      join(repoRoot, "apps/app/src/i18n/locales/zh/session.ts"),
      join(repoRoot, "apps/app/src/i18n/locales/zh-TW/session.ts"),
    ];
    for (const localePath of localeRoots) {
      const text = readFileSync(localePath, "utf8");
      expect(text).toContain("session.expert_marketplace_category_logistics");
    }

    const logisticsPackages = [
      "logistics-ops-navigator",
      "logistics-line-haul",
      "logistics-urban-delivery",
      "logistics-cold-chain",
    ] as const;
    const verticalSkillMarkers: Record<string, string> = {
      "logistics-line-haul": "throw-weight",
      "logistics-urban-delivery": "day-clear",
      "logistics-cold-chain": "break-chain",
    };

    for (const packageName of logisticsPackages) {
      const packageRoot = join(builtinPluginsRoot, packageName);
      const pluginPath = join(packageRoot, ".expert-plugin/plugin.json");
      expect(existsSync(pluginPath)).toBe(true);
      expect(existsSync(join(packageRoot, "agents"))).toBe(true);
      const plugin = JSON.parse(readFileSync(pluginPath, "utf8")) as {
        categoryId?: string;
        categoryIds?: string[];
        skills?: string[];
      };
      const categoryIds = [
        ...(plugin.categoryId ? [plugin.categoryId] : []),
        ...(Array.isArray(plugin.categoryIds) ? plugin.categoryIds : []),
      ];
      expect(categoryIds).toContain("14-Logistics");
      if (packageName in verticalSkillMarkers) {
        const marker = verticalSkillMarkers[packageName];
        const skillTree = join(packageRoot, "skills");
        expect(existsSync(skillTree)).toBe(true);
        const skillBlob = readdirSync(skillTree, { recursive: true })
          .map((rel) => {
            const full = join(skillTree, String(rel));
            return statSync(full).isFile() ? readFileSync(full, "utf8") : "";
          })
          .join("\n");
        expect(skillBlob.toLowerCase()).toContain(marker);
      }
    }

    const expertManifest = JSON.parse(
      readMarketplaceFile("builtin-experts.manifest.json"),
    ) as { experts?: Array<{ packageName?: string; manifest?: { categoryId?: string; categoryIds?: string[] } }> };
    const manifestNames = (expertManifest.experts ?? []).map((entry) => entry.packageName);
    for (const packageName of logisticsPackages) {
      expect(manifestNames).toContain(packageName);
      const entry = (expertManifest.experts ?? []).find((item) => item.packageName === packageName);
      const cats = [
        ...(entry?.manifest?.categoryId ? [entry.manifest.categoryId] : []),
        ...(Array.isArray(entry?.manifest?.categoryIds) ? entry.manifest.categoryIds : []),
      ];
      expect(cats).toContain("14-Logistics");
    }

    const assetMap = readMarketplaceFile("builtin-expert-assets.ts");
    for (const packageName of logisticsPackages) {
      expect(assetMap).toContain(`"${packageName}"`);
    }
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
    expect(dialog).toContain("onSummon={props.onSummonMarketplaceExpert}");
    expect(dialog).toContain('t("session.create_expert")');
    expect(dialog).toContain('t("session.summon")');
    expect(dialog).toContain('t("session.summon_expert"');
    expect(dialog).not.toContain("MyExpertCard");
    expect(dialog).not.toContain("AgentRecord");
    expect(dialog).not.toContain("onSummonMyExpert");
  });

  test("expert cards hide summon until hover and only show border on hover", () => {
    const dialog = readMarketplaceFile("expert-marketplace-dialog.tsx");
    expect(dialog).toContain("border border-transparent");
    expect(dialog).toContain("hover:border-dls-border");
    expect(dialog).toContain("opacity-0");
    expect(dialog).toContain("group-hover:opacity-100");
    expect(dialog).toContain("group-hover:pointer-events-auto");
    expect(dialog).toContain("pointer-events-none");
    expect(dialog).toContain("event.stopPropagation()");
    expect(dialog).toContain("props.onSummon(props.expert)");
  });

  test("store page hosts the expert marketplace and expert icon jumps there", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");
    const assistantPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const storePage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/components/side-panel-pages.tsx",
    );
    const installHelper = readMarketplaceFile("install.ts");
    const pendingAgent = readMarketplaceFile("pending-agent.ts");

    expect(storePage).toContain(
      'export type StorePrimaryTab = "experts" | "skills" | "plugins"',
    );
    expect(storePage).toContain("function StorePrimaryTabs");
    expect(storePage).toContain("<ExpertMarketplacePage");
    expect(storePage).toContain('t("store.experts_tab")');
    expect(storePage).toContain('t("store.skills_tab")');
    expect(storePage).toContain('t("plugins.artifact_tab")');
    expect(storePage).toContain('t("store.all_experts")');
    // Skills market uses "my installed" entry (with count), not a bare add_skill CTA.
    expect(storePage).toContain('t("store.my_installed")');
    expect(storePage).toContain('t("store.skills_marketplace")');
    expect(storePage).toContain("CustomConnectorEntryButton");
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
    const assistantPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const desktopMain = readWorkspaceFile("apps/desktop/electron/main.mjs");
    const zhSession = readWorkspaceFile("apps/app/src/i18n/locales/zh/session.ts");
    const enSession = readWorkspaceFile("apps/app/src/i18n/locales/en/session.ts");

    expect(expertPage).toContain("props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)");
    expect(expertPage).toContain('t("session.create_expert_prompt")');
    expect(expertPage).toContain("setComposerDraftAfterNewTask(");
    expect(expertPage).toContain('props.onNavigateToMode("assistant")');
    expect(expertPage).toContain('packageName: CREATE_EXPERT_SKILL_NAME');
    expect(expertPage).toContain('skillName: CREATE_EXPERT_SKILL_NAME');
    expect(assistantPage).toContain('t("session.create_expert_prompt")');
    expect(assistantPage).toContain("installBuiltinSkillPackage");
    // expert-manager is curated under bundled-skills, not marketplace hub package ids
    expect(desktopMain).toContain('path.join(bundledRoot, safePackage)');
    expect(desktopMain).toContain("apps/desktop/resources/bundled-skills");
    expect(zhSession).toContain("session.create_expert_prompt");
    expect(zhSession).toContain("/expert-manager 帮我创建一个");
    expect(enSession).toContain("session.create_expert_prompt");
    expect(enSession).toContain("/expert-manager Help me create");
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
    const surfaceTypes = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/session-surface-types.ts",
    );

    expect(expertPage).toContain("const activeAgentContext = useMemo<PendingAgentContext | null>");
    expect(expertPage).toContain("findBuiltinMarketplaceExpertById(");
    expect(expertPage).toContain("activeAgentContext?.id ??");
    expect(expertPage).toContain("agentContext={activeAgentContext}");
    expect(expertPage).toContain("assistantFeatureCategoryId={activeExpertFeatureCategoryId}");
    expect(expertPage).not.toContain("DEFAULT_AGENT_TEMPLATE_ID");
    // SessionSurfaceProps lives in session-surface-types (folder extract).
    expect(surfaceTypes).toContain("agentContext?: PendingAgentContext | null");
    expect(surface).toContain('export type { SessionSurfaceProps } from "./session-surface-types"');
    expect(surface).toContain(": props.agentContext");
    expect(surface).toContain("assistantFeatureCategoryId");
  });

  test("expert draft tabs keep multiple unsent experts selectable", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-session-tabs.tsx");
    const panel = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel.tsx");

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
    const list = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-conversation-list.tsx");
    const item = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-conversation-item.tsx");
    const panel = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel.tsx");

    expect(panel).toContain("selectedAgentId?: string | null");
    expect(panel).toContain("selectedAgentId={props.selectedAgentId}");
    expect(list).toContain("selectedAgentId?: string | null");
    // Draft + multi-session: highlight by agentId or any session under the group.
    expect(list).toContain("group.agentId === props.selectedAgentId");
    expect(list).toContain("session.id === props.selectedSessionId");
    // Title matches local-agent list weight (always medium).
    expect(item).toContain(
      'itemTitle: "min-w-0 flex-1 truncate text-sm font-medium leading-5 text-dls-text"',
    );
    // Streaming / activity uses ExpertStatusDots (not raw accent pill).
    expect(item).toContain("ExpertStatusDots");
    expect(item).not.toContain(
      'props.taskStatusVariant === "available" && "bg-dls-accent"',
    );
    expect(list).not.toContain(
      'props.taskStatusVariant === "available" && "bg-dls-accent"',
    );
  });

  test("expert page feeds selected route expert sessions back into the left conversation panel", () => {
    const expertPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");
    const visibility = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-session-visibility.ts");
    const barrel = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/session-chrome.ts");

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
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-session-tabs.tsx");

    expect(tabs).toContain("const menuRef = useRef<HTMLDivElement>(null)");
    expect(tabs).toContain('window.addEventListener("pointermove", handlePointerMove)');
    expect(tabs).toContain("triggerBottom: rect.bottom");
    expect(tabs).toContain("const safeBottom = Math.max(rect.bottom, menuState.triggerBottom) + padding");
    expect(tabs).toContain("onMouseLeave={() => setMenuState(null)}");
    expect(tabs).toContain("onPointerLeave={() => setMenuState(null)}");
  });

  test("expert session tabs keep pending selection visible while route catches up", () => {
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-session-tabs.tsx");
    const actionRow = readWorkspaceFile("apps/app/src/components/ui/action-row.tsx");

    expect(tabs).toContain("const [pendingSessionId, setPendingSessionId]");
    expect(tabs).toContain("const activeSessionId = pendingSessionId ?? props.selectedSessionId");
    expect(tabs).toContain("scrollTabIntoViewIfNeeded(tabRefs.current[activeSessionId])");
    expect(tabs).toContain("mergeStableSessionTabOrder");
    expect(tabs).toContain("window.setTimeout");
    expect(tabs).toContain("setPendingSessionId(session.id)");
    expect(tabs).toContain("const active = session.id === activeSessionId");
    // Session tab active chrome: soft list-selected wash (not accent pill).
    expect(actionRow).toContain("bg-dls-list-selected font-medium text-dls-text shadow-none");
  });

  test("expert session tabs separate expanded chrome and embed the collapse handle", () => {
    const tabs = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/sidebar/agent-session-tabs.tsx",
    );

    // Expanded strip owns the bottom rule; collapsed is hang-tab host only.
    expect(tabs).toContain('"h-11 border-b border-dls-mist px-3"');
    expect(tabs).toContain('"h-0 overflow-visible shadow-none"');
    expect(tabs).toContain(
      'className="flex h-full min-w-0 items-center gap-1.5 overflow-x-auto"',
    );
    expect(tabs).toContain('variant="ghost"');
    expect(tabs).toContain("rounded-t-none rounded-b-md");
    expect(tabs).toContain(
      "border-x border-b border-t-0 border-dls-mist",
    );
    expect(tabs).toContain('expanded ? "-rotate-90" : "rotate-90"');
    expect(tabs).toContain("before:-top-px before:inset-x-0 before:h-px");
    expect(tabs).not.toContain("rounded-full border-dls-border bg-dls-surface");
  });

  test("assistant automation session rows do not expose pinning", () => {
    const sections = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx");
    const taskItem = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/assistant-task-item.tsx");

    expect(taskItem).toContain("pinnable?: boolean");
    expect(taskItem).toContain("const pinnable = props.pinnable ?? true");
    // Pin control only when pinnable and a toggle handler is provided.
    expect(taskItem).toContain("{pinnable && props.onTogglePinned ? (");
    expect(sections).toContain("pinnable={false}");
  });

  test("session route cleans local expert and assistant indexes after deletion", () => {
    const sessionRoute = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route/page-view.tsx",
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
      readWorkspaceFile("apps/app/src/react-app/shell/session-route/page-view.tsx"),
      readWorkspaceFile("apps/app/src/react-app/shell/session-route/surface-props-hook.ts"),
      readWorkspaceFile("apps/app/src/react-app/shell/session-route/intent.ts"),
    ].join("\n");
    const agentContext = readWorkspaceFile("apps/app/src/react-app/shell/session-route/agent-context.ts");

    expect(sessionRoute).toContain("installMarketplaceExpertAfterSessionCreated");
    expect(sessionRoute).toContain('marketplaceExpert.source !== "builtin"');
    expect(sessionRoute).toContain("installExpertPackage({");
    expect(sessionRoute).toContain("bindPendingAgentToSession({");
    expect(sessionRoute).toContain("sessionId: newSession.id");
    expect(sessionRoute).toContain("writeCustomAgentIdForSession(sessionId, pendingAgentSnapshot.id)");
    expect(sessionRoute).toContain("writeSessionAgentSnapshot(sessionId, pendingAgentSnapshot)");
    expect(sessionRoute).toContain("await installMarketplaceExpertAfterSessionCreated");
    // Binding goes through helper; agent-context stamps boundSessionId from sessionId.
    expect(agentContext).toContain("boundSessionId: input.sessionId");
  });

  test("expert sessions persist agent metadata snapshots for restart restore", () => {
    const sessionRoute = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route/page-view.tsx",
    );
    const store = readWorkspaceFile("apps/app/src/react-app/domains/agents/agent-registry-store.ts");
    const model = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/conversation-model.ts");

    // After create, resolvePendingAgentForPrompt may inherit; bind uses agentToBind.
    expect(sessionRoute).toContain("writeSessionAgentSnapshot(newSession.id, agentToBind)");
    expect(sessionRoute).toContain("resolvePendingAgentForPrompt");
    expect(store).toContain("onmyagent:customAgentSnapshotBySessionId");
    expect(store).toContain("export function readSessionAgentSnapshot");
    expect(store).toContain("export function writeSessionAgentSnapshot");
    expect(model).toContain("readSessionAgentSnapshot(session.id)");
    expect(model).toContain("sessionAgentSnapshot?.name");
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
    // desktop.ts may export as function or const re-export after domain splits
    expect(desktop).toMatch(/export (?:async )?function listExpertRegistryRecords|export const listExpertRegistryRecords/);
    const skillsHandlers = readWorkspaceFile(
      "apps/desktop/electron/desktop-handlers/skills.mjs",
    );
    expect(skillsHandlers).toContain('"listExpertRegistryRecords"');
    expect(skillsHandlers).toContain("listExpertRegistryRecords:");
    expect(main).toContain("createAllDesktopDomainHandlers");
  });
});
