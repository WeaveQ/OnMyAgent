/** @jsxImportSource react */
/**
 * Session surface top header (agent name + toolbar actions).
 */
import type { ReactNode } from "react";
import type { AgentRuntimeKind } from "@onmyagent/types/agent-runtime";
import { Settings2 } from "lucide-react";

import { t } from "../../../../../i18n";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { LIST_LANE_HEADER_CLASS } from "@/components/ui/sidebar-chrome";
import { cn } from "@/lib/utils";
import { PendingAgentAvatar } from "./avatars";
import { sessionSurfaceTextClass } from "../surface-styles";

export type SessionSurfaceHeaderAgent = {
  name: string;
  avatarUrl: string | null;
  avatarBackground: string | null | undefined;
};

export function SessionSurfaceHeader(props: {
  agent: SessionSurfaceHeaderAgent;
  runtimeKind?: AgentRuntimeKind | null;
  codeSceneToolbar: ReactNode;
  personalAssistantHome?: boolean;
  onOpenAgentSettings?: () => void;
  headerActions?: ReactNode;
  /**
   * Bottom rule under the title row. Hide when the session-tab strip is
   * expanded (tabs own the single divider) to avoid double lines.
   */
  showBottomBorder?: boolean;
}) {
  const showBottomBorder = props.showBottomBorder !== false;
  return (
    <header
      className={cn(
        // Shared list-lane h-14 (sidebar-chrome) — matches 新建任务 strip.
        LIST_LANE_HEADER_CLASS,
        "justify-between bg-dls-background px-5",
        // Align with side-panel header when this is the only chrome rule.
        showBottomBorder && "border-b border-dls-mist",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <PendingAgentAvatar
          name={props.agent.name}
          avatarUrl={props.agent.avatarUrl}
          avatarBackground={props.agent.avatarBackground ?? undefined}
          className="size-7 text-xs"
        />
        <div className={sessionSurfaceTextClass.headerAgentName}>
          {props.agent.name}
        </div>
        {props.runtimeKind ? (
          <StatusBadge
            size="tiny"
            shape="soft"
            tone={props.runtimeKind === "grok-build" ? "accent" : "neutral"}
            title={t("session.runtime_badge", { runtime: runtimeLabel(props.runtimeKind) })}
          >
            {runtimeLabel(props.runtimeKind)}
          </StatusBadge>
        ) : null}
      </div>
      <div className="relative flex items-center gap-1.5 mac:titlebar-no-drag">
        {props.codeSceneToolbar}
        {!props.personalAssistantHome && props.onOpenAgentSettings ? (
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            title={t("session.configure_current_agent")}
            aria-label={t("session.configure_current_agent")}
            onClick={props.onOpenAgentSettings}
          >
            <Settings2 className="size-4" />
          </Button>
        ) : null}
        {props.headerActions}
      </div>
    </header>
  );
}

function runtimeLabel(kind: AgentRuntimeKind): string {
  return kind === "grok-build" ? "Grok Build" : "OpenCode";
}
