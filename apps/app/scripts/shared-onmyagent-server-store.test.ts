import { describe, expect, test } from "bun:test";

import type { WorkspaceDisplay } from "../src/app/types";
import { createOpenworkServerStore } from "../src/react-app/domains/shared/onmyagent-server-store";

const localWorkspace = {
  id: "local-workspace",
  name: "Local Workspace",
  path: "/tmp/onmyagent",
  preset: "default",
  workspaceType: "local",
} satisfies WorkspaceDisplay;

const createStore = (startupPreference: () => "local" | "server" | null = () => null) =>
  createOpenworkServerStore({
    startupPreference,
    documentVisible: () => true,
    developerMode: () => false,
    runtimeWorkspaceId: () => null,
    activeClient: () => null,
    selectedWorkspaceDisplay: () => localWorkspace,
    restartLocalServer: async () => true,
    createRemoteWorkspaceFlow: async () => true,
  });

describe("shared onmyagent server store contract", () => {
  test("starts with a disconnected headless snapshot", () => {
    const store = createStore();
    const snapshot = store.getSnapshot();

    expect(snapshot.onmyagentServerStatus).toBe("disconnected");
    expect(snapshot.onmyagentServerReady).toBe(false);
    expect(snapshot.onmyagentServerWorkspaceReady).toBe(false);
    expect(snapshot.onmyagentServerClient).toBeNull();
    expect(snapshot.onmyagentServerSettings).toEqual({});
  });

  test("derives server mode url, auth, and client from shared settings", () => {
    const store = createStore(() => "server");
    let changes = 0;
    const unsubscribe = store.subscribe(() => {
      changes += 1;
    });

    store.setOpenworkServerSettings({
      urlOverride: " http://127.0.0.1:4111 ",
      token: "client-token",
      hostToken: "host-token",
    });

    const snapshot = store.getSnapshot();
    expect(changes).toBe(1);
    expect(snapshot.onmyagentServerUrl).toBe("http://127.0.0.1:4111");
    expect(snapshot.onmyagentServerBaseUrl).toBe("http://127.0.0.1:4111");
    expect(snapshot.onmyagentServerAuth).toEqual({ token: "client-token", hostToken: "host-token" });
    expect(snapshot.onmyagentServerClient).not.toBeNull();

    unsubscribe();
    store.setOpenworkServerSettings({});
    expect(changes).toBe(1);
  });
});
