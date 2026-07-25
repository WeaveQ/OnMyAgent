import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");

describe("ai providers controller contract", () => {
  test("controller owns inventory single-flight and host uses the hook", () => {
    const controller = readFileSync(
      path.join(
        root,
        "src/react-app/domains/settings/state/ai-providers-controller.ts",
      ),
      "utf8",
    );
    expect(controller).toContain("inventoryInflight");
    expect(controller).toContain("loadOpenCodeManagedProvidersForWorkspace");
    expect(controller).toContain("mergeConnectedProviders");
    expect(controller).toContain("export function useAiProvidersController");

    const route = readFileSync(
      path.join(root, "src/react-app/shell/settings-route/render.tsx"),
      "utf8",
    );
    expect(route).toContain("useAiProvidersController");
    // Host must not re-implement dual for-loops merge.
    expect(route).not.toMatch(/connectedProvidersById\.set/);
    expect(route).not.toContain("agentManagementSnapshot({");
  });
});
