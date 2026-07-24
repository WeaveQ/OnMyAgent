import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  aiProvidersStatusI18nKey,
  aiProvidersSummaryI18nKey,
  countOpenCodeProviderModels,
  resolveAiProvidersUiPhase,
} from "../src/react-app/shell/settings-route/model";

const localeRoot = path.join(import.meta.dir, "../src/i18n/locales");

function readLocale(locale: string): string {
  return readFileSync(path.join(localeRoot, locale, "settings.ts"), "utf8");
}

describe("resolveAiProvidersUiPhase", () => {
  test("loading while discovering", () => {
    expect(
      resolveAiProvidersUiPhase({ discovering: true, providerCount: 0 }),
    ).toBe("loading");
    expect(
      resolveAiProvidersUiPhase({ discovering: true, providerCount: 2 }),
    ).toBe("loading");
  });

  test("empty finished is empty, not a disconnected phase", () => {
    expect(
      resolveAiProvidersUiPhase({ discovering: false, providerCount: 0 }),
    ).toBe("empty");
  });

  test("ready when providers exist and discovery finished", () => {
    expect(
      resolveAiProvidersUiPhase({ discovering: false, providerCount: 1 }),
    ).toBe("ready");
  });
});

describe("ai providers chrome i18n keys", () => {
  test("empty status is not-configured, never disconnected_label", () => {
    expect(aiProvidersStatusI18nKey("empty")).toBe(
      "settings.providers_not_configured",
    );
    expect(aiProvidersStatusI18nKey("empty")).not.toContain("disconnected");
    expect(aiProvidersSummaryI18nKey("empty")).toBe(
      "settings.providers_empty_summary",
    );
    expect(aiProvidersSummaryI18nKey("empty")).not.toBe(
      "settings.no_providers_connected",
    );
  });

  test("loading and ready keys", () => {
    expect(aiProvidersStatusI18nKey("loading")).toBe(
      "settings.loading_providers",
    );
    expect(aiProvidersSummaryI18nKey("loading")).toBe(
      "settings.loading_providers",
    );
    expect(aiProvidersStatusI18nKey("ready")).toBe("status.connected");
    expect(aiProvidersSummaryI18nKey("ready")).toBe(
      "status.providers_connected",
    );
  });

  test("locale files define dual-path empty hint and not-configured keys", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const src = readLocale(locale);
      expect(src).toContain("settings.providers_not_configured");
      expect(src).toContain("settings.providers_empty_summary");
      expect(src).toContain("settings.provider_model_count");
      expect(src).toContain("settings.connect_provider_empty_hint");
      // Dual-path empty hint must mention custom config path, not only connect.
      if (locale === "en") {
        expect(src.toLowerCase()).toContain("custom model provider");
        expect(src.toLowerCase()).toContain("connect model provider");
      } else if (locale === "zh") {
        expect(src).toContain("自定义模型服务商配置");
        expect(src).toContain("连接模型服务商");
      } else {
        expect(src).toContain("自訂模型服務商配置");
        expect(src).toContain("連接模型服務商");
      }
    }
  });
});

describe("countOpenCodeProviderModels", () => {
  test("uses models array when present", () => {
    expect(
      countOpenCodeProviderModels({
        models: [{ id: "a" }, { id: "b" }],
        settingsConfig: { models: { a: {}, only: {} } },
      }),
    ).toBe(2);
  });

  test("falls back to settingsConfig.models object keys", () => {
    expect(
      countOpenCodeProviderModels({
        models: [],
        settingsConfig: {
          models: {
            "qwen3.8-max-preview": { name: "qwen3.8-max-preview" },
            "glm-5.2": { name: "glm-5.2" },
          },
        },
      }),
    ).toBe(2);
  });

  test("returns 0 when empty", () => {
    expect(countOpenCodeProviderModels({})).toBe(0);
    expect(countOpenCodeProviderModels({ models: [], settingsConfig: {} })).toBe(
      0,
    );
  });
});

describe("settings AI view wiring (structural)", () => {
  test("ai-view renders model count and dual empty hint keys", () => {
    const aiView = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/settings/pages/ai-view.tsx",
      ),
      "utf8",
    );
    expect(aiView).toContain("settings.provider_model_count");
    expect(aiView).toContain("settings.connect_provider_empty_hint");
    expect(aiView).toContain("modelCount");
  });

  test("settings-route uses phase helpers and never empty→disconnected_label", () => {
    const route = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/shell/settings-route/render.tsx",
      ),
      "utf8",
    );
    expect(route).toContain("resolveAiProvidersUiPhase");
    expect(route).toContain("aiProvidersStatusI18nKey");
    expect(route).toContain("countOpenCodeProviderModels");
    // Empty branch must not hard-code disconnected for finished empty list.
    expect(route).not.toMatch(
      /providerCount:\s*connectedProviders\.length[\s\S]{0,200}status\.disconnected_label/,
    );
  });
});
