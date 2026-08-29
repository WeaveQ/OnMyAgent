import { describe, expect, test } from "bun:test";
import { t } from "../../i18n";
import {
  formatDesktopIpcError,
  unwrapDesktopIpcError,
} from "./desktop-ipc-error";

const ipc = (inner: string) =>
  `Error invoking remote method 'onmyagent:desktop': Error: ${inner}`;

describe("desktop IPC errors", () => {
  test("unwraps the Electron invoke prefix", () => {
    expect(unwrapDesktopIpcError(new Error(ipc("posix_spawnp failed.")))).toBe(
      "posix_spawnp failed.",
    );
  });

  test("maps posix_spawnp to spawn i18n, not the invoke wrapper", () => {
    expect(formatDesktopIpcError(new Error(ipc("posix_spawnp failed.")))).toBe(
      t("system.desktop_spawn_failed"),
    );
    expect(formatDesktopIpcError(new Error(ipc("posix_spawnp failed.")))).not.toMatch(
      /invoking remote method/i,
    );
  });

  test("maps stale bridge errors to the restart hint", () => {
    expect(formatDesktopIpcError(new Error(ipc("not implemented yet: x")))).toBe(
      t("plugins.connector_ipc_restart_hint"),
    );
  });

  test("keeps other unwrapped inners", () => {
    expect(
      formatDesktopIpcError(new Error(ipc("No usable directory for the terminal."))),
    ).toBe("No usable directory for the terminal.");
  });
});
