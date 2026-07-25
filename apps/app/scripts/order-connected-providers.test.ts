/**
 * Pure order helpers for settings connected-provider list (move up/down).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  moveConnectedProviderInOrder,
  orderConnectedProviders,
} from "../src/react-app/domains/connections/order-connected-providers";

const appRoot = join(import.meta.dir, "..");

describe("orderConnectedProviders", () => {
  test("applies stored order and appends unknown providers", () => {
    const providers = [
      { id: "b", name: "B" },
      { id: "a", name: "A" },
      { id: "c", name: "C" },
    ];
    expect(orderConnectedProviders(providers, ["a", "c"]).map((p) => p.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  test("ignores missing/stale order ids and empty order", () => {
    const providers = [{ id: "x" }, { id: "y" }];
    expect(orderConnectedProviders(providers, ["gone", "y", "x"]).map((p) => p.id)).toEqual([
      "y",
      "x",
    ]);
    expect(orderConnectedProviders(providers, []).map((p) => p.id)).toEqual(["x", "y"]);
  });

  test("dedupes order ids", () => {
    const providers = [{ id: "a" }, { id: "b" }];
    expect(orderConnectedProviders(providers, ["a", "a", "b"]).map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("moveConnectedProviderInOrder", () => {
  test("moves up and down within bounds", () => {
    const present = ["a", "b", "c"];
    expect(moveConnectedProviderInOrder([], present, "b", "up")).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(moveConnectedProviderInOrder(["a", "b", "c"], present, "b", "down")).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  test("no-op at edges or unknown id", () => {
    const present = ["a", "b"];
    expect(moveConnectedProviderInOrder(["a", "b"], present, "a", "up")).toEqual([
      "a",
      "b",
    ]);
    expect(moveConnectedProviderInOrder(["a", "b"], present, "b", "down")).toEqual([
      "a",
      "b",
    ]);
    expect(moveConnectedProviderInOrder(["a", "b"], present, "missing", "up")).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("settings provider order + badge UI contracts", () => {
  test("ai-view has no provider reorder controls", () => {
    const aiView = readFileSync(
      join(appRoot, "src/react-app/domains/settings/pages/ai-view.tsx"),
      "utf8",
    );
    expect(aiView).not.toContain("onMoveProvider");
    expect(aiView).not.toContain("provider_move_up");
    expect(aiView).not.toContain("provider_move_down");
    expect(aiView).not.toMatch(/onDrag|dnd-kit|useSortable|DragDropContext/);
    // Zen free-only; custom never labeled OpenCode engine.
    expect(aiView).toContain('provider.id === "opencode"');
    expect(aiView).toContain('provider.source ===');
    expect(aiView).toContain("provider_badge_cloud");
    expect(aiView).toMatch(/OpenCode/);
  });

  test("provider modal tests connectivity per model row", () => {
    const modal = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/local-agents/agent-management/agent-management-providers.tsx",
      ),
      "utf8",
    );
    expect(modal).toContain("testModelRow");
    expect(modal).toContain("agentManagementTestModel");
    expect(modal).toContain("test_model");
    // Left-side whole-provider test removed.
    expect(modal).not.toContain("testProviderConnection");
    // Probe path must not rewrite draft model rows.
    const probeStart = modal.indexOf("testModelRow");
    expect(probeStart).toBeGreaterThan(-1);
    const probeBody = modal.slice(probeStart, probeStart + 2200);
    expect(probeBody).toContain("agentManagementTestModel");
    expect(probeBody).not.toContain("setDraftModels");
    expect(probeBody).not.toContain("updateDraft({ models");
  });

  test("controller still applies optional stored provider order", () => {
    const controller = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/settings/state/ai-providers-controller.ts",
      ),
      "utf8",
    );
    // Move-up/down UI removed; order helpers remain for legacy preference file.
    expect(controller).not.toContain("moveConnectedProvider");
    expect(controller).toContain("readConnectedProviderOrderIds");
    expect(controller).toContain("orderConnectedProviders");
  });
});
