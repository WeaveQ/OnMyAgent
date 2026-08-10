/**
 * Pure order helpers for settings connected-provider list (drag reorder +
 * custom-first default).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  defaultConnectedProviderOrderIds,
  moveConnectedProviderInOrder,
  orderConnectedProviders,
  reorderConnectedProviderIds,
} from "../src/react-app/domains/connections/order-connected-providers";

const appRoot = join(import.meta.dir, "..");

describe("orderConnectedProviders", () => {
  test("applies stored order and appends unknown providers (custom first)", () => {
    const providers = [
      { id: "b", name: "B", source: "api" as const },
      { id: "a", name: "A", source: "custom" as const },
      { id: "c", name: "C", source: "custom" as const },
    ];
    expect(orderConnectedProviders(providers, ["a"]).map((p) => p.id)).toEqual([
      "a",
      "c", // unknown custom before unknown non-custom
      "b",
    ]);
  });

  test("empty order defaults to custom first (stable within groups)", () => {
    const providers = [
      { id: "opencode", name: "OpenCode Zen" },
      { id: "aliyuncs", name: "千问", source: "custom" as const },
      { id: "openai", name: "OpenAI", source: "api" as const },
      { id: "local", name: "Local", source: "custom" as const },
    ];
    expect(orderConnectedProviders(providers, []).map((p) => p.id)).toEqual([
      "aliyuncs",
      "local",
      "opencode",
      "openai",
    ]);
    expect(defaultConnectedProviderOrderIds(providers)).toEqual([
      "aliyuncs",
      "local",
      "opencode",
      "openai",
    ]);
  });

  test("ignores missing/stale order ids", () => {
    const providers = [{ id: "x" }, { id: "y" }];
    expect(orderConnectedProviders(providers, ["gone", "y", "x"]).map((p) => p.id)).toEqual([
      "y",
      "x",
    ]);
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

describe("reorderConnectedProviderIds", () => {
  test("moves fromId onto toId index", () => {
    const present = [
      { id: "a", source: "custom" as const },
      { id: "b" },
      { id: "c", source: "custom" as const },
    ];
    // empty preference → custom first: a, c, b
    expect(reorderConnectedProviderIds([], present, "b", "a")).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(reorderConnectedProviderIds(["a", "b", "c"], present, "a", "c")).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  test("no-op when ids missing or identical", () => {
    const present = [{ id: "a" }, { id: "b" }];
    expect(reorderConnectedProviderIds(["a", "b"], present, "a", "a")).toEqual([
      "a",
      "b",
    ]);
    expect(reorderConnectedProviderIds(["a", "b"], present, "missing", "a")).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("settings provider order + badge UI contracts", () => {
  test("ai-view wires HTML5 drag reorder and move up/down buttons", () => {
    const aiView = readFileSync(
      join(appRoot, "src/react-app/domains/settings/pages/ai-view.tsx"),
      "utf8",
    );
    expect(aiView).toContain("onReorderProviders");
    expect(aiView).toContain("onDragStart");
    expect(aiView).toContain("onDrop");
    expect(aiView).toContain("getData");
    expect(aiView).toContain("GripVertical");
    expect(aiView).toContain("provider_reorder_hint");
    // Keyboard / touch a11y (Windows-friendly).
    expect(aiView).toContain("onMoveProvider");
    expect(aiView).toContain("provider_move_up");
    expect(aiView).toContain("provider_move_down");
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

  test("controller persists drag reorder order", () => {
    const controller = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/settings/state/ai-providers-controller.ts",
      ),
      "utf8",
    );
    expect(controller).toContain("reorderConnectedProviders");
    expect(controller).toContain("reorderConnectedProviderIds");
    expect(controller).toContain("moveConnectedProvider");
    expect(controller).toContain("moveConnectedProviderInOrder");
    expect(controller).toContain("writeConnectedProviderOrderIds");
    expect(controller).toContain("readConnectedProviderOrderIds");
    expect(controller).toContain("orderConnectedProviders");
  });

  test("home/session pickers share order via getConnectedProviderItems", () => {
    const query = readFileSync(
      join(appRoot, "src/react-app/domains/connections/provider-list-query.ts"),
      "utf8",
    );
    expect(query).toContain("orderConnectedProviders");
    expect(query).toContain("readConnectedProviderOrderIds");
    const picker = readFileSync(
      join(appRoot, "src/react-app/domains/session/modals/model-picker-modal.tsx"),
      "utf8",
    );
    // Groups must preserve option order, not re-sort by name.
    expect(picker).toContain("seenOrder");
    expect(picker).not.toMatch(/return a\.name\.localeCompare\(b\.name\)/);
  });
});
