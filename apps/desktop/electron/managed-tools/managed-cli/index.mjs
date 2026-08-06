/**
 * Reusable managed remote-CLI install kit.
 *
 * Use for OfficeCLI today and Feishu CLI / other on-demand CLIs later:
 * 1. Ship a download-config JSON with version + permanent HTTPS URLs.
 * 2. Fetch release metadata (integrity) from releaseManifestUrl.
 * 3. Download skill + platform asset (raw or zip+entry).
 * 4. Verify against release manifest sha256/size, stage, activate.
 *
 * Content-addressed CDNs cannot overwrite objects — version bumps require a
 * new config (and desktop release). Root "latest pointer" manifests are optional.
 */
export {
  loadManagedCliDownloadConfig,
  nonEmptyString,
  parseManagedCliAssetSpec,
} from "./config.mjs";
export { extractZipEntry } from "./archive.mjs";
