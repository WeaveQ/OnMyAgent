/** @jsxImportSource react */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Folder, Key, Server, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { CountBadge } from "@/components/ui/status-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { personalLocalAgentHostStatus } from "../../../app/lib/desktop";
import type {
  PersonalLocalAgent,
  PersonalLocalAgentHostStatusResult,
} from "../../../app/lib/desktop-types";
import type { PersonalLocalAgentRuntimeEvent } from "@onmyagent/types/desktop-ipc";

const REFRESH_DEBOUNCE_MS = 300;

type LocalAgentStatusRailProps = {
  workspaceRoot: string;
  agent: PersonalLocalAgent | null;
  conversationId: string | null;
  onOpenManagement?: () => void;
};

type PopoverKey = "skill" | "mcp" | "permission" | null;

type LocalAgentStatusEventTarget = {
  workspaceRoot: string;
  conversationId: string | null;
};

/** Keep status refreshes scoped to the visible Personal conversation/workspace. */
export function shouldRefreshLocalAgentStatus(
  event: Pick<PersonalLocalAgentRuntimeEvent, "type" | "workspaceRoot" | "conversationId" | "events">,
  target: LocalAgentStatusEventTarget,
): boolean {
  if (
    event.type !== "run.started" &&
    event.type !== "run.snapshot" &&
    event.type !== "run.delta" &&
    event.type !== "run.finished" &&
    event.type !== "process.changed" &&
    event.type !== "catalog.invalidated"
  ) return false;
  if (event.workspaceRoot !== target.workspaceRoot) return false;
  if (target.conversationId && event.conversationId && event.conversationId !== target.conversationId) return false;
  if (event.type === "run.delta") {
    return event.events?.some((item) =>
      item.type === "approval_request" || item.type === "approval_decision"
    ) ?? false;
  }
  return true;
}

