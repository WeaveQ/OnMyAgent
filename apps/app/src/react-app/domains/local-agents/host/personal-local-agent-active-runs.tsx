/** @jsxImportSource react */
import { Activity, CircleStop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionRowButton, SessionRowButton } from "@/components/ui/action-row";
import { CountBadge } from "@/components/ui/status-badge";
import { StatusPing } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgent, PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";
import { elapsedSeconds, shortTime } from "../local-agent-formatters";
import { lastEventTime, toConversationItems } from "../messages/timeline-messages";
import { activeRunClass, localAgentTextClass } from "./personal-local-agent-page-helpers";

export function ActiveRunsOverview(props: {
  activeRuns: Array<{ chatKey: string; agentId: string; agent: PersonalLocalAgent | null; run: PersonalLocalAgentRunResult }>;
  selectedChatKey: string | null;
  onSelectAgent: (chatKey: string) => void;
  onCancelRun?: (runId: string, chatKey: string) => void;
  showTitle?: boolean;
}) {
  return (
    <section className={activeRunClass.overview}>
      {props.showTitle ? (
        <div className={localAgentTextClass.runSectionTitle}>
          <Activity className="size-4" />
          {t("local_agent.active_runs")}{" "}
          <CountBadge size="dot" className="bg-dls-accent/10 text-dls-accent">
            {props.activeRuns.length}
          </CountBadge>
        </div>
      ) : null}
      <div className="grid gap-2">
        {props.activeRuns.map(({ chatKey, agentId, agent, run }) => {
          const isSelected = props.selectedChatKey === chatKey;
          return (
            <div
              key={run.runId}
              className={cn(activeRunClass.item, isSelected ? activeRunClass.itemSelected : activeRunClass.itemDefault)}
            >
              <ActionRowButton
                type="button"
                onClick={() => props.onSelectAgent(chatKey)}
                density="compact"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left hover:bg-transparent"
                title={isSelected ? t("local_agent.current_agent_running") : t("local_agent.switch_to_agent_detail")}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={localAgentTextClass.runItemTitle}>
                    <StatusPing />
                    <span className="truncate">{agent?.name ?? agentId}</span>
                  </span>
                  <span className={activeRunClass.runId}>Run {run.runId}</span>
                </div>
                <div className={activeRunClass.meta}>
                  <span>
                    {run.pendingApprovals?.length
                      ? t("local_agent.waiting_approval_count", { count: run.pendingApprovals.length })
                      : t("local_agent.elapsed", { value: elapsedSeconds(run.startedAt, null) })}
                  </span>
                  <span>{t("local_agent.latest_event", { time: shortTime(lastEventTime(run)) })}</span>
                  <span>{t("local_agent.connection", { value: run.connectionMode || "--" })}</span>
                </div>
                {(() => {
                  const items = toConversationItems(run);
                  const last = items.at(-1);
                  return last?.text ? (
                    <div className="mt-1 line-clamp-2 text-xs text-dls-secondary">{last.text}</div>
                  ) : null;
                })()}
              </ActionRowButton>
              {props.onCancelRun ? (
                <Button
                  variant="outline"
                  size="sm"
                  className={activeRunClass.cancel}
                  onClick={() => props.onCancelRun?.(run.runId, chatKey)}
                  title={t("local_agent.stop_run")}
                >
                  <CircleStop className="mr-1.5 size-3.5" />
                  {t("composer.stop")}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {props.activeRuns.length ? null : (
        <div className="px-1 py-1 text-xs text-dls-secondary">{t("local_agent.no_active_runs")}</div>
      )}
    </section>
  );
}
