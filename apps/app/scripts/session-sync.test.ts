import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import type { OpencodeEvent } from "../src/app/types";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import {
  __applySessionSyncEventForTest,
  __createWorkspaceSessionSyncForTest,
  __disposeWorkspaceSessionSyncForTest,
  trackWorkspaceSessionSync,
  transcriptKey,
} from "../src/react-app/domains/session/sync/session-sync";

const syncInput = {
  workspaceId: "runtime_ws",
  baseUrl: "http://127.0.0.1:9999/workspace/runtime_ws/opencode",
  onmyagentToken: "test-token",
};

const partUpdatedEvent: OpencodeEvent = {
  type: "message.part.updated",
  properties: {
    part: {
      id: "part_text",
      type: "text",
      text: "hello",
      sessionID: "ses_new",
      messageID: "msg_assistant",
    },
  },
};

beforeEach(() => {
  getReactQueryClient().clear();
  useSessionActivityStore.setState({
    recordsByWorkspaceId: {},
    statusesByWorkspaceId: {},
  });
});

afterEach(() => {
  __disposeWorkspaceSessionSyncForTest(syncInput);
});

describe("session sync tracking", () => {
  test("scopes workspace sync entries by directory", () => {
    const rootInput = { ...syncInput, directory: "/tmp/root" };
    const taskInput = { ...syncInput, directory: "/tmp/task" };
    const releaseRoot = __createWorkspaceSessionSyncForTest(rootInput);
    const releaseTask = __createWorkspaceSessionSyncForTest(taskInput);

    expect(trackWorkspaceSessionSync(rootInput, "ses_new")).toBeFunction();
    __disposeWorkspaceSessionSyncForTest(rootInput);
    __applySessionSyncEventForTest(taskInput, partUpdatedEvent);

    expect(
      getReactQueryClient()
        .getQueryData<UIMessage[]>(transcriptKey("runtime_ws", "ses_new"))
        ?.flatMap((message) => message.parts)
        .some((part) => part.type === "text" && part.text === "hello"),
    ).toBeUndefined();

    releaseRoot();
    releaseTask();
  });

  test("keeps created sessions tracked while the first prompt is running", () => {
    __createWorkspaceSessionSyncForTest(syncInput);

    __applySessionSyncEventForTest(syncInput, partUpdatedEvent);
    expect(
      getReactQueryClient().getQueryData<UIMessage[]>(
        transcriptKey("runtime_ws", "ses_new"),
      ),
    ).toBeUndefined();

    const release = trackWorkspaceSessionSync(syncInput, "ses_new");
    __applySessionSyncEventForTest(syncInput, partUpdatedEvent);

    expect(
      getReactQueryClient()
        .getQueryData<UIMessage[]>(transcriptKey("runtime_ws", "ses_new"))
        ?.flatMap((message) => message.parts)
        .some((part) => part.type === "text" && part.text === "hello"),
    ).toBe(true);

    release();
    __applySessionSyncEventForTest(syncInput, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part_text",
          type: "text",
          text: "hello again",
          sessionID: "ses_new",
          messageID: "msg_assistant",
        },
      },
    });

    expect(
      getReactQueryClient()
        .getQueryData<UIMessage[]>(transcriptKey("runtime_ws", "ses_new"))
        ?.flatMap((message) => message.parts)
        .some((part) => part.type === "text" && part.text === "hello again"),
    ).toBe(true);
  });
});
