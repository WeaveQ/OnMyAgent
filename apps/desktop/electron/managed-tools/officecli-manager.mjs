import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  cp,
  open,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  officeCliLatestManifestSchema,
  officeCliReleaseManifestSchema,
  officeCliStateSchema,
} from "@onmyagent/types/officecli";

import {
  resolveLocalManagedToolsBinRoot,
  resolveLocalSkillsRoot,
  resolveOfficeCliManagedRoot,
} from "../config-profile-paths.mjs";

export const OFFICECLI_PLUGIN_ID = "officecli";
export const OFFICECLI_DEFAULT_MANIFEST_URL =
  "https://weaveq-static.oss-cn-hangzhou.aliyuncs.com/officecli/manifest.json";
export const OFFICECLI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const OFFICECLI_NETWORK_TIMEOUT_MS = 30_000;
export const OFFICECLI_NETWORK_RETRY_COUNT = 2;

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_BYTES = 1024 * 1024;
const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const PLATFORM_PATTERN = /^officecli-(?:mac|win)-(?:arm64|x64)$/;

export const OFFICECLI_LAUNCHER_SOURCE = `
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.join(root, "state.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (!/^\\d+\\.\\d+\\.\\d+$/.test(String(state.activeVersion ?? ""))) {
  throw new Error("Invalid OfficeCLI active version");
}
if (!/^officecli-(?:mac|win)-(?:arm64|x64)$/.test(String(state.platform ?? ""))) {
  throw new Error("Invalid OfficeCLI platform");
}
const binaryName = process.platform === "win32" ? "officecli.exe" : "officecli";
const binaryPath = path.join(root, "releases", state.activeVersion, state.platform, binaryName);
const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`;

function normalizeArch(arch) {
  if (arch === "arm64") return "arm64";
  if (arch === "x64") return "x64";
  return null;
}

export function officeCliPlatformKey(platform = process.platform, arch = os.arch()) {
  const normalizedArch = normalizeArch(arch);
  if (!normalizedArch) return null;
  if (platform === "darwin") return `officecli-mac-${normalizedArch}`;
  if (platform === "win32") return `officecli-win-${normalizedArch}`;
  return null;
}

export function compareOfficeCliVersions(left, right) {
  const leftParts = String(left).split(".").map(Number);
  const rightParts = String(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function isSafeVersion(value) {
  return VERSION_PATTERN.test(String(value));
}

function isSafePlatform(value) {
  return PLATFORM_PATTERN.test(String(value));
}

function assertSafeRelativePath(value) {
  const text = String(value ?? "");
  if (
    !text ||
    text.startsWith("/") ||
    text.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(text) ||
    text.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`Unsafe OfficeCLI release path: ${text}`);
  }
}

function resolveSameOriginUrl(base, relativeReference) {
  assertSafeRelativePath(relativeReference);
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== "https:") {
    throw new Error("OfficeCLI downloads require HTTPS");
  }
  const resolved = new URL(relativeReference, baseUrl);
  if (resolved.origin !== baseUrl.origin) {
    throw new Error("OfficeCLI download must stay on the configured OSS origin");
  }
  return resolved.href;
}

function resolveOfficeCliUrl(base, reference) {
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== "https:") {
    throw new Error("OfficeCLI downloads require HTTPS");
  }
  if (typeof reference === "string") {
    return resolveSameOriginUrl(base, reference);
  }
  if (reference.url) {
    const directUrl = new URL(reference.url);
    if (directUrl.protocol !== "https:" || directUrl.origin !== baseUrl.origin) {
      throw new Error("OfficeCLI download must stay on the configured OSS origin");
    }
    return directUrl.href;
  }
  return resolveSameOriginUrl(base, reference.path);
}

function referenceWithOverride(reference, override) {
  return override ? override : reference;
}

function releaseSkillReference(release) {
  if (release.skill) return release.skill;
  if (release.skillPath) return release.skillPath;
  throw new Error("OfficeCLI release manifest does not provide SKILL.md");
}

