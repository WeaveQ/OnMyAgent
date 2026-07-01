import { describe, expect, test } from "bun:test";

import type {
  CreateRemoteWorkspaceModalProps,
  CreateWorkspaceModalProps,
  CreateWorkspaceProgress,
  CreateWorkspaceScreen,
  RemoteWorkspaceInput,
  ShareWorkspaceModalProps,
  ShareView,
} from "../src/react-app/domains/shared/workspace-modal-types";

const progress = {
  runId: "run-1",
  startedAt: 1782200000000,
  stage: "clone",
  error: null,
  steps: [
    { key: "clone", label: "Clone", status: "active", detail: "fetching" },
    { key: "install", label: "Install", status: "pending" },
  ],
  logs: ["start"],
} satisfies CreateWorkspaceProgress;

const remoteInput = {
  onmyagentHostUrl: "http://127.0.0.1:4111",
  onmyagentToken: "token",
  onmyagentClientToken: "client-token",
  onmyagentHostToken: "host-token",
  directory: "/tmp/workspace",
  displayName: "Demo",
  closeModal: true,
} satisfies RemoteWorkspaceInput;

describe("shared workspace modal type contracts", () => {
  test("keeps modal screen and share view unions stable", () => {
    const screens: CreateWorkspaceScreen[] = ["chooser", "local", "remote", "shared"];
    const shareViews: ShareView[] = ["chooser", "access"];

    expect(screens).toEqual(["chooser", "local", "remote", "shared"]);
    expect(shareViews).toEqual(["chooser", "access"]);
  });

  test("keeps remote workspace input compatible across session and workspace domains", () => {
    expect(remoteInput).toMatchObject({
      onmyagentHostUrl: "http://127.0.0.1:4111",
      onmyagentToken: "token",
      directory: "/tmp/workspace",
      closeModal: true,
    });
  });

  test("supports shared props consumed by session route modals", () => {
    const createProps = {
      open: true,
      onClose: () => undefined,
      onConfirm: () => undefined,
      onPickFolder: async () => null,
      submittingProgress: progress,
    } satisfies CreateWorkspaceModalProps;

    const remoteProps = {
      open: true,
      onClose: () => undefined,
      onConfirm: () => undefined,
      initialValues: remoteInput,
    } satisfies CreateRemoteWorkspaceModalProps;

    const shareProps = {
      open: true,
      onClose: () => undefined,
      title: "Share",
      workspaceName: "Demo",
      fields: [{ label: "URL", value: "http://127.0.0.1:4111" }],
      remoteAccess: {
        enabled: true,
        busy: false,
        onSave: () => undefined,
      },
    } satisfies ShareWorkspaceModalProps;

    expect(createProps.submittingProgress?.steps[0]?.status).toBe("active");
    expect(remoteProps.initialValues?.displayName).toBe("Demo");
    expect(shareProps.remoteAccess?.enabled).toBe(true);
  });
});
