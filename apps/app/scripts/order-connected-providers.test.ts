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
  test("ai-view wires move up/down without drag handlers", () => {
    const aiView = readFileSync(
      join(appRoot, "src/react-app/domains/settings/pages/ai-view.tsx"),
      "utf8",
    );
    expect(aiView).toContain("onMoveProvider");
    expect(aiView).toContain("provider_move_up");
    expect(aiView).toContain("provider_move_down");
    expect(aiView).not.toMatch(/onDrag|dnd-kit|useSortable|DragDropContext/);
    // Zen free-only; custom never labeled OpenCode engine.
    expect(aiView).toContain('provider.id === "opencode"');
    expect(aiView).toContain('provider.source ===');
    expect(aiView).toContain("provider_badge_cloud");
    expect(aiView).toMatch(/OpenCode/);
  });

  test("provider modal connectivity test does not mutate model rows", () => {
    const modal = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/local-agents/agent-management/agent-management-providers.tsx",
      ),
      "utf8",
    );
    expect(modal).toContain("testProviderConnection");
    expect(modal).toContain("test_connection");
    expect(modal).toContain("agentManagementFetchModels");
    // Probe path shares fetch-models IPC but keeps model rows untouched.
    const probeStart = modal.indexOf("testProviderConnection");
    expect(probeStart).toBeGreaterThan(-1);
    const probeBody = modal.slice(probeStart, probeStart + 1800);
    expect(probeBody).toContain("agentManagementFetchModels");
    expect(probeBody).not.toContain("setDraftModels");
    expect(probeBody).not.toContain("updateDraft({ models");
  });

  test("controller persists order via session-memory helpers", () => {
    const controller = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/settings/state/ai-providers-controller.ts",
      ),
      "utf8",
    );
    expect(controller).toContain("moveConnectedProvider");
    expect(controller).toContain("writeConnectedProviderOrderIds");
    expect(controller).toContain("orderConnectedProviders");
  });
});
