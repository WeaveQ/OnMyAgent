/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Boxes, Cpu, MessagesSquare, Monitor, Plug, Plus, Puzzle, RefreshCw } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { FilterChip, NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shellChrome } from "@/react-app/design-system/type-scale";
import { cn } from "@/lib/utils";
import { useStatusToasts } from "../../shell-feedback";
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
  type AgentManagementHealthResult,
} from "./agent-management-health";
import { agentDisplayStatus, agentOwnership } from "./agent-card-model";
import {
  partitionAgentsForFleet,
  shouldAutoAdoptToStore,
  collectUnavailableSkillAgents,
  visibleSkillMatrixAgents,
} from "./agent-fleet-model";
import { STUDIO_SWITCH_SKILL_AGENT_OPTIONS } from "./agent-management-skill-model";
import {
  countFleetRelatedSkills,
  countSharedPoolSkills,
  filterSkillsByInventoryScope,
  type SkillInventoryScope,
} from "./skill-inventory-scope";
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

type AgentManagerSnapshotCacheEntry = {
  snapshot: AgentManagementSnapshot;
  fetchedAt: number;
};

const AGENT_MANAGER_PANEL_STORAGE_KEY = "onmyagent.agentManagement.activePanel";
/** In-memory snapshot cache across remounts (sidebar view unmounts this page). */
const AGENT_MANAGER_SNAPSHOT_CACHE = new Map<string, AgentManagerSnapshotCacheEntry>();
const AGENT_MANAGER_UI_CACHE = new Map<string, AgentManagementUiCache>();
/** Soft TTL: re-entry within this window reuses cache without network. After TTL, silent background revalidate. */
const AGENT_MANAGER_SNAPSHOT_TTL_MS = 60_000;

function agentManagerCacheKey(workspaceRoot: string) {
  return workspaceRoot.trim() || "__default_workspace__";
}

function readCachedAgentManagerSnapshot(cacheKey: string): AgentManagementSnapshot | null {
  return AGENT_MANAGER_SNAPSHOT_CACHE.get(cacheKey)?.snapshot ?? null;
}

function writeCachedAgentManagerSnapshot(cacheKey: string, snapshot: AgentManagementSnapshot) {
  AGENT_MANAGER_SNAPSHOT_CACHE.set(cacheKey, { snapshot, fetchedAt: Date.now() });
}

function isAgentManagerSnapshotCacheFresh(cacheKey: string, ttlMs = AGENT_MANAGER_SNAPSHOT_TTL_MS) {
  const entry = AGENT_MANAGER_SNAPSHOT_CACHE.get(cacheKey);
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < ttlMs;
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
    activePanel: "agents",
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
    return modelCount
      ? t("agent_manager.conn_ok_models", { count: modelCount })
      : t("agent_manager.conn_ok");
  }
  if (result.status === "needs_auth") {
    return t("agent_manager.conn_needs_auth", {
      detail: result.error ? `：${result.error}` : "",
    });
  }
  if (result.status === "missing") {
    return t("agent_manager.conn_missing", {
      detail: result.error ? `：${result.error}` : "",
    });
  }
  return t("agent_manager.conn_failed", {
    detail: result.error ? `：${result.error}` : `（${result.step}）`,
  });
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
    return { ...defaultAgentManagementUiCache(), activePanel: isAgentManagementPanel(storedPanel) ? storedPanel : "agents" };
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
  icon: typeof Monitor;
  labelKey: string;
  archiveOnly?: boolean;
}> = [
  // Compact labels: 本地 / 模型 / 技能 / MCP / 会话
  { id: "agents", icon: Monitor, labelKey: "agent_manager.tab_agents" },
  { id: "providers", icon: Boxes, labelKey: "agent_manager.tab_providers" },
  { id: "skills", icon: Puzzle, labelKey: "agent_manager.tab_skills" },
  { id: "mcp", icon: Plug, labelKey: "agent_manager.tab_mcp" },
  { id: "archive", icon: MessagesSquare, labelKey: "agent_manager.tab_archive", archiveOnly: true },
];

