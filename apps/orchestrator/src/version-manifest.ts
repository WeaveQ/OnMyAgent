import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type VersionInfo = {
  version: string;
  sha256: string;
};

export type VersionManifest = {
  dir: string;
  entries: Record<string, VersionInfo>;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readVersionManifest(): Promise<VersionManifest | null> {
  const binDir = dirname(process.execPath);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const envManifestPath = process.env.ONMYAGENT_VERSION_MANIFEST?.trim();
  const envSidecarDir = process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR?.trim();
  const candidates = [
    ...(envManifestPath
      ? [
          {
            manifestPath: envManifestPath,
            dir: envSidecarDir || dirname(envManifestPath),
          },
        ]
      : []),
    { manifestPath: join(binDir, "versions.json"), dir: binDir },
    { manifestPath: join(binDir, "..", "Resources", "versions.json"), dir: binDir },
    { manifestPath: join(moduleDir, "versions.json"), dir: moduleDir },
  ];
  for (const { manifestPath, dir } of candidates) {
    if (await fileExists(manifestPath)) {
      try {
        const payload = await readFile(manifestPath, "utf8");
        const entries = JSON.parse(payload) as Record<string, VersionInfo>;
        return { dir, entries };
      } catch {
        return { dir, entries: {} };
      }
    }
  }
  return null;
}
