import { describe, expect, test } from "bun:test";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fetchProviderList,
  getConnectedProviderItems,
  getConnectedProviderSnapshot,
  isModelAvailableInConnectedProviders,
  providerListQueryKey,
  sessionRouteProviderListEnabled,
} from "../src/react-app/domains/connections/provider-list-query";

describe("shared provider list query contract", () => {
  const providerList = {
    connected: ["opencode", "anthropic", "custom-empty", "custom-ready"],
    default: {},
    all: [
      {
        id: "anthropic",
        name: "Anthropic",
        source: "system",
        models: {
          "claude-sonnet": { id: "claude-sonnet", name: "Claude Sonnet" },
        },
      },
      {
        id: "custom-empty",
        name: "Custom Empty",
        source: "custom",
        models: {},
      },
      {
        id: "custom-ready",
        name: "Custom Ready",
        source: "custom",
        models: {
          "ready-model": { id: "ready-model", name: "Ready Model" },
        },
      },
      {
        id: "opencode",
        name: "OpenCode",
        source: "custom",
        models: {},
      },
      {
        id: "unconnected",
        name: "Unconnected",
        source: "system",
        models: {
          unused: { id: "unused", name: "Unused" },
        },
      },
    ],
  } satisfies ProviderListResponse;

  test("builds stable query keys from connection scope", () => {
    expect(providerListQueryKey({ baseUrl: " https://api.example.test ", directory: " /tmp/work " })).toEqual([
      "opencode-provider-list",
      "https://api.example.test",
      "/tmp/work",
    ]);
    expect(providerListQueryKey({ baseUrl: null, directory: undefined })).toEqual([
      "opencode-provider-list",
      "",
      "",
    ]);
  });

  test("filters connected providers and applies custom-first display order", () => {
    // Empty preference → custom providers first (stable), then the rest.
    // custom-empty is dropped (no models); opencode keeps empty-catalog exception.
    expect(getConnectedProviderItems(providerList).map((provider) => provider.id)).toEqual([
      "custom-ready",
      "opencode",
      "anthropic",
    ]);
  });

  test("creates sorted snapshots and validates model availability", () => {
    expect(getConnectedProviderSnapshot(providerList).map((provider) => provider.id)).toEqual([
      "anthropic",
      "custom-ready",
      "opencode",
    ]);
    expect(
      isModelAvailableInConnectedProviders(providerList, {
        providerID: "anthropic",
        modelID: "claude-sonnet",
      }),
    ).toBe(true);
    expect(
      isModelAvailableInConnectedProviders(providerList, {
        providerID: "anthropic",
        modelID: "missing",
      }),
    ).toBe(false);
    expect(isModelAvailableInConnectedProviders(providerList, null)).toBe(true);
  });

  test("session-route cold enter does not fetch provider.list until picker opens", async () => {
    expect(
      sessionRouteProviderListEnabled({ hasClient: true, pickerOpen: false }),
    ).toBe(false);
    expect(
      sessionRouteProviderListEnabled({ hasClient: false, pickerOpen: true }),
    ).toBe(false);
    expect(
      sessionRouteProviderListEnabled({ hasClient: true, pickerOpen: true }),
    ).toBe(true);

    let listCalls = 0;
    const client = {
      provider: {
        list: async () => {
          listCalls += 1;
          return {
            data: { all: [], connected: [], default: {} },
            error: undefined,
            request: new Request("http://local.test"),
            response: new Response(),
          };
        },
      },
    };

    if (
      sessionRouteProviderListEnabled({ hasClient: true, pickerOpen: false })
    ) {
      await fetchProviderList({ client: client as never });
    }
    expect(listCalls).toBe(0);

    if (sessionRouteProviderListEnabled({ hasClient: true, pickerOpen: true })) {
      await fetchProviderList({ client: client as never });
    }
    expect(listCalls).toBe(1);

    const appRoot = join(import.meta.dir, "..");
    const render = readFileSync(
      join(appRoot, "src/react-app/shell/session-route/render.tsx"),
      "utf8",
    );
    expect(render).toContain("sessionRouteProviderListEnabled");

    const composer = readFileSync(
      join(
        appRoot,
        "src/react-app/capabilities/model-selection/model-select-container.tsx",
      ),
      "utf8",
    );
    expect(composer).toContain("sessionRouteProviderListEnabled");
    expect(composer).not.toContain("enabled: Boolean(client)");

    const catalog = readFileSync(
      join(appRoot, "src/react-app/shell/session-route/model-catalog-hook.ts"),
      "utf8",
    );
    expect(catalog).toContain("sessionRouteProviderListEnabled");
    expect(catalog.indexOf("sessionRouteProviderListEnabled")).toBeLessThan(
      catalog.lastIndexOf("ensureProviderListQuery"),
    );
  });
});