function shorten(text: string, max = 48): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - max + 1)}`;
}

export function LocalAgentStatusRail(props: LocalAgentStatusRailProps) {
  const { workspaceRoot, agent, conversationId, onOpenManagement } = props;
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; data: PersonalLocalAgentHostStatusResult; refreshing?: boolean }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [open, setOpen] = useState<PopoverKey>(null);

  const inputRef = useRef({ workspaceRoot, agent, conversationId });
  const inputVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const refreshRef = useRef<() => void>(() => undefined);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      refreshRef.current();
    }, REFRESH_DEBOUNCE_MS);
  }, []);

  const refresh = useCallback(() => {
    const input = inputRef.current;
    if (!input.workspaceRoot || !input.agent) {
      if (mountedRef.current) setState({ kind: "idle" });
      return;
    }
    const inputAgentId = input.agent.id;
    if (!mountedRef.current) return;
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }

    const requestVersion = inputVersionRef.current;
    inFlightRef.current = true;
    setState((prev) => (prev.kind === "ready" ? { ...prev, refreshing: true } : { kind: "loading" }));
    void personalLocalAgentHostStatus({
      workspaceRoot: input.workspaceRoot,
      conversationId: input.conversationId,
      agent: input.agent,
    })
      .then((data) => {
        const current = inputRef.current;
        if (
          !mountedRef.current
          || requestVersion !== inputVersionRef.current
          || current.workspaceRoot !== input.workspaceRoot
          || current.conversationId !== input.conversationId
          || current.agent?.id !== inputAgentId
        ) return;
        setState({ kind: "ready", data });
      })
      .catch((error) => {
        const current = inputRef.current;
        if (
          !mountedRef.current
          || requestVersion !== inputVersionRef.current
          || current.workspaceRoot !== input.workspaceRoot
          || current.conversationId !== input.conversationId
          || current.agent?.id !== inputAgentId
        ) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : t("local_agent.status_rail_load_failed"),
        });
      })
      .finally(() => {
        inFlightRef.current = false;
        if (mountedRef.current && dirtyRef.current) {
          dirtyRef.current = false;
          scheduleRefresh();
        }
      });
  }, [scheduleRefresh]);
  useLayoutEffect(() => {
    inputRef.current = { workspaceRoot, agent, conversationId };
    refreshRef.current = refresh;
  });

  useLayoutEffect(() => {
    inputVersionRef.current += 1;
  }, [agent?.id, conversationId, workspaceRoot]);

  useEffect(() => {
    mountedRef.current = true;
    if (!workspaceRoot || !inputRef.current.agent) {
      setState({ kind: "idle" });
    } else {
      setState((prev) => (prev.kind === "ready" ? { ...prev, refreshing: true } : { kind: "loading" }));
      scheduleRefresh();
    }

    const unsubscribe = window.__ONMYAGENT_ELECTRON__?.personalAgentRuntime?.onEvent?.((event) => {
      if (shouldRefreshLocalAgentStatus(event, { workspaceRoot, conversationId })) scheduleRefresh();
    });

    return () => {
      mountedRef.current = false;
      unsubscribe?.();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [agent?.id, conversationId, scheduleRefresh, workspaceRoot]);

  const data = state.kind === "ready" ? state.data : null;
  const loading = state.kind === "loading" || (state.kind === "ready" && state.refreshing === true);
  const countLabel = (value: number) => (data ? value : "—");
  const skillCount = data?.skill.skills.length ?? 0;
  const mcpCount = data?.mcp.servers.length ?? 0;
  const permissionPending = data?.permission.pending ?? 0;
  const permissionApproved = data?.permission.approved ?? 0;
  const permissionDenied = data?.permission.denied ?? 0;
  const permissionTotal = permissionPending + permissionApproved + permissionDenied;

  const openPopover = (key: PopoverKey) => setOpen((prev) => (prev === key ? null : key));

  const chipClass = (active: boolean, warning = false) =>
    cn(
      // titlebar-no-drag: parent rail is a window drag region on macOS.
      "mac:titlebar-no-drag flex h-7 items-center gap-1.5 rounded-md px-2.5 text-dls-secondary outline-none transition-colors hover:bg-dls-hover hover:text-dls-text focus-visible:ring-1 focus-visible:ring-dls-focus focus-visible:ring-offset-0",
      active && "bg-dls-hover text-dls-text",
      warning && "text-dls-warning",
    );

  if (!workspaceRoot) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-dls-border bg-dls-surface-muted px-4 text-xs text-dls-secondary mac:titlebar-drag">
        <span className="mac:titlebar-no-drag inline-flex items-center gap-2">
          <AlertCircle className="size-3.5" />
          <span>{t("local_agent.status_rail_workspace_missing")}</span>
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex h-9 min-w-0 shrink-0 items-center gap-1.5 overflow-x-hidden border-b border-dls-border bg-dls-surface-muted px-4 text-xs mac:titlebar-drag"
      data-testid="local-agent-status-rail"
      aria-busy={loading || undefined}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-1">
        <Popover open={open === "skill"} onOpenChange={(next) => setOpen(next ? "skill" : null)}>
          <PopoverTrigger
            render={
              <button
                type="button"
                onClick={() => openPopover("skill")}
                className={chipClass(open === "skill")}
                data-testid="local-agent-status-rail-skill"
              >
                <Sparkles className="size-3.5" />
                <span>{t("local_agent.status_rail_skills")}</span>
                <CountBadge>{countLabel(skillCount)}</CountBadge>
              </button>
            }
          />
          <PopoverContent align="start" className="w-72">
            <StatusPopoverBody
              title={t("local_agent.status_rail_skills")}
              hint={t("local_agent.status_rail_skills_hint")}
              emptyLabel={t("local_agent.status_rail_empty")}
              onManage={onOpenManagement ? () => {
                setOpen(null);
                onOpenManagement();
              } : undefined}
              loading={loading && !data}
              items={
                data
                  ? data.skill.skills.map((skill) => ({
                      key: skill.indexFile,
                      primary: skill.name,
                      secondary: shorten(skill.id),
                    }))
                  : []
              }
            />
          </PopoverContent>
        </Popover>

        <Popover open={open === "mcp"} onOpenChange={(next) => setOpen(next ? "mcp" : null)}>
          <PopoverTrigger
            render={
              <button
                type="button"
                onClick={() => openPopover("mcp")}
                className={chipClass(open === "mcp")}
                data-testid="local-agent-status-rail-mcp"
              >
                <Server className="size-3.5" />
                <span>{t("local_agent.status_rail_mcp")}</span>
                <CountBadge>{countLabel(mcpCount)}</CountBadge>
              </button>
            }
          />
          <PopoverContent align="start" className="w-72">
            <StatusPopoverBody
              title={t("local_agent.status_rail_mcp")}
              hint={t("local_agent.status_rail_mcp_hint")}
              emptyLabel={t("local_agent.status_rail_mcp_no_conn")}
              onManage={onOpenManagement ? () => {
                setOpen(null);
                onOpenManagement();
              } : undefined}
              loading={loading && !data}
              items={
                data
                  ? data.mcp.servers.map((server) => ({
                      key: `${server.name}:${server.sourceFile ?? ""}`,
                      primary: server.name,
                      secondary: [
                        server.transport ?? null,
                        server.connected ? t("local_agent.status_rail_mcp_connected") : t("local_agent.status_rail_mcp_config_only"),
                        server.toolCount
                          ? t("local_agent.status_rail_mcp_tools", { count: server.toolCount })
                          : null,
                      ]
                        .filter((piece): piece is string => Boolean(piece))
                        .join(" · "),
                    }))
                  : []
              }
              sourceErrors={data?.mcp.sourceErrors ?? []}
            />
          </PopoverContent>
        </Popover>

        <Popover open={open === "permission"} onOpenChange={(next) => setOpen(next ? "permission" : null)}>
          <PopoverTrigger
            render={
              <button
                type="button"
                onClick={() => openPopover("permission")}
                className={chipClass(open === "permission", permissionPending > 0)}
                data-testid="local-agent-status-rail-permission"
              >
                <Key className="size-3.5" />
                <span>{t("local_agent.status_rail_permissions")}</span>
                <CountBadge>{countLabel(permissionTotal)}</CountBadge>
              </button>
            }
          />
          <PopoverContent align="start" className="w-80">
            <div className="flex flex-col gap-2 p-3">
              <div className="text-xs font-medium text-dls-text">{t("local_agent.status_rail_permissions")}</div>
              {loading && !data ? (
                <LoadingSpinner size="sm" />
              ) : data ? (
                <div className="flex flex-col gap-1 text-xs text-dls-secondary">
                  <div>{t("local_agent.status_rail_permission_pending")}: {data.permission.pending}</div>
                  <div>{t("local_agent.status_rail_permission_approved")}: {data.permission.approved}</div>
                  <div>{t("local_agent.status_rail_permission_denied")}: {data.permission.denied}</div>
                  <div>{t("local_agent.status_rail_permission_remembered")}: {data.permission.remembered}</div>
                </div>
              ) : (
                <div className="text-xs text-dls-secondary">{t("local_agent.status_rail_empty")}</div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Mid strip stays draggable for window move on frameless macOS. */}
      <div className="min-h-full min-w-4 flex-1" aria-hidden />

      <div
        className="mac:titlebar-no-drag flex min-w-0 max-w-[min(42%,20rem)] items-center gap-1.5 text-dls-secondary"
        data-testid="local-agent-status-rail-workspace"
        title={workspaceRoot}
      >
        <Folder className="size-3.5 shrink-0" />
        <span className="truncate">{shorten(workspaceRoot, 40)}</span>
      </div>

      {state.kind === "error" ? (
        <div className="mac:titlebar-no-drag ml-1 flex shrink-0 items-center gap-1 text-dls-danger" data-testid="local-agent-status-rail-error">
          <AlertCircle className="size-3.5" />
          <span>{t("local_agent.status_rail_load_failed")}</span>
        </div>
      ) : null}
    </div>
  );
}

type StatusPopoverBodyProps = {
  title: string;
  hint: string;
  emptyLabel: string;
  onManage?: () => void;
  loading?: boolean;
  items: Array<{ key: string; primary: string; secondary?: string }>;
  sourceErrors?: Array<{ file: string; message: string }>;
};

function StatusPopoverBody(props: StatusPopoverBodyProps) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-dls-text">{props.title}</div>
        {props.onManage ? (
          <Button variant="ghost" size="xs" onClick={props.onManage}>
            {t("local_agent.status_rail_manage")}
          </Button>
        ) : null}
      </div>
      {props.loading ? (
        <LoadingSpinner size="sm" />
      ) : props.items.length ? (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-xs">
          {props.items.map((item) => (
            <li key={item.key} className="rounded-md px-2 py-1 hover:bg-dls-hover">
              <div className="truncate text-dls-text">{item.primary}</div>
              {item.secondary ? (
                <div className="truncate text-xs text-dls-secondary">{item.secondary}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-dls-secondary">{props.emptyLabel}</div>
      )}
      {props.sourceErrors && props.sourceErrors.length ? (
        <div
          className="flex flex-col gap-1 rounded-md border border-dls-status-warning-border bg-dls-status-warning-soft px-2 py-1.5 text-xs text-dls-status-warning-fg"
          data-testid="local-agent-status-rail-source-errors"
        >
          <div className="font-medium">{t("local_agent.status_rail_source_errors_title")}</div>
          {props.sourceErrors.map((err) => (
            <div key={err.file} className="truncate" title={`${err.file}: ${err.message}`}>
              <span className="font-mono">{shorten(err.file, 48)}</span>
              <span className="mx-1">--</span>
              <span>{err.message}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="text-xs text-dls-secondary">{props.hint}</div>
    </div>
  );
}
