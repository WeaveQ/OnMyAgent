import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { spawnProcess } from "./runtime-services.js";

export type ResolvedSandboxMode = "none" | "docker" | "container";

export async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readPathHelperPaths(): Promise<string[]> {
  if (process.platform !== "darwin") return [];
  return await new Promise((resolve) => {
    const child = spawnProcess("/usr/libexec/path_helper", ["-s"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve([]));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      const match =
        stdout.match(/PATH="([^"]+)"/) ?? stdout.match(/PATH=([^;\n]+)/);
      if (!match) {
        resolve([]);
        return;
      }
      resolve(match[1].split(":").filter(Boolean));
    });
  });
}

export async function resolveDockerCandidates(): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  for (const key of [
    "ONMYAGENT_DOCKER_BIN",
    "OPENWRK_DOCKER_BIN",
    "DOCKER_BIN",
  ]) {
    const value = process.env[key];
    if (value) push(value);
  }

  const addFromPath = (value?: string | null) => {
    if (!value) return;
    for (const dir of value.split(delimiter)) {
      if (!dir.trim()) continue;
      push(join(dir, "docker"));
    }
  };

  addFromPath(process.env.PATH ?? "");

  if (process.platform === "darwin") {
    const helperPaths = await readPathHelperPaths();
    for (const dir of helperPaths) {
      push(join(dir, "docker"));
    }
  }

  for (const raw of [
    "/opt/homebrew/bin/docker",
    "/usr/local/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ]) {
    push(raw);
  }

  const valid: string[] = [];
  for (const candidate of out) {
    if (await isExecutable(candidate)) {
      valid.push(candidate);
    }
  }
  return valid;
}

export async function resolveDockerCommand(): Promise<string> {
  const candidates = await resolveDockerCandidates();
  return candidates[0] ?? "docker";
}

export async function probeCommand(
  command: string,
  args: string[],
  timeoutMs = 2500,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawnProcess(command, args, {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve(false);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

export async function resolveSandboxMode(
  mode: "none" | "auto" | "docker" | "container",
): Promise<ResolvedSandboxMode> {
  if (mode === "none") return "none";
  if (mode === "docker") return "docker";
  if (mode === "container") return "container";
  if (process.platform === "darwin" && process.arch === "arm64") {
    const containerOk = await probeCommand("container", ["--version"]);
    if (containerOk) return "container";
  }
  const dockerCommand = await resolveDockerCommand();
  const dockerOk = await probeCommand(dockerCommand, ["version"]);
  if (dockerOk) return "docker";
  const containerOk = await probeCommand("container", ["--version"]);
  if (containerOk) return "container";
  return "none";
}

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function addEnvPassThroughArgs(args: string[], names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value === undefined) continue;
    args.push("-e", `${name}=${value}`);
  }
}

export function sandboxEnvPassThroughNames(userEnv: Record<string, string>): string[] {
  const names = new Set(Object.keys(userEnv));
  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
    names.add(name);
  }
  return [...names].sort();
}

export async function stopDockerContainer(
  name: string,
  dockerCommand: string,
): Promise<void> {
  if (!name.trim()) return;
  await new Promise<void>((resolve) => {
    const child = spawnProcess(dockerCommand, ["stop", name], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

export async function stopAppleContainer(name: string): Promise<void> {
  if (!name.trim()) return;
  await new Promise<void>((resolve) => {
    const child = spawnProcess("container", ["stop", name], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

export async function runQuiet(
  command: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<void> {
  const child = spawnProcess(command, args, {
    stdio: ["ignore", "ignore", "ignore"],
  });
  type QuietResult =
    | { type: "exit"; code: number | null }
    | { type: "error"; error: unknown }
    | { type: "timeout" };

  const result = await Promise.race<QuietResult>([
    new Promise<QuietResult>((resolve) =>
      child.on("exit", (code) => resolve({ type: "exit", code })),
    ),
    new Promise<QuietResult>((resolve) =>
      child.on("error", (error) => resolve({ type: "error", error })),
    ),
    new Promise<QuietResult>((resolve) =>
      setTimeout(resolve, timeoutMs, { type: "timeout" as const }),
    ),
  ]);
  if (result.type === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    throw new Error(`Command timed out: ${command} ${args.join(" ")}`);
  }
  if (result.type === "error") {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}: ${String(result.error)}`,
    );
  }
  if (result.code !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

export async function ensureAppleContainerSystemReady(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Apple container backend is only supported on macOS");
  }
  if (process.arch !== "arm64") {
    throw new Error("Apple container backend requires Apple silicon (arm64)");
  }
  if (!(await probeCommand("container", ["--version"]))) {
    throw new Error(
      "Apple container CLI not found. Install https://github.com/apple/container",
    );
  }
  try {
    await runQuiet("container", ["system", "start"], 90_000);
  } catch {
    // ignore
  }
}