function binaryName(platform) {
  return platform === "win32" ? "officecli.exe" : "officecli";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function nowMs() {
  return Date.now();
}

function codedError(message, code) {
  /** @type {Error & { code?: string }} */
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorCode(error) {
  if (error && typeof error === "object" && "code" in error) {
    return typeof error.code === "string" ? error.code : "officecli_error";
  }
  return "officecli_error";
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function readStreamChunk(reader, timeoutMs, label) {
  let timeout = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(codedError(`OfficeCLI response timed out: ${label}`, "network_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * @param {Response} response
 * @param {number} maximum
 * @param {string} url
 * @param {(receivedBytes: number, totalBytes: number | undefined) => void} [onProgress]
 * @param {number} [timeoutMs]
 */
async function responseBytes(
  response,
  maximum,
  url,
  onProgress = () => undefined,
  timeoutMs = OFFICECLI_NETWORK_TIMEOUT_MS,
) {
  if (!response.ok) {
    throw new Error(`OfficeCLI download failed (${response.status}): ${url}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maximum) {
    throw new Error(`OfficeCLI response exceeds size limit: ${url}`);
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximum) {
      throw new Error(`OfficeCLI response exceeds size limit: ${url}`);
    }
    onProgress(bytes.byteLength, contentLength || undefined);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const next = await readStreamChunk(reader, timeoutMs, url);
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maximum) {
        await reader.cancel();
        throw new Error(`OfficeCLI response exceeds size limit: ${url}`);
      }
      chunks.push(chunk);
      onProgress(receivedBytes, contentLength || undefined);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, receivedBytes);
}

function verifyDigest(size, digest, expected, label) {
  if (size !== expected.size) {
    throw new Error(`${label} size mismatch`);
  }
  if (digest.toLowerCase() !== expected.sha256.toLowerCase()) {
    throw new Error(`${label} checksum mismatch`);
  }
  return digest;
}

function verifyBytes(bytes, expected, label) {
  return verifyDigest(
    bytes.byteLength,
    createHash("sha256").update(bytes).digest("hex"),
    expected,
    label,
  );
}

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyOptionalBytes(bytes, expected, label) {
  if (!expected || typeof expected !== "object") return digestBytes(bytes);
  return verifyBytes(bytes, expected, label);
}

/**
 * @param {Response} response
 * @param {string} target
 * @param {number} maximum
 * @param {{ size: number, sha256: string } | undefined} expected
 * @param {string} label
 * @param {(receivedBytes: number, totalBytes: number | undefined) => void} [onProgress]
 * @param {number} [timeoutMs]
 */
async function streamResponseToFile(
  response,
  target,
  maximum,
  expected,
  label,
  onProgress = () => undefined,
  timeoutMs = OFFICECLI_NETWORK_TIMEOUT_MS,
) {
  if (!response.ok) {
    throw new Error(`OfficeCLI download failed (${response.status}): ${label}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maximum) {
    throw new Error(`OfficeCLI response exceeds size limit: ${label}`);
  }
  if (!response.body) {
    throw new Error(`OfficeCLI streaming response is unavailable: ${label}`);
  }

  const reader = response.body.getReader();
  const file = await open(target, "w");
  const hash = createHash("sha256");
  let receivedBytes = 0;
  try {
    while (true) {
      const next = await readStreamChunk(reader, timeoutMs, label);
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maximum) {
        await reader.cancel();
        throw new Error(`OfficeCLI response exceeds size limit: ${label}`);
      }
      hash.update(chunk);
      await file.write(chunk);
      onProgress(receivedBytes, contentLength || undefined);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    await file.close();
  }
  const digest = hash.digest("hex");
  if (expected) verifyDigest(receivedBytes, digest, expected, label);
  return { receivedBytes, digest };
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryableError(error) {
  return error instanceof Error;
}

function networkError(error, url) {
  if (error?.name === "AbortError") {
    return codedError(`OfficeCLI request timed out: ${url}`, "network_timeout");
  }
  return error;
}

function waitForRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function defaultRunBinaryVersion(binaryPath, expectedVersion) {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 15_000);
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && output.includes(expectedVersion));
    });
  });
}

function statusBase(platform) {
  return {
    pluginId: OFFICECLI_PLUGIN_ID,
    state: platform ? "not_installed" : "unsupported",
    supported: Boolean(platform),
    platform: platform ?? `${process.platform}-${os.arch()}`,
    installedVersion: null,
    latestVersion: null,
    previousVersion: null,
    usable: false,
    lastCheckedAt: null,
  };
}

export function createOfficeCliManager(options = {}) {
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? os.arch();
  const platformKey = officeCliPlatformKey(platform, arch);
  const manifestUrl = String(
    options.manifestUrl ??
      process.env.ONMYAGENT_OFFICECLI_MANIFEST_URL ??
      OFFICECLI_DEFAULT_MANIFEST_URL,
  ).trim();
  const releaseManifestUrlOverride = String(
    options.releaseManifestUrl ??
      process.env.ONMYAGENT_OFFICECLI_RELEASE_MANIFEST_URL ??
      "",
  ).trim() || null;
  const skillUrlOverride = String(
    options.skillUrl ?? process.env.ONMYAGENT_OFFICECLI_SKILL_URL ?? "",
  ).trim() || null;
  const assetUrlOverrides = options.assetUrlOverrides ?? {};
  const networkTimeoutMs = Number.isFinite(Number(options.networkTimeoutMs))
    ? Math.max(1, Number(options.networkTimeoutMs))
    : OFFICECLI_NETWORK_TIMEOUT_MS;
  const networkRetryCount = Number.isInteger(Number(options.networkRetryCount))
    ? Math.max(0, Number(options.networkRetryCount))
    : OFFICECLI_NETWORK_RETRY_COUNT;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const refreshSkillLinks = options.refreshSkillLinks ?? (async () => undefined);
  const runBinaryVersion = options.runBinaryVersion ?? defaultRunBinaryVersion;
  const emitProgress = options.onProgress ?? (() => undefined);
  const emitStatus = options.onStatus ?? (() => undefined);
  const now = options.now ?? nowMs;
  const managedRoot = resolveOfficeCliManagedRoot(homeDir);
  const toolsBinRoot = resolveLocalManagedToolsBinRoot(homeDir);
  const statePath = path.join(managedRoot, "state.json");
  const cachePath = path.join(managedRoot, "update-cache.json");
  let operation = null;

  function currentSkillPath() {
    return path.join(resolveLocalSkillsRoot(homeDir), OFFICECLI_PLUGIN_ID);
  }

  async function readState() {
    try {
      return officeCliStateSchema.parse(await readJson(statePath));
    } catch {
      return null;
    }
  }

  async function fetchWithRetry(url) {
    if (typeof fetchImpl !== "function") {
      throw new Error("OfficeCLI network fetch is unavailable");
    }
    let lastError = null;
    for (let attempt = 0; attempt <= networkRetryCount; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), networkTimeoutMs);
      try {
        const response = await fetchImpl(url, {
          redirect: "error",
          signal: controller.signal,
        });
        if (retryableStatus(response.status) && attempt < networkRetryCount) {
          await response.body?.cancel();
          await waitForRetry(100 * (attempt + 1));
          continue;
        }
        return response;
      } catch (error) {
        lastError = networkError(error, url);
        if (attempt >= networkRetryCount || !retryableError(lastError)) {
          throw lastError;
        }
        await waitForRetry(100 * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error(`OfficeCLI request failed: ${url}`);
  }

  async function fetchJson(url, maximum) {
    const response = await fetchWithRetry(url);
    const bytes = await responseBytes(response, maximum, url, () => undefined, networkTimeoutMs);
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  }

  function assetUrlOverride(platformKey) {
    const configured = assetUrlOverrides[platformKey];
    if (typeof configured === "string" && configured.trim()) return configured.trim();
    const envKey = `ONMYAGENT_OFFICECLI_ASSET_URL_${platformKey
      .replace(/^officecli-/, "")
      .replaceAll("-", "_")
      .toUpperCase()}`;
    const environmentValue = process.env[envKey]?.trim();
    if (environmentValue) return environmentValue;
    return process.env.ONMYAGENT_OFFICECLI_ASSET_URL?.trim() || null;
  }

  async function loadRemote(forceRefresh) {
    let cached = null;
    try {
      const candidate = await readJson(cachePath);
      if (candidate && typeof candidate === "object") cached = candidate;
    } catch {
      cached = null;
    }
    if (
      !forceRefresh &&
      cached &&
      Number(cached.fetchedAt) + OFFICECLI_CACHE_TTL_MS > now()
    ) {
      const latest = officeCliLatestManifestSchema.parse(cached.latest);
      const release = officeCliReleaseManifestSchema.parse(cached.release);
      const releaseUrl =
        releaseManifestUrlOverride ??
        resolveOfficeCliUrl(manifestUrl, latest.releaseManifest);
      return { latest, release, releaseUrl, fetchedAt: Number(cached.fetchedAt) };
    }

    const root = await fetchJson(manifestUrl, MAX_MANIFEST_BYTES);
    const latest = officeCliLatestManifestSchema.parse(root.value);
    const releaseUrl =
      releaseManifestUrlOverride ??
      resolveOfficeCliUrl(manifestUrl, latest.releaseManifest);
    const releaseResponse = await fetchJson(releaseUrl, MAX_MANIFEST_BYTES);
    if (typeof latest.releaseManifest !== "string") {
      verifyBytes(releaseResponse.bytes, latest.releaseManifest, "release manifest");
    }
    const release = officeCliReleaseManifestSchema.parse(releaseResponse.value);
    if (
      (release.pluginId && release.pluginId !== OFFICECLI_PLUGIN_ID) ||
      release.version !== latest.latestVersion ||
      (release.officecliVersion && release.officecliVersion !== release.version)
    ) {
      throw new Error("OfficeCLI release manifest does not match the latest pointer");
    }
    const fetchedAt = now();
    await writeJsonAtomic(cachePath, { fetchedAt, latest, release });
    return { latest, release, releaseUrl, fetchedAt };
  }

  async function readOwnership(skillPath) {
    try {
      const marker = JSON.parse(
        await readFile(path.join(skillPath, ".onmyagent-managed.json"), "utf8"),
      );
      return marker?.owner === "onmyagent" && marker?.pluginId === OFFICECLI_PLUGIN_ID;
    } catch {
      return false;
    }
  }

  async function ensureLauncher() {
    await mkdir(toolsBinRoot, { recursive: true });
    await mkdir(managedRoot, { recursive: true });
    await writeFile(path.join(managedRoot, "launcher.mjs"), OFFICECLI_LAUNCHER_SOURCE, "utf8");
    const posixLauncher = path.join(toolsBinRoot, "officecli");
    const windowsLauncher = path.join(toolsBinRoot, "officecli.cmd");
    await writeFile(
      posixLauncher,
      `#!/bin/sh\nexec node ${shellQuote(path.join(managedRoot, "launcher.mjs"))} "$@"\n`,
      { encoding: "utf8", mode: 0o755 },
    );
    await chmod(posixLauncher, 0o755).catch(() => undefined);
    await writeFile(
      windowsLauncher,
      `@echo off\r\nnode "%~dp0..\\officecli\\launcher.mjs" %*\r\n`,
      "utf8",
    );
  }

  async function activeBinaryPath(state) {
    if (!state || !isSafeVersion(state.activeVersion) || !isSafePlatform(state.platform)) {
      return null;
    }
    return path.join(
      managedRoot,
      "releases",
      state.activeVersion,
      state.platform,
      binaryName(platform),
    );
  }

  async function getStatus() {
    const status = statusBase(platformKey);
    const state = await readState();
    if (!platformKey) return status;
    if (state) {
      status.installedVersion = state.activeVersion;
      status.previousVersion = state.previousVersion;
      const binaryPath = await activeBinaryPath(state);
      const skillPath = currentSkillPath();
      status.usable = Boolean(
        binaryPath &&
          (await pathExists(binaryPath)) &&
          (await pathExists(path.join(skillPath, "SKILL.md"))),
      );
      status.state = status.usable ? "installed" : "error";
    }
    try {
      const cache = await readJson(cachePath);
      const latest = officeCliLatestManifestSchema.parse(cache.latest);
      status.latestVersion = latest.latestVersion;
      status.lastCheckedAt = Number(cache.fetchedAt) || null;
      if (
        state &&
        status.usable &&
        compareOfficeCliVersions(latest.latestVersion, state.activeVersion) > 0
      ) {
        status.state = "update_available";
      }
    } catch {
      // A missing or stale cache does not make an installed version unusable.
    }
    return status;
  }

  async function checkForUpdates(forceRefresh = false) {
    try {
      await loadRemote(forceRefresh);
      const status = await getStatus();
      emitStatus(status);
      return status;
    } catch (error) {
      const status = await getStatus();
      if (!status.usable) status.state = "error";
      status.errorCode = errorCode(error);
      status.errorMessage = error instanceof Error ? error.message : String(error);
      emitStatus(status);
      return status;
    }
  }

  async function installLatest() {
    if (operation) return operation;
    operation = (async () => {
      const current = await readState();
      const operationName = current ? "update" : "install";
      emitProgress({ operation: operationName, phase: "checking" });
      emitProgress({ operation: operationName, phase: "downloading_manifest" });
      const remote = await loadRemote(true);
      const asset = platformKey ? remote.release.assets[platformKey] : undefined;
      if (!platformKey || !asset) {
        throw codedError(
          "OfficeCLI is not supported on this platform",
          "unsupported_platform",
        );
      }
      if (
        current &&
        current.activeVersion === remote.release.version &&
        (await getStatus()).usable
      ) {
        const status = await getStatus();
        emitStatus(status);
        return status;
      }

      const releaseRoot = path.join(
        managedRoot,
        "releases",
        remote.release.version,
        platformKey,
      );
      const stagingRoot = path.join(managedRoot, "staging", randomUUID());
      const stagingSkill = path.join(stagingRoot, "SKILL.md");
      const stagingBinary = path.join(stagingRoot, binaryName(platform));
      const skillReference = releaseSkillReference(remote.release);
      const expectedSkill =
        typeof skillReference === "object" ? skillReference : undefined;
      await mkdir(stagingRoot, { recursive: true });
      try {
        const releaseManifestText = `${JSON.stringify(remote.release, null, 2)}\n`;
        await writeFile(path.join(stagingRoot, "manifest.json"), releaseManifestText, "utf8");
        const binaryUrl = resolveOfficeCliUrl(
          remote.releaseUrl,
          referenceWithOverride(asset, assetUrlOverride(platformKey)),
        );
        const skillUrl = resolveOfficeCliUrl(
          remote.releaseUrl,
          referenceWithOverride(skillReference, skillUrlOverride),
        );
        emitProgress({ operation: operationName, phase: "downloading_binary" });
        const binaryResponse = await fetchWithRetry(binaryUrl);
        await streamResponseToFile(
          binaryResponse,
          stagingBinary,
          MAX_BINARY_BYTES,
          asset,
          "OfficeCLI binary",
          (receivedBytes, totalBytes) =>
            emitProgress({
              operation: operationName,
              phase: "downloading_binary",
              receivedBytes,
              totalBytes,
            }),
          networkTimeoutMs,
        );
        if (platform !== "win32") await chmod(stagingBinary, 0o755);

        emitProgress({ operation: operationName, phase: "downloading_skill" });
        const skillResponse = await fetchWithRetry(skillUrl);
        const skillBytes = await responseBytes(
          skillResponse,
          MAX_SKILL_BYTES,
          skillUrl,
          (receivedBytes, totalBytes) =>
            emitProgress({
              operation: operationName,
              phase: "downloading_skill",
              receivedBytes,
              totalBytes,
            }),
          networkTimeoutMs,
        );
        const skillSha256 = verifyOptionalBytes(
          skillBytes,
          expectedSkill,
          "OfficeCLI SKILL.md",
        );
        const skillText = skillBytes.toString("utf8");
        if (!/^---[\r\n]+[\s\S]*?name:\s*officecli(?:\r?\n|$)/m.test(skillText)) {
          throw new Error("OfficeCLI SKILL.md has an invalid name");
        }
        await writeFile(stagingSkill, skillBytes);

        emitProgress({ operation: operationName, phase: "verifying" });
        if (!(await runBinaryVersion(stagingBinary, remote.release.version))) {
          throw new Error("OfficeCLI binary version check failed");
        }

        const skillPath = currentSkillPath();
        const skillExists = await pathExists(skillPath);
        if (skillExists && !(await readOwnership(skillPath))) {
          throw codedError(
            "An existing user-owned officecli skill was not overwritten",
            "skill_conflict",
          );
        }

        await mkdir(path.dirname(releaseRoot), { recursive: true });
        emitProgress({ operation: operationName, phase: "installing" });
        await rm(releaseRoot, { recursive: true, force: true });
        await rename(stagingRoot, releaseRoot);
        const movedSkillPath = path.join(releaseRoot, "SKILL.md");
        const skillBackup = skillExists
          ? path.join(managedRoot, "staging", `${randomUUID()}-skill-backup`)
          : null;
        if (skillBackup) await rename(skillPath, skillBackup);
        try {
          await mkdir(path.dirname(skillPath), { recursive: true });
          await mkdir(skillPath, { recursive: true });
          await cp(movedSkillPath, path.join(skillPath, "SKILL.md"));
          await writeJsonAtomic(path.join(skillPath, ".onmyagent-managed.json"), {
            schemaVersion: 1,
            owner: "onmyagent",
            pluginId: OFFICECLI_PLUGIN_ID,
            version: remote.release.version,
          });
          const previousVersion = current?.activeVersion ?? null;
          const releases = {
            ...(current?.releases ?? {}),
            [remote.release.version]: {
              binarySha256: asset.sha256,
              skillSha256,
            },
          };
          if (previousVersion && current?.releases?.[previousVersion]) {
            releases[previousVersion] = current.releases[previousVersion];
          }
          await writeJsonAtomic(statePath, {
            schemaVersion: 1,
            pluginId: OFFICECLI_PLUGIN_ID,
            activeVersion: remote.release.version,
            previousVersion,
            platform: platformKey,
            installedSkillPath: skillPath,
            installedAt: current?.installedAt ?? now(),
            updatedAt: now(),
            releases,
          });
          await ensureLauncher();
          emitProgress({ operation: operationName, phase: "refreshing_skills" });
          await refreshSkillLinks();
          if (skillBackup) await rm(skillBackup, { recursive: true, force: true });
        } catch (error) {
          await rm(skillPath, { recursive: true, force: true });
          if (skillBackup) await rename(skillBackup, skillPath);
          if (current) await writeJsonAtomic(statePath, current);
          else await rm(statePath, { force: true });
          throw error;
        }
        const status = await getStatus();
        emitStatus(status);
        emitProgress({ operation: operationName, phase: "complete" });
        return status;
      } finally {
        await rm(stagingRoot, { recursive: true, force: true });
      }
    })();
    try {
      return await operation;
    } finally {
      operation = null;
    }
  }

  async function uninstall() {
    if (operation) return operation;
    operation = (async () => {
      emitProgress({ operation: "uninstall", phase: "installing" });
      const skillPath = currentSkillPath();
      if (await pathExists(skillPath)) {
        if (!(await readOwnership(skillPath))) {
          throw codedError(
            "An existing user-owned officecli skill was not removed",
            "skill_conflict",
          );
        }
        await rm(skillPath, { recursive: true, force: true });
      }
      await rm(managedRoot, { recursive: true, force: true });
      await rm(path.join(toolsBinRoot, "officecli"), { force: true });
      await rm(path.join(toolsBinRoot, "officecli.cmd"), { force: true });
      await refreshSkillLinks();
      const status = statusBase(platformKey);
      emitStatus(status);
      emitProgress({ operation: "uninstall", phase: "complete" });
      return status;
    })();
    try {
      return await operation;
    } finally {
      operation = null;
    }
  }

  return {
    getStatus,
    checkForUpdates,
    installLatest,
    uninstall,
    loadRemote,
    paths: {
      managedRoot,
      toolsBinRoot,
      statePath,
      cachePath,
      skillPath: currentSkillPath(),
    },
  };
}
