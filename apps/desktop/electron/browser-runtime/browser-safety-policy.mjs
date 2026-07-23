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
 * In-app browser automation: no click confirmation dialogs.
 * Upload/download still go through requestApproval when provided.
 * (Product choice: unattended multi-step flows e.g. Xiaohongshu 发送 must not block.)
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
      // Clicks / page-actions never prompt (including 发送 / submit / delete labels).
      if (action.kind === "click" || action.kind === "page-action") {
        return { allowed: true, approval: false };
      }
      const resource = action.kind === "upload"
        ? action.path
        : action.kind === "download"
          ? action.url
          : null;
      const consequential = action.kind === "upload" || action.kind === "download";
      if (!consequential) return { allowed: true, approval: false };
      const risk = "careful";
      const approved = await options.requestApproval({
        risk,
        action: { ...action },
      });
      if (!approved) throw new Error("browser action approval denied");
      if (resource) grants.add(grantKey(action.kind, resource));
      return { allowed: true, approval: true, risk };
    },
    hasGrant(kind, resource) {
      return grants.has(grantKey(kind, resource));
    },
    revokeGrants() {
      grants.clear();
    },
  };
}
