/**
 * Stage-2 local config migration: copy skills + expert marketplaces into
 * profiles/local/config. Never deletes legacy trees.
 * SoT: docs/design/2026-08-02-config-consistency.md
 */
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CONFIG_SCHEMA_VERSION,
  normalizeOnMyAgentHome,
  resolveLegacyExpertsPath,
  resolveLegacySkillsPath,
  resolveLocalConfigManifestPath,
  resolveLocalConfigRoot,
  resolveLocalExpertsProfilePath,
  resolveLocalSkillsProfilePath,
} from "./config-profile-paths.mjs";

/**
 * @param {string} source
 * @param {string} dest
 * @param {{
 *   cp?: typeof cp,
 *   mkdir?: typeof mkdir,
 *   stat?: typeof stat,
 * }} io
 */
async function copyDirIfPresent(source, dest, io) {
  const cpFn = io.cp ?? cp;
  const mkdirFn = io.mkdir ?? mkdir;
  const statFn = io.stat ?? stat;
  try {
    await statFn(source);
  } catch {
    return { copied: false, reason: "source_missing" };
  }
  await mkdirFn(dest, { recursive: true });
  // force:false — do not clobber existing dest files (resume-safe).
  await cpFn(source, dest, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
  return { copied: true };
}

/**
 * @param {string} manifestPath
 * @param {typeof readFile} readFileFn
 * @returns {Promise<"absent" | "pending" | "complete" | "failed">}
 */
async function readMigrationStatusAsync(manifestPath, readFileFn) {
  try {
    const raw = await readFileFn(manifestPath, "utf8");
    const parsed = JSON.parse(String(raw));
    const status = String(parsed?.migration?.status ?? "").trim();
    if (status === "complete" || status === "pending" || status === "failed") {
      return status;
    }
    return "absent";
  } catch {
    return "absent";
  }
}

/**
 * Ensure profiles/local/config exists and legacy config-class data is copied.
 * Idempotent when manifest.migration.status === complete.
 *
 * @param {{
 *   homeDir?: string,
 *   appVersion?: string,
 *   mkdir?: typeof mkdir,
 *   readFile?: typeof readFile,
 *   writeFile?: typeof writeFile,
 *   stat?: typeof stat,
 *   cp?: typeof cp,
 *   now?: () => Date,
 * }} [input]
 */
export async function ensureLocalConfigMigrated(input = {}) {
  const home = normalizeOnMyAgentHome(input.homeDir ?? os.homedir());
  const mkdirFn = input.mkdir ?? mkdir;
  const readFileFn = input.readFile ?? readFile;
  const writeFileFn = input.writeFile ?? writeFile;
  const statFn = input.stat ?? stat;
  const now = input.now ?? (() => new Date());

  const configRoot = resolveLocalConfigRoot(home);
  const manifestPath = resolveLocalConfigManifestPath(home);
  const migrationStatus = await readMigrationStatusAsync(
    manifestPath,
    readFileFn,
  );

  if (migrationStatus === "complete") {
    return {
      ok: true,
      status: "complete",
      skipped: true,
      configRoot,
      copied: [],
    };
  }

  const copied = [];
  const fromPaths = [
    resolveLegacySkillsPath(home),
    resolveLegacyExpertsPath(home, "experts"),
    resolveLegacyExpertsPath(home, "my-experts"),
  ];

  try {
    await mkdirFn(configRoot, { recursive: true });
    await mkdirFn(path.join(configRoot, "memory"), { recursive: true });
    await mkdirFn(path.join(configRoot, "tools"), { recursive: true });
    await mkdirFn(resolveLocalSkillsProfilePath(home), { recursive: true });
    await mkdirFn(resolveLocalExpertsProfilePath(home, "experts"), {
      recursive: true,
    });
    await mkdirFn(resolveLocalExpertsProfilePath(home, "my-experts"), {
      recursive: true,
    });

    await writeFileFn(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          profile: "local",
          migration: {
            status: "pending",
            from: fromPaths,
            migratedAt: null,
            appVersion: input.appVersion ?? null,
          },
          contentVersion: 1,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const io = { cp: input.cp, mkdir: mkdirFn, stat: statFn };

    const skillsResult = await copyDirIfPresent(
      resolveLegacySkillsPath(home),
      resolveLocalSkillsProfilePath(home),
      io,
    );
    if (skillsResult.copied) copied.push("skills");

    const expertsResult = await copyDirIfPresent(
      resolveLegacyExpertsPath(home, "experts"),
      resolveLocalExpertsProfilePath(home, "experts"),
      io,
    );
    if (expertsResult.copied) copied.push("experts/installed");

    const mineResult = await copyDirIfPresent(
      resolveLegacyExpertsPath(home, "my-experts"),
      resolveLocalExpertsProfilePath(home, "my-experts"),
      io,
    );
    if (mineResult.copied) copied.push("experts/mine");

    const mcpPath = path.join(configRoot, "tools", "mcp.json");
    const gatewayPath = path.join(configRoot, "tools", "gateway.json");
    try {
      await statFn(mcpPath);
    } catch {
      await writeFileFn(mcpPath, "{}\n", "utf8");
    }
    try {
      await statFn(gatewayPath);
    } catch {
      await writeFileFn(gatewayPath, "{}\n", "utf8");
    }

    const completedAt = now().toISOString();
    await writeFileFn(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          profile: "local",
          migration: {
            status: "complete",
            from: fromPaths,
            migratedAt: completedAt,
            appVersion: input.appVersion ?? null,
            copied,
          },
          contentVersion: 1,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return {
      ok: true,
      status: "complete",
      skipped: false,
      configRoot,
      copied,
    };
  } catch (error) {
    try {
      await writeFileFn(
        manifestPath,
        `${JSON.stringify(
          {
            schemaVersion: CONFIG_SCHEMA_VERSION,
            profile: "local",
            migration: {
              status: "failed",
              error: String(error?.message ?? error),
              migratedAt: now().toISOString(),
              copied,
            },
            contentVersion: 1,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    } catch {
      // ignore secondary failure writing failed manifest
    }
    return {
      ok: false,
      status: "failed",
      skipped: false,
      configRoot,
      copied,
      error: String(error?.message ?? error),
    };
  }
}
