/**
 * Reusable managed remote-CLI install kit.
 *
 * Registry (desktop asar): managed-cli-registry.json
 *   pluginId → permanent root manifestUrl
 *
 * Root catalog (CDN, hot-updated):
 *   latestVersion + skill.url + assets[platform].{url,archive,entry,sha256,size}
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
export { extractZipEntry } from "./archive.mjs";
