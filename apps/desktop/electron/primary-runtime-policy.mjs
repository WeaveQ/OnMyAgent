import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

/** Resolve the native OpenCode data directory from the exact child environment. */
export function resolveDesktopOpencodeRuntimeHome(env, options = {}) {
  const xdgDataHome = String(env.XDG_DATA_HOME ?? "").trim();
  if (xdgDataHome) return path.join(xdgDataHome, "opencode");

  const homeDir = String(options.homeDir ?? os.homedir()).trim();
  if (homeDir) return path.join(homeDir, ".local", "share", "opencode");
  throw new Error("Managed OpenCode runtime data root is unavailable");
}

/** Keep isolated desktop and real-home OpenCode profiles distinct. */
export function resolveDesktopOpencodeRuntimeIdentity(env, options = {}) {
  const runtimeHome = resolveDesktopOpencodeRuntimeHome(env, options);
  if (String(env.ONMYAGENT_OPENCODE_USE_REAL_HOME ?? "").trim() === "1") {
    return { profileId: "desktop-system", runtimeHome };
  }
  return {
    profileId: "desktop-managed",
    runtimeHome,
    sandboxProfile: "desktop-managed",
  };
}

/**
 * Primary Grok uses the user's system profile by default so switching runtimes
 * never makes their login or model catalog appear to disappear.
 */
export function resolveDesktopGrokRuntimePolicy(binary, env, options = {}) {
  const binaryPath = String(binary?.path ?? "").trim();
  if (!binaryPath) return null;
  const versionMatch = String(binary?.version ?? "").match(
    /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$|\()/u,
  );
  const expectedVersion = versionMatch?.[1] ?? null;
  if (!expectedVersion || !["1.0.0", "1.0.1", "1.0.3"].includes(expectedVersion)) {
    return null;
  }
  const homeDir = String(options.homeDir ?? os.homedir()).trim();
  if (!homeDir) return null;
  const allowedKeys = new Set([
    "PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec",
    "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE",
    "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
    "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
    "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  ]);
  const environment = resolveDesktopGrokProxyEnvironment(
    Object.fromEntries(
      Object.entries(env).filter(
        ([key, value]) => allowedKeys.has(key) && typeof value === "string",
      ),
    ),
    { scutilOutput: options.scutilOutput },
  );
  const managedEnvironment = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !["XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"].includes(key),
    ),
  );
  return buildGrokRuntimePolicy({
    binaryPath,
    expectedVersion,
    homeDir,
    managedHome: String(options.userDataDir ?? "").trim(),
    bundledBinary: supportedBundledBinary(options.bundledBinary),
    environment,
    managedEnvironment,
    env,
  });
}

function supportedBundledBinary(binary) {
  return binary?.path && ["1.0.0", "1.0.1", "1.0.3"].includes(binary.version)
    ? binary
    : null;
}

