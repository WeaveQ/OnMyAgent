/**
 * CLI binary resolution — download, verify, and resolve sidecar binaries.
 * Extracted from cli-shared.ts (mechanical split; re-exported for compat).
 */
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { BinarySourcePreference } from "./cli-args.js";
import {
  fileExists,
  readCliVersion,
  resolveExpectedVersion,
  resolveLocalOpencodeBin,
  runCommand,
  type BinarySource,
  type ResolvedBinary,
  type RemoteSidecarManifest,
  type SidecarName,
} from "./cli-shared.js";
import { isExecutable } from "./runtime-sandbox.js";
import {
  resolveSidecarTarget,
  type SidecarConfig,
  type SidecarTarget,
} from "./sidecar-config.js";
import type { VersionInfo, VersionManifest } from "./version-manifest.js";

export const remoteManifestCache = new Map<
  string,
  Promise<RemoteSidecarManifest | null>
>();


export async function fetchRemoteManifest(
  url: string,
): Promise<RemoteSidecarManifest | null> {
  const cached = remoteManifestCache.get(url);
  if (cached) return cached;
  const task = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return (await response.json()) as RemoteSidecarManifest;
    } catch {
      return null;
    }
  })();
  remoteManifestCache.set(url, task);
  return task;
}

export function resolveAssetUrl(
  baseUrl: string,
  asset?: string,
  url?: string,
): string | null {
  if (url && url.trim()) return url.trim();
  if (asset && asset.trim())
    return `${baseUrl.replace(/\/$/, "")}/${asset.trim()}`;
  return null;
}

export function resolveAssetName(asset?: string, url?: string): string | null {
  if (asset && asset.trim()) return asset.trim();
  if (url && url.trim()) {
    try {
      return basename(new URL(url).pathname);
    } catch {
      const parts = url.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    }
  }
  return null;
}

