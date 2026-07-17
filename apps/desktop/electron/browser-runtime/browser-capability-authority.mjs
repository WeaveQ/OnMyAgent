import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SCOPE_KEYS = [
  "workspaceId",
  "sessionId",
  "backend",
  "peerPid",
  "peerIdentity",
];

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function validateScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("browser capability scope is required");
  }
  for (const key of SCOPE_KEYS) {
    const value = scope[key];
    if (key === "peerPid") {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError("browser capability peerPid is invalid");
      }
    } else if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`browser capability ${key} is required`);
    }
  }
  if (scope.backend !== "in-app" && scope.backend !== "chrome") {
    throw new TypeError("browser capability backend is invalid");
  }
  return {
    workspaceId: scope.workspaceId,
    sessionId: scope.sessionId,
    backend: scope.backend,
    peerPid: scope.peerPid,
    peerIdentity: scope.peerIdentity,
  };
}

export function createBrowserCapabilityAuthority(options = {}) {
  const secret = options.secret ?? randomBytes(32);
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new TypeError("browser capability secret must contain at least 32 bytes");
  }
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 60_000;
  const sign = (payload) => createHmac("sha256", secret).update(payload).digest();

  return {
    issue(input) {
      const scope = validateScope(input);
      const payload = encodeJson({ ...scope, expiresAt: now() + ttlMs });
      return `${payload}.${sign(payload).toString("base64url")}`;
    },
    verify(token, expectedInput) {
      if (typeof token !== "string") throw new Error("browser capability signature is invalid");
      const [payload, signatureText, ...extra] = token.split(".");
      if (!payload || !signatureText || extra.length) {
        throw new Error("browser capability signature is invalid");
      }
      const expectedSignature = sign(payload);
      const actualSignature = Buffer.from(signatureText, "base64url");
      if (
        actualSignature.length !== expectedSignature.length ||
        !timingSafeEqual(actualSignature, expectedSignature)
      ) {
        throw new Error("browser capability signature is invalid");
      }
      const claims = decodeJson(payload);
      const expected = validateScope(expectedInput);
      for (const key of SCOPE_KEYS) {
        if (claims[key] !== expected[key]) {
          throw new Error("browser capability scope mismatch");
        }
      }
      if (!Number.isFinite(claims.expiresAt) || now() > claims.expiresAt) {
        throw new Error("browser capability expired");
      }
      return { ...expected, expiresAt: claims.expiresAt };
    },
  };
}
