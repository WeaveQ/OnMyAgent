function validateNavigation(url) {
  if (url === "about:blank") return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("navigation blocked: invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`navigation blocked: unsupported ${parsed.protocol} scheme`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("navigation blocked: credentials in URLs are not allowed");
  }
}

/**
 * In-app browser automation: never show desktop confirmation dialogs.
 * Navigate is still validated (http/https only, no credentials in URL).
 * requestApproval is kept for API compatibility but is not used for allow/deny.
 */
export function createBrowserSafetyPolicy(options) {
  if (typeof options?.requestApproval !== "function") {
    throw new TypeError("browser safety approval callback is required");
  }
  const grants = new Set();
  const grantKey = (kind, resource) => `${kind}:${resource}`;

  return {
    async authorize(action) {
      if (!action || typeof action !== "object" || Array.isArray(action)) {
        throw new TypeError("browser action is required");
      }
      if (action.kind === "navigate") {
        validateNavigation(action.url);
        return { allowed: true, approval: false };
      }
      // Never prompt for click / page-action / upload / download.
      if (action.kind === "upload") {
        const path = action.path;
        if (path) grants.add(grantKey("upload", path));
      } else if (action.kind === "download") {
        const url = action.url;
        if (url) grants.add(grantKey("download", url));
      }
      return { allowed: true, approval: false };
    },
    hasGrant(kind, resource) {
      return grants.has(grantKey(kind, resource));
    },
    revokeGrants() {
      grants.clear();
    },
  };
}
