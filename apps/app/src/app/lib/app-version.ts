export function formatAppVersionLabel(version: string): string {
  const core = version.trim();
  if (!core) return "";
  return /^v/i.test(core) ? core : `v${core}`;
}

export function formatAppMilestoneLabel(version: string): string {
  const core = version.trim().replace(/^v/i, "");
  if (!core) return "";
  const [major, minor] = core.split(".");
  if (!major || minor == null || minor === "") return core;
  return `${major}.${minor}`;
}

export function readAppVersion(): string {
  return String(import.meta.env.VITE_ONMYAGENT_APP_VERSION ?? "").trim();
}
