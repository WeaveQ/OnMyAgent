import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearLocalStorageForOnboardingReset,
  softReenterWelcomeGuide,
} from "../src/react-app/kernel/reset-local-storage";

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
  let hash = "";
  let reloaded = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: createLocalStorage(),
      location: {
        get hash() {
          return hash;
        },
        set hash(value: string) {
          hash = value;
        },
        reload: () => {
          reloaded = true;
        },
        // test helper
        __didReload: () => reloaded,
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("clearLocalStorageForOnboardingReset", () => {
  test("writes hasCompletedOnboarding false and clears onboarding markers", () => {
    window.localStorage.setItem(
      "onmyagent.preferences",
      JSON.stringify({ hasCompletedOnboarding: true, responseTone: "friendly" }),
    );
    window.localStorage.setItem("onmyagent.orgOnboardingSeen", "1");
    window.localStorage.setItem("onmyagent.ui", JSON.stringify({ view: "settings" }));

    clearLocalStorageForOnboardingReset();

    const prefs = JSON.parse(
      window.localStorage.getItem("onmyagent.preferences") ?? "{}",
    ) as { hasCompletedOnboarding?: boolean };
    expect(prefs.hasCompletedOnboarding).toBe(false);
    expect(window.localStorage.getItem("onmyagent.orgOnboardingSeen")).toBeNull();
    expect(window.localStorage.getItem("onmyagent.ui")).toBeNull();
  });
});

describe("softReenterWelcomeGuide", () => {
  test("sets hash router welcome path and reloads renderer", () => {
    softReenterWelcomeGuide();
    expect(window.location.hash).toBe("#/welcome");
    expect(
      (window.location as unknown as { __didReload: () => boolean }).__didReload(),
    ).toBe(true);
  });
});
