/** @jsxImportSource react */
import { SessionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../../i18n";
import type {
  AgentConversationGroup,
  AgentStarterItem,
  TaskStatusIndicator,
} from "./conversation-model";
import { AgentConversationItem } from "./agent-conversation-item";

type AgentConversationListProps = {
  groups: AgentConversationGroup[];
  hasAnyConversation: boolean;
  starterItems?: AgentStarterItem[];
  workspaceId: string;
  selectedSessionId: string | null;
  selectedAgentId?: string | null;
  sessionStatusById: Record<string, string>;
  taskStatusVariant: TaskStatusIndicator["variant"];
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onOpenDraftSession?: (sessionId: string) => void;
  onOpenStarter?: (agentId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
};

const starterTextClass = {
  itemTitle: "min-w-0 flex-1 truncate text-sm font-medium leading-5 text-dls-text",
  itemDescription: "min-w-0 truncate text-xs leading-5 text-dls-secondary",
};

function AgentStarterRow(props: {
  item: AgentStarterItem;
  taskStatusVariant: TaskStatusIndicator["variant"];
  onOpenStarter?: (agentId: string) => void;
}) {
  return (
    <SessionRowButton
      type="button"
      onClick={() => props.onOpenStarter?.(props.item.agentId)}
    >
      <div className="relative shrink-0">
        <div
          className="flex size-11 items-center justify-center overflow-hidden rounded-lg border border-dls-border bg-dls-decision-soft text-base font-medium text-dls-accent"
          style={{ backgroundColor: props.item.avatarBackground }}
        >
          {props.item.avatarUrl ? (
            <img
              src={props.item.avatarUrl}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            props.item.name.charAt(0).toUpperCase() || "新"
          )}
        </div>
        <span
          className={cn(
            "absolute -right-0.5 bottom-0 size-2.5 rounded-full border-2 border-dls-surface",
            props.taskStatusVariant === "available" && "bg-dls-accent",
            props.taskStatusVariant === "loading" && "bg-dls-status-warning",
            props.taskStatusVariant === "limited" && "bg-dls-status-warning",
            props.taskStatusVariant === "offline" && "bg-dls-status-danger",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className={starterTextClass.itemTitle}>
          {props.item.name}
        </div>
        <div className={starterTextClass.itemDescription}>
          {props.item.description}
        </div>
      </div>
    </SessionRowButton>
  );
}

export function AgentConversationList(props: AgentConversationListProps) {
  if (props.groups.length === 0) {
    if (props.hasAnyConversation && props.starterItems?.length) {
      return (
        <div>
          {props.starterItems.map((item) => (
            <AgentStarterRow
              key={item.key}
              item={item}
              taskStatusVariant={props.taskStatusVariant}
              onOpenStarter={props.onOpenStarter}
            />
          ))}
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm leading-5 text-dls-secondary">
        {props.hasAnyConversation
          ? t("session.no_matching_expert_conversations")
          : t("session.no_expert_conversations")}
      </div>
    );
  }

  return (
    <div>
      {props.groups.map((item) => (
        <AgentConversationItem
          key={item.key}
          group={item}
          workspaceId={props.workspaceId}
          selected={item.sessions.some(
            (session) => session.id === props.selectedSessionId,
          ) || item.agentId === props.selectedAgentId}
          status={props.sessionStatusById[item.latestSession.id]}
          taskStatusVariant={props.taskStatusVariant}
          onOpenSession={props.onOpenSession}
          onOpenDraftSession={props.onOpenDraftSession}
          onPrefetchSession={props.onPrefetchSession}
        />
      ))}
    </div>
  );
}
