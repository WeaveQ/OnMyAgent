/** @jsxImportSource react */
import { SessionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../../i18n";
import { isStreamingSessionStatus } from "../../sidebar/utils";
import { formatConversationTime, type AgentConversationGroup, type TaskStatusIndicator } from "./conversation-model";

const agentConversationTextClass = {
  itemTitle: "min-w-0 flex-1 truncate text-sm leading-5 text-dls-text",
  itemMeta: "shrink-0 text-xs leading-none text-dls-secondary/70",
  itemDescription: "min-w-0 flex-1 truncate text-xs leading-5 text-dls-secondary",
};

export function AgentConversationItem(props: {
  group: AgentConversationGroup;
  workspaceId: string;
  selected: boolean;
  status?: string;
  taskStatusVariant: TaskStatusIndicator["variant"];
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onOpenDraftSession?: (sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
}) {
  const latestSession = props.group.latestSession;
  const isDraftSession = latestSession.id.startsWith("draft:");
  const summaryTime = formatConversationTime(
    latestSession.time?.updated ?? latestSession.time?.created,
  );
  const badge = isStreamingSessionStatus(props.status);
  return (
    <SessionRowButton
      type="button"
      onClick={() => {
        if (isDraftSession) {
          props.onOpenDraftSession?.(latestSession.id);
          return;
        }
        props.onOpenSession(props.workspaceId, latestSession.id);
      }}
      onPointerEnter={() =>
        isDraftSession
          ? undefined
          : props.onPrefetchSession?.(props.workspaceId, latestSession.id)
      }
      onFocus={() =>
        isDraftSession
          ? undefined
          : props.onPrefetchSession?.(props.workspaceId, latestSession.id)
      }
      active={props.selected}
    >
      <div className="relative shrink-0">
        <div
          className={cn(
            "flex size-11 items-center justify-center overflow-hidden rounded-lg border text-base font-medium",
            props.selected
              ? "border-dls-border bg-dls-surface text-dls-accent"
              : "border-dls-border bg-dls-decision-soft text-dls-accent",
          )}
          style={{ backgroundColor: props.group.avatarBackground }}
        >
          {props.group.avatarUrl ? (
            <img
              src={props.group.avatarUrl}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            props.group.name.charAt(0).toUpperCase() || t("session.agent_initial")
          )}
        </div>
        <span
          className={cn(
            "absolute -right-0.5 bottom-0 size-2.5 rounded-full border-2",
            props.selected ? "border-dls-list-selected" : "border-dls-surface",
            props.taskStatusVariant === "available" && "bg-dls-online",
            props.taskStatusVariant === "loading" && "bg-dls-status-warning",
            props.taskStatusVariant === "limited" && "bg-dls-status-warning",
            props.taskStatusVariant === "offline" && "bg-dls-status-danger",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <div
            className={cn(
              agentConversationTextClass.itemTitle,
              props.selected ? "font-medium" : "font-normal",
            )}
          >
            {props.group.name}
          </div>
          <div className={agentConversationTextClass.itemMeta}>
            {summaryTime}
          </div>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <div className={agentConversationTextClass.itemDescription}>
            {props.group.description}
          </div>
          {badge ? (
            <span className="size-2 shrink-0 rounded-full bg-dls-status-warning" />
          ) : null}
        </div>
      </div>
    </SessionRowButton>
  );
}
