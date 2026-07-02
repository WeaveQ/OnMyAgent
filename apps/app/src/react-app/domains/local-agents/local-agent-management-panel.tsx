/** @jsxImportSource react */
import { memo, useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import {
  personalLocalAgentTestConnection,
  type PersonalLocalAgent,
  type PersonalLocalAgentTestConnectionResult,
} from "../../../app/lib/desktop";
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
          onClick={() => props.onRefresh?.()}
          disabled={props.refreshing}
        >
          <RefreshCw className={cn("mr-1.5 size-3.5", props.refreshing && "animate-spin")} />
          {t("common.refresh")}
        </Button>
      </div>

      {filteredAgents.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.map((agent) => (
            <LocalAgentCard
              key={agent.id}
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
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-dls-border px-4 py-8 text-center text-sm text-dls-secondary">
          {t("local_agent.filter_empty")}
        </div>
      )}

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
