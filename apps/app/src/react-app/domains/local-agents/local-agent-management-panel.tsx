/** @jsxImportSource react */
import { memo, useCallback, useMemo, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/status-badge";
import { NoticeBox, EmptyStateBox } from "@/components/ui/notice-box";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import {
  personalLocalAgentCreateCustomAgent,
  personalLocalAgentDeleteCustomAgent,
  personalLocalAgentDetectAvailableAgents,
  personalLocalAgentTestConnection,
  personalLocalAgentUpdateCustomAgent,
  type PersonalLocalAgent,
  type PersonalLocalAgentDetectAvailableAgent,
  type PersonalLocalAgentTestConnectionResult,
} from "../../../app/lib/desktop";
import { InlineAgentEditor, type InlineAgentEditorValue } from "./inline-agent-editor";
import { ExtensionListPanel } from "./extension-list-panel";
import { LocalAgentCard } from "./local-agent-card";
import { LocalAgentRepairPanel, type LocalAgentRepairAction } from "./local-agent-repair-panel";
import {
  LOCAL_AGENT_FILTER_IDS,
  localAgentFilterCounts,
  matchesLocalAgentFilter,
  type LocalAgentFilterId,
} from "./local-agent-filters";

export type LocalAgentManagementPanelProps = {
  agents: PersonalLocalAgent[];
  workspaceRoot: string;
  selectedAgentId?: string | null;
  refreshing?: boolean;
  providerLabel: (agent: PersonalLocalAgent) => string;
  providerIconUrl: (agent: PersonalLocalAgent) => string | null;
  onSelectAgent?: (agentId: string) => void;
  onRefresh?: () => void;
  onAgentsChange?: (agents: PersonalLocalAgent[]) => void;
  onConfigure?: (agent: PersonalLocalAgent) => void;
  onRepairAction?: (action: LocalAgentRepairAction, agent: PersonalLocalAgent) => void;
  /** Repair actions the host actually handles; passed through to RepairPanel. */
  supportedRepairActions?: LocalAgentRepairAction[];
};

const FILTER_LABEL_KEYS: Record<LocalAgentFilterId, string> = {
  all: "local_agent.filter_all",
  available: "local_agent.filter_available",
  unavailable: "local_agent.filter_unavailable",
  needs_auth: "local_agent.filter_needs_auth",
  missing: "local_agent.filter_missing",
};

// Dedicated Local Agent management surface for status, connection checks, and repair guidance.
export const LocalAgentManagementPanel = memo(function LocalAgentManagementPanel(props: LocalAgentManagementPanelProps) {
  const [filter, setFilter] = useState<LocalAgentFilterId>("all");
  const [testingByAgent, setTestingByAgent] = useState<Record<string, boolean>>({});
  const [testResultsByAgent, setTestResultsByAgent] = useState<Record<string, PersonalLocalAgentTestConnectionResult | null>>({});
  const [editingAgent, setEditingAgent] = useState<PersonalLocalAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<PersonalLocalAgentDetectAvailableAgent[] | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [addingById, setAddingById] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => localAgentFilterCounts(props.agents), [props.agents]);
  const filteredAgents = useMemo(
    () => props.agents.filter((agent) => matchesLocalAgentFilter(agent, filter)),
    [props.agents, filter],
  );

  const handleTestConnection = useCallback(async (agent: PersonalLocalAgent) => {
    setTestingByAgent((current) => ({ ...current, [agent.id]: true }));
    try {
      const result = await personalLocalAgentTestConnection({ agent, workspaceRoot: props.workspaceRoot });
      setTestResultsByAgent((current) => ({ ...current, [agent.id]: result }));
    } catch (error) {
      setTestResultsByAgent((current) => ({
        ...current,
        [agent.id]: {
          ok: false,
          status: "offline",
          step: "fail_cli",
          error: error instanceof Error ? error.message : String(error),
          capabilities: null,
          models: [],
          configOptions: [],
          checkedAt: Date.now(),
        },
      }));
    } finally {
      setTestingByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [props.workspaceRoot]);

  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId) ?? null;

  const upsertAgent = useCallback((agent: PersonalLocalAgent) => {
    const nextAgents = props.agents.some((item) => item.id === agent.id)
      ? props.agents.map((item) => item.id === agent.id ? agent : item)
      : [agent, ...props.agents];
    props.onAgentsChange?.(nextAgents);
    props.onSelectAgent?.(agent.id);
  }, [props]);

  const handleSaveAgent = useCallback(async (value: InlineAgentEditorValue) => {
    setSaving(true);
    setEditorError(null);
    try {
      const input = {
        workspaceRoot: props.workspaceRoot,
        id: value.id,
        agent: {
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
        },
      };
      const result = editingAgent
        ? await personalLocalAgentUpdateCustomAgent(input)
        : await personalLocalAgentCreateCustomAgent(input);
      upsertAgent(result.agent);
      setCreating(false);
      setEditingAgent(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [editingAgent, props.workspaceRoot, upsertAgent]);

  const handleDeleteAgent = useCallback(async (agent: PersonalLocalAgent) => {
    setSaving(true);
    setEditorError(null);
    try {
      await personalLocalAgentDeleteCustomAgent({ workspaceRoot: props.workspaceRoot, id: agent.id });
      const nextAgents = props.agents.filter((item) => item.id !== agent.id);
      props.onAgentsChange?.(nextAgents);
      if (props.selectedAgentId === agent.id) props.onSelectAgent?.(nextAgents[0]?.id ?? "");
      setEditingAgent(null);
      setCreating(false);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [props]);

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    setDetectError(null);
    setDetected(null);
    try {
      const result = await personalLocalAgentDetectAvailableAgents({
        workspaceRoot: props.workspaceRoot,
        existingIds: props.agents.map((agent) => agent.id),
      });
      setDetected(result.agents);
    } catch (error) {
      setDetectError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetecting(false);
    }
  }, [props.workspaceRoot, props.agents]);

  const handleAddDetected = useCallback(async (draft: PersonalLocalAgentDetectAvailableAgent) => {
    setAddingById((current) => ({ ...current, [draft.id]: true }));
    setEditorError(null);
    try {
      const result = await personalLocalAgentCreateCustomAgent({
        workspaceRoot: props.workspaceRoot,
        agent: draft,
      });
      upsertAgent(result.agent);
      setDetected((current) => (current ? current.filter((item) => item.id !== draft.id) : current));
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setAddingById((current) => ({ ...current, [draft.id]: false }));
    }
  }, [props.workspaceRoot, upsertAgent]);

  return (
    <section className="flex flex-col gap-4" data-testid="local-agent-management-panel">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {LOCAL_AGENT_FILTER_IDS.map((id) => (
            <Button
              key={id}
              type="button"
              variant={filter === id ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(id)}
              data-testid={`local-agent-filter-${id}`}
              aria-pressed={filter === id}
            >
              {t(FILTER_LABEL_KEYS[id])}
              <CountBadge size="dot" className={cn("ml-1.5", filter === id ? "bg-white/20 text-white" : "bg-dls-surface-muted")}>
                {counts[id]}
              </CountBadge>
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => { setCreating(true); setEditingAgent(null); setEditorError(null); }}
          data-testid="local-agent-add-custom"
        >
          <Plus className="mr-1.5 size-3.5" />
          {t("local_agent.custom_agent_add")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleDetect()}
          disabled={detecting}
          data-testid="local-agent-detect"
        >
          <RefreshCw className={cn("mr-1.5 size-3.5", detecting && "animate-spin")} />
          {t("local_agent.detect_available")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => props.onRefresh?.()}
          disabled={props.refreshing}
        >
          <RefreshCw className={cn("mr-1.5 size-3.5", props.refreshing && "animate-spin")} />
          {t("common.refresh")}
        </Button>
      </div>

      {creating || editingAgent ? (
        <InlineAgentEditor
          key={editingAgent?.id ?? "create"}
          agent={editingAgent}
          busy={saving}
          error={editorError}
          onCancel={() => { setCreating(false); setEditingAgent(null); setEditorError(null); }}
          onSave={(value) => void handleSaveAgent(value)}
        />
      ) : null}

      {detecting ? (
        <EmptyStateBox size="comfortable" className="text-sm">
          {t("local_agent.detect_available_loading")}
        </EmptyStateBox>
      ) : detected ? (
        <div className="space-y-2 rounded-xl border border-dls-border bg-dls-surface-muted/35 p-3" data-testid="local-agent-detected">
          <div className="text-xs font-medium text-dls-secondary">{t("local_agent.detect_available_title")}</div>
          {detected.length ? (
            <ul className="space-y-2">
              {detected.map((draft) => (
                <li key={draft.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-dls-primary">{draft.name}</div>
                    <div className="truncate font-mono text-xs text-dls-secondary">{draft.command}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={Boolean(addingById[draft.id])}
                    onClick={() => void handleAddDetected(draft)}
                    data-testid={`local-agent-detected-add-${draft.id}`}
                  >
                    {addingById[draft.id] ? t("common.saving") : t("local_agent.detect_available_add")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-dls-secondary">{t("local_agent.detect_available_none")}</div>
          )}
        </div>
      ) : null}

      {detectError ? (
        <NoticeBox tone="error">{detectError}</NoticeBox>
      ) : null}

      {filteredAgents.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.map((agent) => (
            <div key={agent.id} className="space-y-2">
              <LocalAgentCard
                agent={agent}
                iconUrl={props.providerIconUrl(agent)}
                providerLabel={props.providerLabel(agent)}
                selected={agent.id === props.selectedAgentId}
                testing={Boolean(testingByAgent[agent.id])}
                testResult={testResultsByAgent[agent.id] ?? null}
                onSelect={props.onSelectAgent}
                onTestConnection={handleTestConnection}
                onConfigure={props.onConfigure}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setEditingAgent(agent); setCreating(false); setEditorError(null); }} data-testid={`local-agent-edit-${agent.id}`}>
                  <Pencil className="mr-1.5 size-3.5" />{t("common.edit")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleDeleteAgent(agent)} disabled={saving} data-testid={`local-agent-delete-${agent.id}`}>
                  <Trash2 className="mr-1.5 size-3.5" />{t("common.delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyStateBox size="spacious" className="text-sm">
          {t("local_agent.filter_empty")}
        </EmptyStateBox>
      )}

      <ExtensionListPanel />

      {selectedAgent ? (
        <LocalAgentRepairPanel
          agent={selectedAgent}
          supportedActions={props.supportedRepairActions}
          onAction={props.onRepairAction}
        />
      ) : null}
    </section>
  );
});
LocalAgentManagementPanel.displayName = "LocalAgentManagementPanel";
