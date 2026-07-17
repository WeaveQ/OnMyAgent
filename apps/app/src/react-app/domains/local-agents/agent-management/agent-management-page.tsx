/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Bot, Cloud, Cpu, FileText, HeartPulse, Loader2, Plug, Plus, RefreshCw, ShoppingBag, Sparkles, Wrench } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { FilterChip, IconTile, NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shellChrome, typeScale } from "@/react-app/design-system/type-scale";
import { cn } from "@/lib/utils";
import {
  agentManagementFetchModels,
  agentManagementMcpAction,
  agentManagementProviderAction,
  agentManagementSkillAction,
  agentManagementSnapshot,
  personalLocalAgentTestConnection,
  personalLocalAgentCreateCustomAgent,
  personalLocalAgentUpdateCustomAgent,
  personalLocalAgentDeleteCustomAgent,
  type AgentManagementAgent,
  type PersonalLocalAgentTestConnectionResult,
  type AgentManagementManagedProvider,
  type AgentManagementSkill,
  type AgentManagementSkillAgent,
  type AgentManagementSnapshot,
} from "../../../../app/lib/desktop";
import { AgentManagementAgentCard } from "./agent-management-agent-card";
import { InlineAgentEditor, type InlineAgentEditorValue } from "../inline-agent-editor";
import { AgentManagementRepairDialog } from "../agent-management-repair-dialog";
import { ExtensionListPanel } from "../extension-list-panel";
import {
  formatAgentManagerDuration,
  type AgentManagementHealthResult,
} from "./agent-management-health";
import {
  AgentManagementProviderModal,
  AgentManagementProviderPanel,
  AGENT_MANAGER_PROVIDER_LABELS,
  defaultProviderDraft,
  providerDraftFromProvider,
  serializeCodexCatalogRows,
  serializeProviderModelRows,
  type AgentManagementProviderApp,
  type ProviderDraft,
} from "./agent-management-providers";
import { AgentManagementMcpPanel } from "./agent-management-mcp-panel";
import { SkillMatrixPanel } from "./agent-management-skill-matrix";

type AgentManagementPanel = "providers" | "agents" | "skills" | "mcp" | "archive";

type AgentManagementUiCache = {
  activePanel: AgentManagementPanel;
  providerApp: AgentManagementProviderApp;
  skillColumnFilter: AgentManagementSkillAgent[];
  skillSearch: string;
  selectedSkillKey: string | null;
  healthResults: Record<string, AgentManagementHealthResult>;
};

const AGENT_MANAGER_PANEL_STORAGE_KEY = "onmyagent.agentManagement.activePanel";
const AGENT_MANAGER_SNAPSHOT_CACHE = new Map<string, AgentManagementSnapshot>();
const AGENT_MANAGER_UI_CACHE = new Map<string, AgentManagementUiCache>();

function agentManagerCacheKey(workspaceRoot: string) {
  return workspaceRoot.trim() || "__default_workspace__";
}

function isAgentManagementPanel(value: unknown): value is AgentManagementPanel {
  return value === "providers" || value === "agents" || value === "skills" || value === "mcp" || value === "archive";
}

function isAgentManagementProviderApp(value: unknown): value is AgentManagementProviderApp {
  return value === "opencode" || value === "claude" || value === "codex" || value === "openclaw" || value === "hermes";
}

function isAgentManagementSkillAgent(value: unknown): value is AgentManagementSkillAgent {
  return value === "opencode" || value === "codex" || value === "claude" || value === "hermes" || value === "openclaw" || value === "onmyagent" || value === "unknown";
}

function defaultAgentManagementUiCache(): AgentManagementUiCache {
  return {
    activePanel: "providers",
    providerApp: "opencode",
    skillColumnFilter: [],
    skillSearch: "",
    selectedSkillKey: null,
    healthResults: {},
  };
}

function agentManagerUiStorageKey(cacheKey: string) {
  return `${AGENT_MANAGER_PANEL_STORAGE_KEY}:${encodeURIComponent(cacheKey)}`;
}

