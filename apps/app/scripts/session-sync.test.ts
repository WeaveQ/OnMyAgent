import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import type { OpencodeEvent } from "../src/app/types";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { readTranscriptMessageMetadata } from "../src/react-app/domains/session/sync/message-metadata";
import {
  __applySessionSyncEventForTest,
  __createSessionSyncConnectionForTest,
  __createWorkspaceSessionSyncForTest,
  __disposeWorkspaceSessionSyncForTest,
  __expireRetainedSessionForTest,
  __getWorkspaceSessionSyncResourcesForTest,
  __hasWorkspaceSessionSyncForTest,
  __retentionTtlForUntrackedSessionForTest,
  disposeWorkspaceSessionSyncs,
  trackWorkspaceSessionSync,
  transcriptKey,
} from "../src/react-app/domains/session/sync/session-sync";

const syncInput = {
  workspaceId: "runtime_ws",
  baseUrl: "http://127.0.0.1:9999/workspace/runtime_ws/opencode",
  onmyagentToken: "test-token",
};

function deferred<T>() {
  let reject: (reason?: unknown) => void = () => undefined;
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

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
  test("does not let a stale watchdog connection schedule a third stream", async () => {
    const first = deferred<{ stream: AsyncIterable<unknown> }>();
    const second = deferred<{ stream: AsyncIterable<unknown> }>();
    const never = deferred<void>();
    let subscriptions = 0;
    const sync = __createSessionSyncConnectionForTest({
      initialRetryDelayMs: 0,
      staleStreamMs: 0,
      subscribe: () => {
        subscriptions += 1;
        return subscriptions === 1 ? first.promise : second.promise;
      },
      onEvent: () => undefined,
    });

    await settle();
    expect(subscriptions).toBe(1);

    sync.watchdog();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(subscriptions).toBe(2);

    second.resolve({
      stream: (async function* () {
        await never.promise;
      })(),
    });
    await settle();
    first.reject(new Error("late connection failure"));
    await settle();

    expect(subscriptions).toBe(2);
    sync.dispose();
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

  test("releases idle directories after their short retention window", () => {
    const oldInputs = Array.from({ length: 10 }, (_, index) => ({
      ...syncInput,
      directory: `/tmp/idle-${index}`,
    }));
    const currentInput = { ...syncInput, directory: "/tmp/current" };

    const releases = oldInputs.map((input) => {
      const releaseWorkspace = __createWorkspaceSessionSyncForTest(input);
      const releaseSession = trackWorkspaceSessionSync(input, `ses_idle_${input.directory}`);
      releaseSession();
      releaseWorkspace();
      return input;
    });
    __createWorkspaceSessionSyncForTest(currentInput);
    const releaseCurrent = trackWorkspaceSessionSync(currentInput, "ses_current");

    for (const input of releases) {
      expect(__getWorkspaceSessionSyncResourcesForTest(input)).toEqual({
        exists: true,
        refs: 0,
        trackedSessions: 0,
        retainedSessions: 1,
      });
      __expireRetainedSessionForTest(input, `ses_idle_${input.directory}`);
      expect(__hasWorkspaceSessionSyncForTest(input)).toBe(false);
    }
    expect(__getWorkspaceSessionSyncResourcesForTest(currentInput)).toEqual({
      exists: true,
      refs: 1,
      trackedSessions: 1,
      retainedSessions: 0,
    });

    releaseCurrent();
    __expireRetainedSessionForTest(currentInput, "ses_current");
    __disposeWorkspaceSessionSyncForTest(currentInput);
    expect(__hasWorkspaceSessionSyncForTest(currentInput)).toBe(false);
  });

  test("immediately disposes all directory streams for a forgotten workspace", () => {
    const first = { ...syncInput, directory: "/tmp/first" };
    const second = { ...syncInput, directory: "/tmp/second" };
    __createWorkspaceSessionSyncForTest(first);
    __createWorkspaceSessionSyncForTest(second);

    disposeWorkspaceSessionSyncs(syncInput.workspaceId);

    expect(__hasWorkspaceSessionSyncForTest(first)).toBe(false);
    expect(__hasWorkspaceSessionSyncForTest(second)).toBe(false);
  });

  test("does not dispose a shared workspace stream when one release runs twice", () => {
    const firstRelease = __createWorkspaceSessionSyncForTest(syncInput);
    const secondRelease = __createWorkspaceSessionSyncForTest(syncInput);

    firstRelease();
    firstRelease();

    expect(__getWorkspaceSessionSyncResourcesForTest(syncInput)).toMatchObject({
      exists: true,
      refs: 1,
    });

    secondRelease();
    expect(__hasWorkspaceSessionSyncForTest(syncInput)).toBe(false);
  });

  test("makes tracked-session release idempotent", () => {
    const releaseWorkspace = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "ses_release_once");

    releaseSession();
    releaseSession();

    expect(__getWorkspaceSessionSyncResourcesForTest(syncInput)).toMatchObject({
      exists: true,
      trackedSessions: 0,
      retainedSessions: 1,
    });

    releaseWorkspace();
    __expireRetainedSessionForTest(syncInput, "ses_release_once");
  });

  test("keeps busy sessions long only until they become idle, then releases them", () => {
    const input = { ...syncInput, directory: "/tmp/busy" };
    const releaseWorkspace = __createWorkspaceSessionSyncForTest(input);
    const releaseSession = trackWorkspaceSessionSync(input, "ses_busy");

    __applySessionSyncEventForTest(input, {
      type: "session.status",
      properties: { sessionID: "ses_busy", status: { type: "busy" } },
    });
    releaseSession();
    releaseWorkspace();
    expect(__getWorkspaceSessionSyncResourcesForTest(input)).toEqual({
      exists: true,
      refs: 0,
      trackedSessions: 0,
      retainedSessions: 1,
    });

    __applySessionSyncEventForTest(input, {
      type: "session.idle",
      properties: { sessionID: "ses_busy" },
    });
    __expireRetainedSessionForTest(input, "ses_busy");
    expect(__hasWorkspaceSessionSyncForTest(input)).toBe(false);
  });

  test("does not retain waiting or compacting directories for ten minutes", () => {
    useSessionActivityStore.getState().setWaitingRequest(
      syncInput.workspaceId,
      "ses_waiting",
      "permission",
      "permission-1",
      true,
    );
    useSessionActivityStore.getState().setCompacting(
      syncInput.workspaceId,
      "ses_compacting",
      true,
    );
    expect(
      __retentionTtlForUntrackedSessionForTest(syncInput, "ses_waiting"),
    ).toBe(10_000);
    expect(
      __retentionTtlForUntrackedSessionForTest(syncInput, "ses_compacting"),
    ).toBe(10_000);
  });
});
