import { homedir } from "node:os";
import { join } from "node:path";

import { exists } from "../core/utils.js";

/**
 * Whether the optional OfficeCLI managed skill is installed for this user.
 * Checks profile + legacy skill roots (same dual-read layout as desktop).
 */
export async function isOfficeCliInstalled(
  homeDir: string = resolveUserHomeDir(),
): Promise<boolean> {
  const home = homeDir.trim() || resolveUserHomeDir();
  const skillPaths = [
    join(home, ".onmyagent", "profiles", "local", "config", "skills", "officecli", "SKILL.md"),
    join(home, ".onmyagent", "skills", "officecli", "SKILL.md"),
  ];
  for (const skillPath of skillPaths) {
    if (await exists(skillPath)) return true;
  }
  return false;
}

function resolveUserHomeDir(): string {
  return (
    process.env.HOME?.trim() ||
    process.env.USERPROFILE?.trim() ||
    homedir()
  );
}