function isRecordStringUnknown(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Build a concise, human-readable one-liner from a lightweight connection probe.
function describeAgentTestConnection(result: PersonalLocalAgentTestConnectionResult): string {
  if (result.ok) {
    const modelCount = Array.isArray(result.models) ? result.models.length : 0;
    return modelCount ? `连接正常 · ${modelCount} 个模型可用` : "连接正常";
  }
  if (result.status === "needs_auth") return `需要登录认证${result.error ? `：${result.error}` : ""}`;
  if (result.status === "missing") return `未安装${result.error ? `：${result.error}` : ""}`;
  return `连接失败${result.error ? `：${result.error}` : `（${result.step}）`}`;
}

function coerceAgentManagementUiCache(input: unknown): AgentManagementUiCache {
  const fallback = defaultAgentManagementUiCache();
  if (!isRecordStringUnknown(input)) return fallback;
  return {
    activePanel: isAgentManagementPanel(input.activePanel) ? input.activePanel : fallback.activePanel,
    providerApp: isAgentManagementProviderApp(input.providerApp) ? input.providerApp : fallback.providerApp,
    skillColumnFilter: Array.isArray(input.skillColumnFilter) ? input.skillColumnFilter.filter(isAgentManagementSkillAgent) : fallback.skillColumnFilter,
    skillSearch: typeof input.skillSearch === "string" ? input.skillSearch : fallback.skillSearch,
    selectedSkillKey: typeof input.selectedSkillKey === "string" ? input.selectedSkillKey : null,
    healthResults: isRecordStringUnknown(input.healthResults) ? input.healthResults as Record<string, AgentManagementHealthResult> : fallback.healthResults,
  };
}

function readInitialAgentManagementUi(cacheKey: string): AgentManagementUiCache {
  const cached = AGENT_MANAGER_UI_CACHE.get(cacheKey);
  if (cached) return cached;
  if (typeof window === "undefined") return defaultAgentManagementUiCache();
  try {
    const storedUi = window.localStorage.getItem(agentManagerUiStorageKey(cacheKey));
    if (storedUi) {
      const ui = coerceAgentManagementUiCache(JSON.parse(storedUi));
      AGENT_MANAGER_UI_CACHE.set(cacheKey, ui);
      return ui;
    }
    const storedPanel = window.localStorage.getItem(AGENT_MANAGER_PANEL_STORAGE_KEY);
    return { ...defaultAgentManagementUiCache(), activePanel: isAgentManagementPanel(storedPanel) ? storedPanel : "providers" };
  } catch {
    return defaultAgentManagementUiCache();
  }
}

function writeAgentManagementUi(cacheKey: string, ui: AgentManagementUiCache) {
  AGENT_MANAGER_UI_CACHE.set(cacheKey, ui);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AGENT_MANAGER_PANEL_STORAGE_KEY, ui.activePanel);
    window.localStorage.setItem(agentManagerUiStorageKey(cacheKey), JSON.stringify(ui));
  } catch {
    // ignore localStorage quota/security errors
  }
}

function AgentManagementMetric(props: { label: string; value: string | number }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 px-0.5 py-0.5">
      <span className="truncate text-xs text-dls-secondary">{props.label}</span>
      <span className="shrink-0 text-xs font-medium tabular-nums text-dls-text">{props.value}</span>
    </div>
  );
}

const PANEL_TABS: Array<{
  id: AgentManagementPanel;
  icon: typeof ShoppingBag;
  labelKey: string;
  archiveOnly?: boolean;
}> = [
  { id: "providers", icon: ShoppingBag, labelKey: "agent_manager.providers" },
  { id: "agents", icon: Cpu, labelKey: "agent_manager.agent_check" },
  { id: "skills", icon: FileText, labelKey: "agent_manager.skill_management" },
  { id: "mcp", icon: Plug, labelKey: "agent_manager.mcp.tab" },
  { id: "archive", icon: Archive, labelKey: "nav.session_archive", archiveOnly: true },
];

