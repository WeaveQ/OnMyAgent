const CONSEQUENTIAL_LABEL = /\b(?:buy|checkout|delete|pay|place\s+order|publish|purchase|send|submit|transfer|confirm\s+order)\b|购买|付款|下单|发布|删除|发送|提交|转账/i;

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
      const resource = action.kind === "upload"
        ? action.path
        : action.kind === "download"
          ? action.url
          : null;
      const consequential =
        action.kind === "upload" ||
        action.kind === "download" ||
        (action.kind === "click" && CONSEQUENTIAL_LABEL.test(action.label ?? ""));
      if (!consequential) return { allowed: true, approval: false };
      const risk = action.kind === "click" ? "destructive" : "careful";
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
