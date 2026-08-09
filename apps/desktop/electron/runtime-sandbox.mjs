import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  findFreePort,
  waitForHttpOk,
} from "./runtime-path-env.mjs";
import { nowMs } from "./runtime-engine-state.mjs";
import { truncateOutput } from "./runtime-opencode-lifecycle.mjs";
import {
  collectDockerCandidatePaths,
  deriveOrchestratorContainerName,
  interpretDockerInfoFailure,
  parseDockerClientVersion,
  parseDockerServerVersion,
  parseManagedContainerNames,
  validateStoppableSandboxContainerName,
} from "./runtime-helpers.mjs";
import { existsSync } from "node:fs";

/**
 * Docker / sandbox operations for the desktop runtime manager. These are pure
 * with respect to the runtime closure: every collaborator they need (binary
 * resolution, child env, host-token issuance) is passed in explicitly.
 *
 * @param {object} deps
 * @param {(baseName: string, extraPaths?: string[]) => string | null} deps.resolveBinary
 * @param {(extra?: object, options?: object) => Promise<NodeJS.ProcessEnv>} deps.resolveChildEnvironment
 * @param {(baseUrl: string, hostToken: string) => Promise<string | null>} deps.issueOwnerToken
 */
export function createRuntimeSandbox({ resolveBinary, resolveChildEnvironment, issueOwnerToken }) {
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

  async function sandboxDoctor() {
    const candidates = resolveDockerCandidates();
    const debug = {
      candidates,
      selectedBin: null,
      versionCommand: null,
      infoCommand: null,
    };

    let version;
    try {
      version = runDockerCommandDetailed(["--version"], 2000);
    } catch (error) {
      return {
        installed: false,
        daemonRunning: false,
        permissionOk: false,
        ready: false,
        clientVersion: null,
        serverVersion: null,
        error: error instanceof Error ? error.message : String(error),
        debug,
      };
    }

    debug.selectedBin = version.program;
    debug.versionCommand = {
      status: version.status,
      stdout: truncateOutput(version.stdout, 1200),
      stderr: truncateOutput(version.stderr, 1200),
    };

    const clientVersion = parseDockerClientVersion(version.stdout);
    if (version.status !== 0) {
      return {
        installed: false,
        daemonRunning: false,
        permissionOk: false,
        ready: false,
        clientVersion: null,
        serverVersion: null,
        error: `docker --version failed (status ${version.status}): ${version.stderr.trim()}`,
        debug,
      };
    }

    let info;
    try {
      info = runDockerCommandDetailed(["info"], 8000);
    } catch (error) {
      return {
        installed: true,
        daemonRunning: false,
        permissionOk: false,
        ready: false,
        clientVersion,
        serverVersion: null,
        error: error instanceof Error ? error.message : String(error),
        debug,
      };
    }

    debug.infoCommand = {
      status: info.status,
      stdout: truncateOutput(info.stdout, 1200),
      stderr: truncateOutput(info.stderr, 1200),
    };

    if (info.status === 0) {
      return {
        installed: true,
        daemonRunning: true,
        permissionOk: true,
        ready: true,
        clientVersion,
        serverVersion: parseDockerServerVersion(info.stdout),
        error: null,
        debug,
      };
    }

    const errorText = `${info.stdout.trim()}\n${info.stderr.trim()}`.trim();
    const { permissionOk, daemonRunning } = interpretDockerInfoFailure(errorText);

    return {
      installed: true,
      daemonRunning,
      permissionOk,
      ready: false,
      clientVersion,
      serverVersion: null,
      error: errorText || `docker info failed (status ${info.status})`,
      debug,
    };
  }

  async function sandboxStop(containerName) {
    const validated = validateStoppableSandboxContainerName(containerName);
    if (validated.ok !== true) throw new Error(validated.error);
    const name = validated.name;
    const result = runDockerCommandDetailed(["stop", name], 15_000);
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async function sandboxCleanupOnMyAgentContainers() {
    const candidates = await listOnMyAgentManagedContainers().catch((error) => {
      throw error;
    });
    const removed = [];
    const errors = [];

    for (const name of candidates) {
      try {
        const result = runDockerCommandDetailed(["rm", "-f", name], 20_000);
        if (result.status === 0) {
          removed.push(name);
        } else {
          errors.push(`${name}: exit ${result.status}: ${(result.stdout + "\n" + result.stderr).trim()}`);
        }
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { candidates, removed, errors };
  }

  async function orchestratorStartDetached(options = {}) {
    const workspacePath = String(options.workspacePath ?? "").trim();
    if (!workspacePath) {
      throw new Error("workspacePath is required");
    }

    const sandboxBackend = String(options.sandboxBackend ?? "none").trim().toLowerCase();
    if (!["none", "docker", "microsandbox"].includes(sandboxBackend)) {
      throw new Error("sandboxBackend must be one of: none, docker, microsandbox");
    }

    const wantsDockerSandbox = sandboxBackend === "docker" || sandboxBackend === "microsandbox";
    const runId = String(options.runId ?? randomUUID()).trim();
    const containerName = wantsDockerSandbox ? deriveOrchestratorContainerName(runId) : null;
    const port = await findFreePort("127.0.0.1");
    const token = String(options.onmyagentToken ?? randomUUID()).trim();
    const hostToken = String(options.onmyagentHostToken ?? randomUUID()).trim();
    const onmyagentUrl = `http://127.0.0.1:${port}`;
    const program = resolveBinary("onmyagent-orchestrator") ?? resolveBinary("onmyagent");
    if (!program) {
      throw new Error("Failed to locate onmyagent orchestrator.");
    }

    const args = [
      "start",
      "--workspace",
      workspacePath,
      "--approval",
      "auto",
      "--detach",
      "--onmyagent-port",
      String(port),
      "--run-id",
      runId,
      ...(wantsDockerSandbox ? ["--sandbox", "docker"] : []),
      ...(options.sandboxImageRef ? ["--sandbox-image", String(options.sandboxImageRef)] : []),
    ];

    const child = spawn(program, args, {
      env: {
        ...(await resolveChildEnvironment()),
        ONMYAGENT_TOKEN: token,
        ONMYAGENT_HOST_TOKEN: hostToken,
      },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    await waitForHttpOk(`${onmyagentUrl}/health`, wantsDockerSandbox ? 90_000 : 12_000);
    const ownerToken = await issueOwnerToken(onmyagentUrl, hostToken).catch(() => null);

    return {
      onmyagentUrl,
      token,
      ownerToken,
      hostToken,
      port,
      sandboxBackend: wantsDockerSandbox ? sandboxBackend : null,
      sandboxRunId: wantsDockerSandbox ? runId : null,
      sandboxContainerName: containerName,
    };
  }

  async function sandboxDebugProbe() {
    const startedAt = nowMs();
    const runId = `probe-${randomUUID()}`;
    const workspacePath = path.join(os.tmpdir(), `onmyagent-sandbox-probe-${randomUUID()}`);
    await mkdir(workspacePath, { recursive: true });

    const doctor = await sandboxDoctor();
    let detachedHost = null;
    let dockerInspect = null;
    let dockerLogs = null;
    let error = null;
    const cleanupErrors = [];
    let containerRemoved = false;
    let workspaceRemoved = false;
    let removeResult = null;

    if (doctor.ready) {
      try {
        detachedHost = await orchestratorStartDetached({
          workspacePath,
          sandboxBackend: "docker",
          runId,
        });
        const containerName = detachedHost.sandboxContainerName ?? deriveOrchestratorContainerName(runId);
        try {
          const inspectResult = runDockerCommandDetailed(["inspect", containerName], 6000);
          dockerInspect = {
            status: inspectResult.status,
            stdout: truncateOutput(inspectResult.stdout, 48000),
            stderr: truncateOutput(inspectResult.stderr, 48000),
          };
        } catch (inspectError) {
          cleanupErrors.push(`docker inspect failed: ${inspectError instanceof Error ? inspectError.message : String(inspectError)}`);
        }
        try {
          const logsResult = runDockerCommandDetailed(["logs", "--timestamps", "--tail", "400", containerName], 8000);
          dockerLogs = {
            status: logsResult.status,
            stdout: truncateOutput(logsResult.stdout, 48000),
            stderr: truncateOutput(logsResult.stderr, 48000),
          };
        } catch (logsError) {
          cleanupErrors.push(`docker logs failed: ${logsError instanceof Error ? logsError.message : String(logsError)}`);
        }

        try {
          const rmResult = runDockerCommandDetailed(["rm", "-f", containerName], 20_000);
          containerRemoved = rmResult.status === 0;
          removeResult = {
            status: rmResult.status,
            stdout: truncateOutput(rmResult.stdout, 48000),
            stderr: truncateOutput(rmResult.stderr, 48000),
          };
        } catch (removeError) {
          cleanupErrors.push(`docker rm -f ${containerName} failed: ${removeError instanceof Error ? removeError.message : String(removeError)}`);
        }
      } catch (probeError) {
        error = `Sandbox probe failed to start: ${probeError instanceof Error ? probeError.message : String(probeError)}`;
      }
    } else {
      error = doctor.error ?? "Docker is not ready for sandbox creation";
    }

    try {
      await rm(workspacePath, { recursive: true, force: true });
      workspaceRemoved = true;
    } catch (workspaceError) {
      cleanupErrors.push(`Failed to remove probe workspace: ${workspaceError instanceof Error ? workspaceError.message : String(workspaceError)}`);
    }

    return {
      startedAt,
      finishedAt: nowMs(),
      runId,
      workspacePath,
      ready: doctor.ready && !error,
      doctor,
      detachedHost,
      dockerInspect,
      dockerLogs,
      cleanup: {
        containerName: detachedHost?.sandboxContainerName ?? null,
        containerRemoved,
        removeResult,
        workspaceRemoved,
        errors: cleanupErrors,
      },
      error,
    };
  }

  return {
    sandboxDoctor,
    sandboxStop,
    sandboxCleanupOnMyAgentContainers,
    orchestratorStartDetached,
    sandboxDebugProbe,
  };
}
