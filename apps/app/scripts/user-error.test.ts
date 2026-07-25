import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyProviderError,
  presentUserError,
  userErrorCopy,
  userErrorFromRaw,
  userErrorMessage,
} from "../src/react-app/kernel/user-error";

const localeRoot = path.join(import.meta.dir, "../src/i18n/locales");
const appRoot = path.join(import.meta.dir, "../src/react-app");

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

  test("userErrorMessage joins title and body", () => {
    const message = userErrorMessage("not_connected");
    expect(message).toContain(".");
    expect(message.length).toBeGreaterThan(10);
  });

  test("userErrorFromRaw maps offline / connect strings", () => {
    const offline = userErrorFromRaw("Not connected to a server");
    expect(offline.length).toBeGreaterThan(0);
    expect(offline.toLowerCase()).not.toContain("at object");

    const connect = userErrorFromRaw("Failed to connect provider");
    expect(connect.length).toBeGreaterThan(0);
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
    expect(classifyProviderError("Please connect first").scenario).toBe(
      "not_connected",
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

describe("S1–S3 UX wiring", () => {
  test("S1: session/settings first-paint use system load copy, not session.loading_detail", () => {
    const pageView = readFileSync(
      path.join(appRoot, "shell/session-route/page-view.tsx"),
      "utf8",
    );
    const settingsRender = readFileSync(
      path.join(appRoot, "shell/settings-route/render.tsx"),
      "utf8",
    );
    expect(pageView).toContain("system.load_session_route");
    expect(pageView).not.toMatch(
      /busyHint=\{[^}]*session\.loading_detail/,
    );
    expect(settingsRender).toContain("system.load_settings_route");
    expect(settingsRender).not.toMatch(
      /busyHint=\{loading \? t\("session\.loading_detail"\)/,
    );
  });

  test("S2: model-unavailable CTA opens AI settings section", () => {
    const composer = readFileSync(
      path.join(
        appRoot,
        "domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );
    const sectionRoutes = readFileSync(
      path.join(appRoot, "shell/session-route/composer.ts"),
      "utf8",
    );
    expect(composer).toContain('onOpenSettingsSection("ai")');
    expect(composer).toContain("system.error_action_open_ai_settings");
    expect(sectionRoutes).toContain('section === "ai"');
    expect(sectionRoutes).toContain('"/settings/ai"');
  });

  test("S3: main failure paths call userErrorFromRaw / userErrorMessage", () => {
    const sessionRefresh = readFileSync(
      path.join(appRoot, "shell/session-route/refresh-hook.ts"),
      "utf8",
    );
    const sessionRender = readFileSync(
      path.join(appRoot, "shell/session-route/render.tsx"),
      "utf8",
    );
    const settingsRender = readFileSync(
      path.join(appRoot, "shell/settings-route/render.tsx"),
      "utf8",
    );
    expect(sessionRefresh).toContain("userErrorFromRaw");
    expect(sessionRefresh).toContain('userErrorMessage("not_connected")');
    expect(sessionRender).toContain("userErrorFromRaw");
    expect(settingsRender).toContain("userErrorFromRaw");
    expect(settingsRender).toContain('setFacingRouteError(null, "not_connected")');
  });
});

describe("S4–S6 UX wiring", () => {
  test("S4: first-load vs soft-refresh scopes; suppress busy under boot overlay", () => {
    const sessionRender = readFileSync(
      path.join(appRoot, "shell/session-route/render.tsx"),
      "utf8",
    );
    const pageView = readFileSync(
      path.join(appRoot, "shell/session-route/page-view.tsx"),
      "utf8",
    );
    const settingsRender = readFileSync(
      path.join(appRoot, "shell/settings-route/render.tsx"),
      "utf8",
    );
    expect(sessionRender).toContain('useLoadScope("route-session"');
    expect(sessionRender).toContain('useLoadScope("session-refresh"');
    expect(sessionRender).toContain("shellInteractive");
    expect(sessionRender).toContain("routeDataLoading && !shellInteractive");
    expect(pageView).toContain("useBootOverlayVisible");
    expect(pageView).toContain("bootOverlayVisible");
    expect(settingsRender).toContain('useLoadScope("route-settings"');
    expect(settingsRender).toContain("loading && !shellInteractive");
  });

  test("S5: settings error banner has recovery action slot; send block is i18n", () => {
    const settingsRender = readFileSync(
      path.join(appRoot, "shell/settings-route/render.tsx"),
      "utf8",
    );
    const surface = readFileSync(
      path.join(appRoot, "shell/session-route/surface-props-hook-impl.ts"),
      "utf8",
    );
    expect(settingsRender).toContain("errorSlot=");
    expect(settingsRender).toContain("routeErrorAction");
    expect(settingsRender).toContain("system.error_action_retry");
    expect(settingsRender).toContain("presentUserError");
    expect(surface).toContain("session.model_unavailable_send_blocked");
    expect(surface).not.toContain(
      "Selected model is unavailable. Choose another model before sending.",
    );
    const copy = presentUserError(null, "not_connected");
    expect(copy.primaryAction).toBe("retry");
  });

  test("S6: reload copy avoids bare engine jargon in product strings", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const system = readFileSync(
        path.join(localeRoot, locale, "system.ts"),
        "utf8",
      );
      const settings = readFileSync(
        path.join(localeRoot, locale, "settings.ts"),
        "utf8",
      );
      expect(system).not.toContain("Reload the engine");
      expect(system).not.toContain("重新加载引擎");
      expect(system).not.toContain("重新加載引擎");
      expect(settings).not.toContain("Engine reload required");
      expect(settings).not.toContain("需要刷新引擎");
      expect(settings).not.toContain("需要重新載入引擎");
      expect(settings).toContain("settings.provider_reload_required_title");
    }
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const session = readFileSync(
        path.join(localeRoot, locale, "session.ts"),
        "utf8",
      );
      expect(session).toContain("session.model_unavailable_send_blocked");
    }
  });
});
