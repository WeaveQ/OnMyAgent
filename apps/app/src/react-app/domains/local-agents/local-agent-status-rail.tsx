/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Folder, Key, Server, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/status-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { personalLocalAgentHostStatus } from "../../../app/lib/desktop";
import type {
  PersonalLocalAgent,
  PersonalLocalAgentHostStatusResult,
} from "../../../app/lib/desktop-types";

const REFRESH_DEBOUNCE_MS = 300;

type LocalAgentStatusRailProps = {
  workspaceRoot: string;
  agent: PersonalLocalAgent | null;
  conversationId: string | null;
  onOpenManagement: () => void;
};

type PopoverKey = "skill" | "mcp" | "permission" | null;

function shorten(text: string, max = 48): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - max + 1)}`;
}

export function LocalAgentStatusRail(props: LocalAgentStatusRailProps) {
  const { workspaceRoot, agent, conversationId, onOpenManagement } = props;
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; data: PersonalLocalAgentHostStatusResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [open, setOpen] = useState<PopoverKey>(null);

  const refresh = useCallback(async () => {
    if (!workspaceRoot || !agent) {
      setState({ kind: "idle" });
      return;
    }
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    try {
      const data = await personalLocalAgentHostStatus({
        workspaceRoot,
        conversationId: conversationId ?? null,
        agent,
      });
      setState({ kind: "ready", data });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : t("local_agent.status_rail_load_failed"),
      });
    }
  }, [workspaceRoot, agent, conversationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const data = state.kind === "ready" ? state.data : null;
  const skillCount = data?.skill.skills.length ?? 0;
  const mcpCount = data?.mcp.servers.length ?? 0;
  const permissionPending = data?.permission.pending ?? 0;
  const permissionApproved = data?.permission.approved ?? 0;
  const permissionDenied = data?.permission.denied ?? 0;
  const permissionTotal = permissionPending + permissionApproved + permissionDenied;

  const openPopover = (key: PopoverKey) => setOpen((prev) => (prev === key ? null : key));

  if (!workspaceRoot) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-dls-border bg-dls-surface-muted px-4 text-xs text-dls-secondary mac:titlebar-no-drag">
        <AlertCircle className="size-3.5" />
        <span>{t("local_agent.status_rail_workspace_missing")}</span>
      </div>
    );
  }

  return (
    <div
      className="flex h-8 min-w-0 shrink-0 items-center gap-1 overflow-x-hidden border-b border-dls-border bg-dls-surface-muted px-3 text-xs mac:titlebar-no-drag"
      data-testid="local-agent-status-rail"
    >
      <Popover open={open === "skill"} onOpenChange={(next) => setOpen(next ? "skill" : null)}>
        <PopoverTrigger
          render={
            <button
              type="button"
              onClick={() => openPopover("skill")}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-md px-2 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text",
                open === "skill" && "bg-dls-hover text-dls-text",
              )}
              data-testid="local-agent-status-rail-skill"
            >
              <Sparkles className="size-3.5" />
              <span>{t("local_agent.status_rail_skills")}</span>
              <CountBadge>{skillCount}</CountBadge>
            </button>
          }
        />
        <PopoverContent align="start" className="w-72">
          <StatusPopoverBody
            title={t("local_agent.status_rail_skills")}
            hint={t("local_agent.status_rail_skills_hint")}
            emptyLabel={t("local_agent.status_rail_empty")}
            onManage={() => {
              setOpen(null);
              onOpenManagement();
            }}
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
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-md px-2 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text",
                open === "mcp" && "bg-dls-hover text-dls-text",
              )}
              data-testid="local-agent-status-rail-mcp"
            >
              <Server className="size-3.5" />
              <span>{t("local_agent.status_rail_mcp")}</span>
              <CountBadge>{mcpCount}</CountBadge>
            </button>
          }
        />
        <PopoverContent align="start" className="w-72">
          <StatusPopoverBody
            title={t("local_agent.status_rail_mcp")}
            hint={t("local_agent.status_rail_skills_hint")}
            emptyLabel={t("local_agent.status_rail_mcp_no_conn")}
            onManage={() => {
              setOpen(null);
              onOpenManagement();
            }}
            items={
              data
                ? data.mcp.servers.map((server) => ({
                    key: `${server.name}:${server.sourceFile ?? ""}`,
                    primary: server.name,
                    secondary: [
                      server.transport ?? null,
                      server.connected ? t("local_agent.status_rail_mcp_connected") : t("local_agent.status_rail_mcp_config_only"),
                      server.toolCount ? `${server.toolCount} tools` : null,
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
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-md px-2 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text",
                open === "permission" && "bg-dls-hover text-dls-text",
                permissionPending > 0 && "text-dls-warning",
              )}
              data-testid="local-agent-status-rail-permission"
            >
              <Key className="size-3.5" />
              <span>{t("local_agent.status_rail_permissions")}</span>
              <CountBadge>{permissionTotal}</CountBadge>
            </button>
          }
        />
        <PopoverContent align="start" className="w-80">
          <div className="flex flex-col gap-2 p-3">
            <div className="text-xs font-medium text-dls-text">{t("local_agent.status_rail_permissions")}</div>
            {data ? (
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

      <div className="mx-1 h-3 w-px shrink-0 bg-dls-border" aria-hidden />

      <div className="flex min-w-0 items-center gap-1.5 text-dls-secondary" data-testid="local-agent-status-rail-workspace">
        <Folder className="size-3.5 shrink-0" />
        <span className="truncate">{shorten(workspaceRoot, 60)}</span>
      </div>

      {state.kind === "error" ? (
        <div className="ml-auto flex items-center gap-1 text-dls-danger" data-testid="local-agent-status-rail-error">
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
  onManage: () => void;
  items: Array<{ key: string; primary: string; secondary?: string }>;
  sourceErrors?: Array<{ file: string; message: string }>;
};

function StatusPopoverBody(props: StatusPopoverBodyProps) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-dls-text">{props.title}</div>
        <Button variant="ghost" size="xs" onClick={props.onManage}>
          {t("local_agent.status_rail_manage")}
        </Button>
      </div>
      {props.items.length ? (
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
