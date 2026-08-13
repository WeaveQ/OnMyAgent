/**
 * Shared real-home reconstruction. Keep lockstep with
 * apps/desktop/electron/real-home-policy.mjs
 */
import path from "node:path";

export type RealHomeResolutionInput = {
  override?: string | readonly (string | null | undefined)[] | null;
  home?: string | readonly (string | null | undefined)[] | null;
  userProfile?: string | null;
  user?: string | null;
  platform?: NodeJS.Platform | string | null;
};

/** Sandbox / Electron userData homes are not the user's real home. */
export function isRejectedHomePath(home: string | null | undefined): boolean {
  const value = String(home ?? "").trim();
  if (!value) return false;
  return (
    value.includes("opencode-sandbox") ||
    (value.includes("Application Support") && value.includes("onmyagent"))
  );
}

function pathCandidates(
  value: string | readonly (string | null | undefined)[] | null | undefined,
): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

/**
 * Honor override only when absolute and not sandbox; then a non-sandbox home;
 * then USERPROFILE on win32; invent /Users/$USER or /home/$USER last.
 */
export function resolveRealHomeDir(input: RealHomeResolutionInput = {}): string {
  const platform = String(input.platform ?? "").trim() || process.platform;

  for (const override of pathCandidates(input.override)) {
    if (path.isAbsolute(override) && !isRejectedHomePath(override)) {
      return path.resolve(override);
    }
  }

  const homes = pathCandidates(input.home);
  const usableHome = homes.find((home) => !isRejectedHomePath(home));
  if (usableHome) return usableHome;

  const userProfile = String(input.userProfile ?? "").trim();
  if (platform === "win32" && userProfile && !isRejectedHomePath(userProfile)) {
    return userProfile;
  }

  const user = String(input.user ?? "").trim();
  if (user) {
    if (platform === "darwin") return `/Users/${user}`;
    if (platform === "linux") return `/home/${user}`;
    if (platform === "win32") return path.win32.join("C:\\Users", user);
  }

  return homes[0] || userProfile || "";
}

export const resolveRealHome = resolveRealHomeDir;
