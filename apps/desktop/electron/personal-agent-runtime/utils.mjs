import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function createExecHelpers(options = {}) {
  const extraPathEntries = () => {
    if (typeof options.extraPathEntries === "function") return options.extraPathEntries();
    return Array.isArray(options.extraPathEntries) ? options.extraPathEntries : [];
  };
  function pathEntries() {
    const home = os.homedir();
    return [
      ...extraPathEntries(),
      process.env.PATH,
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      path.join(home, ".local", "bin"),
      path.join(home, ".opencode", "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, "Library", "pnpm"),
    ]
      .flatMap((entry) => String(entry ?? "").split(path.delimiter))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function processEnv(extra = {}) {
    const seen = new Set();
    const pathValue = pathEntries()
      .filter((entry) => {
        if (seen.has(entry)) return false;
        seen.add(entry);
        return true;
      })
      .join(path.delimiter);
    return { ...process.env, PATH: pathValue, Path: pathValue, path: pathValue, ...extra };
  }

  function runCommandCapture(command, args, options = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? processEnv(),
        shell: options.shell ?? false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeoutMs = Number(options.timeoutMs ?? 0);
      const timeout = timeoutMs > 0 ? setTimeout(() => child.kill("SIGTERM"), timeoutMs) : null;
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        if (timeout) clearTimeout(timeout);
        resolve({ ok: false, status: 1, stdout, stderr: stderr || error.message });
      });
      child.on("close", (code, signal) => {
        if (timeout) clearTimeout(timeout);
        resolve({
          ok: code === 0,
          status: typeof code === "number" ? code : 1,
          signal: signal ?? null,
          stdout,
          stderr,
        });
      });
    });
  }

  async function resolveCommandFromLoginShell(names) {
    if (!names.length || process.platform === "win32") return new Map();
    const safeNames = names.filter((name) => /^[A-Za-z0-9._-]+$/.test(name));
    if (!safeNames.length) return new Map();
    const script = safeNames.map((name) => `printf '${name}='; command -v ${name} 2>/dev/null || true`).join("; ");
    const result = await runCommandCapture(process.env.SHELL || "/bin/zsh", ["-lc", script], { timeoutMs: 4000 });
    const out = new Map();
    for (const line of result.stdout.split("\n")) {
      const [name, ...rest] = line.split("=");
      const value = rest.join("=").trim();
      if (name && value) out.set(name.trim(), value);
    }
    return out;
  }

  async function resolveExecutable(command) {
    const name = String(command ?? "").trim();
    if (!name || name.includes("/") || name.includes("\\")) return name;
    const shellResolved = await resolveCommandFromLoginShell([name]);
    const resolvedPath = shellResolved.get(name);
    if (resolvedPath) return resolvedPath;
    for (const entry of pathEntries()) {
      const candidate = path.join(entry, name);
      try {
        const info = await stat(candidate);
        if (info.isFile()) return candidate;
      } catch {
        // Continue probing fallback PATH entries.
      }
    }
    return name;
  }

  return { pathEntries, processEnv, runCommandCapture, resolveCommandFromLoginShell, resolveExecutable };
}

export function parseJsonLikeObject(raw) {
  const text = String(raw ?? "").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch {
    const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLineComments = withoutBlockComments.replace(/(^|[^:])\/\/.*$/gm, "$1");
    const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(withoutTrailingCommas);
    } catch {
      return null;
    }
  }
}

export async function readJsonLikeFile(targetPath) {
  try {
    return parseJsonLikeObject(await readFile(targetPath, "utf8"));
  } catch {
    return null;
  }
}

export async function writeJsonFile(targetPath, data) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  // Atomic write: tmp+rename so a crash mid-serialize cannot leave a partial
  // JSON file on disk that would break the next boot's parse.
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, targetPath);
}

export function uniqueModelOptions(options) {
  const seen = new Set();
  const output = [];
  for (const option of options) {
    const id = String(option?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({ id, label: String(option?.label ?? id).trim() || id });
  }
  return output;
}

export function modelLookupKey(id) {
  return String(id ?? "").trim().toLowerCase().replace(/[\s_.]+/g, "-");
}

export function reconcileModelOptions(preferredOptions, discoveredOptions) {
  const discoveredByKey = new Map();
  for (const option of discoveredOptions) discoveredByKey.set(modelLookupKey(option.id), option);
  const reconciled = preferredOptions.map((option) => discoveredByKey.get(modelLookupKey(option.id)) ?? option);
  return uniqueModelOptions([...reconciled, ...discoveredOptions]);
}

export function stableKey(provider, workspaceRoot, agentId = "default") {
  const hash = createHash("sha256").update(`${provider}\n${workspaceRoot}\n${agentId}`).digest("hex").slice(0, 16);
  return `onmyagent-personal-${provider}-${hash}`;
}

export function runId() {
  return `${Date.now()}-${randomBytes(6).toString("hex")}`;
}

export function stringifyAgentCommand(execPath, args) {
  return [execPath, ...args].map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

export function appendRunEvent(events, event) {
  events.push({ ...event, at: Date.now() });
}
