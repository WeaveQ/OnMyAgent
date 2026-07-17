/** @jsxImportSource react */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Bot, Plus, Search } from "lucide-react";

import { t } from "../../../../i18n";
import type {
  OnMyAgentServerClient,
  OnMyAgentSessionSnapshot,
} from "../../../../app/lib/onmyagent-server";
import type { WorkspaceSessionGroup } from "../../../../app/types";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { SessionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { isStreamingSessionStatus } from "../sidebar/utils";

import { snapshotConversationSummary } from "./session-page-conversation-model";
import type { TaskStatusIndicator } from "./session-page-model";

const agentConversationPanelClass = {
  shell: "flex shrink-0 flex-col overflow-hidden bg-dls-sidebar px-4 pb-5 pt-2",
  toolbar: "flex h-10 items-center gap-2.5",
  searchInput: "text-sm placeholder:text-dls-secondary/75",
  agentsButton: "relative shrink-0 rounded-xl border border-dls-border bg-dls-surface text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
  listViewport: "mt-5 min-h-0 flex-1 overflow-y-auto pr-1",
  list: "space-y-2",
  empty: "flex h-full items-center justify-center px-4 text-center text-sm leading-5 text-dls-secondary",
  row: "gap-2.5 rounded-xl px-2.5 data-[active=true]:bg-dls-list-selected",
  avatarWrap: "relative shrink-0",
  avatar: "flex size-11 items-center justify-center overflow-hidden rounded-full border border-dls-sidebar bg-dls-decision-soft text-base font-medium text-dls-accent",
  statusDot: "absolute bottom-0.5 right-0.5 size-2.5 rounded-full border-2 border-dls-sidebar",
  rowBody: "min-w-0 flex-1 py-3",
  rowHeader: "flex min-w-0 items-center gap-2",
  rowTitle: "min-w-0 flex-1 truncate text-sm font-medium",
  rowTime: "shrink-0 text-xs leading-none text-dls-secondary/75",
  rowPreview: "mt-1 flex min-w-0 items-center gap-1.5",
  previewText: "min-w-0 flex-1 truncate text-xs leading-5",
  activityDot: "size-2 shrink-0 rounded-full bg-dls-status-warning",
};

export type AgentConversationDisplay = {
  name: string;
  avatarUrl?: string | null;
  avatarBackground?: string | null;
};

export function AgentConversationPanel(props: {
  width: number;
  client: OnMyAgentServerClient | null;
  taskStatusVariant: TaskStatusIndicator["variant"];
  collapsed: boolean;
  groups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  sessionStatusById: Record<string, string>;
  query: string;
  disabledNewTask: boolean;
  onQueryChange: (value: string) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onToggleCollapsed: () => void;
  onOpenAgents: () => void;
  resolveSessionDisplay: (
    session: WorkspaceSessionGroup["sessions"][number],
  ) => AgentConversationDisplay;
}) {
  const group = props.groups.find(
    (item) => item.workspace.id === props.selectedWorkspaceId,
  );
  const sessions: WorkspaceSessionGroup["sessions"] = group?.sessions ?? [];
  const normalizedQuery = props.query.trim().toLowerCase();
  const filteredSessions = normalizedQuery
    ? sessions.filter((session) =>
        props.resolveSessionDisplay(session).name
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : sessions;
  const snapshotQueries = useQueries({
    queries: filteredSessions.map((session) => ({
      queryKey: [
        "onmyagent-session-list-snapshot",
        props.selectedWorkspaceId,
        session.id,
      ],
      enabled: Boolean(props.client),
      queryFn: async () => {
        const client = props.client;
        if (!client) throw new Error("OnMyAgent server unavailable");
        return (
          await client.getSessionSnapshot(
            props.selectedWorkspaceId,
            session.id,
            { limit: 16 },
          )
        ).item;
      },
      staleTime: 2_000,
    })),
  });
  const snapshotBySessionId = useMemo(() => {
    const byId = new Map<string, OnMyAgentSessionSnapshot>();
    filteredSessions.forEach((session, index) => {
      const snapshot = snapshotQueries[index]?.data;
      if (snapshot) byId.set(session.id, snapshot);
    });
    return byId;
  }, [filteredSessions, snapshotQueries]);

  return (
    <aside
      className={agentConversationPanelClass.shell}
      style={{ width: props.width }}
    >
      <div className={agentConversationPanelClass.toolbar}>
        <InputGroup controlSize="lg" radius="xl" tone="surface" className="flex-1">
          <InputGroupAddon align="inline-start">
            <Search className="size-5" />
          </InputGroupAddon>
          <InputGroupInput
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder={t("agents.search")}
            className={agentConversationPanelClass.searchInput}
          />
        </InputGroup>
        <Button
          type="button"
          size="icon-lg"
          onClick={props.onOpenAgents}
          className={agentConversationPanelClass.agentsButton}
          title={t("nav.agents")}
          aria-label={t("session.open_agent")}
        >
          <Bot className="size-5" />
          <Plus className="absolute right-1.5 top-1.5 size-2.5" strokeWidth={3} />
        </Button>
      </div>

      <div className={agentConversationPanelClass.listViewport}>
        {filteredSessions.length > 0 ? (
          <div className={agentConversationPanelClass.list}>
            {filteredSessions.map((session, index) => (
              <AgentConversationItem
                key={session.id}
                session={session}
                workspaceId={props.selectedWorkspaceId}
                selected={props.selectedSessionId === session.id}
                status={props.sessionStatusById[session.id]}
                taskStatusVariant={props.taskStatusVariant}
                display={props.resolveSessionDisplay(session)}
                snapshot={snapshotBySessionId.get(session.id)}
                onOpenSession={props.onOpenSession}
                onPrefetchSession={props.onPrefetchSession}
              />
            ))}
          </div>
        ) : (
          <div className={agentConversationPanelClass.empty}>
            {t("session.no_sessions")}
          </div>
        )}
      </div>
    </aside>
  );
}

function AgentConversationItem(props: {
  session: WorkspaceSessionGroup["sessions"][number];
  workspaceId: string;
  selected: boolean;
  status?: string;
  taskStatusVariant: TaskStatusIndicator["variant"];
  display: AgentConversationDisplay;
  snapshot?: OnMyAgentSessionSnapshot;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
}) {
  const name = props.display.name;
  const summary = snapshotConversationSummary(
    props.snapshot,
    props.session.time?.updated ?? props.session.time?.created,
  );
  const badge = isStreamingSessionStatus(props.status);

  return (
    <SessionRowButton
      type="button"
      onClick={() => props.onOpenSession(props.workspaceId, props.session.id)}
      onPointerEnter={() =>
        props.onPrefetchSession?.(props.workspaceId, props.session.id)
      }
      onFocus={() =>
        props.onPrefetchSession?.(props.workspaceId, props.session.id)
      }
      active={props.selected}
      className={agentConversationPanelClass.row}
      data-active={props.selected}
    >
      <div className={agentConversationPanelClass.avatarWrap}>
        <div
          className={agentConversationPanelClass.avatar}
          style={{
            backgroundColor:
              props.display.avatarBackground ?? "var(--ow-primary-light)",
          }}
        >
          {props.display.avatarUrl ? (
            <img
              src={props.display.avatarUrl}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            name.charAt(0).toUpperCase() || t("session.agent_initial")
          )}
        </div>
        <span
          className={cn(
            "absolute bottom-0.5 right-0.5 size-2.5 rounded-full border-2 border-dls-surface",
            props.taskStatusVariant === "available" && "bg-dls-accent",
            props.taskStatusVariant === "loading" && "bg-dls-status-warning",
            props.taskStatusVariant === "limited" && "bg-dls-status-warning",
            props.taskStatusVariant === "offline" && "bg-dls-status-danger",
            agentConversationPanelClass.statusDot,
          )}
        />
      </div>
      <div
        className={cn(
          agentConversationPanelClass.rowBody,
          !props.selected && "border-b border-dls-border",
        )}
      >
        <div className={agentConversationPanelClass.rowHeader}>
          <div className={agentConversationPanelClass.rowTitle}>
            {name}
          </div>
          <div className={agentConversationPanelClass.rowTime}>
            {summary.time}
          </div>
        </div>
        <div className={agentConversationPanelClass.rowPreview}>
          <div className={agentConversationPanelClass.previewText}>
            {summary.preview}
          </div>
          {badge ? (
            <span className={agentConversationPanelClass.activityDot} />
          ) : null}
        </div>
      </div>
    </SessionRowButton>
  );
}
