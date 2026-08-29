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

/** Account-menu chip: `v0.7.0 · milestone 0.7`, or empty when version is unset. */
export function formatAccountVersionBadge(
  version: string,
  formatMilestone: (milestone: string) => string,
): string {
  const versionLabel = formatAppVersionLabel(version);
  if (!versionLabel) return "";
  const milestone = formatAppMilestoneLabel(version);
  return milestone ? `${versionLabel} · ${formatMilestone(milestone)}` : versionLabel;
}

export function readAppVersion(): string {
  return String(import.meta.env.VITE_ONMYAGENT_APP_VERSION ?? "").trim();
}
