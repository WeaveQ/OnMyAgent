import path from "node:path";

/**
 * In-app terminal shell. Windows defaults to PowerShell, not COMSPEC/cmd.
 * Override with ONMYAGENT_TERMINAL_SHELL.
 */
export function resolveInAppTerminalShell({
  platform = process.platform,
  env = process.env,
} = {}) {
  const override = String(env.ONMYAGENT_TERMINAL_SHELL ?? "").trim();
  if (override) {
    return { command: override, args: [], label: path.basename(override) };
  }
  if (platform === "win32") {
    const systemRoot = env.SystemRoot || env.windir || "C:\\Windows";
    const command = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    return { command, args: ["-NoLogo"], label: "powershell.exe" };
  }
  const command = env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return {
    command,
    args: [],
    label: path.basename(command),
  };
}