export async function downloadToPath(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  const tmpPath = `${dest}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, dest);
}

export async function ensureExecutable(path: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    await chmod(path, 0o755);
  } catch {
    // ignore
  }
}

export async function downloadSidecarBinary(options: {
  name: SidecarName;
  sidecar: SidecarConfig;
  expectedVersion?: string;
}): Promise<ResolvedBinary | null> {
  if (!options.sidecar.target) return null;
  const manifest = await fetchRemoteManifest(options.sidecar.manifestUrl);
  if (!manifest) return null;
  const entry = manifest.entries[options.name];
  if (!entry) return null;
  if (options.expectedVersion && entry.version !== options.expectedVersion) {
    return null;
  }
  const targetInfo = entry.targets[options.sidecar.target];
  if (!targetInfo) return null;

  const assetName = resolveAssetName(targetInfo.asset, targetInfo.url);
  const assetUrl = resolveAssetUrl(
    options.sidecar.baseUrl,
    targetInfo.asset,
    targetInfo.url,
  );
  if (!assetName || !assetUrl) return null;

  const targetDir = join(
    options.sidecar.dir,
    entry.version,
    options.sidecar.target,
  );
  const targetPath = join(targetDir, assetName);
  if (await fileExists(targetPath)) {
    if (targetInfo.sha256) {
      try {
        await verifyBinary(targetPath, {
          version: entry.version,
          sha256: targetInfo.sha256,
        });
        await ensureExecutable(targetPath);
        return {
          bin: targetPath,
          source: "downloaded",
          expectedVersion: entry.version,
        };
      } catch {
        await rm(targetPath, { force: true });
      }
    } else {
      await ensureExecutable(targetPath);
      return {
        bin: targetPath,
        source: "downloaded",
        expectedVersion: entry.version,
      };
    }
  }

  await downloadToPath(assetUrl, targetPath);
  if (targetInfo.sha256) {
    await verifyBinary(targetPath, {
      version: entry.version,
      sha256: targetInfo.sha256,
    });
  }
  await ensureExecutable(targetPath);
  return {
    bin: targetPath,
    source: "downloaded",
    expectedVersion: entry.version,
  };
}

export function resolveOpencodeAsset(target: SidecarTarget): string | null {
  const assets: Record<SidecarTarget, string> = {
    "darwin-arm64": "opencode-darwin-arm64.zip",
    "darwin-x64": "opencode-darwin-x64-baseline.zip",
    "linux-x64": "opencode-linux-x64-baseline.tar.gz",
    "linux-arm64": "opencode-linux-arm64.tar.gz",
    "windows-x64": "opencode-windows-x64-baseline.zip",
    "windows-arm64": "opencode-windows-arm64.zip",
  };
  return assets[target] ?? null;
}

export async function resolveOpencodeDownload(
  sidecar: SidecarConfig,
  expectedVersion?: string,
): Promise<string | null> {
  if (!expectedVersion) return null;
  if (!sidecar.target) return null;

  const assetOverride =
    process.env.ONMYAGENT_OPENCODE_ASSET ?? process.env.OPENCODE_ASSET;
  const asset = assetOverride?.trim() || resolveOpencodeAsset(sidecar.target);
  if (!asset) return null;

  const version = expectedVersion.startsWith("v")
    ? expectedVersion.slice(1)
    : expectedVersion;
  const url = `https://github.com/anomalyco/opencode/releases/download/v${version}/${asset}`;
  const targetDir = join(sidecar.dir, "opencode", version, sidecar.target);
  const targetPath = join(
    targetDir,
    process.platform === "win32" ? "opencode.exe" : "opencode",
  );

  const hostTarget = resolveSidecarTarget();
  const runnableOnHost = hostTarget !== null && sidecar.target === hostTarget;

  if (await fileExists(targetPath)) {
    if (!runnableOnHost) {
      await ensureExecutable(targetPath);
      return targetPath;
    }
    const actual = await readCliVersion(targetPath);
    if (actual === version) {
      await ensureExecutable(targetPath);
      return targetPath;
    }
  }

  await mkdir(targetDir, { recursive: true });
  const stamp = Date.now();
  const archivePath = join(
    tmpdir(),
    `onmyagent-orchestrator-opencode-${stamp}-${asset}`,
  );
  const extractDir = await mkdtemp(
    join(tmpdir(), "onmyagent-orchestrator-opencode-"),
  );

  try {
    await downloadToPath(url, archivePath);
    if (process.platform === "win32") {
      const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
      const psScript = [
        "$ErrorActionPreference = 'Stop'",
        `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(extractDir)} -Force`,
      ].join("; ");
      await runCommand("powershell", ["-NoProfile", "-Command", psScript]);
    } else if (asset.endsWith(".zip")) {
      await runCommand("unzip", ["-q", archivePath, "-d", extractDir]);
    } else if (asset.endsWith(".tar.gz")) {
      await runCommand("tar", ["-xzf", archivePath, "-C", extractDir]);
    } else {
      throw new Error(`Unsupported opencode asset type: ${asset}`);
    }

    const entries = await readdir(extractDir, { withFileTypes: true });
    const queue = entries.map((entry) => join(extractDir, entry.name));
    let candidate: string | null = null;
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      const statInfo = await stat(current);
      if (statInfo.isDirectory()) {
        const nested = await readdir(current, { withFileTypes: true });
        queue.push(...nested.map((entry) => join(current, entry.name)));
        continue;
      }
      const base = basename(current);
      if (base === "opencode" || base === "opencode.exe") {
        candidate = current;
        break;
      }
    }

    if (!candidate) {
      throw new Error("OpenCode binary not found after extraction.");
    }

    await copyFile(candidate, targetPath);
    await ensureExecutable(targetPath);
    return targetPath;
  } finally {
    await rm(extractDir, { recursive: true, force: true });
    await rm(archivePath, { force: true });
  }
}

export async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

export async function verifyBinary(
  path: string,
  expected?: VersionInfo,
): Promise<void> {
  if (!expected) return;
  const hash = await sha256File(path);
  if (hash !== expected.sha256) {
    throw new Error(`Integrity check failed for ${path}`);
  }
}

export async function resolveBundledBinary(
  manifest: VersionManifest | null,
  name: string,
): Promise<string | null> {
  if (!manifest) return null;
  const candidates = [join(manifest.dir, name)];
  if (process.platform === "win32") {
    candidates.push(join(manifest.dir, `${name}.exe`));
  }
  for (const bundled of candidates) {
    if (!(await isExecutable(bundled))) continue;
    // Desktop bundles may be code-signed after we generate versions.json, which
    // mutates the on-disk bytes and makes a precomputed sha256 unstable.
    // Linux bundles remain byte-stable, so keep integrity verification there.
    if (process.platform === "linux") {
      await verifyBinary(bundled, manifest.entries[name]);
    }
    return bundled;
  }
  return null;
}
export function resolveBinPath(bin: string): string {
  if (bin.includes("/") || bin.startsWith(".")) {
    return resolve(process.cwd(), bin);
  }
  return bin;
}

export function isPathLikeBinary(bin: string): boolean {
  return bin.includes("/") || bin.startsWith(".");
}

