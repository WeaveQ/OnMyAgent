/** @jsxImportSource react */
/**
 * Expert empty chat: avatar + capability copy + prompt suggestions.
 */
import type { ReactNode } from "react";
import type { ExpertTeamWorkflow, ExpertTeamWorkflowStageKind } from "@onmyagent/types/desktop-ipc";
import { StatusBadge, StepMarker } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { PendingAgentAvatar } from "./avatars";
import { sessionSurfaceTextClass } from "../surface-styles";

function teamWorkflowStageTitle(kind: ExpertTeamWorkflowStageKind): string {
  if (kind === "frame") return t("session.team_workflow_stage_frame");
  if (kind === "investigate") return t("session.team_workflow_stage_investigate");
  if (kind === "produce") return t("session.team_workflow_stage_produce");
  if (kind === "verify") return t("session.team_workflow_stage_verify");
  return t("session.team_workflow_stage_deliver");
}

function TeamWorkflowSummary(props: { workflow: ExpertTeamWorkflow }) {
  return (
    <section className="w-full max-w-2xl rounded-xl border border-dls-border bg-dls-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-dls-primary">
              {t("session.team_workflow_title")}
            </h3>
            <StatusBadge tone="accent" shape="soft" size="tiny">
              {t("session.team_workflow_mode")}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-dls-secondary">
            {t("session.team_workflow_description")}
          </p>
        </div>
        <span className="text-xs text-dls-secondary">
          {t("session.team_workflow_stage_count", { count: props.workflow.stages.length })}
        </span>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {props.workflow.stages.map((stage, index) => (
          <li
            key={stage.id}
            className="flex min-w-0 gap-2 rounded-lg bg-dls-surface-muted px-3 py-2"
          >
            <StepMarker size="sm">{index + 1}</StepMarker>
            <div className="min-w-0">
              <p className="text-xs font-medium text-dls-primary">
                {teamWorkflowStageTitle(stage.kind)}
              </p>
              <p
                className="mt-0.5 truncate text-2xs text-dls-secondary"
                title={stage.members.join(" · ")}
              >
                {stage.members.length > 0
                  ? stage.members.join(" · ")
                  : t("session.team_workflow_lead_stage")}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-2xs text-dls-secondary">
        {t("session.team_workflow_honesty_note")}
      </p>
    </section>
  );
}

export function SessionSurfaceExpertEmpty(props: {
  agent: {
    name: string;
    description?: string | null;
    avatar: { avatarUrl: string | null; avatarBackground?: string | null };
    teamWorkflow?: ExpertTeamWorkflow;
  };
  promptSuggestions: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-5 py-6">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <PendingAgentAvatar
          name={props.agent.name}
          avatarUrl={props.agent.avatar.avatarUrl}
          avatarBackground={props.agent.avatar.avatarBackground ?? undefined}
          className="size-16 text-3xl"
        />
        <h2 className={sessionSurfaceTextClass.agentEmptyTitle}>{props.agent.name}</h2>
        {props.agent.description ? (
          <p className={sessionSurfaceTextClass.agentEmptyDescription}>
            {props.agent.description}
          </p>
        ) : null}
      </div>
      {props.agent.teamWorkflow ? (
        <TeamWorkflowSummary workflow={props.agent.teamWorkflow} />
      ) : null}
      {props.promptSuggestions}
    </div>
  );
}
