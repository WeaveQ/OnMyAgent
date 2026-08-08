import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  bootPhaseMessage,
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
});

describe("boot/desktop wiring", () => {
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