export async function assertSandboxBinaryFile(
  name: string,
  bin: string,
): Promise<void> {
  const lower = bin.toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".ts")) {
    throw new Error(
      `Sandbox mode requires ${name} to be a native binary (got ${bin}). Use downloaded sidecars or pass a Linux binary path.`,
    );
  }
  if (!isPathLikeBinary(bin)) {
    throw new Error(
      `Sandbox mode requires ${name} to be a file path (got ${bin}). Use downloaded sidecars or pass --${name}-bin with a Linux binary path.`,
    );
  }
  const resolved = resolve(process.cwd(), bin);
  if (!(await fileExists(resolved))) {
    throw new Error(
      `Sandbox mode could not find ${name} binary at ${resolved}.`,
    );
  }
}

export async function resolveOnMyAgentServerBin(options: {
  explicit?: string;
  manifest: VersionManifest | null;
  allowExternal: boolean;
  sidecar: SidecarConfig;
  source: BinarySourcePreference;
}): Promise<ResolvedBinary> {
  if (options.explicit && !options.allowExternal) {
    throw new Error("onmyagent-server-bin requires --allow-external");
  }
  if (
    options.explicit &&
    options.source !== "auto" &&
    options.source !== "external"
  ) {
    throw new Error(
      "onmyagent-server-bin requires --sidecar-source external or auto",
    );
  }

  const expectedVersion = await resolveExpectedVersion(
    options.manifest,
    "onmyagent-server",
  );
  const resolveExternal = async (): Promise<ResolvedBinary> => {
    if (!options.allowExternal) {
      throw new Error("External onmyagent-server requires --allow-external");
    }
    if (options.explicit) {
      const resolved = resolveBinPath(options.explicit);
      if (
        (resolved.includes("/") || resolved.startsWith(".")) &&
        !(await fileExists(resolved))
      ) {
        throw new Error(`onmyagent-server-bin not found: ${resolved}`);
      }
      return { bin: resolved, source: "external", expectedVersion };
    }

    const require = createRequire(import.meta.url);
    try {
      const pkgPath = require.resolve("onmyagent-server/package.json");
      const pkgDir = dirname(pkgPath);
      const binaryPath = join(pkgDir, "dist", "bin", "onmyagent-server");
      if (await isExecutable(binaryPath)) {
        return { bin: binaryPath, source: "external", expectedVersion };
      }
      const cliPath = join(pkgDir, "dist", "cli.js");
      if (await isExecutable(cliPath)) {
        return { bin: cliPath, source: "external", expectedVersion };
      }
    } catch {
      // ignore
    }

    return { bin: "onmyagent-server", source: "external", expectedVersion };
  };

  if (options.source === "bundled") {
    const bundled = await resolveBundledBinary(
      options.manifest,
      "onmyagent-server",
    );
    if (!bundled) {
      throw new Error(
        "Bundled onmyagent-server binary missing. Build with pnpm --filter onmyagent-orchestrator build:bin:bundled.",
      );
    }
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.source === "downloaded") {
    const downloaded = await downloadSidecarBinary({
      name: "onmyagent-server",
      sidecar: options.sidecar,
    });
    if (!downloaded) {
      throw new Error(
        "onmyagent-server download failed. Check sidecar manifest or base URL.",
      );
    }
    return downloaded;
  }

  if (options.source === "external") {
    return resolveExternal();
  }

  const bundled = await resolveBundledBinary(
    options.manifest,
    "onmyagent-server",
  );
  if (bundled && !(options.allowExternal && options.explicit)) {
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.explicit) {
    return resolveExternal();
  }

  const downloaded = await downloadSidecarBinary({
    name: "onmyagent-server",
    sidecar: options.sidecar,
  });
  if (downloaded) return downloaded;

  if (!options.allowExternal) {
    throw new Error(
      "Bundled onmyagent-server binary missing and download failed. Use --allow-external or --sidecar-source external.",
    );
  }

  return resolveExternal();
}

