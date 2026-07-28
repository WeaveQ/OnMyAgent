import { describe, expect, test } from "bun:test";

import {
  beginLoadScope,
  endLoadScope,
  getRouteLoadSnapshot,
  listLoadScopeIds,
  resetRouteLoadRegistryForTests,
} from "../src/react-app/shell/route-load-registry";

describe("route-load-registry", () => {
  test("begin/end nests and picks highest priority", () => {
    resetRouteLoadRegistryForTests();
    expect(getRouteLoadSnapshot().busy).toBe(false);

    const endSettings = beginLoadScope("route-settings");
    expect(getRouteLoadSnapshot().busy).toBe(true);
    expect(getRouteLoadSnapshot().top?.id).toBe("route-settings");

    // Tab load is lower priority than route.
    const endTab = beginLoadScope("settings-tab");
    expect(getRouteLoadSnapshot().top?.id).toBe("route-settings");

    endSettings();
    expect(getRouteLoadSnapshot().top?.id).toBe("settings-tab");

    endTab();
    expect(getRouteLoadSnapshot().busy).toBe(false);
    expect(getRouteLoadSnapshot().top).toBeNull();
  });

  test("desktop-boot outranks route scopes", () => {
    resetRouteLoadRegistryForTests();
    beginLoadScope("route-session");
    beginLoadScope("desktop-boot");
    expect(getRouteLoadSnapshot().top?.id).toBe("desktop-boot");
    endLoadScope("desktop-boot");
    expect(getRouteLoadSnapshot().top?.id).toBe("route-session");
    endLoadScope("route-session");
  });

  test("end is idempotent via disposer", () => {
    resetRouteLoadRegistryForTests();
    const end = beginLoadScope("chunk-settings");
    end();
    end();
    expect(getRouteLoadSnapshot().busy).toBe(false);
  });

  test("catalog lists known scopes", () => {
    expect(listLoadScopeIds()).toContain("route-settings");
    expect(listLoadScopeIds()).toContain("settings-ai-providers");
  });
});
