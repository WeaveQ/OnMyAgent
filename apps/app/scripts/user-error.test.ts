import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyProviderError,
  userErrorCopy,
} from "../src/react-app/kernel/user-error";

const localeRoot = path.join(import.meta.dir, "../src/i18n/locales");

describe("userErrorCopy", () => {
  test("covers main scenarios with recovery actions", () => {
    for (const scenario of [
      "boot_failed",
      "not_connected",
      "providers_load_failed",
      "connect_provider_failed",
      "remote_workspace_failed",
      "request_failed",
    ] as const) {
      const copy = userErrorCopy(scenario);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.primaryAction).not.toBeNull();
      expect(copy.primaryActionLabel?.length).toBeGreaterThan(0);
    }
  });

  test("does not put stack traces into body via detail", () => {
    const copy = userErrorCopy(
      "request_failed",
      "Error: boom\n    at Object.fn (x.ts:1:1)",
    );
    expect(copy.body).not.toContain("at Object.fn");
    expect(copy.body).not.toContain("Error: boom");
  });
});

describe("classifyProviderError", () => {
  test("maps common connect / offline strings", () => {
    expect(classifyProviderError("Not connected to a server").scenario).toBe(
      "not_connected",
    );
    expect(classifyProviderError("Failed to connect provider").scenario).toBe(
      "connect_provider_failed",
    );
    expect(classifyProviderError("Failed to load providers").scenario).toBe(
      "providers_load_failed",
    );
  });
});

describe("UX-1 wiring", () => {
  test("ai-view empty state has dual CTAs", () => {
    const src = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/settings/pages/ai-view.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("settings.providers_empty_title");
    expect(src).toContain("settings.providers_empty_cta_connect");
    expect(src).toContain("settings.providers_empty_cta_custom");
    expect(src).toContain("settings.provider_error_retry");
  });

  test("boot overlay has retry CTA", () => {
    const src = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/loading-overlay.tsx"),
      "utf8",
    );
    expect(src).toContain("system.boot_retry");
    expect(src).toContain("relaunchOrReload");
  });

  test("composer keeps reasoning next to model select", () => {
    const src = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );
    // Behavior select should live in the trailing cluster, not the expanding left flex.
    const trailingIdx = src.indexOf(
      "Model controls + send stay as a tight trailing cluster",
    );
    const behaviorIdx = src.indexOf("<ModelBehaviorSelect");
    const modelIdx = src.indexOf("<ModelSelectContainer");
    expect(trailingIdx).toBeGreaterThan(0);
    expect(behaviorIdx).toBeGreaterThan(trailingIdx);
    expect(modelIdx).toBeGreaterThan(behaviorIdx);
  });

  test("locale files define empty-state and error template keys", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const settings = readFileSync(
        path.join(localeRoot, locale, "settings.ts"),
        "utf8",
      );
      const system = readFileSync(
        path.join(localeRoot, locale, "system.ts"),
        "utf8",
      );
      expect(settings).toContain("settings.providers_empty_title");
      expect(settings).toContain("settings.providers_empty_cta_connect");
      expect(system).toContain("system.error_connect_provider_body");
      expect(system).toContain("system.error_action_retry");
    }
  });
});
