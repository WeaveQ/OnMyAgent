/** @jsxImportSource react */
import { memo } from "react";
import { AlertTriangle, Download, KeyRound, RefreshCw, Settings2, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { t } from "@/i18n";
import type { PersonalLocalAgent } from "../../../app/lib/desktop";
import { localAgentStatus } from "./local-agent-filters";

export type LocalAgentRepairAction = "install" | "login" | "check_env" | "open_config" | "recheck";

export type LocalAgentRepairPanelProps = {
  agent: PersonalLocalAgent;
  busy?: boolean;
  /** Actions the host actually handles. Buttons for unsupported actions are
   * rendered disabled with a tooltip so the user sees the guidance exists but
   * is not yet wired up, instead of clicking silently with no effect. */
  supportedActions?: LocalAgentRepairAction[];
  onAction?: (action: LocalAgentRepairAction, agent: PersonalLocalAgent) => void;
};

// Status-specific repair guidance for offline, missing, or unauthenticated agents.
export const LocalAgentRepairPanel = memo(function LocalAgentRepairPanel(props: LocalAgentRepairPanelProps) {
  const { agent } = props;
  const status = localAgentStatus(agent);
  if (status === "online" || status === "unknown") return null;

  const supported = new Set<LocalAgentRepairAction>(
    props.supportedActions ?? ["install", "login", "check_env", "open_config", "recheck"],
  );

  const guidanceKey =
    status === "missing"
      ? "local_agent.repair_missing_guidance"
      : status === "needs_auth"
        ? "local_agent.repair_needs_auth_guidance"
        : "local_agent.repair_offline_guidance";

  const actions: Array<{ id: LocalAgentRepairAction; label: string; icon: typeof Download }> =
    status === "missing"
      ? [
          { id: "install", label: t("local_agent.repair_action_install"), icon: Download },
          { id: "check_env", label: t("local_agent.repair_action_check_env"), icon: TerminalSquare },
          { id: "recheck", label: t("local_agent.repair_action_recheck"), icon: RefreshCw },
        ]
      : status === "needs_auth"
        ? [
            { id: "login", label: t("local_agent.repair_action_login"), icon: KeyRound },
            { id: "recheck", label: t("local_agent.repair_action_recheck"), icon: RefreshCw },
          ]
        : [
            { id: "check_env", label: t("local_agent.repair_action_check_env"), icon: TerminalSquare },
            { id: "open_config", label: t("local_agent.repair_action_open_config"), icon: Settings2 },
            { id: "recheck", label: t("local_agent.repair_action_recheck"), icon: RefreshCw },
          ];

  return (
    <div className="space-y-3 rounded-xl border border-dls-status-warning/25 bg-dls-status-warning/10 p-4" data-testid="local-agent-repair-panel" data-status={status}>
      <div className="flex items-center gap-2 text-sm font-medium text-dls-status-warning">
        <AlertTriangle className="size-4" />
        {t("local_agent.repair_title", { name: agent.name })}
      </div>
      <NoticeBox tone="warning">{t(guidanceKey)}</NoticeBox>
      {agent.error ? <div className="font-mono text-xs text-dls-secondary">{agent.error}</div> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => {
          const Icon = action.icon;
          const enabled = supported.has(action.id);
          return (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={props.busy || !enabled}
              title={enabled ? undefined : t("local_agent.repair_action_unavailable")}
              onClick={() => props.onAction?.(action.id, agent)}
            >
              <Icon className="mr-1.5 size-3.5" />
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
});
LocalAgentRepairPanel.displayName = "LocalAgentRepairPanel";
