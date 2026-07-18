/** @jsxImportSource react */
import { SessionRowButton } from "@/components/ui/action-row";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import { isStreamingSessionStatus } from "./utils";
import { formatConversationTime, type AgentConversationGroup, type TaskStatusIndicator } from "./conversation-model";

function taskPresenceTone(
  variant: TaskStatusIndicator["variant"],
): "warning" | "danger" | "muted" {
  if (variant === "loading" || variant === "limited") return "warning";
  if (variant === "offline") return "danger";
  return "muted";
}

function taskPresenceClass(variant: TaskStatusIndicator["variant"]) {
  if (variant === "available") return "bg-dls-online";
  return undefined;
}

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
        <StatusDot
          size="sm"
          tone={taskPresenceTone(props.taskStatusVariant)}
          className={cn(
            "absolute -right-0.5 bottom-0 border-2",
            props.selected ? "border-dls-list-selected" : "border-dls-surface",
            taskPresenceClass(props.taskStatusVariant),
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
          {badge ? <StatusDot size="md" tone="warning" className="shrink-0" /> : null}
        </div>
      </div>
    </SessionRowButton>
  );
}
