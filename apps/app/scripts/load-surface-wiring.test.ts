import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");

describe("load surface wiring", () => {
  test("app-root uses RouteChunkFallback for lazy routes", () => {
    const src = readFileSync(
      path.join(root, "src/react-app/shell/app-root.tsx"),
      "utf8",
    );
    expect(src).toContain("RouteChunkFallback");
    expect(src).toContain("system.load_opening");
    expect(src).not.toContain("function RouteSuspenseFallback");
  });

  test("settings tab suspense uses LoadSurface not boot copy", () => {
    const src = readFileSync(
      path.join(root, "src/react-app/shell/settings-route/lazy-tab-views.tsx"),
      "utf8",
    );
    expect(src).toContain("LoadSurface");
    expect(src).toContain("system.load_settings_tab");
    expect(src).not.toContain("system.boot_preparing_workspace");
  });

  test("session and settings report route load scopes", () => {
    const session = readFileSync(
      path.join(root, "src/react-app/shell/session-route/render.tsx"),
      "utf8",
    );
    const settings = readFileSync(
      path.join(root, "src/react-app/shell/settings-route/render.tsx"),
      "utf8",
    );
    const shellLoad = readFileSync(
      path.join(root, "src/react-app/shell/use-shell-interactive-load.ts"),
      "utf8",
    );
    // Settings (and session) declare scopes via useShellInteractiveLoad → useLoadScope.
    expect(session).toContain('firstLoadScope: "route-session"');
    expect(settings).toContain('firstLoadScope: "route-settings"');
    expect(shellLoad).toContain("useLoadScope");
  });

  test("session switch inset reuses the boot monogram, not fake bubbles", () => {
    const src = readFileSync(
      path.join(
        root,
        "src/react-app/domains/session/surface/session-surface-transcript-content.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("LoadSurface");
    expect(src).toContain('mark="brand"');
    expect(src).toContain('messageKey="session.switching"');
    expect(src).toContain("if (props.pendingSessionLoad)");
    expect(src).not.toContain(
      "showDelayedLoading && props.pendingSessionLoad",
    );
    expect(src).not.toContain("TranscriptHistorySkeleton");
  });

  test("loading overlay reads route load registry", () => {
    const src = readFileSync(
      path.join(root, "src/react-app/shell/loading-overlay.tsx"),
      "utf8",
    );
    expect(src).toContain("useRouteLoadTop");
    expect(src).toContain("LoadSurface");
  });

  test("brand inset fills the host and centers the mark", () => {
    const src = readFileSync(
      path.join(root, "src/react-app/shell/load-surface.tsx"),
      "utf8",
    );
    expect(src).toContain(
      'insetFill: "absolute inset-0 flex items-center justify-center"',
    );
    expect(src).toContain(
      "brandInset ? surfaceClass.insetFill : surfaceClass.inset",
    );
  });
});