export async function resolveOpencodeBin(options: {
  explicit?: string;
  manifest: VersionManifest | null;
  allowExternal: boolean;
  sidecar: SidecarConfig;
  source: BinarySourcePreference;
}): Promise<ResolvedBinary> {
  if (options.explicit && !options.allowExternal) {
    throw new Error("opencode-bin requires --allow-external");
  }
  if (
    options.explicit &&
    options.source !== "auto" &&
    options.source !== "external"
  ) {
    throw new Error("opencode-bin requires --opencode-source external or auto");
  }

  const expectedVersion = await resolveExpectedVersion(
    options.manifest,
    "opencode",
  );
  const resolveExternal = async (): Promise<ResolvedBinary> => {
    if (!options.allowExternal) {
      throw new Error("External opencode requires --allow-external");
    }
    if (options.explicit) {
      const resolved = resolveBinPath(options.explicit);
      if (
        (resolved.includes("/") || resolved.startsWith(".")) &&
        !(await fileExists(resolved))
      ) {
        throw new Error(`opencode-bin not found: ${resolved}`);
      }
      return { bin: resolved, source: "external", expectedVersion };
    }
    return { bin: (await resolveLocalOpencodeBin()) ?? "opencode", source: "external", expectedVersion };
  };

  if (options.source === "bundled") {
    const bundled = await resolveBundledBinary(options.manifest, "opencode");
    if (!bundled) {
      throw new Error(
        "Bundled opencode binary missing. Build with pnpm --filter onmyagent-orchestrator build:bin:bundled.",
      );
    }
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.source === "downloaded") {
    const downloaded = await downloadSidecarBinary({
      name: "opencode",
      sidecar: options.sidecar,
      expectedVersion,
    });
    if (downloaded) return downloaded;
    const opencodeDownloaded = await resolveOpencodeDownload(
      options.sidecar,
      expectedVersion,
    );
    if (opencodeDownloaded) {
      return { bin: opencodeDownloaded, source: "downloaded", expectedVersion };
    }
    throw new Error(
      "opencode download failed. Check sidecar manifest/network access, or update constants.json.",
    );
  }

  if (options.source === "external") {
    return resolveExternal();
  }

  if (options.allowExternal) {
    const local = await resolveLocalOpencodeBin();
    if (local) return { bin: local, source: "external", expectedVersion };
  }

  const bundled = await resolveBundledBinary(options.manifest, "opencode");
  if (bundled && !(options.allowExternal && options.explicit)) {
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.explicit) {
    return resolveExternal();
  }

  const downloaded = await downloadSidecarBinary({
    name: "opencode",
    sidecar: options.sidecar,
    expectedVersion,
  });
  if (downloaded) return downloaded;

  const opencodeDownloaded = await resolveOpencodeDownload(
    options.sidecar,
    expectedVersion,
  );
  if (opencodeDownloaded) {
    return { bin: opencodeDownloaded, source: "downloaded", expectedVersion };
  }

  if (!options.allowExternal) {
    throw new Error(
      "Bundled opencode binary missing and download failed. Use --allow-external or --opencode-source external.",
    );
  }

  return resolveExternal();
}

export async function resolveOpenCodeRouterBin(options: {
  explicit?: string;
  manifest: VersionManifest | null;
  allowExternal: boolean;
  sidecar: SidecarConfig;
  source: BinarySourcePreference;
}): Promise<ResolvedBinary> {
  if (options.explicit && !options.allowExternal) {
    throw new Error("opencode-router-bin requires --allow-external");
  }
  if (
    options.explicit &&
    options.source !== "auto" &&
    options.source !== "external"
  ) {
    throw new Error(
      "opencode-router-bin requires --sidecar-source external or auto",
    );
  }

  const expectedVersion = await resolveExpectedVersion(
    options.manifest,
    "opencode-router",
  );
  const resolveExternal = async (): Promise<ResolvedBinary> => {
    if (!options.allowExternal) {
      throw new Error("External opencodeRouter requires --allow-external");
    }
    if (options.explicit) {
      const resolved = resolveBinPath(options.explicit);
      if (
        (resolved.includes("/") || resolved.startsWith(".")) &&
        !(await fileExists(resolved))
      ) {
        throw new Error(`opencode-router-bin not found: ${resolved}`);
      }
      return { bin: resolved, source: "external", expectedVersion };
    }

    throw new Error(
      "opencode-router binary not configured. Pass --opencode-router-bin with --allow-external to use an external router.",
    );
  };

  if (options.source === "bundled") {
    const bundled = await resolveBundledBinary(
      options.manifest,
      "opencode-router",
    );
    if (!bundled) {
      throw new Error(
        "Bundled opencodeRouter binary missing. Build with pnpm --filter onmyagent-orchestrator build:bin:bundled.",
      );
    }
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.source === "downloaded") {
    const downloaded = await downloadSidecarBinary({
      name: "opencode-router",
      sidecar: options.sidecar,
    });
    if (!downloaded) {
      throw new Error(
        "opencodeRouter download failed. Check sidecar manifest or base URL.",
      );
    }
    return downloaded;
  }

  if (options.source === "external") {
    return resolveExternal();
  }

  const bundled = await resolveBundledBinary(
    options.manifest,
    "opencode-router",
  );
  if (bundled && !(options.allowExternal && options.explicit)) {
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.explicit) {
    return resolveExternal();
  }

  const downloaded = await downloadSidecarBinary({
    name: "opencode-router",
    sidecar: options.sidecar,
  });
  if (downloaded) return downloaded;

  if (!options.allowExternal) {
    throw new Error(
      "Bundled opencodeRouter binary missing and download failed. Use --allow-external or --sidecar-source external.",
    );
  }

  return resolveExternal();
}

