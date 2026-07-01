import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearSessionDraft,
  getSessionDraft,
  saveSessionDraft,
  sessionDraftScopeKey,
} from "../src/react-app/domains/session/sync/draft-store";

const STORAGE_KEY = "onmyagent.session-drafts.v1";

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: createLocalStorage() },
  });
});

describe("session draft store", () => {
  test("builds scoped draft keys from trimmed workspace and session ids", () => {
    expect(sessionDraftScopeKey(" ws_1 ", " ses_1 ")).toBe("ws_1:ses_1");
    expect(sessionDraftScopeKey("", "ses_1")).toBe("");
    expect(sessionDraftScopeKey("ws_1", null)).toBe("");
  });

  test("loads valid persisted drafts and filters prompt-empty drafts", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "ws_1:ses_prompt": { text: "hello", mode: "prompt" },
        "ws_1:ses_shell": { text: "", mode: "shell" },
        "ws_1:ses_empty": { text: "", mode: "prompt" },
        "ws_1:ses_bad_mode": { text: "fallback", mode: "bad" },
      }),
    );

    expect(getSessionDraft("ws_1", "ses_prompt")).toEqual({ text: "hello", mode: "prompt" });
    expect(getSessionDraft("ws_1", "ses_shell")).toEqual({ text: "", mode: "shell" });
    expect(getSessionDraft("ws_1", "ses_empty")).toBeNull();
    expect(getSessionDraft("ws_1", "ses_bad_mode")).toEqual({ text: "fallback", mode: "prompt" });
  });

  test("saves, clears, and persists drafts by scoped session", () => {
    saveSessionDraft(" ws_2 ", " ses_1 ", { text: "draft", mode: "prompt" });
    expect(getSessionDraft("ws_2", "ses_1")).toEqual({ text: "draft", mode: "prompt" });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")["ws_2:ses_1"]).toEqual({
      text: "draft",
      mode: "prompt",
    });

    clearSessionDraft("ws_2", "ses_1");
    expect(getSessionDraft("ws_2", "ses_1")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")["ws_2:ses_1"]).toBeUndefined();
  });

  test("empty prompt drafts clear existing entries but shell drafts persist", () => {
    saveSessionDraft("ws_1", "ses_1", { text: "draft", mode: "prompt" });
    saveSessionDraft("ws_1", "ses_1", { text: "", mode: "prompt" });
    expect(getSessionDraft("ws_1", "ses_1")).toBeNull();

    saveSessionDraft("ws_1", "ses_1", { text: "", mode: "shell" });
    expect(getSessionDraft("ws_1", "ses_1")).toEqual({ text: "", mode: "shell" });
  });
});
