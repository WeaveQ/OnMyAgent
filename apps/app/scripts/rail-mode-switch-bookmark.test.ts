import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  readRailView,
  writeRailView,
} from "../src/react-app/domains/session/sidebar/rail-navigation-memory";
import {
  resetRailBookmarkHydrationForTests,
  resetRailBookmarkToPrimary,
} from "../src/react-app/domains/session/pages/use-rail-location";
import {
  resolveActiveRailView,
  shouldHydrateRailBookmarkIntoUrl,
} from "../src/react-app/domains/session/navigation/app-location";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

beforeEach(() => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  // Prefer patching an existing window (Bun may define it); avoid replacing
  // window wholesale so other modules keep fetch/etc.
  const win =
    typeof globalThis.window === "object" && globalThis.window
      ? globalThis.window
      : (globalThis as typeof globalThis & { window: Window }).window;
  if (win) {
    Object.defineProperty(win, "localStorage", {
      configurable: true,
      value: storage,
    });
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });
  }
  resetRailBookmarkHydrationForTests();
});
afterEach(() => {
  resetRailBookmarkHydrationForTests();
});

describe("rail mode switch bookmark (files → expert → assistant)", () => {
  test("mode switch resets target mode bookmark to primary so remount stays on chat", () => {
    // User was on 助理 + 文件.
    writeRailView("assistant", "ws1", "files");
    expect(readRailView("assistant", "ws1", "assistant")).toBe("files");

    // Click 专家 then 助理: target assistant must not re-open files.
    resetRailBookmarkToPrimary("assistant", "ws1");
    expect(readRailView("assistant", "ws1", "assistant")).toBe("assistant");

    // Clean mode-switch URL has no ?view= → primary conversation.
    expect(
      resolveActiveRailView({ mode: "assistant", search: "" }),
    ).toBe("assistant");

    // Bookmark is primary → should not hydrate secondary into URL.
    expect(
      shouldHydrateRailBookmarkIntoUrl({
        mode: "assistant",
        search: "",
        bookmarkedView: readRailView("assistant", "ws1", "assistant"),
      }),
    ).toBe(false);
  });

  test("page-view wires resetRailBookmarkToPrimary on mode switch", () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/shell/session-route/page-view.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("resetRailBookmarkToPrimary");
    expect(src).toContain("onNavigateToMode");
    // Shell must use the session barrel, not a deep pages/ import.
    expect(src).toMatch(
      /resetRailBookmarkToPrimary[\s\S]*from ["']\.\.\/\.\.\/domains\/session["']/,
    );
    expect(src).not.toContain("pages/use-rail-location");
  });

  test("use-rail-location hydrates via session-scoped keys not only component ref", () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/pages/use-rail-location.ts",
      ),
      "utf8",
    );
    expect(src).toContain("railBookmarkHydratedKeys");
    expect(src).toContain("resetRailBookmarkToPrimary");
  });
});
