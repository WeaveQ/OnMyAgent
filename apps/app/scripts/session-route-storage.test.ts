import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearOrgOnboardingReloadRequest,
  readDeveloperModeEnabled,
  readOrgOnboardingReloadRequested,
  readWindowSeenProviderIds,
} from "../src/react-app/shell/session-route/storage";
import { reloadAfterOrgOnboardingKey } from "../src/react-app/shell/session-route/state";
import { SETTINGS_DEVELOPER_MODE_KEY } from "../src/react-app/shell/settings-route-storage";

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
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

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("session route storage", () => {
  test("reads and clears org onboarding reload requests", () => {
    expect(readOrgOnboardingReloadRequested()).toBe(false);
    window.localStorage.setItem(reloadAfterOrgOnboardingKey, "1");
    expect(readOrgOnboardingReloadRequested()).toBe(true);

    clearOrgOnboardingReloadRequest();
    expect(readOrgOnboardingReloadRequested()).toBe(false);
  });

  test("reads seen provider ids from window localStorage", () => {
    window.localStorage.setItem("onmyagent.seenProviderIds", JSON.stringify(["openai", 123, "anthropic"]));

    expect(Array.from(readWindowSeenProviderIds()).sort()).toEqual(["anthropic", "openai"]);
  });

  test("returns empty seen provider ids for malformed storage", () => {
    window.localStorage.setItem("onmyagent.seenProviderIds", "not-json");

    expect(readWindowSeenProviderIds()).toEqual(new Set());
  });

  test("reads developer mode through settings storage boolean contract", () => {
    expect(readDeveloperModeEnabled()).toBe(false);
    window.localStorage.setItem(SETTINGS_DEVELOPER_MODE_KEY, "1");
    expect(readDeveloperModeEnabled()).toBe(true);
    window.localStorage.setItem(SETTINGS_DEVELOPER_MODE_KEY, "0");
    expect(readDeveloperModeEnabled()).toBe(false);
  });
});
