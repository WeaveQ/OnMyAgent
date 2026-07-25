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
    expect(controller).toContain("inventoryCache");
    expect(controller).toContain("loadOpenCodeManagedProvidersForWorkspace");
    expect(controller).toContain("peekOpenCodeManagedProvidersCache");
    expect(controller).toContain("mergeConnectedProviders");
    expect(controller).toContain("export function useAiProvidersController");

    const route = readFileSync(
      path.join(root, "src/react-app/shell/settings-route/render.tsx"),
      "utf8",
    );
    expect(route).toContain("useAiProvidersController");
    expect(route).toContain("useSettingsProvidersPrewarm");
    // Host must not re-implement dual for-loops merge.
    expect(route).not.toMatch(/connectedProvidersById\.set/);
    expect(route).not.toContain("agentManagementSnapshot({");

    const settingsPrewarm = readFileSync(
      path.join(
        root,
        "src/react-app/shell/settings-route/providers-prewarm-hook.ts",
      ),
      "utf8",
    );
    expect(settingsPrewarm).toContain("prewarmWorkspaceProviders");
  });

  test("session and welcome routes prewarm providers before Models tab", () => {
    const prewarm = readFileSync(
      path.join(
        root,
        "src/react-app/domains/settings/state/providers-prewarm.ts",
      ),
      "utf8",
    );
    expect(prewarm).toContain("export async function prewarmWorkspaceProviders");
    expect(prewarm).toContain("export async function prewarmProvidersForWorkspace");
    expect(prewarm).toContain("ensureProviderListQuery");
    expect(prewarm).toContain("loadOpenCodeManagedProvidersForWorkspace");

    const modelCatalog = readFileSync(
      path.join(root, "src/react-app/shell/session-route/model-catalog-hook.ts"),
      "utf8",
    );
    expect(modelCatalog).toContain("useSessionRoutePrewarm");

    const sessionPrewarm = readFileSync(
      path.join(root, "src/react-app/shell/session-route/prewarm-hook.ts"),
      "utf8",
    );
    expect(sessionPrewarm).toContain("prewarmWorkspaceProviders");

    const welcome = readFileSync(
      path.join(root, "src/react-app/shell/welcome-route.tsx"),
      "utf8",
    );
    expect(welcome).toContain("prewarmProvidersForWorkspace");
  });
});
