import { describe, expect, test } from "bun:test";
import type { RuntimeSessionBinding } from "@onmyagent/types/agent-runtime";
import {
  hasDuplicateRuntimeSessionIdentity,
  planVerifiedOpenCodeInventoryBackfill,
  runtimeSessionNativeIdentity,
  sameRuntimeSessionBinding,
} from "../src/services/runtime-session-binding-records.js";

function binding(overrides: Partial<RuntimeSessionBinding> & { productSessionId: string }): RuntimeSessionBinding {
  return {
    runtimeKind: "opencode",
    runtimeSessionId: `native-${overrides.productSessionId}`,
    workspaceId: "ws_1",
    cwd: `/workspace/${overrides.productSessionId}`,
    profileId: "primary-opencode",
    runtimeHome: "/runtime",
    createdAt: 1,
    ...overrides,
  };
}

describe("runtimeSessionNativeIdentity", () => {
  test("distinguishes by runtime/profile/home/native id", () => {
    const a = binding({ productSessionId: "p1" });
    const b = binding({ productSessionId: "p1", profileId: "other" });
    const c = binding({ productSessionId: "p1", runtimeHome: "/other" });
    expect(runtimeSessionNativeIdentity(a)).not.toBe(runtimeSessionNativeIdentity(b));
    expect(runtimeSessionNativeIdentity(a)).not.toBe(runtimeSessionNativeIdentity(c));
  });
});

describe("sameRuntimeSessionBinding", () => {
  test("deep-compares binding objects", () => {
    const a = binding({ productSessionId: "p1" });
    expect(sameRuntimeSessionBinding(a, { ...a })).toBe(true);
    expect(sameRuntimeSessionBinding(a, binding({ productSessionId: "p2" }))).toBe(false);
  });
});

describe("hasDuplicateRuntimeSessionIdentity", () => {
  test("detects duplicate product ids", () => {
    const a = binding({ productSessionId: "p1" });
    const b = binding({ productSessionId: "p1", runtimeSessionId: "native-other" });
    expect(hasDuplicateRuntimeSessionIdentity([a, b])).toBe(true);
  });

  test("detects duplicate native identities with different product ids", () => {
    const a = binding({ productSessionId: "p1", runtimeSessionId: "native-same" });
    const b = binding({ productSessionId: "p2", runtimeSessionId: "native-same" });
    expect(hasDuplicateRuntimeSessionIdentity([a, b])).toBe(true);
  });

  test("returns false for distinct bindings", () => {
    const a = binding({ productSessionId: "p1" });
    const b = binding({ productSessionId: "p2" });
    expect(hasDuplicateRuntimeSessionIdentity([a, b])).toBe(false);
  });
});

describe("planVerifiedOpenCodeInventoryBackfill", () => {
  const inventoryItem = (productSessionId: string) => ({
    productSessionId,
    runtimeSessionId: `native-${productSessionId}`,
    cwd: `/workspace/${productSessionId}`,
    profileId: "primary-opencode",
    runtimeHome: "/runtime",
    createdAt: 1,
  });

  test("adds new bindings and reports complete", () => {
    const result = planVerifiedOpenCodeInventoryBackfill({
      existing: [],
      inventory: [inventoryItem("p1"), inventoryItem("p2")],
      workspaceId: "ws_1",
    });
    expect(result.added).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.bindings.map((b) => b.productSessionId)).toEqual(["p1", "p2"]);
  });

  test("skips bindings already present by product id", () => {
    const existing = [binding({ productSessionId: "p1" })];
    const result = planVerifiedOpenCodeInventoryBackfill({
      existing,
      inventory: [inventoryItem("p1"), inventoryItem("p2")],
      workspaceId: "ws_1",
    });
    expect(result.added).toBe(1);
    expect(result.bindings.map((b) => b.productSessionId)).toEqual(["p2"]);
  });

  test("flags duplicate product ids in the inventory", () => {
    const result = planVerifiedOpenCodeInventoryBackfill({
      existing: [],
      inventory: [inventoryItem("p1"), inventoryItem("p1")],
      workspaceId: "ws_1",
    });
    expect(result.complete).toBe(false);
    expect(result.added).toBe(0);
    expect(result.failures.some((f) => f.code === "duplicate_product_session_id")).toBe(true);
    expect(result.failures.some((f) => f.code === "duplicate_runtime_session_id")).toBe(true);
  });

  test("flags duplicate native identities with different product ids", () => {
    const result = planVerifiedOpenCodeInventoryBackfill({
      existing: [],
      inventory: [
        inventoryItem("p1"),
        { ...inventoryItem("p2"), runtimeSessionId: "native-p1" },
      ],
      workspaceId: "ws_1",
    });
    expect(result.complete).toBe(false);
    expect(result.failures.some((f) => f.code === "duplicate_runtime_session_id")).toBe(true);
  });

  test("flags conflicts with an existing binding holding the same native id", () => {
    const existing = [binding({ productSessionId: "existing", runtimeSessionId: "native-p1" })];
    const result = planVerifiedOpenCodeInventoryBackfill({
      existing,
      inventory: [inventoryItem("p1")],
      workspaceId: "ws_1",
    });
    expect(result.complete).toBe(false);
    expect(result.failures.some((f) => f.code === "conflicting_existing_binding")).toBe(true);
  });

  test("rejects invalid inventory items", () => {
    const result = planVerifiedOpenCodeInventoryBackfill({
      existing: [],
      inventory: [{ ...inventoryItem(""), runtimeSessionId: "" }],
      workspaceId: "ws_1",
    });
    expect(result.complete).toBe(false);
    expect(result.failures.some((f) => f.code === "invalid_inventory_item")).toBe(true);
  });
});
