import { describe, expect, test } from "bun:test";

import {
  canRemoveProviderRow,
  isEnvManagedProvider,
  resolveProviderRemoveMode,
} from "../src/react-app/shell/settings-route/provider-disconnect-policy";

describe("provider remove policy (unified 移除)", () => {
  test("env rows: no remove mode, env-managed", () => {
    const provider = { id: "deepseek", source: "env" as const };
    expect(isEnvManagedProvider(provider)).toBe(true);
    expect(
      resolveProviderRemoveMode({
        provider,
        opencodeInventoryReady: true,
      }),
    ).toBeNull();
    expect(
      canRemoveProviderRow({ provider, opencodeInventoryReady: true }),
    ).toBe(false);
  });

  test("custom rows: delete mode", () => {
    const provider = { id: "huoshan", source: "custom" as const };
    expect(
      resolveProviderRemoveMode({
        provider,
        opencodeInventoryReady: true,
      }),
    ).toBe("delete");
  });

  test("config / managedBy opencode: delete mode", () => {
    expect(
      resolveProviderRemoveMode({
        provider: { id: "ollama", source: "config" },
        opencodeInventoryReady: true,
      }),
    ).toBe("delete");
    expect(
      resolveProviderRemoveMode({
        provider: { id: "my-llm", managedBy: "opencode" },
        opencodeInventoryReady: true,
      }),
    ).toBe("delete");
  });

  test("API key / OAuth rows: disconnect mode when inventory ready", () => {
    expect(
      resolveProviderRemoveMode({
        provider: { id: "xiaomi", source: "api" },
        opencodeInventoryReady: true,
      }),
    ).toBe("disconnect");
    expect(
      resolveProviderRemoveMode({
        provider: { id: "anthropic" },
        opencodeInventoryReady: true,
      }),
    ).toBe("disconnect");
  });

  test("OpenCode Zen free: disconnect mode", () => {
    expect(
      resolveProviderRemoveMode({
        provider: { id: "opencode" },
        opencodeInventoryReady: true,
      }),
    ).toBe("disconnect");
  });

  test("non-custom without inventory: no flash of remove", () => {
    expect(
      resolveProviderRemoveMode({
        provider: { id: "xiaomi", source: "api" },
        opencodeInventoryReady: false,
      }),
    ).toBeNull();
  });
});
