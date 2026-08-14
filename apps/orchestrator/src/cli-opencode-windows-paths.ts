import { homedir } from "node:os";
import { join } from "node:path";

export function localOpencodeWindowsExtraCandidates(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const candidates: string[] = [];
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData) {
    candidates.push(
      join(localAppData, "opencode", "bin", "opencode.exe"),
      join(localAppData, "Programs", "opencode", "opencode.exe"),
    );
  }
  candidates.push(join(home, ".opencode", "bin", "opencode.exe"));
  return candidates;
}
