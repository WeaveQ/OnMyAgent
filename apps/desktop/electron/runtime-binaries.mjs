/**
 * OpenCode / product-runtime / docker binary resolution.
 * Extracted from runtime.mjs (factory; re-used by createRuntimeManager).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  chooseOpencodeBinary,
  chooseProductRuntimeBinary,
} from "./opencode-binary-policy.mjs";
import {
  OPENCODE_BIN_ENV_KEYS,
  buildLocalOpencodeBinaryCandidates,
  collectDockerCandidatePaths,
  envForcedBinaryPath,
  parseManagedContainerNames,
  productRuntimeBinaryEnvKeys,
  productRuntimeBinaryNames,
  productRuntimeBinaryRelativePath,
  selectBestLocalOpencodeFromProbed,
  shouldSkipLocalOpencodeCandidate,
} from "./runtime-helpers.mjs";
import { binaryFileNames, enrichedPath } from "./runtime-path-env.mjs";

/**
 * @param {{
 *   app: { getPath: (name: string) => string },
 *   sidecarDirs: string[],
 *   runtimeRoot: string | null,
 *   runtimeBinDirs: string[],
 * }} deps
 */
export function createRuntimeBinaryResolver({
  app,
  sidecarDirs,
  runtimeRoot,
  runtimeBinDirs,
}) {
    function envForcedOpencodeBinaryPath() {
      return envForcedBinaryPath(process.env, OPENCODE_BIN_ENV_KEYS, existsSync);
    }

    function localOpencodeBinaryCandidates() {
      return buildLocalOpencodeBinaryCandidates({
        platform: process.platform,
        homeDir: app.getPath("home"),
        pathEnv: enrichedPath([], process.env.PATH) ?? "",
        env: process.env,
      });
    }

    /**
     * Scan machine-local OpenCode installs and pick the newest one that meets
     * the bundled pin. Avoids PATH order traps (e.g. stale /usr/local 1.14.x
     * before Homebrew 1.17.x) that reintroduce plugin hook failures.
     */
    function findBestLocalOpencodeBinary(bundledPath, bundledVersion) {
      const bundledResolved = bundledPath ? path.resolve(bundledPath) : null;
      const probed = [];
      for (const candidate of localOpencodeBinaryCandidates()) {
        if (!existsSync(candidate)) continue;
        if (shouldSkipLocalOpencodeCandidate(candidate, bundledResolved)) continue;
        probed.push({ path: candidate, version: probeVersion(candidate) });
      }
      return selectBestLocalOpencodeFromProbed(probed, bundledVersion);
    }

    /**
     * Resolve OpenCode with product-owned version gate:
     * bundled by default; local only when a compatible version is found.
     */
    function resolveOpencodeBinaryDecision(opencodeBinPath) {
      const explicitPath = typeof opencodeBinPath === "string" ? opencodeBinPath.trim() : "";
      const envForcedPath = explicitPath ? null : envForcedOpencodeBinaryPath();
      const bundled = resolveBundledBinaryInfo("opencode");
      const bundledVersion = bundled?.path ? probeVersion(bundled.path) : null;

      let localPath = null;
      let localVersion = null;
      if (!explicitPath && !envForcedPath) {
        const { bestCompatible, firstExisting } = findBestLocalOpencodeBinary(
          bundled?.path ?? null,
          bundledVersion,
        );
        if (bestCompatible) {
          localPath = bestCompatible.path;
          localVersion = bestCompatible.version;
        } else if (firstExisting) {
          // Feed an incompatible/unknown local into the policy so notices fire.
          localPath = firstExisting.path;
          localVersion = firstExisting.version;
        }
      } else if (envForcedPath) {
        localVersion = probeVersion(envForcedPath);
      }

      const decision = chooseOpencodeBinary({
        explicitPath: explicitPath || null,
        envForcedPath,
        localPath,
        localVersion,
        bundledPath: bundled?.path ?? null,
        bundledVersion,
      });

      if (decision.notice) {
        console.warn(`[runtime] OpenCode binary policy: ${decision.notice}`);
      } else if (decision.path) {
        console.info(
          `[runtime] OpenCode binary policy: using ${decision.source} (${decision.reason}) -> ${decision.path}`,
        );
      }

      if (!decision.path) return null;
      return {
        path: decision.path,
        source: decision.source,
        reason: decision.reason,
        notice: decision.notice,
        localVersion: decision.localVersion,
        bundledVersion: decision.bundledVersion,
      };
    }

    function resolveBinaryInfo(baseName, extraPaths = []) {
      if (baseName === "opencode") {
        return resolveOpencodeBinaryDecision(null);
      }

      for (const directory of [...sidecarDirs, ...extraPaths]) {
        for (const fileName of binaryFileNames(baseName)) {
          const candidate = path.join(directory, fileName);
          if (existsSync(candidate)) {
            return { path: candidate, source: "bundled" };
          }
        }
      }

      const pathEntries = (enrichedPath([], process.env.PATH) ?? "")
        .split(path.delimiter)
        .filter(Boolean);
      for (const entry of pathEntries) {
        for (const fileName of binaryFileNames(baseName)) {
          const candidate = path.join(entry, fileName);
          if (existsSync(candidate)) {
            return { path: candidate, source: "path" };
          }
        }
      }

      return null;
    }

    function resolveBundledBinaryInfo(baseName) {
      for (const directory of sidecarDirs) {
        for (const fileName of binaryFileNames(baseName)) {
          const candidate = path.join(directory, fileName);
          if (existsSync(candidate)) {
            return { path: candidate, source: "bundled" };
          }
        }
      }
      return null;
    }

    function bundledRuntimeBinary(tool) {
      if (!runtimeRoot) return null;
      const relative = productRuntimeBinaryRelativePath(tool, process.platform);
      return relative ? path.join(runtimeRoot, relative) : null;
    }

    function envForcedRuntimeBinaryPath(tool) {
      return envForcedBinaryPath(process.env, productRuntimeBinaryEnvKeys(tool), existsSync);
    }

    function findPathRuntimeBinary(tool) {
      const names = productRuntimeBinaryNames(tool, process.platform);
      // Search the original process PATH without our runtimeBinDirs prepend so
      // we can tell "true machine local" from product-bundled copies.
      const rawPath = process.env.PATH ?? process.env.Path ?? process.env.path ?? "";
      const pathEntries = rawPath.split(path.delimiter).filter(Boolean);
      const bundledDirs = new Set(runtimeBinDirs.map((dir) => path.resolve(dir)));
      for (const entry of pathEntries) {
        if (bundledDirs.has(path.resolve(entry))) continue;
        for (const name of names) {
          const candidate = path.join(entry, name);
          if (existsSync(candidate)) return candidate;
        }
      }
      return null;
    }

    /**
     * Product-owned Node / Python: bundled wins whenever present.
     */
    function resolveProductRuntimeBinaryDecision(tool) {
      const toolLabel = tool === "node" ? "Node" : tool === "python" ? "Python" : tool;
      const bundledPath = bundledRuntimeBinary(tool);
      const bundledExists = bundledPath && existsSync(bundledPath) ? bundledPath : null;
      const envForcedPath = envForcedRuntimeBinaryPath(tool);
      const localPath = envForcedPath || bundledExists ? null : findPathRuntimeBinary(tool);

      const decision = chooseProductRuntimeBinary({
        toolLabel,
        envForcedPath,
        localPath,
        bundledPath: bundledExists,
        bundledVersion: bundledExists ? probeVersion(bundledExists) : null,
        localVersion: localPath || envForcedPath ? probeVersion(localPath ?? envForcedPath) : null,
      });

      if (decision.notice) {
        console.warn(`[runtime] ${toolLabel} binary policy: ${decision.notice}`);
      }

      if (!decision.path) return null;
      return {
        path: decision.path,
        source: decision.source,
        reason: decision.reason,
        notice: decision.notice,
        localVersion: decision.localVersion,
        bundledVersion: decision.bundledVersion,
      };
    }

    function probeVersion(binary) {
      if (!binary || !existsSync(binary)) return null;
      const result = spawnSync(binary, ["--version"], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (result.status !== 0) return null;
      return String(result.stdout || result.stderr || "").trim() || null;
    }

    function resolveBinary(baseName, extraPaths = []) {
      return resolveBinaryInfo(baseName, extraPaths)?.path ?? null;
    }

    function resolveOpencodeBinary(opencodeBinPath) {
      return resolveOpencodeBinaryDecision(opencodeBinPath);
    }

    function resolveDockerCandidates() {
      return collectDockerCandidatePaths({
        platform: process.platform,
        env: process.env,
      }).filter((candidate) => existsSync(candidate));
    }

    function runDockerCommandDetailed(args, timeoutMs = 8000) {
      const tried = [...resolveDockerCandidates(), process.platform === "win32" ? "docker.exe" : "docker"];
      const errors = [];

      for (const program of tried) {
        try {
          const result = spawnSync(program, args, {
            encoding: "utf8",
            timeout: timeoutMs,
            windowsHide: true,
          });
          return {
            program,
            status: typeof result.status === "number" ? result.status : -1,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
          };
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      throw new Error(
        `Failed to run docker: ${errors.join("; ")} (Set ONMYAGENT_DOCKER_BIN to your docker binary if needed)`,
      );
    }

    async function listOnMyAgentManagedContainers() {
      const result = runDockerCommandDetailed(["ps", "-a", "--format", "{{.Names}}"], 8000);
      if (result.status !== 0) {
        const combined = `${result.stdout.trim()}\n${result.stderr.trim()}`.trim();
        throw new Error(combined || `docker ps -a failed (status ${result.status})`);
      }
      return parseManagedContainerNames(result.stdout);
    }

    async function runShellCommand(program, args, options = {}) {
      const result = spawnSync(program, args, {
        encoding: "utf8",
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        timeout: options.timeoutMs,
      });
      return {
        status: typeof result.status === "number" ? result.status : -1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    }

  return {
    envForcedOpencodeBinaryPath,
    localOpencodeBinaryCandidates,
    findBestLocalOpencodeBinary,
    resolveOpencodeBinaryDecision,
    resolveBinaryInfo,
    resolveBundledBinaryInfo,
    bundledRuntimeBinary,
    envForcedRuntimeBinaryPath,
    findPathRuntimeBinary,
    resolveProductRuntimeBinaryDecision,
    probeVersion,
    resolveBinary,
    resolveOpencodeBinary,
    resolveDockerCandidates,
    runDockerCommandDetailed,
    listOnMyAgentManagedContainers,
    runShellCommand,
  };
}
