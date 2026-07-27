import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import type { OpencodeEvent } from "../src/app/types";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { readTranscriptMessageMetadata } from "../src/react-app/domains/session/sync/message-metadata";
import {
  __applySessionSyncEventForTest,
  __createWorkspaceSessionSyncForTest,
  __disposeWorkspaceSessionSyncForTest,
  removeOptimisticUserMessage,
  seedOptimisticUserMessage,
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
  test("shows a created session user prompt immediately and reconciles to the runtime id", () => {
    const optimisticMessageId = seedOptimisticUserMessage({
      workspaceId: "runtime_ws",
      sessionId: "ses_new",
      text: "客户微信发来一条新订单",
    });
    expect(optimisticMessageId).toStartWith("optimistic-user-");
    __createWorkspaceSessionSyncForTest(syncInput);
    const release = trackWorkspaceSessionSync(syncInput, "ses_new");

    __applySessionSyncEventForTest(syncInput, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_runtime_user",
          sessionID: "ses_new",
          role: "user",
          time: { created: 1_000 },
        },
      },
    });

    expect(
      getReactQueryClient().getQueryData<UIMessage[]>(
        transcriptKey("runtime_ws", "ses_new"),
      ),
    ).toEqual([
      expect.objectContaining({
        id: "msg_runtime_user",
        role: "user",
        parts: [{ type: "text", text: "客户微信发来一条新订单" }],
      }),
    ]);
    release();
  });

  test("removes a created-session optimistic prompt when submission fails", () => {
    const optimisticMessageId = seedOptimisticUserMessage({
      workspaceId: "runtime_ws",
      sessionId: "ses_new",
      text: "这条消息发送失败",
    });
    expect(optimisticMessageId).not.toBeNull();
    if (!optimisticMessageId) throw new Error("Expected optimistic message id");
    removeOptimisticUserMessage({
      workspaceId: "runtime_ws",
      sessionId: "ses_new",
      messageId: optimisticMessageId,
    });
    expect(
      getReactQueryClient().getQueryData<UIMessage[]>(
        transcriptKey("runtime_ws", "ses_new"),
      ),
    ).toEqual([]);
  });

  test("preserves rich metadata from live message updates", () => {
    __createWorkspaceSessionSyncForTest(syncInput);
    const release = trackWorkspaceSessionSync(syncInput, "ses_new");

    __applySessionSyncEventForTest(syncInput, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_assistant",
          sessionID: "ses_new",
          role: "assistant",
          time: { created: 1_000, completed: 2_000 },
          providerID: "openai",
          modelID: "gpt-5",
          cost: 0.25,
          tokens: {
            total: 30,
            input: 10,
            output: 20,
            reasoning: 3,
            cache: { read: 4, write: 5 },
          },
        },
      },
    });

    const synced = getReactQueryClient()
      .getQueryData<UIMessage[]>(transcriptKey("runtime_ws", "ses_new"))
      ?.find((item) => item.id === "msg_assistant");
    expect(readTranscriptMessageMetadata(synced?.metadata)).toEqual({
      created: 1_000,
      completed: 2_000,
      providerID: "openai",
      modelID: "gpt-5",
      cost: 0.25,
      tokens: {
        total: 30,
        input: 10,
        output: 20,
        reasoning: 3,
        cacheRead: 4,
        cacheWrite: 5,
      },
      errorName: null,
      finishReason: null,
    });

    release();
  });

  test("preserves output-limit finish reasons from live message updates", () => {
    __createWorkspaceSessionSyncForTest(syncInput);
    const release = trackWorkspaceSessionSync(syncInput, "ses_new");

    __applySessionSyncEventForTest(syncInput, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_assistant",
          sessionID: "ses_new",
          role: "assistant",
          finish: "length",
          time: { created: 1_000, completed: 2_000 },
        },
      },
    });

    const synced = getReactQueryClient()
      .getQueryData<UIMessage[]>(transcriptKey("runtime_ws", "ses_new"))
      ?.find((item) => item.id === "msg_assistant");
    expect(readTranscriptMessageMetadata(synced?.metadata).finishReason).toBe("length");

    release();
  });

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
