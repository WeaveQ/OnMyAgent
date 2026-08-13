/**
 * Shared real-home reconstruction. Keep lockstep with
 * apps/server/src/services/real-home-policy.ts
 */
import path from "node:path";

/**
 * Sandbox / Electron userData homes are not the user's real home.
 * @param {string | null | undefined} home
 * @returns {boolean}
 */
export function isRejectedHomePath(home) {
  const value = String(home ?? "").trim();
  if (!value) return false;
  return (
    value.includes("opencode-sandbox") ||
    (value.includes("Application Support") && value.includes("onmyagent"))
  );
}

/**
 * @param {string | Array<string | null | undefined> | null | undefined} value
 * @returns {string[]}
 */
function pathCandidates(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

/**
 * Honor override only when absolute and not sandbox; then a non-sandbox home;
 * then USERPROFILE on win32; invent /Users/$USER or /home/$USER last.
 *
 * @param {{
 *   override?: string | Array<string | null | undefined> | null,
 *   home?: string | Array<string | null | undefined> | null,
 *   userProfile?: string | null,
 *   user?: string | null,
 *   platform?: string | null,
 * }} [input]
 * @returns {string}
 */
export function resolveRealHomeDir(input = {}) {
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
