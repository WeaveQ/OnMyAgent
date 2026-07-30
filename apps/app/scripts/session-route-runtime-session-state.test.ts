import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SidebarSessionItem } from "../src/app/types";
import {
  applyRuntimeSessionInfoUpdate,
  applyRuntimeSessionStatusUpdate,
  resolveSessionRouteCanCreateTask,
  resolveSessionRouteShowPreparingStatus,
} from "../src/react-app/shell/session-route/runtime-session-state";
import {
  createEmptySessionProviderAuthState,
  sessionProviderAuthOnMyAgentSnapshot,
  sessionProviderAuthWorkspaceDisplay,
} from "../src/react-app/shell/session-route/session-provider-auth";

const shell = join(import.meta.dir, "../src/react-app/shell/session-route");

function session(
  input: Partial<SidebarSessionItem> & { id: string },
): SidebarSessionItem {
  return {
    id: input.id,
    title: input.title ?? input.id,
    slug: input.slug ?? null,
    status: input.status,
    state: input.state,
    runStatus: input.runStatus,
    parentID: input.parentID ?? null,
    time: input.time,
    directory: input.directory ?? null,
  };
}

describe("session-route runtime session state pure helpers", () => {
  test("applyRuntimeSessionInfoUpdate merges metadata and preserves identity when unchanged", () => {
    const current = {
      ws_1: [session({ id: "ses_1", title: "Old" })],
    };
    const next = applyRuntimeSessionInfoUpdate(current, "ws_1", {
      sessionId: "ses_1",
      info: { title: "New", status: "busy" },
    });
    expect(next).not.toBe(current);
    expect(next.ws_1[0]).toMatchObject({
      id: "ses_1",
      title: "New",
      status: "busy",
    });

    const same = applyRuntimeSessionInfoUpdate(next, "ws_1", {
      sessionId: "ses_1",
      info: { title: "New", status: "busy" },
    });
    expect(same).toBe(next);

    const missing = applyRuntimeSessionInfoUpdate(next, "ws_1", {
      sessionId: "ses_missing",
      info: { title: "Nope" },
    });
    expect(missing).toBe(next);
  });

  test("applyRuntimeSessionStatusUpdate updates status only", () => {
    const current = {
      ws_1: [session({ id: "ses_1", title: "T", status: "idle" })],
    };
    const next = applyRuntimeSessionStatusUpdate(current, "ws_1", {
      sessionId: "ses_1",
      status: "busy",
    });
    expect(next.ws_1[0]).toMatchObject({ id: "ses_1", title: "T", status: "busy" });

    const blank = applyRuntimeSessionStatusUpdate(next, "ws_1", {
      sessionId: "  ",
      status: "done",
    });
    expect(blank).toBe(next);

    const same = applyRuntimeSessionStatusUpdate(next, "ws_1", {
      sessionId: "ses_1",
      status: "busy",
    });
    expect(same).toBe(next);
  });

  test("resolveSessionRouteCanCreateTask and showPreparingStatus", () => {
    expect(
      resolveSessionRouteCanCreateTask({
        hasOpencodeClient: true,
        selectedWorkspaceId: "ws",
        loading: false,
        selectedWorkspaceError: null,
        modelAvailabilityBlocksTask: false,
      }),
    ).toBe(true);

    expect(
      resolveSessionRouteCanCreateTask({
        hasOpencodeClient: true,
        selectedWorkspaceId: "ws",
        loading: false,
        selectedWorkspaceError: null,
        modelAvailabilityBlocksTask: true,
      }),
    ).toBe(false);

    expect(
      resolveSessionRouteShowPreparingStatus({
        effectiveLoading: false,
        canCreateTask: false,
        routeError: null,
        selectedWorkspaceError: null,
      }),
    ).toBe(true);

    expect(
      resolveSessionRouteShowPreparingStatus({
        effectiveLoading: false,
        canCreateTask: true,
        routeError: null,
        selectedWorkspaceError: null,
      }),
    ).toBe(false);
  });

  test("provider-auth pure bag helpers", () => {
    const empty = createEmptySessionProviderAuthState();
    expect(empty.opencodeClient).toBeNull();
    expect(empty.providers).toEqual([]);

    expect(sessionProviderAuthWorkspaceDisplay(null)).toMatchObject({
      id: "",
      name: "",
    });

    const display = sessionProviderAuthWorkspaceDisplay({
      id: "ws_1",
      name: "Alpha",
      path: "/tmp/alpha",
      preset: "local",
      workspaceType: "local",
      displayNameResolved: "Alpha",
      displayName: "Alpha",
    });
    expect(display.name).toBe("Alpha");
    expect(display.id).toBe("ws_1");

    expect(sessionProviderAuthOnMyAgentSnapshot(null)).toEqual({
      onmyagentServerStatus: "disconnected",
      onmyagentServerClient: null,
      onmyagentServerCapabilities: null,
    });
    expect(
      sessionProviderAuthOnMyAgentSnapshot({
        baseUrl: "http://127.0.0.1:1",
        token: "t",
        workspaceId: "ws",
        isRemote: false,
        client: {} as never,
        mountedBaseUrl: "http://127.0.0.1:1/workspace/ws",
        opencodeBaseUrl: "http://127.0.0.1:1/workspace/ws/opencode",
      }),
    ).toMatchObject({
      onmyagentServerStatus: "connected",
      onmyagentServerCapabilities: { config: { read: true, write: true } },
    });
  });

  test("render.tsx wires extracted pure modules", () => {
    const renderPath = join(shell, "render.tsx");
    const runtimePath = join(shell, "runtime-session-state.ts");
    const providerAuthPath = join(shell, "session-provider-auth.ts");
    const hookPath = join(shell, "provider-auth-hook.ts");
    expect(existsSync(renderPath)).toBe(true);
    expect(existsSync(runtimePath)).toBe(true);
    expect(existsSync(providerAuthPath)).toBe(true);
    expect(existsSync(hookPath)).toBe(true);

    const render = readFileSync(renderPath, "utf8");
    expect(render).toContain('from "./runtime-session-state"');
    expect(render).toContain('from "./provider-auth-hook"');
    expect(render).toContain("applyRuntimeSessionInfoUpdate");
    expect(render).toContain("applyRuntimeSessionStatusUpdate");
    expect(render).toContain("resolveSessionRouteCanCreateTask");
    expect(render).toContain("useSessionRouteProviderAuth");
    expect(render).not.toContain("createProviderAuthStore({");
  });
});
