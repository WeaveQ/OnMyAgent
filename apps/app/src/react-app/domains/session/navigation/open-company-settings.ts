/**
 * Navigate to Settings → Company, preserving workspace hash when present.
 */
export function openCompanySettingsPath(): void {
  try {
    const path = "/settings/company";
    if (typeof window === "undefined") return;
    const hash = window.location.hash || "";
    if (hash.includes("/workspace/")) {
      const match = hash.match(/#(\/workspace\/[^/]+)/);
      if (match?.[1]) {
        window.location.hash = `${match[1]}${path}`;
        return;
      }
    }
    window.location.hash = path;
  } catch {
    // ignore navigation failures in non-browser hosts
  }
}
