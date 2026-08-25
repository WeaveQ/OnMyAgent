import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { ApiError } from "../core/errors.js";
import { GrokAcpTransport } from "./grok-acp-transport.js";
import { assertGrokRuntimeVersion } from "./grok-version-policy.js";

export type GrokProcessKey = {
  profileId: string;
  workspaceRoot: string;
  sandboxProfile?: string;
};

export type GrokProcessPolicy = {
  binaryPath: string;
  runtimeHome: string;
  sandboxProfile?: string;
  environment?: Readonly<Record<string, string>>;
  expectedVersion?: string;
};

export type GrokProcessHandle = {
  transport: GrokAcpTransport;
  initialized: unknown;
  isAlive: () => boolean;
  stop: () => Promise<void>;
};

export type GrokProcessDiagnostic = {
  type: "stderr" | "exit";
  bytes?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

type SpawnProcess = (input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => ChildProcessWithoutNullStreams;

export class GrokProcessSupervisor {
  readonly #inflight = new Map<string, Promise<GrokProcessHandle>>();
  readonly #active = new Map<string, GrokProcessHandle>();
  readonly #children = new Set<ChildProcessWithoutNullStreams>();
  readonly #spawn: SpawnProcess;
  readonly #onRequest: (method: string, params: unknown) => Promise<unknown>;
  readonly #onNotification: (method: string, params: unknown) => void;
  readonly #onDiagnostic: (diagnostic: GrokProcessDiagnostic) => void;
  #draining = false;

  constructor(input: {
    spawnProcess?: SpawnProcess;
    onRequest: (method: string, params: unknown) => Promise<unknown>;
    onNotification?: (method: string, params: unknown) => void;
    onDiagnostic?: (diagnostic: GrokProcessDiagnostic) => void;
  }) {
    this.#spawn = input.spawnProcess ?? defaultSpawn;
    this.#onRequest = input.onRequest;
    this.#onNotification = input.onNotification ?? (() => undefined);
    this.#onDiagnostic = input.onDiagnostic ?? (() => undefined);
  }

  get draining(): boolean {
    return this.#draining;
  }

  beginDrain(): void {
    this.#draining = true;
  }

  start(key: GrokProcessKey, policy: GrokProcessPolicy): Promise<GrokProcessHandle> {
    const id = processKey(key);
    const active = this.#active.get(id);
    if (active?.isAlive()) return Promise.resolve(active);
    if (active) this.#active.delete(id);
    if (this.#draining) return Promise.reject(grokRuntimeDraining());
    const pending = this.#inflight.get(id);
    if (pending) return pending;
    const start = this.#start(key, policy, () => this.#active.delete(id)).then(async (handle) => {
      if (this.#draining) {
        await handle.stop();
        throw grokRuntimeDraining();
      }
      this.#active.set(id, handle);
      return handle;
    }).finally(() => this.#inflight.delete(id));
    this.#inflight.set(id, start);
    if (this.#draining) {
      return start.then(async (handle) => {
        await handle.stop();
        throw grokRuntimeDraining();
      });
    }
    return start;
  }

  async stopAll(): Promise<void> {
    this.beginDrain();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (this.#children.size === 0 && this.#inflight.size === 0 && this.#active.size === 0) {
        return;
      }
      const startingChildren = [...this.#children];
      await Promise.all(startingChildren.map((child) => terminateProcessTree(child, 0)));
      const pending = await Promise.allSettled(this.#inflight.values());
      const handles = new Set(this.#active.values());
      for (const item of pending) if (item.status === "fulfilled") handles.add(item.value);
      await Promise.all([...handles].map((handle) => handle.stop()));
      this.#active.clear();
    }
    const counts = {
      children: this.#children.size,
      inflight: this.#inflight.size,
      active: this.#active.size,
    };
    if (counts.children || counts.inflight || counts.active) {
      throw grokRuntimeDraining(counts);
    }
  }

  async #start(key: GrokProcessKey, policy: GrokProcessPolicy, onClosed: () => void): Promise<GrokProcessHandle> {
    if (this.#draining) throw grokRuntimeDraining();
    const command = requireValue(policy.binaryPath, "binaryPath");
    const cwd = requireValue(key.workspaceRoot, "workspaceRoot");
    const args = ["--no-auto-update", "--permission-mode", "default", "agent"];
    args.push("--no-leader", "stdio");
    const child = this.#spawn({
      command,
      args,
      cwd,
      env: {
        ...policy.environment,
        GROK_HOME: requireValue(policy.runtimeHome, "runtimeHome"),
        GROK_DISABLE_AUTOUPDATER: "1",
      },
    });
    this.#children.add(child);
    if (this.#draining) {
      await terminateProcessTree(child, 0);
      throw grokRuntimeDraining();
    }
    const transport = new GrokAcpTransport({
      child,
      onRequest: this.#onRequest,
      onNotification: this.#onNotification,
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.#onDiagnostic({ type: "stderr", bytes: Buffer.byteLength(chunk) });
    });
    child.once("exit", (exitCode, signal) => {
      this.#onDiagnostic({ type: "exit", exitCode, signal });
    });
    child.once("close", () => {
      this.#children.delete(child);
      onClosed();
    });
    try {
      const initialized = await transport.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "onmyagent-primary-runtime", version: "0.1.0" },
        clientCapabilities: {},
      }, 30_000);
      assertGrokRuntimeVersion({
        expectedVersion: policy.expectedVersion,
        initialized,
      });
      let stopped = false;
      return {
        transport,
        initialized,
        isAlive: () => child.exitCode === null && child.signalCode === null,
        async stop() {
          if (stopped) return;
          stopped = true;
          transport.dispose();
          await terminateProcessTree(child);
        },
      };
    } catch (error) {
      transport.dispose();
      await terminateProcessTree(child, 0);
      throw error;
    }
  }
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams, graceMs = 1_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    if (pid) {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      await once(killer, "close").catch(() => undefined);
    }
    return;
  }
  const signal = (value: NodeJS.Signals) => {
    try { if (pid) process.kill(-pid, value); else child.kill(value); }
    catch { try { child.kill(value); } catch { /* already exited */ } }
  };
  signal("SIGTERM");
  if (graceMs > 0 && child.exitCode === null && child.signalCode === null) {
    await Promise.race([
      once(child, "exit").catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, graceMs)),
    ]);
  }
  if (child.exitCode === null && child.signalCode === null) signal("SIGKILL");
}

function defaultSpawn(input: Parameters<SpawnProcess>[0]): ChildProcessWithoutNullStreams {
  return spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
}

function grokRuntimeDraining(details?: { children: number; inflight: number; active: number }): ApiError {
  return new ApiError(
    503,
    "grok_runtime_draining",
    "Grok runtime is shutting down",
    details,
  );
}

function processKey(key: GrokProcessKey): string {
  return JSON.stringify([requireValue(key.profileId, "profileId"), requireValue(key.workspaceRoot, "workspaceRoot"), key.sandboxProfile?.trim() ?? ""]);
}

function requireValue(value: string, label: string): string {
  const resolved = value.trim();
  if (!resolved) throw new ApiError(400, "invalid_payload", `${label} is required`);
  return resolved;
}