export function AgentManagementPage(props: {
  workspaceRoot: string;
  sessionArchiveSlot?: ReactNode;
  intent?: { key: string; action: "createProvider" | "openPanel"; panel?: AgentManagementPanel; focus?: "custom" | "detected" } | null;
}) {
  const { showToast } = useStatusToasts();
  const cacheKey = agentManagerCacheKey(props.workspaceRoot);
  const initialUi = useMemo(() => readInitialAgentManagementUi(cacheKey), [cacheKey]);
  const [snapshot, setSnapshot] = useState<AgentManagementSnapshot | null>(() => readCachedAgentManagerSnapshot(cacheKey));
  const consumedIntentRef = useRef<string | null>(null);
  const [activePanel, setActivePanel] = useState<AgentManagementPanel>(() => initialUi.activePanel);
  /** Full-page loading only when there is no cached snapshot to show. */
  const [loading, setLoading] = useState(() => !readCachedAgentManagerSnapshot(cacheKey));
  /** Quiet revalidate / manual refresh while content stays visible. */
  const [refreshing, setRefreshing] = useState(false);
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
  /** Default fleet: only skills tied to managed agents (not full-disk 155). */
  const [skillInventoryScope, setSkillInventoryScope] = useState<SkillInventoryScope>("fleet");
  const refresh = useCallback(async (options?: { force?: boolean }) => {
    const cached = readCachedAgentManagerSnapshot(cacheKey);

    // Cache-first: paint instantly on re-entry. Fresh cache skips network entirely.
    if (cached && !options?.force) {
      setSnapshot(cached);
      setError(null);
      setLoading(false);
      if (isAgentManagerSnapshotCacheFresh(cacheKey)) {
        return cached;
      }
    }

    // Have data → quiet background revalidate. No data → centered full loading.
    if (cached || options?.force) {
      setRefreshing(true);
      if (!cached) setLoading(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const nextSnapshot = await agentManagementSnapshot({ workspaceRoot: props.workspaceRoot });
      writeCachedAgentManagerSnapshot(cacheKey, nextSnapshot);
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch (loadError) {
      // Keep stale cache on screen when background revalidate fails.
      if (!cached) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
      return cached;
    } finally {
      setLoading(false);
      setRefreshing(false);
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

  /** Mutually exclusive filters aligned with card badges: healthy / needs-auth / offline / not-installed. */
  const [agentFilter, setAgentFilter] = useState<"all" | "online" | "needs_auth" | "offline" | "missing">("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentManagementAgent | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [repairAgent, setRepairAgent] = useState<AgentManagementAgent | null>(null);
  const [customFocusPending, setCustomFocusPending] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(true);
  const fleetSectionRef = useRef<HTMLDivElement>(null);
  const autoAdoptInFlightRef = useRef(false);
  const autoAdoptedIdsRef = useRef<Set<string>>(new Set());

  /** First paint without cache: show spinners, never inventory-empty copy. */
  const snapshotPending = loading && !snapshot;

  // Managed fleet (primary) vs discover catalog (secondary).
  const fleetParts = useMemo(
    () => partitionAgentsForFleet(snapshot?.agents ?? [], healthResults),
    [snapshot?.agents, healthResults],
  );
  const managedAgents = fleetParts.managed;
  const discoverAgents = fleetParts.discover;
  // Status chips (健康 / 需登录 / 离线 / 未安装) only filter「我的智能体」.
  // Discover catalog always lists the full installable set.
  const filteredManagedAgents = useMemo(() => {
    if (agentFilter === "all") return managedAgents;
    return managedAgents.filter((agent) => agentDisplayStatus(agent, healthResults[agent.id]) === agentFilter);
  }, [agentFilter, managedAgents, healthResults]);

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

  const [addingAgentId, setAddingAgentId] = useState<string | null>(null);

  const catalogAgentToStoreInput = useCallback((agent: AgentManagementAgent) => {
    const draft = agent as AgentManagementAgent & {
      supportsStreaming?: boolean;
      supportsResume?: boolean;
      supportsApproval?: boolean;
      supportsModelOverride?: boolean;
      authRequired?: boolean;
      description?: string | null;
      customArgs?: string[];
    };
    const command = String(draft.executablePath ?? "").trim() || String(draft.id ?? "").trim();
    if (!command) throw new Error(t("local_agent.editor_error_command"));
    const connectionType = draft.connectionType === "raw" ? ("raw" as const) : ("cli" as const);
    const acpArgs = Array.isArray(draft.acpArgs) ? draft.acpArgs : [];
    const customId = String(draft.id).trim();
    return {
      id: customId,
      agent: {
        id: customId,
        name: draft.name,
        command,
        args: Array.isArray(draft.customArgs) ? draft.customArgs : [],
        connectionType,
        acpArgs,
        supportsAcp: connectionType === "cli",
        supportsStreaming: draft.supportsStreaming !== false && connectionType === "cli",
        supportsResume: draft.supportsResume === true,
        supportsApproval: draft.supportsApproval === true,
        supportsModelOverride: draft.supportsModelOverride === true,
        authRequired: draft.authRequired === true,
        nativeSkillsDirs: Array.isArray(draft.nativeSkillsDirs) ? draft.nativeSkillsDirs : [],
        description: typeof draft.description === "string" ? draft.description : null,
        agentSource: "custom" as const,
      },
    };
  }, []);

  /** Catalog (discoverable) → user-owned custom agent in the managed fleet. */
  const handleAddDiscoverableAsCustom = useCallback(async (agent: AgentManagementAgent) => {
    if (addingAgentId) return;
    if (!String(props.workspaceRoot ?? "").trim()) {
      showToast({
        tone: "error",
        title: t("agent_manager.agent_card.add_as_mine_fail_title"),
        description: t("agent_manager.agent_card.add_as_mine_no_workspace"),
      });
      return;
    }
    setAddingAgentId(agent.id);
    setError(null);
    try {
      const payload = catalogAgentToStoreInput(agent);
      await personalLocalAgentCreateCustomAgent({
        workspaceRoot: props.workspaceRoot,
        id: payload.id,
        agent: payload.agent,
      });
      await refresh({ force: true });
      setCustomFocusPending(true);
      showToast({
        tone: "success",
        title: t("agent_manager.agent_card.add_as_mine_ok_title", { name: agent.name }),
        description: t("agent_manager.agent_card.add_as_mine_ok_desc"),
      });
    } catch (addError) {
      const raw = addError instanceof Error ? addError.message : String(addError);
      const already = /already exists/i.test(raw);
      if (already) {
        await refresh({ force: true });
        setCustomFocusPending(true);
        showToast({
          tone: "success",
          title: t("agent_manager.agent_card.add_as_mine_ok_title", { name: agent.name }),
          description: t("agent_manager.agent_card.add_as_mine_exists", { name: agent.name }),
        });
        return;
      }
      const message = /command is required|editor_error_command|\u4e0d\u80fd\u4e3a\u7a7a/i.test(raw)
        ? t("local_agent.editor_error_command")
        : raw;
      setError(message);
      showToast({
        tone: "error",
        title: t("agent_manager.agent_card.add_as_mine_fail_title"),
        description: message,
      });
    } finally {
      setAddingAgentId(null);
    }
  }, [addingAgentId, catalogAgentToStoreInput, props.workspaceRoot, refresh, showToast]);

  // Idempotent auto-adopt: installed common catalog agents enter the fleet store.
  useEffect(() => {
    if (!snapshot?.agents?.length || !String(props.workspaceRoot ?? "").trim()) return;
    if (autoAdoptInFlightRef.current) return;
    const candidates = snapshot.agents.filter((agent) => {
      if (!shouldAutoAdoptToStore(agent, healthResults[agent.id])) return false;
      if (autoAdoptedIdsRef.current.has(agent.id)) return false;
      return true;
    });
    if (candidates.length === 0) return;
    autoAdoptInFlightRef.current = true;
    void (async () => {
      const adoptedNames: string[] = [];
      for (const agent of candidates) {
        autoAdoptedIdsRef.current.add(agent.id);
        try {
          const payload = catalogAgentToStoreInput(agent);
          await personalLocalAgentCreateCustomAgent({
            workspaceRoot: props.workspaceRoot,
            id: payload.id,
            agent: payload.agent,
          });
          adoptedNames.push(agent.name);
        } catch (error) {
          const raw = error instanceof Error ? error.message : String(error);
          // Already in store: still counts as managed membership.
          if (!/already exists/i.test(raw)) {
            autoAdoptedIdsRef.current.delete(agent.id);
          }
        }
      }
      autoAdoptInFlightRef.current = false;
      if (adoptedNames.length > 0) {
        await refresh({ force: true });
        showToast({
          tone: "success",
          title: t("agent_manager.fleet_auto_adopt_title"),
          description: t("agent_manager.fleet_auto_adopt_desc", {
            names: adoptedNames.slice(0, 4).join("、"),
            count: adoptedNames.length,
          }),
        });
      }
    })();
  }, [catalogAgentToStoreInput, healthResults, props.workspaceRoot, refresh, showToast, snapshot?.agents]);

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
      fleetSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        writeCachedAgentManagerSnapshot(cacheKey, nextSnapshot);
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
        writeCachedAgentManagerSnapshot(cacheKey, nextSnapshot);
        return nextSnapshot;
      });
    } catch (mcpError) {
      setError(mcpError instanceof Error ? mcpError.message : String(mcpError));
    } finally {
      setMcpActionKey(null);
    }
  }, [cacheKey]);

  const matrixAgents = useMemo(() => {
    const keys = visibleSkillMatrixAgents(
      STUDIO_SWITCH_SKILL_AGENT_OPTIONS,
      snapshot?.agents ?? [],
      healthResults,
    );
    // Prefer known product keys; keep custom ids that declare skill dirs.
    return keys as AgentManagementSkillAgent[];
  }, [snapshot?.agents, healthResults]);

  const unavailableSkillAgents = useMemo(
    () =>
      collectUnavailableSkillAgents(
        matrixAgents,
        snapshot?.agents ?? [],
        healthResults,
      ),
    [matrixAgents, snapshot?.agents, healthResults],
  );

  const skillScopeCounts = useMemo(() => {
    const all = snapshot?.skills ?? [];
    return {
      all: all.length,
      fleet: countFleetRelatedSkills(all, matrixAgents),
      shared: countSharedPoolSkills(all),
    };
  }, [snapshot?.skills, matrixAgents]);

  const skills = useMemo(() => {
    const scoped = filterSkillsByInventoryScope(
      snapshot?.skills ?? [],
      skillInventoryScope,
      matrixAgents,
    );
    const query = skillSearch.trim().toLowerCase();
    if (!query) return scoped;
    return scoped.filter((skill) => {
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
  }, [snapshot?.skills, skillSearch, skillInventoryScope, matrixAgents]);

  const skillCountsByAgent = useMemo(() => {
    const counts: Record<string, number> = {};
    // Counts reflect current inventory scope so column badges match visible rows.
    for (const skill of skills) {
      for (const agent of skill.agents) counts[agent] = (counts[agent] ?? 0) + 1;
    }
    return counts;
  }, [skills]);

  const totalRuns = snapshot?.agents.reduce((sum, agent) => sum + agent.usage.runs, 0) ?? 0;
  const onlineAgents = snapshot?.agents.filter((agent) => agent.status === "online").length ?? 0;
  const managedProviderTotal = snapshot?.providers.total ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      {/* Store-style top chrome: segmented switch only (no page title). */}
      <header
        className={cn(
          shellChrome.pageHeaderSimple,
          // Keep the whole header interactive; metrics + refresh sit under the macOS drag strip.
          "justify-between gap-3 border-b-0 mac:titlebar-no-drag",
        )}
      >
        <SegmentedTabGroup density="bare" className="mac:titlebar-no-drag">
          {PANEL_TABS.filter((tab) => !tab.archiveOnly || props.sessionArchiveSlot).map(
            (tab) => {
              const Icon = tab.icon;
              const active = activePanel === tab.id;
              return (
                <NavTabButton
                  key={tab.id}
                  type="button"
                  active={active}
                  onClick={() => setActivePanel(tab.id)}
                  size="tab"
                  shape="tab"
                  aria-current={active ? "page" : undefined}
                >
                  <Icon aria-hidden />
                  <span>{t(tab.labelKey)}</span>
                </NavTabButton>
              );
            },
          )}
        </SegmentedTabGroup>
        {/*
          mac:titlebar-no-drag: top 28px is a global Electron drag strip on macOS;
          interactive chrome here must opt out or clicks (esp. far-right refresh) are swallowed.
        */}
        <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 mac:titlebar-no-drag">
          {activePanel === "agents" ? (
            <>
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
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={loading || refreshing}
            onClick={() => void refresh({ force: true })}
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
            aria-busy={loading || refreshing || undefined}
            className="relative z-10 text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text mac:titlebar-no-drag"
          >
            {loading || refreshing ? (
              <LoadingSpinner size="sm" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
        </div>
      </header>

      {/*
        Shared content gutter for every tab (本地 / 模型 / 技能 / MCP / 会话).
        Must match shellChrome.pageHeaderSimple (px-6) so left/right inset is identical
        when switching panels — no full-bleed archive vs max-w-6xl agents mismatch.
      */}
      <div
        className={cn(
          "min-h-0 flex-1 px-6 py-4",
          activePanel === "archive" ||
            activePanel === "providers" ||
            activePanel === "skills" ||
            activePanel === "mcp"
            ? "overflow-hidden"
            : "overflow-y-auto",
        )}
      >
        <div
          className={cn(
            "flex h-full min-h-0 w-full flex-col",
            activePanel === "skills" && "gap-4",
            activePanel === "agents" && "space-y-4",
            activePanel === "mcp" && "min-h-0",
          )}
        >
          {error && activePanel !== "archive" ? (
            <NoticeBox size="comfortable" tone="error">{error}</NoticeBox>
          ) : null}

          {activePanel === "archive" && props.sessionArchiveSlot ? (
            <div className="min-h-0 flex-1 overflow-hidden">{props.sessionArchiveSlot}</div>
          ) : activePanel === "providers" ? (
            <>
              <AgentManagementProviderPanel
                snapshot={snapshot}
                loading={snapshotPending}
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
              loading={snapshotPending}
              busyKey={mcpActionKey}
              onMcpAction={runMcpAction}
            />
          ) : activePanel === "agents" ? (
            <section className="space-y-6">
              {/* Primary: managed fleet */}
              <div ref={fleetSectionRef} className="scroll-mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Bot className="size-4 text-dls-secondary" />
                      <h3 className="text-sm font-medium">{t("agent_manager.fleet_title")}</h3>
                      <span className="text-xs tabular-nums text-dls-secondary">
                        {snapshotPending ? "…" : filteredManagedAgents.length}
                        {!snapshotPending && agentFilter !== "all" ? ` / ${managedAgents.length}` : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-dls-secondary">{t("agent_manager.fleet_desc")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap items-center gap-0.5">
                      <FilterChip
                        selected={agentFilter === "all"}
                        onClick={() => setAgentFilter("all")}
                        label={t("agent_manager.filter_all")}
                      />
                      <FilterChip
                        selected={agentFilter === "online"}
                        onClick={() => setAgentFilter("online")}
                        label={t("agent_manager.filter_online")}
                      />
                      <FilterChip
                        selected={agentFilter === "needs_auth"}
                        onClick={() => setAgentFilter("needs_auth")}
                        label={t("agent_manager.filter_needs_auth")}
                      />
                      <FilterChip
                        selected={agentFilter === "offline"}
                        onClick={() => setAgentFilter("offline")}
                        label={t("agent_manager.filter_offline")}
                      />
                      <FilterChip
                        selected={agentFilter === "missing"}
                        onClick={() => setAgentFilter("missing")}
                        label={t("agent_manager.filter_missing")}
                      />
                    </div>
                    <Button variant="default" size="sm" onClick={openAddCustomAgent}>
                      <Plus className="mr-1.5 size-3.5" />
                      {t("agent_manager.custom_agents_add")}
                    </Button>
                  </div>
                </div>
                {snapshotPending ? (
                  <div
                    className="flex min-h-32 items-center justify-center gap-2 text-sm text-dls-secondary"
                    role="status"
                    aria-label={t("common.loading")}
                  >
                    <LoadingSpinner />
                    <span>{t("common.loading")}</span>
                  </div>
                ) : managedAgents.length === 0 ? (
                  <EmptyStateBox size="spacious" tone="surface" className="text-sm">
                    {t("agent_manager.fleet_empty")}
                  </EmptyStateBox>
                ) : filteredManagedAgents.length === 0 ? (
                  <EmptyStateBox size="spacious" tone="surface" className="text-sm">
                    {t("agent_manager.fleet_filter_empty")}
                  </EmptyStateBox>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {filteredManagedAgents.map((agent) => {
                      const ownership = agentOwnership(agent);
                      const isMine = ownership === "mine";
                      return (
                        <AgentManagementAgentCard
                          key={agent.id}
                          agent={agent}
                          health={healthResults[agent.id]}
                          checking={checkingAgentId === agent.id}
                          adding={addingAgentId === agent.id}
                          onTestConnection={runTestConnection}
                          onRepair={openRepair}
                          onToggleEnabled={isMine ? handleToggleCustomAgentEnabled : undefined}
                          onDelete={isMine ? handleDeleteCustomAgent : undefined}
                          onEdit={isMine ? openEditCustomAgent : undefined}
                          onAddAsCustom={
                            ownership === "catalog" ? handleAddDiscoverableAsCustom : undefined
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Secondary: discover / install catalog */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    onClick={() => setDiscoverOpen((open) => !open)}
                    aria-expanded={discoverOpen}
                  >
                    <Cpu className="size-4 shrink-0 text-dls-secondary" />
                    <h3 className="text-sm font-medium text-dls-text">{t("agent_manager.discover_title")}</h3>
                    <span className="text-xs tabular-nums text-dls-secondary">
                      {snapshotPending ? "…" : discoverAgents.length}
                    </span>
                    <span className="text-xs text-dls-secondary">
                      {discoverOpen ? t("agent_manager.discover_collapse") : t("agent_manager.discover_expand")}
                    </span>
                  </button>
                </div>
                {discoverOpen ? (
                  <>
                    <p className="text-xs text-dls-secondary">{t("agent_manager.discover_desc")}</p>
                    {snapshotPending ? (
                      <div
                        className="flex min-h-24 items-center justify-center gap-2 text-sm text-dls-secondary"
                        role="status"
                        aria-label={t("common.loading")}
                      >
                        <LoadingSpinner />
                        <span>{t("common.loading")}</span>
                      </div>
                    ) : discoverAgents.length === 0 ? (
                      <EmptyStateBox size="spacious" tone="surface" className="text-sm">
                        {t("agent_manager.discover_empty")}
                      </EmptyStateBox>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                        {discoverAgents.map((agent) => (
                          <AgentManagementAgentCard
                            key={agent.id}
                            agent={agent}
                            health={healthResults[agent.id]}
                            checking={checkingAgentId === agent.id}
                            adding={addingAgentId === agent.id}
                            onTestConnection={runTestConnection}
                            onRepair={openRepair}
                            onAddAsCustom={handleAddDiscoverableAsCustom}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : null}
              </div>

              <ExtensionListPanel />
            </section>
          ) : (
            <SkillMatrixPanel
              skills={skills}
              totalSkills={skillScopeCounts.all}
              search={skillSearch}
              onSearchChange={setSkillSearch}
              busyKey={skillActionKey}
              onSkillAction={runSkillAction}
              columnFilter={skillColumnFilter}
              onColumnFilterChange={setSkillColumnFilter}
              countsByAgent={skillCountsByAgent}
              selectedSkill={selectedSkillKey ? (snapshot?.skills.find((item) => `${item.path}/${item.name}` === selectedSkillKey) ?? null) : null}
              onSelectSkill={(skill) => setSelectedSkillKey(skill ? `${skill.path}/${skill.name}` : null)}
              matrixAgents={matrixAgents}
              unavailableAgents={unavailableSkillAgents}
              inventoryScope={skillInventoryScope}
              onInventoryScopeChange={setSkillInventoryScope}
              scopeCounts={skillScopeCounts}
              loading={snapshotPending}
            />
          )}
        </div>
      </div>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        {/* Match provider modal: fixed width, sticky chrome, scroll body (legacy layout polish). */}
        <DialogContent className="flex max-h-[90vh] !w-[min(720px,calc(100vw-32px))] !max-w-none flex-col gap-0 overflow-hidden rounded-xl bg-dls-surface p-0 text-dls-text sm:!max-w-none">
          <DialogHeader className="shrink-0 border-b border-dls-border bg-dls-surface px-5 py-3.5">
            <DialogTitle className="truncate text-base font-medium text-dls-text">
              {editingAgent ? t("agent_manager.custom_agents_edit") : t("agent_manager.custom_agents_add")}
            </DialogTitle>
            <p className="mt-0.5 text-xs text-dls-secondary">
              {t("agent_manager.custom_agents_dialog_desc")}
            </p>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col bg-dls-background px-5 py-4">
            <InlineAgentEditor
              agent={editingAgent}
              busy={editorBusy}
              error={editorError}
              embedded
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
