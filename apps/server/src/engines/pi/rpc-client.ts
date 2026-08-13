/**
 * Pi RPC process client — wraps `pi --mode rpc` (JSONL over stdio).
 *
 * Protocol (pi 0.84.x):
 *  - commands are JSON objects with a `type` field sent to stdin, one per line
 *  - responses are `{id?, type:"response", command, success, data?, error?}`
 *  - agent events stream to stdout as JSON lines (agent_*, message_*,
 *    tool_execution_*, …)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

export type PiRpcCommand =
  | { id?: number | string; type: "new_session"; parentSession?: string }
  | { id?: number | string; type: "switch_session"; sessionPath: string }
  | { id?: number | string; type: "prompt"; message: string; images?: unknown[]; streamingBehavior?: string }
  | { id?: number | string; type: "steer"; message: string }
  | { id?: number | string; type: "follow_up"; message: string }
  | { id?: number | string; type: "abort" }
  | { id?: number | string; type: "get_state" }
  | { id?: number | string; type: "get_messages" }
  | { id?: number | string; type: "get_entries"; since?: string }
  | { id?: number | string; type: "get_session_stats" }
  | { id?: number | string; type: "set_session_name"; name: string }
  | { id?: number | string; type: "set_model"; provider?: string; modelId?: string }
  | { id?: number | string; type: "get_available_models" }
  | { id?: number | string; type: "compact"; customInstructions?: string }
  | { id?: number | string; type: "bash"; command: string }
  | { id?: number | string; type: "abort_bash" }
  | { id?: number | string; type: "extension_ui_response"; requestId: string; confirmed?: boolean; value?: string };

export type PiExtensionUiRequest = {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: unknown;
  timeout?: number;
  [key: string]: unknown;
};

export type PiRpcResponse = {
  id?: number | string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

function isPiRpcResponse(value: Record<string, unknown>): value is PiRpcResponse & Record<string, unknown> {
  return value.type === "response" && typeof value.command === "string";
}

export interface PiRpcProcessOptions {
  bin: string;
  /** Node executable to run `bin` when it is a JS entry (bundled sidecar). */
  nodeBin?: string | null;
  sessionDir: string;
  cwd: string;
  name?: string;
  provider?: string;
  model?: string;
  extension?: string | null;
  env?: Record<string, string | undefined>;
  onEvent: (event: Record<string, unknown>) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class PiRpcProcess {
  private child: ChildProcess;
  private lines: ReturnType<typeof createInterface>;
  private nextId = 1;
  private pending = new Map<string, { resolve: (r: PiRpcResponse) => void; timer: NodeJS.Timeout }>();
  readonly sessionDir: string;
  readonly cwd: string;

  constructor(private readonly options: PiRpcProcessOptions) {
    this.sessionDir = options.sessionDir;
    this.cwd = options.cwd;
    const args = ["--mode", "rpc", "--session-dir", options.sessionDir];
    if (options.name) args.push("--name", options.name);
    if (options.provider) args.push("--provider", options.provider);
    if (options.model) args.push("--model", options.model);
    if (options.extension) args.push("--extension", options.extension);

    // Bundled sidecar: bin is dist/cli.js — run it through the pinned node.
    const command = options.nodeBin ? options.nodeBin : options.bin;
    const commandArgs = options.nodeBin ? [options.bin, ...args] : args;

    this.child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr?.on("data", () => {
      // pi RPC may log warnings to stderr; ignore for protocol purposes.
    });
    this.child.on("exit", (code, signal) => {
      this.failAll(`pi process exited (code=${code}, signal=${signal})`);
      options.onExit?.(code, signal);
    });

    this.lines = createInterface({ input: this.child.stdout! });
    this.lines.on("line", (line) => this.handleLine(line));
  }

  private handleLine(line: string) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    if (isPiRpcResponse(obj)) {
      this.resolveResponse(obj);
      return;
    }
    // Everything else is an agent event.
    this.options.onEvent(obj);
  }

  private resolveResponse(resp: PiRpcResponse) {
    const key = String(resp.id ?? "");
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.resolve(resp);
  }

  private failAll(message: string) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ type: "response", command: "process", success: false, error: message });
    }
    this.pending.clear();
  }

  send(command: PiRpcCommand, timeoutMs = 60_000): Promise<PiRpcResponse> {
    return new Promise((resolve) => {
      const id = command.id ?? this.nextId++;
      const key = String(id);
      const timer = setTimeout(() => {
        this.pending.delete(key);
        resolve({ type: "response", command: command.type, success: false, error: `pi RPC timeout after ${timeoutMs}ms` });
      }, timeoutMs);
      this.pending.set(key, { resolve, timer });
      const payload = { ...command, id };
      this.child.stdin!.write(JSON.stringify(payload) + "\n");
    });
  }

  /**
   * Reply to an extension UI dialog request (confirm/select/input/editor) emitted
   * by an injected extension in RPC mode. The extension's `ctx.ui.*` call blocks
   * until this response arrives; `confirmed:false` makes the approval extension
   * return `{block:true}` so the tool is not executed.
   */
  sendExtensionUiResponse(requestId: string, response: { confirmed?: boolean; value?: string; cancelled?: boolean }): void {
    const payload = {
      type: "extension_ui_response",
      id: String(requestId),
      ...response,
    };
    this.child.stdin!.write(JSON.stringify(payload) + "\n");
  }

  /** True when the process is still running. */
  isRunning(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  async stop(signal: NodeJS.Signals = "SIGTERM", graceMs = 2_000): Promise<void> {
    if (!this.isRunning()) return;
    this.child.kill(signal);
    await new Promise<void>((resolve) => {
      const done = () => {
        this.child.removeListener("exit", done);
        resolve();
      };
      this.child.once("exit", done);
      setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) {
          this.child.kill("SIGKILL");
        }
        done();
      }, graceMs);
    });
  }
}

export function resolvePiBinary(): string {
  const candidates = [
    process.env.ONMYAGENT_PI_BIN,
    process.env.PI_BIN,
  ].filter(Boolean) as string[];
  if (candidates.length > 0) return candidates[0];
  return "pi";
}

/**
 * Node executable used to run the bundled pi package (cli.js). When unset,
 * pi's shebang resolves node from PATH — fine for local installs, but the
 * product-bundled sidecar must pin the bundled Node runtime.
 */
export function resolvePiNodeBin(): string | null {
  return process.env.ONMYAGENT_PI_NODE_BIN?.trim() || null;
}
