/**
 * Product runtime binary selection policy (OpenCode / Node / Python).
 *
 * Shared product rule:
 * - Prefer product-bundled binaries by default (never silent PATH wins).
 * - Explicit overrides (API path / env force) always win.
 *
 * OpenCode additionally allows a machine-local binary when its version is
 * known and at least as new as the bundled pin; otherwise fall back to
 * bundled with a notice.
 *
 * Node / Python stay strictly product-owned: use bundled whenever present.
 */

/**
 * Extract numeric version tokens from CLI output or a pin like "v1.17.8".
 * @param {string | null | undefined} versionText
 * @returns {number[] | null}
 */
export function parseVersionTokens(versionText) {
  if (versionText == null) return null;
  const text = String(versionText).trim();
  if (!text) return null;
  const match = text.match(/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 * @returns {-1 | 0 | 1 | null}
 */
export function compareVersions(left, right) {
  const leftTokens = parseVersionTokens(left);
  const rightTokens = parseVersionTokens(right);
  if (!leftTokens || !rightTokens) return null;
  for (let index = 0; index < 3; index += 1) {
    if (leftTokens[index] !== rightTokens[index]) {
      return leftTokens[index] < rightTokens[index] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * @param {string | null | undefined} candidate
 * @param {string | null | undefined} minimum
 */
export function isVersionAtLeast(candidate, minimum) {
  const comparison = compareVersions(candidate, minimum);
  return comparison !== null && comparison >= 0;
}

/**
 * @typedef {"explicit" | "explicit-env" | "local-compatible" | "local-too-old" | "local-version-unknown" | "bundled-only" | "local-only" | "missing"} OpencodeBinaryReason
 */

/**
 * Choose which OpenCode binary the product should run.
 *
 * @param {{
 *   explicitPath?: string | null,
 *   envForcedPath?: string | null,
 *   localPath?: string | null,
 *   localVersion?: string | null,
 *   bundledPath?: string | null,
 *   bundledVersion?: string | null,
 * }} input
 * @returns {{
 *   path: string | null,
 *   source: "custom" | "local" | "bundled" | null,
 *   reason: OpencodeBinaryReason,
 *   notice: string | null,
 *   localVersion: string | null,
 *   bundledVersion: string | null,
 * }}
 */
export function chooseOpencodeBinary(input = {}) {
  const explicitPath = typeof input.explicitPath === "string" ? input.explicitPath.trim() : "";
  const envForcedPath = typeof input.envForcedPath === "string" ? input.envForcedPath.trim() : "";
  const localPath = typeof input.localPath === "string" ? input.localPath.trim() : "";
  const bundledPath = typeof input.bundledPath === "string" ? input.bundledPath.trim() : "";
  const localVersion =
    typeof input.localVersion === "string" && input.localVersion.trim()
      ? input.localVersion.trim()
      : null;
  const bundledVersion =
    typeof input.bundledVersion === "string" && input.bundledVersion.trim()
      ? input.bundledVersion.trim()
      : null;

  if (explicitPath) {
    return {
      path: explicitPath,
      source: "custom",
      reason: "explicit",
      notice: null,
      localVersion,
      bundledVersion,
    };
  }

  if (envForcedPath) {
    return {
      path: envForcedPath,
      source: "local",
      reason: "explicit-env",
      notice: null,
      localVersion,
      bundledVersion,
    };
  }

  if (localPath && bundledPath) {
    if (localVersion && bundledVersion) {
      const comparison = compareVersions(localVersion, bundledVersion);
      // Prefer product-bundled when versions are equal for stable plugin
      // contracts; only prefer a machine-local install when it is strictly newer.
      if (comparison !== null && comparison > 0) {
        return {
          path: localPath,
          source: "local",
          reason: "local-compatible",
          notice: null,
          localVersion,
          bundledVersion,
        };
      }
      if (comparison !== null && comparison < 0) {
        return {
          path: bundledPath,
          source: "bundled",
          reason: "local-too-old",
          notice: `本机 OpenCode ${localVersion} 低于产品要求 ${bundledVersion}，已改用内置版本。`,
          localVersion,
          bundledVersion,
        };
      }
      // Equal or unparsable comparison with both versions present: product default.
      return {
        path: bundledPath,
        source: "bundled",
        reason: "bundled-only",
        notice: null,
        localVersion,
        bundledVersion,
      };
    }

    const locationHint = localPath;
    return {
      path: bundledPath,
      source: "bundled",
      reason: "local-version-unknown",
      notice: `无法确认本机 OpenCode 版本是否满足要求（${locationHint}），已改用内置版本${bundledVersion ? ` ${bundledVersion}` : ""}。`,
      localVersion,
      bundledVersion,
    };
  }

  if (bundledPath) {
    return {
      path: bundledPath,
      source: "bundled",
      reason: "bundled-only",
      notice: null,
      localVersion,
      bundledVersion,
    };
  }

  if (localPath) {
    return {
      path: localPath,
      source: "local",
      reason: "local-only",
      notice: null,
      localVersion,
      bundledVersion,
    };
  }

  return {
    path: null,
    source: null,
    reason: "missing",
    notice: null,
    localVersion,
    bundledVersion,
  };
}

/**
 * @typedef {"explicit" | "explicit-env" | "bundled-only" | "local-only" | "missing"} ProductRuntimeBinaryReason
 */

/**
 * Choose Node / Python style product-owned runtime binaries.
 * Bundled always wins when present; local is only a last resort.
 *
 * @param {{
 *   toolLabel?: string,
 *   explicitPath?: string | null,
 *   envForcedPath?: string | null,
 *   localPath?: string | null,
 *   bundledPath?: string | null,
 *   bundledVersion?: string | null,
 *   localVersion?: string | null,
 * }} input
 * @returns {{
 *   path: string | null,
 *   source: "custom" | "local" | "bundled" | null,
 *   reason: ProductRuntimeBinaryReason,
 *   notice: string | null,
 *   localVersion: string | null,
 *   bundledVersion: string | null,
 * }}
 */
export function chooseProductRuntimeBinary(input = {}) {
  const toolLabel =
    typeof input.toolLabel === "string" && input.toolLabel.trim()
      ? input.toolLabel.trim()
      : "runtime";
  const explicitPath = typeof input.explicitPath === "string" ? input.explicitPath.trim() : "";
  const envForcedPath = typeof input.envForcedPath === "string" ? input.envForcedPath.trim() : "";
  const localPath = typeof input.localPath === "string" ? input.localPath.trim() : "";
  const bundledPath = typeof input.bundledPath === "string" ? input.bundledPath.trim() : "";
  const localVersion =
    typeof input.localVersion === "string" && input.localVersion.trim()
      ? input.localVersion.trim()
      : null;
  const bundledVersion =
    typeof input.bundledVersion === "string" && input.bundledVersion.trim()
      ? input.bundledVersion.trim()
      : null;

  if (explicitPath) {
    return {
      path: explicitPath,
      source: "custom",
      reason: "explicit",
      notice: null,
      localVersion,
      bundledVersion,
    };
  }

  if (envForcedPath) {
    return {
      path: envForcedPath,
      source: "local",
      reason: "explicit-env",
      notice: null,
      localVersion,
      bundledVersion,
    };
  }

  if (bundledPath) {
    return {
      path: bundledPath,
      source: "bundled",
      reason: "bundled-only",
      notice: null,
      localVersion,
      bundledVersion,
    };
  }

  if (localPath) {
    return {
      path: localPath,
      source: "local",
      reason: "local-only",
      notice: `未找到产品内置 ${toolLabel}，临时使用本机路径：${localPath}`,
      localVersion,
      bundledVersion,
    };
  }

  return {
    path: null,
    source: null,
    reason: "missing",
    notice: null,
    localVersion,
    bundledVersion,
  };
}