export function AgentManagementPage(props: {
  workspaceRoot: string;
  sessionArchiveSlot?: ReactNode;
  intent?: { key: string; action: "createProvider" | "openPanel"; panel?: AgentManagementPanel; focus?: "custom" | "detected" } | null;
}) {
  const cacheKey = agentManagerCacheKey(props.workspaceRoot);
  const initialUi = useMemo(() => readInitialAgentManagementUi(cacheKey), [cacheKey]);
  const [snapshot, setSnapshot] = useState<AgentManagementSnapshot | null>(() => AGENT_MANAGER_SNAPSHOT_CACHE.get(cacheKey) ?? null);
  const consumedIntentRef = useRef<string | null>(null);
  const [activePanel, setActivePanel] = useState<AgentManagementPanel>(() => initialUi.activePanel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerActionKey, setProviderActionKey] = useState<string | null>(null);
  const [providerApp, setProviderApp] = useState<AgentManagementProviderApp>(() => initialUi.providerApp);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(() => defaultProviderDraft(initialUi.providerApp));
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [checkingAgentId, setCheckingAgentId] = useState<string | null>(null);
  const [skillActionKey, setSkillActionKey] = useState<string | null>(null);
  const [mcpActionKey, setMcpActionKey] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, AgentManagementHealthResult>>(() => initialUi.healthResults);
  const [skillColumnFilter, setSkillColumnFilter] = useState<AgentManagementSkillAgent[]>(() => initialUi.skillColumnFilter);
  const [skillSearch, setSkillSearch] = useState(() => initialUi.skillSearch);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(() => initialUi.selectedSkillKey);
  const refresh = useCallback(async (options?: { force?: boolean }) => {
    const cached = AGENT_MANAGER_SNAPSHOT_CACHE.get(cacheKey);
    if (cached && !options?.force) {
      setSnapshot(cached);
      setError(null);
      return cached;
    }
    setLoading(true);
    setError(null);
    try {
      const nextSnapshot = await agentManagementSnapshot({ workspaceRoot: props.workspaceRoot });
      AGENT_MANAGER_SNAPSHOT_CACHE.set(cacheKey, nextSnapshot);
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      return null;
    } finally {
      setLoading(false);
    }
  }, [cacheKey, props.workspaceRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    writeAgentManagementUi(cacheKey, {
      activePanel,
      providerApp,
      skillColumnFilter,
      skillSearch,
      selectedSkillKey,
      healthResults,
    });
  }, [activePanel, cacheKey, healthResults, providerApp, selectedSkillKey, skillColumnFilter, skillSearch]);

  const [agentFilter, setAgentFilter] = useState<"all" | "available" | "unavailable" | "needs_auth" | "missing">("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentManagementAgent | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [repairAgent, setRepairAgent] = useState<AgentManagementAgent | null>(null);
  const [customFocusPending, setCustomFocusPending] = useState(false);
  const customSectionRef = useRef<HTMLDivElement>(null);

  // Detected section = the built-in providers PLUS the discoverable catalog
  // (known agents surfaced even when not installed). Custom section = only the
  // user's own registered custom agents (discoverable entries are read-only and
  // must not show edit/delete/enable controls).
  const detectedAgents = useMemo(
    () => (snapshot?.agents ?? []).filter((agent) => agent.provider !== "custom" || agent.discoverable),
    [snapshot?.agents],
  );
  const customAgents = useMemo(
    () => (snapshot?.agents ?? []).filter((agent) => agent.provider === "custom" && !agent.discoverable),
    [snapshot?.agents],
  );
  const filteredDetectedAgents = useMemo(() => {
    if (agentFilter === "available") return detectedAgents.filter((agent) => agent.status === "online");
    if (agentFilter === "unavailable") return detectedAgents.filter((agent) => agent.status !== "online");
    if (agentFilter === "needs_auth") return detectedAgents.filter((agent) => agent.status === "needs_auth");
    if (agentFilter === "missing") return detectedAgents.filter((agent) => agent.status === "missing");
    return detectedAgents;
  }, [agentFilter, detectedAgents]);
  // Custom agents (e.g. CodeBuddy added via "detect available") must also
  // respect the availability filter, otherwise an online custom agent stays
  // visible under the "不可用" tab and looks wrongly classified as unavailable.
  const filteredCustomAgents = useMemo(() => {
    if (agentFilter === "all") return customAgents;
    if (agentFilter === "available") return customAgents.filter((agent) => agent.status === "online");
    if (agentFilter === "unavailable") return customAgents.filter((agent) => agent.status !== "online");
    if (agentFilter === "needs_auth") return customAgents.filter((agent) => agent.status === "needs_auth");
    if (agentFilter === "missing") return customAgents.filter((agent) => agent.status === "missing");
    return customAgents.filter((agent) => agent.status === agentFilter);
  }, [agentFilter, customAgents]);

  const openAddCustomAgent = useCallback(() => {
    setEditingAgent(null);
    setEditorError(null);
    setEditorBusy(false);
    setEditorOpen(true);
  }, []);

  const openEditCustomAgent = useCallback((agent: AgentManagementAgent) => {
    setEditingAgent(agent);
    setEditorError(null);
    setEditorBusy(false);
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingAgent(null);
    setEditorError(null);
    setEditorBusy(false);
  }, []);

  const openRepair = useCallback((agent: AgentManagementAgent) => {
    setRepairAgent(agent);
  }, []);

  const handleSaveCustomAgent = useCallback(async (value: InlineAgentEditorValue) => {
    setEditorBusy(true);
    setEditorError(null);
    try {
      const agentInput = {
        id: value.id,
        name: value.name,
        command: value.command,
        args: value.args,
        env: value.env,
        description: value.description,
        nativeSkillsDirs: value.nativeSkillsDirs,
        behaviorPolicy: value.behaviorPolicy,
        connectionType: value.connectionType,
        acpArgs: value.acpArgs,
        supportsAcp: value.connectionType === "cli",
        supportsStreaming: value.supportsStreaming,
        supportsResume: value.supportsResume,
        supportsApproval: value.supportsApproval,
        supportsModelOverride: value.supportsModelOverride,
        authRequired: value.authRequired,
      };
      if (editingAgent) {
        await personalLocalAgentUpdateCustomAgent({ workspaceRoot: props.workspaceRoot, id: editingAgent.id, agent: agentInput });
      } else {
        await personalLocalAgentCreateCustomAgent({ workspaceRoot: props.workspaceRoot, id: value.id, agent: agentInput });
      }
      await refresh({ force: true });
      closeEditor();
    } catch (saveError) {
      setEditorError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setEditorBusy(false);
    }
  }, [closeEditor, editingAgent, props.workspaceRoot, refresh]);

  const handleToggleCustomAgentEnabled = useCallback(async (agent: AgentManagementAgent, enabled: boolean) => {
    try {
      await personalLocalAgentUpdateCustomAgent({ workspaceRoot: props.workspaceRoot, id: agent.id, agent: { enabled } });
      await refresh({ force: true });
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
  }, [props.workspaceRoot, refresh]);

  const handleDeleteCustomAgent = useCallback(async (agent: AgentManagementAgent) => {
    try {
      await personalLocalAgentDeleteCustomAgent({ workspaceRoot: props.workspaceRoot, id: agent.id });
      await refresh({ force: true });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  }, [props.workspaceRoot, refresh]);

  useEffect(() => {
    const intent = props.intent;
    if (!intent || consumedIntentRef.current === intent.key) return;
    consumedIntentRef.current = intent.key;
    if (intent.action === "createProvider") {
      setActivePanel("providers");
      setProviderApp("opencode");
      setProviderDraft(defaultProviderDraft("opencode"));
      setProviderModalOpen(true);
    } else if (intent.action === "openPanel" && intent.panel && isAgentManagementPanel(intent.panel)) {
      setActivePanel(intent.panel);
      setCustomFocusPending(intent.focus === "custom");
    }
  }, [props.intent]);

  useEffect(() => {
    if (customFocusPending && activePanel === "agents") {
      customSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setCustomFocusPending(false);
    }
  }, [customFocusPending, activePanel]);

  const selectProviderApp = useCallback((app: AgentManagementProviderApp) => {
    setProviderApp(app);
    setProviderDraft(defaultProviderDraft(app));
    setProviderModalOpen(false);
  }, []);

  const openCreateProvider = useCallback(() => {
    setProviderDraft(defaultProviderDraft(providerApp));
    setProviderModalOpen(true);
  }, [providerApp]);

  const openEditProvider = useCallback((provider: AgentManagementManagedProvider) => {
    setProviderApp(provider.appType);
    setProviderDraft(providerDraftFromProvider(provider));
    setProviderModalOpen(true);
  }, []);

  const runProviderAction = useCallback(async (
    input: Parameters<typeof agentManagementProviderAction>[0],
    busyKey: string,
  ) => {
    setProviderActionKey(busyKey);
    setError(null);
    try {
      const result = await agentManagementProviderAction({ ...input, workspaceRoot: props.workspaceRoot });
      setSnapshot((current) => {
        if (!current) return current;
        const nextSnapshot = { ...current, providers: result.providers };
        AGENT_MANAGER_SNAPSHOT_CACHE.set(cacheKey, nextSnapshot);
        return nextSnapshot;
      });
      if (input.action === "save") {
        setProviderDraft(defaultProviderDraft(input.appType));
        setProviderModalOpen(false);
      }
    } catch (providerError) {
      setError(providerError instanceof Error ? providerError.message : String(providerError));
    } finally {
      setProviderActionKey(null);
    }
  }, [cacheKey, props.workspaceRoot]);

  const submitProviderDraft = useCallback(() => {
    runProviderAction({
      action: "save",
      appType: providerApp,
      syncLive: true,
      provider: {
        id: providerDraft.id,
        name: providerDraft.name,
        settingsConfig: providerDraft.settingsJson.trim() ? providerDraft.settingsJson : undefined,
        simple: {
          id: providerDraft.id,
          name: providerDraft.name,
          baseUrl: providerDraft.baseUrl,
          apiKey: providerDraft.apiKey,
          models: providerApp === "claude" || providerApp === "codex" ? providerDraft.models : serializeProviderModelRows(providerDraft.modelRows),
          claudeHaikuModel: providerDraft.claudeHaikuModel,
          claudeHaikuName: providerDraft.claudeHaikuName,
          claudeSonnetModel: providerDraft.claudeSonnetModel,
          claudeSonnetName: providerDraft.claudeSonnetName,
          claudeOpusModel: providerDraft.claudeOpusModel,
          claudeOpusName: providerDraft.claudeOpusName,
          claudeFableModel: providerDraft.claudeFableModel,
          claudeFableName: providerDraft.claudeFableName,
          codexCatalog: serializeCodexCatalogRows(providerDraft.codexCatalogRows),
        },
      },
    }, `provider:${providerApp}:save`);
  }, [providerApp, providerDraft, runProviderAction]);

  // Lightweight connection probe that works for ANY agent status (online /
  // needs_auth / offline / missing). Unlike the old health-check which only ran
  // for already-online agents and spawned a full session, this mirrors Upstream's
  // "Test Connection" — a quick ACP probe usable even when the agent is not
  // installed or not yet authenticated.
  const runTestConnection = useCallback(async (agent: AgentManagementAgent) => {
    setCheckingAgentId(agent.id);
    setError(null);
    setHealthResults((current) => ({
      ...current,
      [agent.id]: {
        status: "running",
        at: Date.now(),
        runId: null,
        output: t("agent_manager.agent_card.test_connection_running"),
        error: null,
      },
    }));
    try {
      const result = await personalLocalAgentTestConnection({
        agent,
        workspaceRoot: props.workspaceRoot,
      });
      setHealthResults((current) => ({
        ...current,
        [agent.id]: {
          // Upstream parity: a probe that reaches the agent but reports
          // needs_auth / missing is NOT a failure — surface it as its own
          // neutral/warning state instead of "failed".
          status: result.ok
            ? "passed"
            : result.status === "needs_auth"
              ? "needs_auth"
              : result.status === "missing"
                ? "missing"
                : "failed",
          at: result.checkedAt,
          runId: null,
          output: describeAgentTestConnection(result),
          error: result.error,
        },
      }));
      await refresh({ force: true });
    } catch (connError) {
      const message = connError instanceof Error ? connError.message : String(connError);
      setHealthResults((current) => ({
        ...current,
        [agent.id]: {
          status: "failed",
          at: Date.now(),
          runId: null,
          output: "",
          error: message,
        },
      }));
      setError(message);
    } finally {
      setCheckingAgentId(null);
    }
  }, [props.workspaceRoot, refresh]);

  const runSkillAction = useCallback(async (
    skill: AgentManagementSkill,
    agent: AgentManagementSkillAgent,
    action: "enable" | "disable" | "open" | "import",
  ) => {
    const key = action === "import" ? `${skill.path}:${agent}:import` : `${skill.path}:${agent}`;
    setSkillActionKey(key);
    setError(null);
    try {
      await agentManagementSkillAction({
        action,
        agent,
        directory: skill.name,
        sourcePath: skill.path,
        displayName: skill.displayNameZh || skill.displayNameEn || skill.name,
        description: skill.descriptionZh || skill.descriptionEn || skill.description,
        kind: skill.kind,
      });
      if (action !== "open") await refresh({ force: true });
    } catch (skillError) {
      setError(skillError instanceof Error ? skillError.message : String(skillError));
    } finally {
      setSkillActionKey(null);
    }
  }, [refresh]);

  const runMcpAction = useCallback(async (
    input: Parameters<typeof agentManagementMcpAction>[0],
    busyKey: string,
  ) => {
    setMcpActionKey(busyKey);
    setError(null);
    try {
      const result = await agentManagementMcpAction(input);
      setSnapshot((current) => {
        if (!current) return current;
        const nextSnapshot = { ...current, mcp: result.snapshot };
        AGENT_MANAGER_SNAPSHOT_CACHE.set(cacheKey, nextSnapshot);
        return nextSnapshot;
      });
    } catch (mcpError) {
      setError(mcpError instanceof Error ? mcpError.message : String(mcpError));
    } finally {
      setMcpActionKey(null);
    }
  }, [cacheKey]);

  const skills = useMemo(() => {
    const items = snapshot?.skills ?? [];
    const query = skillSearch.trim().toLowerCase();
    return items.filter((skill) => {
      if (!query) return true;
      const haystack = [
        skill.name,
        skill.displayNameZh,
        skill.displayNameEn,
        skill.description,
        skill.descriptionZh,
        skill.descriptionEn,
        skill.path,
        ...skill.sources.map((source) => `${source.label} ${source.root}`),
      ].filter(Boolean).join("\n").toLowerCase();
      return haystack.includes(query);
    });
  }, [snapshot?.skills, skillSearch]);

  const skillCountsByAgent = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const skill of snapshot?.skills ?? []) {
      for (const agent of skill.agents) counts[agent] = (counts[agent] ?? 0) + 1;
    }
    return counts;
  }, [snapshot?.skills]);

  const totalRuns = snapshot?.agents.reduce((sum, agent) => sum + agent.usage.runs, 0) ?? 0;
  const onlineAgents = snapshot?.agents.filter((agent) => agent.status === "online").length ?? 0;
  const managedProviderTotal = snapshot?.providers.total ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      <header className={shellChrome.pageHeader}>
        <h2 className={cn("min-w-0 truncate", typeScale.pageTitle)}>
          {t("agent_manager.title")}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void refresh({ force: true })}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          className="text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text"
        >
          {loading ? <LoadingSpinner size="sm" /> : <RefreshCw className="size-4" />}
        </Button>
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 px-6 py-4",
          activePanel === "archive" ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        <div
          className={cn(
            "mx-auto w-full max-w-6xl",
            activePanel === "archive" ? "flex h-full min-h-0 flex-col gap-4" : "space-y-4",
          )}
        >
          {error ? <NoticeBox size="comfortable" tone="error">{error}</NoticeBox> : null}

          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedTabGroup density="filter">
                {PANEL_TABS.filter((tab) => !tab.archiveOnly || props.sessionArchiveSlot).map(
                  (tab) => {
                    const Icon = tab.icon;
                    const active = activePanel === tab.id;
                    return (
                      <NavTabButton
                        key={tab.id}
                        active={active}
                        onClick={() => setActivePanel(tab.id)}
                        size="tab"
                        shape="tab"
                      >
                        <Icon className="size-3.5 shrink-0" />
                        {t(tab.labelKey)}
                      </NavTabButton>
                    );
                  },
                )}
              </SegmentedTabGroup>
              {activePanel === "agents" ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <AgentManagementMetric
                    label={t("agent_manager.online_agents")}
                    value={`${onlineAgents} / ${snapshot?.agents.length ?? 0}`}
                  />
                  <AgentManagementMetric label={t("agent_manager.local_runs")} value={totalRuns} />
                  <AgentManagementMetric
                    label={t("agent_manager.recognized_skills")}
                    value={snapshot?.skills.length ?? 0}
                  />
                  <AgentManagementMetric
                    label={t("agent_manager.managed_providers")}
                    value={managedProviderTotal}
                  />
                </div>
              ) : null}
            </div>
          </div>

          {activePanel === "archive" && props.sessionArchiveSlot ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
              {props.sessionArchiveSlot}
            </div>
          ) : activePanel === "providers" ? (
            <>
              <AgentManagementProviderPanel
                snapshot={snapshot}
                busyKey={providerActionKey}
                selectedApp={providerApp}
                onCreateProvider={openCreateProvider}
                onEditProvider={openEditProvider}
                onSelectApp={selectProviderApp}
                onProviderAction={runProviderAction}
              />
              <AgentManagementProviderModal
                open={providerModalOpen}
                appType={providerApp}
                draft={providerDraft}
                busy={providerActionKey === `provider:${providerApp}:save`}
                onOpenChange={setProviderModalOpen}
                onDraftChange={setProviderDraft}
                onSubmit={submitProviderDraft}
              />
            </>
          ) : activePanel === "mcp" ? (
            <AgentManagementMcpPanel
              snapshot={snapshot?.mcp ?? null}
              busyKey={mcpActionKey}
              onMcpAction={runMcpAction}
            />
          ) : activePanel === "agents" ? (
            <section className="space-y-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="size-4 text-dls-secondary" />
                    <h3 className="text-sm font-medium">{t("agent_manager.detected_agents")}</h3>
                    <span className="text-xs text-dls-secondary">
                      {filteredDetectedAgents.length} / {detectedAgents.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-0.5">
                    <FilterChip
                      selected={agentFilter === "all"}
                      onClick={() => setAgentFilter("all")}
                      label={t("agent_manager.filter_all")}
                    />
                    <FilterChip
                      selected={agentFilter === "available"}
                      onClick={() => setAgentFilter("available")}
                      label={t("agent_manager.filter_available")}
                    />
                    <FilterChip
                      selected={agentFilter === "unavailable"}
                      onClick={() => setAgentFilter("unavailable")}
                      label={t("agent_manager.filter_unavailable")}
                    />
                    <FilterChip
                      selected={agentFilter === "needs_auth"}
                      onClick={() => setAgentFilter("needs_auth")}
                      label={t("local_agent.filter_needs_auth")}
                    />
                    <FilterChip
                      selected={agentFilter === "missing"}
                      onClick={() => setAgentFilter("missing")}
                      label={t("local_agent.filter_missing")}
                    />
                  </div>
                </div>
                {detectedAgents.length === 0 ? (
                  <EmptyStateBox size="spacious" tone="surface" className="text-sm">
                    {t("agent_manager.detected_agents_desc")}
                  </EmptyStateBox>
                ) : (
                  <div className="space-y-2">
                    {filteredDetectedAgents.map((agent) => (
                      <AgentManagementAgentCard
                        key={agent.id}
                        agent={agent}
                        health={healthResults[agent.id]}
                        checking={checkingAgentId === agent.id}
                        onTestConnection={runTestConnection}
                        onRepair={openRepair}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div ref={customSectionRef} className="scroll-mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Bot className="size-4 text-dls-secondary" />
                    <h3 className="text-sm font-medium">{t("agent_manager.custom_agents")}</h3>
                    <span className="text-xs text-dls-secondary">{filteredCustomAgents.length}</span>
                  </div>
                  <Button variant="default" size="sm" onClick={openAddCustomAgent}>
                    <Plus className="mr-1.5 size-3.5" />
                    {t("agent_manager.custom_agents_add")}
                  </Button>
                </div>
                {customAgents.length === 0 ? (
                  <EmptyStateBox size="spacious" tone="surface" className="text-sm">
                    {t("agent_manager.custom_agents_empty")}
                  </EmptyStateBox>
                ) : (
                  <div className="space-y-2">
                    {filteredCustomAgents.map((agent) => (
                      <AgentManagementAgentCard
                        key={agent.id}
                        agent={agent}
                        health={healthResults[agent.id]}
                        checking={checkingAgentId === agent.id}
                        onTestConnection={runTestConnection}
                        onToggleEnabled={handleToggleCustomAgentEnabled}
                        onDelete={handleDeleteCustomAgent}
                        onEdit={openEditCustomAgent}
                      />
                    ))}
                  </div>
                )}
              </div>

              <ExtensionListPanel />
            </section>
          ) : (
            <SkillMatrixPanel
              skills={skills}
              totalSkills={snapshot?.skills.length ?? 0}
              search={skillSearch}
              onSearchChange={setSkillSearch}
              busyKey={skillActionKey}
              onSkillAction={runSkillAction}
              columnFilter={skillColumnFilter}
              onColumnFilterChange={setSkillColumnFilter}
              countsByAgent={skillCountsByAgent}
              selectedSkill={selectedSkillKey ? (snapshot?.skills.find((item) => `${item.path}/${item.name}` === selectedSkillKey) ?? null) : null}
              onSelectSkill={(skill) => setSelectedSkillKey(skill ? `${skill.path}/${skill.name}` : null)}
            />
          )}
        </div>
      </div>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-dls-surface p-0 text-dls-text sm:!max-w-none">
          <DialogHeader className="border-b border-dls-border px-5 py-4">
            <DialogTitle className="truncate text-base font-medium text-dls-text">
              {editingAgent ? t("agent_manager.custom_agents_edit") : t("agent_manager.custom_agents_add")}
            </DialogTitle>
          </DialogHeader>
          <div className="px-5 py-4">
            <InlineAgentEditor
              agent={editingAgent}
              busy={editorBusy}
              error={editorError}
              onCancel={closeEditor}
              onSave={handleSaveCustomAgent}
            />
          </div>
        </DialogContent>
      </Dialog>

      {repairAgent ? (
        <AgentManagementRepairDialog
          agent={repairAgent}
          workspaceRoot={props.workspaceRoot}
          onClose={() => setRepairAgent(null)}
          onSaved={() => void refresh({ force: true })}
        />
      ) : null}
    </div>
  );
}
