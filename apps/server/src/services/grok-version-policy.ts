import { ApiError } from "../core/errors.js";

// 1.0.3 is audited for base ACP only. Its initialize surface does not expose
// the x.ai session-admin extensions present in the 1.0.0/1.0.1 snapshots.
const AUDITED_GROK_VERSIONS = new Set(["1.0.0", "1.0.1", "1.0.3"]);

export function parseGrokVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$|\()/u);
  return match?.[1] ?? null;
}

export function isAuditedGrokVersion(version: string): boolean {
  return AUDITED_GROK_VERSIONS.has(version);
}

export function assertGrokRuntimeVersion(input: {
  expectedVersion?: string;
  initialized: unknown;
}): string {
  const root = input.initialized && typeof input.initialized === "object"
    ? input.initialized as Record<string, unknown>
    : {};
  const meta = root._meta && typeof root._meta === "object"
    ? root._meta as Record<string, unknown>
    : {};
  const nativeVersion = parseGrokVersion(meta.agentVersion);
  if (!nativeVersion) {
    throw new ApiError(
      409,
      "grok_runtime_version_unsupported",
      "The installed Grok Build version has not been audited for this OnMyAgent release",
    );
  }
  if (input.expectedVersion && nativeVersion !== input.expectedVersion) {
    throw new ApiError(
      409,
      "grok_runtime_version_mismatch",
      "The Grok Build process version does not match the selected binary",
    );
  }
  return nativeVersion;
}

export function grokVersionCompatibilityMode(version: string): "audited" | "base-acp" {
  return isAuditedGrokVersion(version) ? "audited" : "base-acp";
}
