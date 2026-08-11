import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  bootPhaseMessage,
  classifyBootError,
  userFacingBootError,
} from "../src/react-app/shell/boot-state";

const localeRoot = path.join(import.meta.dir, "../src/i18n/locales");

describe("boot phase i18n keys exist", () => {
  test("en/zh/zh-TW define boot and load copy keys", () => {
    const keys = [
      "system.boot_loading_workspaces",
      "system.boot_starting_server",
      "system.boot_start_runtime_failed",
      "system.boot_server_not_ready",
      "system.boot_config_invalid",
      "system.boot_package_missing",
      "system.boot_download_latest_hint",
      "system.boot_open_config_dir",
      "system.boot_repair_config",
      "system.load_opening",
      "system.load_settings_ai",
    ];
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const src = readFileSync(
        path.join(localeRoot, locale, "system.ts"),
        "utf8",
      );
      for (const key of keys) {
        expect(src, `${locale} missing ${key}`).toContain(key);
      }
    }
  });

  test("ready phase stays transitional until the boot overlay exits", () => {
    const expectedCopy = {
      en: "Almost ready",
      zh: "即将就绪",
      "zh-TW": "即將就緒",
    } as const;
    for (const [locale, copy] of Object.entries(expectedCopy)) {
      const src = readFileSync(
        path.join(localeRoot, locale, "system.ts"),
        "utf8",
      );
      expect(src).toContain(`"system.boot_ready": "${copy}"`);
    }
  });
});

describe("bootPhaseMessage", () => {
  test("never returns hardcoded English-only phase without t()", () => {
    // After i18n fix, messages resolve through t(); English default still ok.
    expect(bootPhaseMessage("bootstrapping-workspaces").length).toBeGreaterThan(
      0,
    );
    expect(bootPhaseMessage("starting-onmyagent-server").length).toBeGreaterThan(
      0,
    );
    expect(bootPhaseMessage("error").length).toBeGreaterThan(0);
  });
});

describe("userFacingBootError", () => {
  test("maps known English internals to product keys", () => {
    const a = userFacingBootError(
      "OnMyAgent server did not finish starting. Please restart OnMyAgent.",
    );
    expect(a.message.length).toBeGreaterThan(0);
    expect(a.technicalDetail).toContain("did not finish starting");

    const b = userFacingBootError("Failed to start OnMyAgent runtime");
    expect(b.message.length).toBeGreaterThan(0);
    expect(b.technicalDetail).toContain("Failed to start");
  });

  test("does not surface stack-like strings as primary message", () => {
    const raw =
      "Error: ENOENT: no such file\n    at Object.openSync (node:fs:1:1)";
    const result = userFacingBootError(raw);
    expect(result.message).not.toContain("ENOENT");
    expect(result.message).not.toContain("at Object.openSync");
    expect(result.technicalDetail).toContain("ENOENT");
  });

  test("maps invalid opencode / mcp config failures to repair-friendly copy", () => {
    const raw =
      "Configuration is invalid at /tmp/opencode.jsonc\n↳ Missing key mcp.visitbeijing.enabled";
    const result = userFacingBootError(raw);
    expect(result.technicalDetail).toContain("Configuration is invalid");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).not.toContain("Missing key mcp");
  });

  test("classifies ERR_MODULE_NOT_FOUND / missing package as package-missing", () => {
    // The packaged "Cannot find package 'jsonc-parser'" boot crash must not
    // offer "Repair engine config" (it cannot fix a missing bundle file).
    const missingPkg =
      "Cannot find package 'jsonc-parser' imported from /Applications/OnMyAgent.app/Contents/Resources/app.asar/server/dist/core/jsonc.js";
    expect(classifyBootError(missingPkg)).toBe("package-missing");
    expect(classifyBootError("Error [ERR_MODULE_NOT_FOUND]: ...")).toBe(
      "package-missing",
    );
    expect(classifyBootError("Cannot find module 'x'")).toBe("package-missing");

    const configErr =
      "Configuration is invalid: Missing key mcp.foo";
    expect(classifyBootError(configErr)).toBe("config-invalid");
    expect(classifyBootError("ECONNREFUSED 127.0.0.1:1234")).toBe("generic");
    expect(classifyBootError(null)).toBe("generic");

    const result = userFacingBootError(missingPkg);
    expect(result.message).not.toContain("Cannot find package");
    expect(result.technicalDetail).toContain("Cannot find package");
  });
});

describe("progressive boot overlay", () => {
  test("overlay can hide once routeReady even while engine is still starting", () => {
    const bootState = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/boot-state.tsx"),
      "utf8",
    );
    // Overlay stays while boot phases block OR while phase is error.
    expect(bootState).toContain("routeReady && !bootStillBlocking && phase !== \"error\"");
    expect(bootState).toContain("BOOT_BLOCKING_PHASES");
    expect(bootState).toContain('"bootstrapping-workspaces"');
    expect(bootState).not.toContain('  "starting-engine",');
    expect(bootState).not.toContain('  "starting-onmyagent-server",');
    expect(bootState).not.toContain('  "activating-workspace",');
  });

  test("session route marks shell ready after desktop workspaces paint", () => {
    const refresh = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/shell/session-route/refresh-hook.ts",
      ),
      "utf8",
    );
    expect(refresh).toContain("markShellReady");
    expect(refresh).toContain("readCachedSidebarSessionsByWorkspace");
    expect(refresh).toContain("scheduleStartupConnectionRetry");
  });

  test("assistant draft home commits before it releases the boot overlay", () => {
    const assistant = readFileSync(
      path.join(import.meta.dir, "../src/react-app/domains/session/pages/assistant.tsx"),
      "utf8",
    );
    const startupHome = readFileSync(
      path.join(import.meta.dir, "../src/react-app/domains/session/pages/assistant-startup-home.tsx"),
      "utf8",
    );
    const refresh = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/session-route/refresh-hook.ts"),
      "utf8",
    );
    expect(assistant).toContain("<AssistantStartupHome categoryId={assistantCategoryId} />");
    expect(assistant).toContain("isDraftSession && !canRenderReactSurface");
    expect(assistant).toContain("useLayoutEffect");
    expect(assistant).toContain("shouldNotifyStaticHomeReady");
    expect(assistant).toContain("props.onStaticHomeReady?.()");
    expect(startupHome).toContain("SessionSurfaceDraftHome");
    expect(startupHome).toContain('aria-busy="true"');
    expect(refresh).toContain("waitForStaticHomeFirstPaintRef.current");
    expect(refresh).toContain("planBootShellReadyAfterRefresh");
    expect(refresh).toContain("staticHomeDeadlineTimerRef");
    expect(refresh).not.toContain("waitForStaticHomeFirstPaint,\n    routeWorkspaceId");

    const overlay = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/loading-overlay.tsx"),
      "utf8",
    );
    expect(overlay).not.toContain('fading={fading}');
  });
});

