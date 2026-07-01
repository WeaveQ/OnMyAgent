/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Bot, Cloud, Cpu, FileText, HeartPulse, Loader2, Plug, RefreshCw, ShoppingBag, Sparkles, Zap } from "lucide-react";

import { t } from "../../../../../i18n";
import { Button } from "@/components/ui/button";
import { IconTile, NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  agentManagementFetchModels,
  agentManagementMcpAction,
  agentManagementProviderAction,
  agentManagementSetProvider,
  agentManagementSetProxy,
  agentManagementSkillAction,
  agentManagementSnapshot,
  personalLocalAgentStart,
  personalLocalAgentStatus,
  type AgentManagementAgent,
  type AgentManagementManagedProvider,
  type AgentManagementSkill,
  type AgentManagementSkillAgent,
  type AgentManagementSnapshot,
} from "../../../../../app/lib/desktop";
import { AgentManagementAgentCard } from "./agent-management-agent-card";
import {
  formatAgentManagerDuration,
  summarizeAgentManagementHealth,
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
import { AgentManagementProxyPanel } from "./agent-management-proxy-panel";
import { AgentManagementMcpPanel } from "./agent-management-mcp-panel";
import { SkillMatrixPanel } from "./agent-management-skill-matrix";

const AGENT_MANAGER_HEALTH_PROMPT = "Agent 管理健康检查：请只回复 HEALTH_CHECK_OK。";

type AgentManagementPanel = "providers" | "agents" | "skills" | "mcp" | "archive" | "proxy";

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
  return value === "providers" || value === "agents" || value === "skills" || value === "mcp" || value === "archive" || value === "proxy";
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

function coerceAgentManagementUiCache(input: unknown): AgentManagementUiCache {
  const fallback = defaultAgentManagementUiCache();
  if (!input || typeof input !== "object") return fallback;
  const record = input as Record<string, unknown>;
  return {
    activePanel: isAgentManagementPanel(record.activePanel) ? record.activePanel : fallback.activePanel,
    providerApp: isAgentManagementProviderApp(record.providerApp) ? record.providerApp : fallback.providerApp,
    skillColumnFilter: Array.isArray(record.skillColumnFilter) ? record.skillColumnFilter.filter(isAgentManagementSkillAgent) : fallback.skillColumnFilter,
    skillSearch: typeof record.skillSearch === "string" ? record.skillSearch : fallback.skillSearch,
    selectedSkillKey: typeof record.selectedSkillKey === "string" ? record.selectedSkillKey : null,
    healthResults: record.healthResults && typeof record.healthResults === "object" ? record.healthResults as Record<string, AgentManagementHealthResult> : fallback.healthResults,
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
    <div className="rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
      <div className="text-xs text-dls-secondary">{props.label}</div>
      <div className="mt-1 text-base font-medium text-dls-text">{props.value}</div>
    </div>
  );
}

export function AgentManagementPage(props: {
  workspaceRoot: string;
  sessionArchiveSlot?: ReactNode;
  intent?: { key: string; action: "createProvider" } | null;
}) {
  const cacheKey = agentManagerCacheKey(props.workspaceRoot);
  const initialUi = useMemo(() => readInitialAgentManagementUi(cacheKey), [cacheKey]);
  const [snapshot, setSnapshot] = useState<AgentManagementSnapshot | null>(() => AGENT_MANAGER_SNAPSHOT_CACHE.get(cacheKey) ?? null);
  const consumedIntentRef = useRef<string | null>(null);
  const [activePanel, setActivePanel] = useState<AgentManagementPanel>(() => initialUi.activePanel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [providerActionKey, setProviderActionKey] = useState<string | null>(null);
  const [providerApp, setProviderApp] = useState<AgentManagementProviderApp>(() => initialUi.providerApp);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(() => defaultProviderDraft(initialUi.providerApp));
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [checkingAgentId, setCheckingAgentId] = useState<string | null>(null);
  const [skillActionKey, setSkillActionKey] = useState<string | null>(null);
  const [mcpActionKey, setMcpActionKey] = useState<string | null>(null);
  const [proxyActionKey, setProxyActionKey] = useState<string | null>(null);
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

  useEffect(() => {
    const intent = props.intent;
    if (!intent || consumedIntentRef.current === intent.key) return;
    consumedIntentRef.current = intent.key;
    if (intent.action === "createProvider") {
      setActivePanel("providers");
      setProviderApp("opencode");
      setProviderDraft(defaultProviderDraft("opencode"));
      setProviderModalOpen(true);
    }
  }, [props.intent]);

  const switchProvider = useCallback(async (agent: AgentManagementAgent, model: string) => {
    setSavingProvider(agent.provider);
    setError(null);
    try {
      await agentManagementSetProvider({ workspaceRoot: props.workspaceRoot, provider: agent.provider, model });
      await refresh({ force: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingProvider(null);
    }
  }, [props.workspaceRoot, refresh]);

  const runProxyAction = useCallback(async (
    input: Parameters<typeof agentManagementSetProxy>[0],
    busyKey: string,
  ) => {
    setProxyActionKey(busyKey);
    setError(null);
    try {
      await agentManagementSetProxy({ ...input, workspaceRoot: props.workspaceRoot });
      await refresh({ force: true });
    } catch (proxyError) {
      setError(proxyError instanceof Error ? proxyError.message : String(proxyError));
    } finally {
      setProxyActionKey(null);
    }
  }, [props.workspaceRoot, refresh]);

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

  const runHealthCheck = useCallback(async (agent: AgentManagementAgent) => {
    if (agent.status !== "online") return;
    setCheckingAgentId(agent.id);
    setError(null);
    setHealthResults((current) => ({
      ...current,
      [agent.id]: {
        status: "running",
        at: Date.now(),
        runId: null,
        output: "",
        error: null,
      },
    }));
    try {
      let snapshot = await personalLocalAgentStart({
        workspaceRoot: props.workspaceRoot,
        prompt: AGENT_MANAGER_HEALTH_PROMPT,
        agent,
      });
      setHealthResults((current) => ({ ...current, [agent.id]: summarizeAgentManagementHealth(snapshot) }));
      for (let attempt = 0; snapshot.status === "running" && attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        snapshot = await personalLocalAgentStatus(snapshot.runId);
        setHealthResults((current) => ({ ...current, [agent.id]: summarizeAgentManagementHealth(snapshot) }));
      }
      await refresh({ force: true });
    } catch (healthError) {
      const message = healthError instanceof Error ? healthError.message : String(healthError);
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
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-dls-border bg-dls-surface/80 px-6">
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium">
            {t("agent_manager.title")}
          </h2>
          <p className="truncate text-xs text-dls-secondary">
            {t("agent_manager.description")}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => void refresh({ force: true })} title={t("common.refresh")} aria-label={t("common.refresh")}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </header>

      <div className={cn("min-h-0 flex-1 p-5", activePanel === "archive" ? "overflow-hidden" : "overflow-y-auto")}>
        <div className={cn("w-full", activePanel === "archive" ? "flex h-full min-h-0 flex-col gap-5" : "space-y-5")}>
          {error ? <NoticeBox size="comfortable" tone="error">{error}</NoticeBox> : null}

          <section className="grid gap-3 sm:grid-cols-4">
            <AgentManagementMetric label={t("agent_manager.online_agents")} value={`${onlineAgents} / ${snapshot?.agents.length ?? 0}`} />
            <AgentManagementMetric label={t("agent_manager.local_runs")} value={totalRuns} />
            <AgentManagementMetric label={t("agent_manager.recognized_skills")} value={snapshot?.skills.length ?? 0} />
            <AgentManagementMetric label={t("agent_manager.managed_providers")} value={managedProviderTotal} />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dls-border pb-3">
            <div className="inline-flex rounded-lg border border-dls-border bg-dls-surface p-1">
              <NavTabButton
                active={activePanel === "providers"}
                onClick={() => setActivePanel("providers")}
                className="px-3 py-2 text-sm font-medium"
              >
                <ShoppingBag className="size-4" />
                {t("agent_manager.providers")}
              </NavTabButton>
              <NavTabButton
                active={activePanel === "agents"}
                onClick={() => setActivePanel("agents")}
                className="px-3 py-2 text-sm font-medium"
              >
                <Cpu className="size-4" />
                {t("agent_manager.agent_check")}
              </NavTabButton>
              <NavTabButton
                active={activePanel === "skills"}
                onClick={() => setActivePanel("skills")}
                className="px-3 py-2 text-sm font-medium"
              >
                <FileText className="size-4" />
                {t("agent_manager.skill_management")}
              </NavTabButton>
              <NavTabButton
                active={activePanel === "mcp"}
                onClick={() => setActivePanel("mcp")}
                className="px-3 py-2 text-sm font-medium"
              >
                <Plug className="size-4" />
                {t("agent_manager.mcp.tab")}
              </NavTabButton>
              {props.sessionArchiveSlot ? (
                <NavTabButton
                  active={activePanel === "archive"}
                  onClick={() => setActivePanel("archive")}
                  className="px-3 py-2 text-sm font-medium"
                >
                  <Archive className="size-4" />
                  {t("nav.session_archive")}
                </NavTabButton>
              ) : null}
              <NavTabButton
                active={activePanel === "proxy"}
                onClick={() => setActivePanel("proxy")}
                className="px-3 py-2 text-sm font-medium"
              >
                <Zap className="size-4" />
                {t("agent_manager.proxy_control")}
              </NavTabButton>
            </div>
            <div className="text-xs text-dls-secondary">
              {activePanel === "proxy"
                ? t("agent_manager.proxy_desc")
                : activePanel === "archive"
                  ? t("agent_manager.session_archive_desc")
                : activePanel === "mcp"
                  ? t("agent_manager.mcp.desc")
                : activePanel === "providers"
                  ? t("agent_manager.providers_desc")
                  : activePanel === "agents"
                    ? t("agent_manager.agents_desc")
                    : t("agent_manager.skills_desc")}
            </div>
          </div>

          {activePanel === "archive" && props.sessionArchiveSlot ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-dls-border bg-dls-surface">
              {props.sessionArchiveSlot}
            </div>
          ) : activePanel === "proxy" ? (
            <AgentManagementProxyPanel
              snapshot={snapshot}
              busyKey={proxyActionKey}
              onProxyAction={runProxyAction}
            />
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
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-dls-secondary" />
                <h3 className="text-sm font-medium">
                  {t("agent_manager.provider_health")}
                </h3>
              </div>
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {(snapshot?.agents ?? []).map((agent) => (
                  <AgentManagementAgentCard
                    key={agent.id}
                    agent={agent}
                    busy={savingProvider === agent.provider}
                    health={healthResults[agent.id]}
                    checking={checkingAgentId === agent.id}
                    onSwitch={switchProvider}
                    onHealthCheck={runHealthCheck}
                  />
                ))}
              </div>
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
    </div>
  );
}