function buildGrokRuntimePolicy(input) {
  const profiles = {
    ...(input.managedHome
      ? {
          managed: {
            binaryPath: input.binaryPath,
            expectedVersion: input.expectedVersion,
            runtimeHome: path.join(input.managedHome, "runtime-state", "grok"),
            sandboxProfile: "desktop-managed",
            environment: input.managedEnvironment,
          },
        }
      : {}),
    ...(input.bundledBinary
      ? {
          "system-bundled": {
            binaryPath: input.bundledBinary.path,
            expectedVersion: input.bundledBinary.version,
            runtimeHome: path.join(input.homeDir, ".grok"),
            environment: input.environment,
          },
          ...(input.managedHome
            ? {
                "managed-bundled": {
                  binaryPath: input.bundledBinary.path,
                  expectedVersion: input.bundledBinary.version,
                  runtimeHome: path.join(input.managedHome, "runtime-state", "grok"),
                  sandboxProfile: "desktop-managed",
                  environment: input.managedEnvironment,
                },
              }
            : {}),
        }
      : {}),
  };
  return {
    profileId: "system",
    binaryPath: input.binaryPath,
    expectedVersion: input.expectedVersion,
    runtimeHome: path.join(input.homeDir, ".grok"),
    environment: input.environment,
    ...(Object.keys(profiles).length ? { profiles } : {}),
    rollout: {
      // Grok is the shipped primary runtime when an audited binary exists;
      // operators retain an explicit env opt-out and kill switch for rollout.
      newSessionsEnabled:
        String(input.env.ONMYAGENT_GROK_PRIMARY_ENABLED ?? "1").trim() !== "0"
        && String(input.env.ONMYAGENT_GROK_PRIMARY_KILL_SWITCH ?? "").trim() !== "1",
      workspaceAllowlist: [...new Set(
        String(input.env.ONMYAGENT_GROK_PRIMARY_WORKSPACE_ALLOWLIST ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      )],
    },
  };
}

export function resolveDesktopGrokProxyEnvironment(env, options = {}) {
  const current = { ...env };
  if (
    current.HTTPS_PROXY
    || current.https_proxy
    || current.HTTP_PROXY
    || current.http_proxy
    || current.ALL_PROXY
    || current.all_proxy
  ) return current;
  if ((options.platform ?? process.platform) !== "darwin") return current;
  const output = options.scutilOutput ?? readMacProxySettings();
  const values = Object.fromEntries(
    [...String(output).matchAll(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/gm)]
      .map((match) => [match[1], match[2]]),
  );
  const resolveProxy = (prefix) => {
    if (values[`${prefix}Enable`] !== "1") return null;
    const host = String(values[`${prefix}Proxy`] ?? "").trim();
    const port = String(values[`${prefix}Port`] ?? "").trim();
    if (!host || !/^\d+$/.test(port)) return null;
    return `http://${host}:${port}`;
  };
  const httpsProxy = resolveProxy("HTTPS");
  const httpProxy = resolveProxy("HTTP");
  if (httpsProxy) current.HTTPS_PROXY = httpsProxy;
  if (httpProxy) current.HTTP_PROXY = httpProxy;
  return current;
}

function readMacProxySettings() {
  try {
    return String(spawnSync("/usr/sbin/scutil", ["--proxy"], {
      encoding: "utf8",
      windowsHide: true,
    }).stdout ?? "");
  } catch {
    return "";
  }
}

export function resolveDesktopPrimaryRuntimePolicy(input) {
  const opencodeRuntimeIdentity = resolveDesktopOpencodeRuntimeIdentity(input.serverEnv, {
    homeDir: input.homeDir,
  });
  const grokBinaryPath = input.resolveBinary("grok", [
    path.join(input.homeDir, ".grok", "bin"),
  ]);
  const bundledGrok = input.resolveBundledBinaryInfo("grok");
  const bundledVersion = bundledGrok?.path
    ? versionFromOutput(input.probeVersion(bundledGrok.path))
    : null;
  const grokRuntimePolicy = resolveDesktopGrokRuntimePolicy(
    grokBinaryPath
      ? { path: grokBinaryPath, version: input.probeVersion(grokBinaryPath) ?? undefined }
      : null,
    input.serverEnv,
    {
      homeDir: input.homeDir,
      userDataDir: input.userDataDir,
      ...(bundledGrok?.path && bundledVersion
        ? { bundledBinary: { path: bundledGrok.path, version: bundledVersion } }
        : {}),
    },
  );
  return {
    dataRoot: input.userDataDir,
    opencodeRuntimeIdentity,
    grokRuntimePolicy: grokRuntimePolicy ?? undefined,
    grokRuntimeRollout: grokRuntimePolicy
      ? {
          grokNewSessionsEnabled: grokRuntimePolicy.rollout.newSessionsEnabled,
          ...(grokRuntimePolicy.rollout.workspaceAllowlist.length
            ? { grokWorkspaceAllowlist: grokRuntimePolicy.rollout.workspaceAllowlist }
            : {}),
        }
      : undefined,
  };
}

export function createPrimaryRuntimeMcpProjectionProvider() {
  let provider = async () => ({ descriptors: [], accounts: [], complete: true });
  return {
    read: () => provider(),
    set(next) {
      if (typeof next !== "function") {
        throw new TypeError("Primary runtime MCP descriptor provider must be a function");
      }
      provider = next;
    },
  };
}

function versionFromOutput(output) {
  return String(output ?? "").match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$|\()/u)?.[1] ?? null;
}
