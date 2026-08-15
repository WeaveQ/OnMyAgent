import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ComposerAttachment } from "../src/app/types";
import {
  clearComposerDraftForNewTask,
  setComposerDraftAfterNewTask,
} from "../src/react-app/domains/session/pages/shared-page-utils";
import {
  getComposerAttachments,
  getComposerDraft,
  getComposerMentions,
  getComposerPasteParts,
  useComposerStateStore,
  type ComposerPastePart,
} from "../src/react-app/domains/session/surface/composer-state-store";

const attachment = {
  id: "att_1",
  name: "note.txt",
  mimeType: "text/plain",
  size: 12,
  kind: "file",
  file: new File(["hello"], "note.txt", { type: "text/plain" }),
} satisfies ComposerAttachment;

const pastePart = {
  id: "paste_1",
  label: "Snippet",
  text: "line 1\nline 2",
  lines: 2,
} satisfies ComposerPastePart;

beforeEach(() => {
  useComposerStateStore.setState({ sessions: {} });
});

describe("composer state store", () => {
  test("returns stable empty fallbacks for missing sessions", () => {
    const state = useComposerStateStore.getState();

    expect(getComposerDraft(state, "missing")).toBe("");
    expect(getComposerAttachments(state, "missing")).toEqual([]);
    expect(getComposerMentions(state, "missing")).toEqual({});
    expect(getComposerPasteParts(state, "missing")).toEqual([]);
    expect(getComposerAttachments(state, "missing")).toBe(getComposerAttachments(state, "another"));
    expect(getComposerMentions(state, "missing")).toBe(getComposerMentions(state, "another"));
    expect(getComposerPasteParts(state, "missing")).toBe(getComposerPasteParts(state, "another"));
  });

  test("updates draft, attachments, mentions, and paste parts per session", () => {
    useComposerStateStore.getState().setDraft("ses_1", "hello");
    useComposerStateStore.getState().setAttachments("ses_1", [attachment]);
    useComposerStateStore.getState().setMentions("ses_1", { agent_alpha: "agent", file_readme: "file" });
    useComposerStateStore.getState().setPasteParts("ses_1", [pastePart]);

    const state = useComposerStateStore.getState();
    expect(getComposerDraft(state, "ses_1")).toBe("hello");
    expect(getComposerAttachments(state, "ses_1")).toEqual([attachment]);
    expect(getComposerMentions(state, "ses_1")).toEqual({ agent_alpha: "agent", file_readme: "file" });
    expect(getComposerPasteParts(state, "ses_1")).toEqual([pastePart]);
    expect(getComposerDraft(state, "ses_2")).toBe("");
  });

  test("preserves other sessions and clears only the requested session", () => {
    useComposerStateStore.getState().setDraft("ses_1", "one");
    useComposerStateStore.getState().setDraft("ses_2", "two");
    useComposerStateStore.getState().clearSession("ses_1");

    const state = useComposerStateStore.getState();
    expect(getComposerDraft(state, "ses_1")).toBe("");
    expect(getComposerDraft(state, "ses_2")).toBe("two");

    const unchanged = useComposerStateStore.getState();
    useComposerStateStore.getState().clearSession("missing");
    expect(useComposerStateStore.getState()).toBe(unchanged);
  });

  test("plain new task clears a leftover assistant draft seed", () => {
    const workspaceId = "ws_office";
    const sessionId = `draft:${workspaceId}`;
    useComposerStateStore
      .getState()
      .setDraft(sessionId, "/skill-creator Please help me create a skill");
    expect(getComposerDraft(useComposerStateStore.getState(), sessionId)).toContain(
      "/skill-creator",
    );
    clearComposerDraftForNewTask(workspaceId);
    expect(getComposerDraft(useComposerStateStore.getState(), sessionId)).toBe("");
  });

  test("plain new-task CTAs clear leftover draft; shared create-task does not", () => {
    const hook = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/shell/session-route/workspace-interaction-hook.ts",
      ),
      "utf8",
    );
    const assistant = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/pages/assistant.tsx",
      ),
      "utf8",
    );
    const shortcuts = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/shell/session-route/global-shortcuts-hook.ts",
      ),
      "utf8",
    );
    expect(hook).not.toContain("clearComposerDraftForNewTask");
    expect(assistant).toContain(
      "clearComposerDraftForNewTask(props.selectedWorkspaceId)",
    );
    const seedBlock = assistant.slice(
      assistant.indexOf("const openOfficeNewTaskWithDraft"),
      assistant.indexOf("const handleCreateSkill"),
    );
    expect(seedBlock).toContain('openAssistantNewTask("office")');
    expect(seedBlock).toContain(
      "setComposerDraftAfterNewTask(props.selectedWorkspaceId, draft)",
    );
    expect(seedBlock).not.toContain("clearComposerDraftForNewTask");
    expect(shortcuts).toContain(
      "clearComposerDraftForNewTask(selectedWorkspaceId)",
    );
  });

  test("create-skill seed still applies after a leftover draft was cleared", () => {
    const workspaceId = "ws_office";
    const sessionId = `draft:${workspaceId}`;
    const queued: Array<() => void> = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
      setTimeout: (fn: TimerHandler) => {
        if (typeof fn === "function") queued.push(() => fn());
        return 0;
      },
      requestAnimationFrame: (fn: FrameRequestCallback) => {
        queued.push(() => fn(0));
        return 0;
      },
    } as unknown as Window & typeof globalThis;
    try {
      useComposerStateStore
        .getState()
        .setDraft(sessionId, "/skill-creator leftover");
      clearComposerDraftForNewTask(workspaceId);
      setComposerDraftAfterNewTask(
        workspaceId,
        "/skill-creator Please help me create a skill",
      );
      expect(getComposerDraft(useComposerStateStore.getState(), sessionId)).toContain(
        "/skill-creator Please help me create",
      );
      for (const apply of queued) apply();
      expect(getComposerDraft(useComposerStateStore.getState(), sessionId)).toContain(
        "/skill-creator Please help me create",
      );
    } finally {
      globalThis.window = previousWindow;
    }
  });

  test("plain new-task clear cancels an in-flight create-skill seed", () => {
    const workspaceId = "ws_office";
    const sessionId = `draft:${workspaceId}`;
    const queued: Array<() => void> = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
      setTimeout: (fn: TimerHandler) => {
        if (typeof fn === "function") queued.push(() => fn());
        return 0;
      },
      requestAnimationFrame: (fn: FrameRequestCallback) => {
        queued.push(() => fn(0));
        return 0;
      },
    } as unknown as Window & typeof globalThis;
    try {
      setComposerDraftAfterNewTask(
        workspaceId,
        "/skill-creator Please help me create a skill",
      );
      clearComposerDraftForNewTask(workspaceId);
      for (const apply of queued) apply();
      expect(getComposerDraft(useComposerStateStore.getState(), sessionId)).toBe(
        "",
      );
    } finally {
      globalThis.window = previousWindow;
    }
  });
});
