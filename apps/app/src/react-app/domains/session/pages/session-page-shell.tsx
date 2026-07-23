/**
 * Shared session page chrome for expert + assistant hosts:
 * main column layout and rail keep-alive stack.
 *
 * Mode-specific page bodies (StorePage props, SessionSurface wiring, etc.)
 * stay in the hosts; this shell only owns the stack / hide / primary-rail
 * structure so keep-alive contracts stay one place.
 */
/** @jsxImportSource react */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { KeepAlivePane } from "../sidebar/keep-alive-pane";

export type SessionRailPaneKey =
  | "agents"
  | "store"
  | "localAgent"
  | "agentManagement"
  | "files"
  | "projects"
  | "devices"
  | "channels"
  | "billing";

/** Secondary rail panes that use visited-set keep-alive. */
export const SESSION_RAIL_KEEP_ALIVE_PANE_KEYS = [
  "agents",
  "store",
  "localAgent",
  "agentManagement",
  "files",
  "projects",
  "devices",
  "channels",
  "billing",
] as const satisfies readonly SessionRailPaneKey[];

/**
 * Outer main column: transparent under local-agent, otherwise dls background;
 * drops the right border when the session side panel is open on primary rail.
 */
export function SessionPageMainColumn(props: {
  activeSidebarView: string;
  sidePanelBorderOpen: boolean;
  children: ReactNode;
  className?: string;
}) {
  const localAgent = props.activeSidebarView === "localAgent";
  return (
    <main
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden",
        // Local agent paints its own list/content chrome; avoid stacking
        // extra bg-dls-background under the list (was washing out sidebar).
        localAgent ? "bg-transparent" : "bg-dls-background",
        // One separator only: handle draws the line when the right panel is open.
        props.sidePanelBorderOpen ? "border-r-0" : "border-r border-dls-border",
        props.className,
      )}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "relative min-w-0 flex-1 overflow-hidden",
            localAgent
              ? "bg-transparent"
              : "bg-dls-background mac:bg-dls-background",
          )}
        >
          {props.children}
        </div>
      </div>
    </main>
  );
}

export type SessionRailKeepAliveStackProps = {
  activeSidebarView: string;
  visitedRailViews: Set<string>;
  /**
   * Whether the primary conversation rail is selected (assistant/chat).
   * Primary SessionSurface must only paint when this is true.
   */
  isPrimarySessionView: boolean;
  /** KeepAlivePane active for SessionSurface (primary + not delayed loading). */
  primarySessionActive: boolean;
  /** Optional bodies per keep-alive rail key; omit a key to skip that pane. */
  panes: Partial<Record<SessionRailPaneKey, ReactNode>>;
  /**
   * Non-keep-alive content between secondary rails and primary surface
   * (scheduled tasks, placeholders, skeletons, empty/loading states).
   */
  middle?: ReactNode;
  /** Primary SessionSurface (or null when not ready). Mounted always when set. */
  primarySession?: ReactNode | null;
  afterPrimary?: ReactNode;
};

/**
 * Rail keep-alive stack shared by expert + assistant.
 * Explicit `visitedRailViews.has("…")` strings are intentional for source-scan contracts.
 */
export function SessionRailKeepAliveStack(props: SessionRailKeepAliveStackProps) {
  return (
    <>
      {props.panes.agents != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "agents"}
          mounted={props.visitedRailViews.has("agents")}
        >
          {props.panes.agents}
        </KeepAlivePane>
      ) : null}

      {props.panes.store != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "store"}
          mounted={props.visitedRailViews.has("store")}
        >
          {props.panes.store}
        </KeepAlivePane>
      ) : null}

      {props.panes.localAgent != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "localAgent"}
          mounted={props.visitedRailViews.has("localAgent")}
        >
          {props.panes.localAgent}
        </KeepAlivePane>
      ) : null}

      {props.panes.agentManagement != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "agentManagement"}
          mounted={props.visitedRailViews.has("agentManagement")}
        >
          {props.panes.agentManagement}
        </KeepAlivePane>
      ) : null}

      {props.panes.files != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "files"}
          mounted={props.visitedRailViews.has("files")}
        >
          {props.panes.files}
        </KeepAlivePane>
      ) : null}

      {props.panes.projects != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "projects"}
          mounted={props.visitedRailViews.has("projects")}
        >
          {props.panes.projects}
        </KeepAlivePane>
      ) : null}

      {props.panes.devices != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "devices"}
          mounted={props.visitedRailViews.has("devices")}
        >
          {props.panes.devices}
        </KeepAlivePane>
      ) : null}

      {props.panes.channels != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "channels"}
          mounted={props.visitedRailViews.has("channels")}
        >
          {props.panes.channels}
        </KeepAlivePane>
      ) : null}

      {props.panes.billing != null ? (
        <KeepAlivePane
          active={props.activeSidebarView === "billing"}
          mounted={props.visitedRailViews.has("billing")}
        >
          {props.panes.billing}
        </KeepAlivePane>
      ) : null}

      {props.middle}

      {props.primarySession != null ? (
        <KeepAlivePane
          active={
            props.primarySessionActive
          }
          mounted
        >
          {props.primarySession}
        </KeepAlivePane>
      ) : null}

      {props.afterPrimary}
    </>
  );
}
