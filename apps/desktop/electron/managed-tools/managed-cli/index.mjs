/**
 * Reusable managed remote-CLI install kit.
 *
 * Registry (desktop asar): managed-cli-registry.json
 *   pluginId → permanent root manifestUrl
 *
 * Root catalog (CDN, hot-updated):
 *   latestVersion + skill.url + optional skillsPack +
 *   assets[platform].{url,archive,entry,sha256,size?}
 *
 * Shared layers:
 *   config   — registry / download-config loaders
 *   archive  — zip extract
 *   download — fetch/retry, stream, sha256 verify
 *   version  — x.y.z compare
 *   errors   — codedError helpers
 *
 * Product managers (officecli-manager, future feishu/tencent) own:
 *   platform keys, binary names, skill materialization, launcher, state schema.
 */
export {
  loadManagedCliDownloadConfig,
  loadManagedCliPluginEntry,
  loadManagedCliRegistry,
  MANAGED_CLI_DEFAULT_REGISTRY_PATH,
  nonEmptyString,
  parseManagedCliAssetSpec,
  resolveManagedCliRegistryPath,
} from "./config.mjs";
export { extractZipEntry, extractZipToDir } from "./archive.mjs";
export {
  createManagedCliDownloader,
  digestBytes,
  hashFile,
  MANAGED_CLI_NETWORK_RETRY_COUNT,
  MANAGED_CLI_NETWORK_TIMEOUT_MS,
  safeDownloadTarget,
  verifyBytes,
  verifyDigest,
  verifyHash,
  verifyOptionalBytes,
} from "./download.mjs";
export { compareManagedCliVersions } from "./version.mjs";
export { codedError, errorCode } from "./errors.mjs";