describe("boot/desktop wiring", () => {
  test("the parser-time document contains a self-contained boot surface", () => {
    const indexHtml = readFileSync(
      path.join(import.meta.dir, "../index.html"),
      "utf8",
    );
    expect(indexHtml).toContain("onmyagent-static-boot");
    expect(indexHtml).toContain('id="onmyagent-static-boot"');
    expect(indexHtml).toContain('<div id="root"></div>');
    expect(indexHtml).toContain("Sibling, not a child of #root");
    expect(indexHtml).toContain("html[data-theme=\"dark\"] body");
    expect(indexHtml).toContain("background: #2c2c2c");
    expect(indexHtml).toContain("Starting OnMyAgent…");
    expect(indexHtml).toContain("onmyagent-boot-mark.png");
    expect(indexHtml).toContain("@keyframes onmyagent-static-boot-spin");
    expect(indexHtml).toContain("onmyagent-static-boot__ring");
    expect(indexHtml).not.toContain("onmyagent-static-boot__dot");
  });

  test("React keeps the parser surface until the deferred app shell commits", () => {
    const entry = readFileSync(
      path.join(import.meta.dir, "../src/index.react.tsx"),
      "utf8",
    );
    expect(entry).toContain('import("./react-app/shell/renderer-app")');
    expect(entry).toContain('const denBootstrapPromise = import("./app/lib/den")');
    expect(entry).toContain("module.initializeDenBootstrapConfig()");
    expect(entry).toContain("<React.Suspense fallback={null}>");
    expect(entry).not.toContain("function BootstrapFallback()");
    expect(entry).toContain("function StaticBootHandoff()");
    expect(entry).toContain("parserBootSurface?.remove()");
    expect(entry).toContain("React.useLayoutEffect");
  });

  test("boot chrome uses compact monogram, not the large product logo", () => {
    const surface = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/load-surface.tsx"),
      "utf8",
    );
    const indexHtml = readFileSync(
      path.join(import.meta.dir, "../index.html"),
      "utf8",
    );
    expect(surface).toContain("onmyagent-boot-mark.png");
    expect(surface).not.toContain("onmyagent-logo.png");
    expect(surface).toContain("resolvePublicAssetUrl");
    expect(indexHtml).toContain("onmyagent-boot-mark.png");
    expect(indexHtml).toContain('src="./onmyagent-boot-mark.png"');
    expect(indexHtml).not.toContain('src="/onmyagent-boot-mark.png"');
    expect(indexHtml).not.toContain('src="/onmyagent-logo.png"');
  });

  test("renderer shell lazy-loads the heavy session route", () => {
    const appRoot = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/app-root.tsx"),
      "utf8",
    );
    expect(appRoot).toContain('import("./session-route")');
    expect(appRoot).not.toContain('import { SessionRoute } from "./session-route"');
  });

  test("post-boot desktop monitors stay out of the renderer bootstrap chunk", () => {
    const providers = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/providers.tsx"),
      "utf8",
    );
    expect(providers).toContain('import("./deferred-desktop-monitor-runtime")');
    expect(providers).not.toContain('from "./automation-run-desktop-notification-monitor"');
    expect(providers).not.toContain('from "./agent-ready-desktop-notification-monitor"');
  });

  test("desktop boot uses userFacingBootError; no raw English setError literals", () => {
    const boot = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/shell/desktop-runtime-boot.ts",
      ),
      "utf8",
    );
    expect(boot).toContain("userFacingBootError");
    expect(boot).not.toContain(
      'setError("OnMyAgent server did not finish starting',
    );
    expect(boot).not.toContain(
      'setError(boot.error || "Failed to start OnMyAgent runtime")',
    );
  });

  test("boot-state has no English-only PHASE_MESSAGES table", () => {
    const src = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/boot-state.tsx"),
      "utf8",
    );
    expect(src).not.toContain("Loading your workspaces");
    expect(src).not.toContain("Starting the OnMyAgent server");
    expect(src).toContain("bootPhaseMessage");
  });

  test("providers loading keys share unicode ellipsis in en settings", () => {
    const src = readFileSync(
      path.join(localeRoot, "en", "settings.ts"),
      "utf8",
    );
    expect(src).toContain('"settings.loading_providers": "Loading providers…"');
    expect(src).toContain(
      '"settings.loading_providers_list": "Loading providers…"',
    );
    expect(src).not.toContain('"settings.loading_providers": "Loading providers..."');
  });
});
