import { join, resolve } from "node:path";

/** Skills OpenCode should see for a managed Expert session (already copied). */
export function expertSessionMaterializedSkillsDir(sessionDirectory: string): string {
  return join(resolve(sessionDirectory.trim()), ".opencode", "skills");
}

/**
 * Build the OpenCode child env so a profile-wide `OPENCODE_GLOBAL_SKILLS_DIR`
 * (kept on the server process for install/list) does not leak into every
 * session. A dedicated expert process may pass `expertSessionDirectory` to
 * point at that session's materialized skills only.
 */
export function applyOpenCodeChildGlobalSkillsDir(
  env: Record<string, string | undefined>,
  options?: { expertSessionDirectory?: string },
): Record<string, string | undefined> {
  const next = { ...env };
  next.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1";
  const sessionDirectory = options?.expertSessionDirectory?.trim();
  if (sessionDirectory) {
    next.OPENCODE_GLOBAL_SKILLS_DIR = expertSessionMaterializedSkillsDir(sessionDirectory);
    return next;
  }
  delete next.OPENCODE_GLOBAL_SKILLS_DIR;
  return next;
}
