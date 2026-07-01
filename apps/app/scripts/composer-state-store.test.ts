import { beforeEach, describe, expect, test } from "bun:test";

import type { ComposerAttachment } from "../src/app/types";
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
});
