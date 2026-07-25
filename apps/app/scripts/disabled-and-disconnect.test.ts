import { describe, expect, test } from "bun:test";

import {
  disabledProvidersListsEqual,
  isBuiltinOpenCodeZenProvider,
  nextDisabledProvidersList,
  normalizeDisabledProviders,
} from "../src/react-app/domains/connections/provider-auth/disabled-and-disconnect";

describe("normalizeDisabledProviders", () => {
  test("dedupes and trims", () => {
    expect(normalizeDisabledProviders([" opencode ", "a", "opencode", 1, ""])).toEqual([
      "opencode",
      "a",
    ]);
  });

  test("empty for non-arrays", () => {
    expect(normalizeDisabledProviders(null)).toEqual([]);
    expect(normalizeDisabledProviders("x")).toEqual([]);
  });
});

describe("nextDisabledProvidersList", () => {
  test("adds on disable", () => {
    expect(nextDisabledProvidersList(["a"], "opencode", true)).toEqual([
      "a",
      "opencode",
    ]);
  });

  test("removes on enable", () => {
    expect(nextDisabledProvidersList(["a", "opencode"], "opencode", false)).toEqual([
      "a",
    ]);
  });

  test("Zen disconnect path keeps id in disabled list", () => {
    const after = nextDisabledProvidersList([], "opencode", true);
    expect(isBuiltinOpenCodeZenProvider("opencode")).toBe(true);
    expect(after).toContain("opencode");
    // Re-applying disable is idempotent (no duplicate).
    expect(nextDisabledProvidersList(after, "opencode", true)).toEqual(["opencode"]);
  });
});

describe("disabledProvidersListsEqual", () => {
  test("order-sensitive equality", () => {
    expect(disabledProvidersListsEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(disabledProvidersListsEqual(["a", "b"], ["b", "a"])).toBe(false);
  });
});
