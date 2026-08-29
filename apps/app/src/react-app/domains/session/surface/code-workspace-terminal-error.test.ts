import { describe, expect, test } from "bun:test";
import { t } from "../../../../i18n";
import { formatCodeWorkspaceTerminalOpenError } from "./code-workspace-terminal-error";

const ipcPrefix = "Error invoking remote method 'onmyagent:desktop': Error: ";

describe("formatCodeWorkspaceTerminalOpenError", () => {
  test("maps posix_spawnp IPC errors to the terminal open i18n string", () => {
    expect(
      formatCodeWorkspaceTerminalOpenError(
        new Error(`${ipcPrefix}posix_spawnp failed.`),
      ),
    ).toBe(t("session.code_side_panel_terminal_open_failed"));
  });

  test("keeps other unwrapped desktop errors", () => {
    expect(
      formatCodeWorkspaceTerminalOpenError(
        new Error(`${ipcPrefix}No usable directory for the terminal.`),
      ),
    ).toBe("No usable directory for the terminal.");
  });
});
