import { describe, expect, it } from "bun:test";

import { buildSessionPageViewModel } from "../src/react-app/domains/session/chat/session-page-view-model";
import {
  SIDEBAR_VIEW_ICONS,
  SIDEBAR_VIEW_LABELS,
  type SidebarFeatureView,
} from "../src/react-app/domains/session/chat/session-page-sidebar-view-model";

const baseInput = {
  activeSidebarView: "chat" as const,
  clientConnected: true,
  onmyagentServerClient: null,
  onmyagentServerStatus: "connected" as const,
  onmyagentServerToken: null,
  opencodeBaseUrl: null,
  runtimeWorkspaceId: null,
  selectedSessionId: null,
  selectedWorkspaceDisplay: { workspaceType: "local" as const },
  selectedWorkspaceError: null,
  selectedWorkspaceId: "ws_local",
  sessionLoadingById: () => false,
  sidebar: {
    workspaceSessionGroups: [],
    workspaceConnectionStateById: {},
    startupPhase: "ready" as const,
  },
  startupPhase: "ready" as const,
  statusBarLoading: false,
  surface: null,
  workspaceCount: 1,
};

describe("session page view model", () => {
  it("marks the local Agent page as a first-class view for right side panels", () => {
    const view = buildSessionPageViewModel({
      ...baseInput,
      activeSidebarView: "localAgent",
    });

    expect(view.activePlaceholderView).toBeNull();
    expect(view.isLocalAgentView).toBe(true);
    expect(view.isSessionSurfaceView).toBe(false);
  });

  it("keeps first-class sidebar views out of placeholder rendering", () => {
    const firstClassViews = [
      "chat",
      "files",
      "store",
      "projects",
      "skills",
      "connectors",
      "localAgent",
      "sessionArchive",
    ] as const;

    for (const activeSidebarView of firstClassViews) {
      expect(
        buildSessionPageViewModel({
          ...baseInput,
          activeSidebarView,
        }).activePlaceholderView,
      ).toBeNull();
    }
  });

  it("keeps utility sidebar views as placeholders", () => {
    const view = buildSessionPageViewModel({
      ...baseInput,
      activeSidebarView: "billing",
    });

    expect(view.activePlaceholderView).toBe("billing");
    expect(view.isLocalAgentView).toBe(false);
    expect(view.isSessionSurfaceView).toBe(false);
  });

  it("builds draft and react surface contracts from workspace/session state", () => {
    const view = buildSessionPageViewModel({
      ...baseInput,
      onmyagentServerClient: { token: "client-token" },
      onmyagentServerToken: " owner-token ",
      opencodeBaseUrl: " http://127.0.0.1:4096 ",
      runtimeWorkspaceId: "runtime_ws",
      selectedSessionId: null,
      surface: {},
    });

    expect(view.renderedSessionId).toBe("draft:ws_local");
    expect(view.isDraftSession).toBe(true);
    expect(view.canRenderReactSurface).toBe(true);
    expect(view.reactSessionBaseUrl).toBe("http://127.0.0.1:4096");
    expect(view.reactSessionToken).toBe("owner-token");
  });

  it("prioritizes explicit workspace errors before connection and group errors", () => {
    const view = buildSessionPageViewModel({
      ...baseInput,
      selectedWorkspaceDisplay: { workspaceType: "remote" },
      selectedWorkspaceError: " explicit failure ",
      sidebar: {
        workspaceSessionGroups: [
          {
            workspace: { id: "ws_local", name: "Remote" },
            sessions: [],
            error: " group failure ",
          },
        ],
        workspaceConnectionStateById: {
          ws_local: { status: "error", message: " connection failure " },
        },
        startupPhase: "ready",
      },
    });

    expect(view.showSelectedWorkspaceError).toBe(true);
    expect(view.selectedWorkspaceErrorMessage).toBe("explicit failure");
    expect(view.selectedWorkspaceErrorTitle).toBe("Remote workspace unavailable");
  });
});

describe("session page sidebar view model", () => {
  it("keeps labels and icons registered for every feature view", () => {
    const featureViews = [
      "billing",
      "agents",
      "skills",
      "connectors",
      "devices",
      "scheduledTasks",
      "channels",
      "personalAssistant",
      "localAgent",
      "sessionArchive",
    ] satisfies SidebarFeatureView[];

    for (const view of featureViews) {
      expect(SIDEBAR_VIEW_LABELS[view]).toBeString();
      expect(SIDEBAR_VIEW_LABELS[view].length).toBeGreaterThan(0);
      expect(SIDEBAR_VIEW_ICONS[view].render).toBeFunction();
    }
  });
});
