import { spawn, type SpawnOptions } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type LogFormat, type OpencodeHotReload } from './cli-args.js';
import { buildSpawnEnv } from './env-paths.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type RuntimeLogger = {
  format: LogFormat;
  output: 'stdout' | 'silent';
  log: (
    level: LogLevel,
    message: string,
    attributes?: Record<string, unknown>,
    component?: string,
  ) => void;
};

type OpencodeStateLayout = {
  devMode: boolean;
  rootDir: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  importConfigDir?: string;
  importDataDir?: string;
};

type ApprovalMode = 'manual' | 'auto';

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_ROOT_DIR = resolve(SOURCE_DIR, '..');
const REPO_ROOT_DIR = resolve(ORCHESTRATOR_ROOT_DIR, '..', '..');

export function shouldUseBun(bin: string): boolean {
  if (!bin.endsWith(`${join('dist', 'cli.js')}`)) return false;
  if (bin.includes('onmyagent-server')) return true;
  return bin.includes(`${join('packages', 'server')}`);
}

export function resolveBinCommand(bin: string): {
  command: string;
  prefixArgs: string[];
} {
  if (bin.endsWith('.ts')) {
    return { command: 'bun', prefixArgs: [bin, '--'] };
  }
  if (bin.endsWith('.js')) {
    if (shouldUseBun(bin)) {
      return { command: 'bun', prefixArgs: [bin, '--'] };
    }
    return { command: 'node', prefixArgs: [bin, '--'] };
  }
  return { command: bin, prefixArgs: [] };
}

export function spawnProcess(
  command: string,
  args: string[],
  options: SpawnOptions = {},
) {
  const env = buildSpawnEnv(options.env, { orchestratorRoot: ORCHESTRATOR_ROOT_DIR, repoRoot: REPO_ROOT_DIR });
  const resolvedOptions = { ...options, env };
  if (process.platform === 'win32') {
    return spawn(command, args, { ...resolvedOptions, windowsHide: true });
  }
  return spawn(command, args, resolvedOptions);
}

export function mergeResourceAttributes(
  additional: Record<string, string>,
  existing?: string,
): string {
  const entries = new Map<string, string>();
  if (existing) {
    for (const part of existing.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!key || rest.length === 0) continue;
      entries.set(key, rest.join('=').replace(/,/g, ';'));
    }
  }
  for (const [key, value] of Object.entries(additional)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    entries.set(key, String(value).replace(/,/g, ';'));
  }
  return Array.from(entries.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

export function looksLikeOtelLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return false;
    return (
      typeof parsed.timeUnixNano === 'string' &&
      typeof parsed.severityText === 'string'
    );
  } catch {
    return false;
  }
}

export function prefixStream(
  stream: NodeJS.ReadableStream | null,
  label: string,
  level: 'stdout' | 'stderr',
  logger: RuntimeLogger,
  pid?: number,
): void {
  if (!stream) return;
  stream.setEncoding('utf8');
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      if (
        logger.output === 'stdout' &&
        logger.format === 'json' &&
        looksLikeOtelLogLine(line)
      ) {
        process.stdout.write(`${line}\n`);
        continue;
      }
      const severity: LogLevel = level === 'stderr' ? 'error' : 'info';
      logger.log(severity, line, { stream: level, pid }, label);
    }
  });
  stream.on('end', () => {
    if (!buffer.trim()) return;
    if (
      logger.output === 'stdout' &&
      logger.format === 'json' &&
      looksLikeOtelLogLine(buffer)
    ) {
      process.stdout.write(`${buffer}\n`);
      return;
    }
    const severity: LogLevel = level === 'stderr' ? 'error' : 'info';
    logger.log(severity, buffer, { stream: level, pid }, label);
  });
}

export async function stopChild(
  child: ReturnType<typeof spawn>,
  timeoutMs = 2500,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, false)),
  ]);
  if (exited) return;
  try {
    child.kill('SIGKILL');
  } catch {
    return;
  }
  await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, false)),
  ]);
}

export async function startOpencode(options: {
  bin: string;
  workspace: string;
  stateLayout?: OpencodeStateLayout;
  hotReload: OpencodeHotReload;
  bindHost: string;
  port: number;
  username?: string;
  password?: string;
  corsOrigins: string[];
  logger: RuntimeLogger;
  runId: string;
  logFormat: LogFormat;
  logLevel?: string;
  opencodeRouterHealthPort?: number;
}) {
  const args = [
    'serve',
    '--hostname',
    options.bindHost,
    '--port',
    String(options.port),
  ];
  if (options.logLevel) {
    args.push('--log-level', options.logLevel);
  }
  for (const origin of options.corsOrigins) {
    args.push('--cors', origin);
  }

  const child = spawnProcess(options.bin, args, {
    cwd: options.workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(options.stateLayout?.env ?? {}),
      OPENCODE_CLIENT: 'onmyagent-orchestrator',
      ONMYAGENT: '1',
      ONMYAGENT_RUN_ID: options.runId,
      ONMYAGENT_LOG_FORMAT: options.logFormat,
      OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(
        {
          'service.name': 'opencode',
          'service.instance.id': options.runId,
        },
        process.env.OTEL_RESOURCE_ATTRIBUTES,
      ),
      ...(options.username
        ? { OPENCODE_SERVER_USERNAME: options.username }
        : {}),
      ...(options.password
        ? { OPENCODE_SERVER_PASSWORD: options.password }
        : {}),
      ...(options.stateLayout?.configDir
        ? { OPENCODE_CONFIG_DIR: options.stateLayout.configDir }
        : {}),
      OPENCODE_HOT_RELOAD: options.hotReload.enabled ? '1' : '0',
      OPENCODE_HOT_RELOAD_DEBOUNCE_MS: String(options.hotReload.debounceMs),
      OPENCODE_HOT_RELOAD_COOLDOWN_MS: String(options.hotReload.cooldownMs),
      ...(options.opencodeRouterHealthPort
        ? {
            OPENCODE_ROUTER_HEALTH_PORT: String(
              options.opencodeRouterHealthPort,
            ),
          }
        : {}),
    },
  });

  prefixStream(child.stdout, 'opencode', 'stdout', options.logger, child.pid ?? undefined);
  prefixStream(child.stderr, 'opencode', 'stderr', options.logger, child.pid ?? undefined);

  return child;
}

export async function startOnMyAgentServer(options: {
  bin: string;
  host: string;
  port: number;
  workspace: string;
  token: string;
  hostToken: string;
  approvalMode: ApprovalMode;
  approvalTimeoutMs: number;
  readOnly: boolean;
  corsOrigins: string[];
  opencodeBaseUrl?: string;
  opencodeDirectory?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  opencodeRouterHealthPort?: number;
  opencodeRouterDataDir?: string;
  controlBaseUrl?: string;
  controlToken?: string;
  logger: RuntimeLogger;
  runId: string;
  logFormat: LogFormat;
}) {
  const args = [
    '--host',
    options.host,
    '--port',
    String(options.port),
    '--workspace',
    options.workspace,
    '--approval',
    options.approvalMode,
    '--approval-timeout',
    String(options.approvalTimeoutMs),
  ];

  if (options.readOnly) {
    args.push('--read-only');
  }

  if (options.corsOrigins.length) {
    args.push('--cors', options.corsOrigins.join(','));
  }

  if (options.opencodeBaseUrl) {
    args.push('--opencode-base-url', options.opencodeBaseUrl);
  }
  if (options.opencodeDirectory) {
    args.push('--opencode-directory', options.opencodeDirectory);
  }
  if (options.logFormat) {
    args.push('--log-format', options.logFormat);
  }

  const resolved = resolveBinCommand(options.bin);
  const child = spawnProcess(
    resolved.command,
    [...resolved.prefixArgs, ...args],
    {
      cwd: options.workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ONMYAGENT_TOKEN: options.token,
        ONMYAGENT_HOST_TOKEN: options.hostToken,
        ONMYAGENT_RUN_ID: options.runId,
        ONMYAGENT_LOG_FORMAT: options.logFormat,
        OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(
          {
            'service.name': 'onmyagent-server',
            'service.instance.id': options.runId,
          },
          process.env.OTEL_RESOURCE_ATTRIBUTES,
        ),
        ...(options.opencodeRouterHealthPort
          ? {
              OPENCODE_ROUTER_HEALTH_PORT: String(
                options.opencodeRouterHealthPort,
              ),
            }
          : {}),
        ...(options.opencodeRouterDataDir
          ? { OPENCODE_ROUTER_DATA_DIR: options.opencodeRouterDataDir }
          : {}),
        ...(options.opencodeBaseUrl
          ? { ONMYAGENT_OPENCODE_BASE_URL: options.opencodeBaseUrl }
          : {}),
        ...(options.opencodeDirectory
          ? { ONMYAGENT_OPENCODE_DIRECTORY: options.opencodeDirectory }
          : {}),
        ...(options.opencodeUsername
          ? { ONMYAGENT_OPENCODE_USERNAME: options.opencodeUsername }
          : {}),
        ...(options.opencodePassword
          ? { ONMYAGENT_OPENCODE_PASSWORD: options.opencodePassword }
          : {}),
        ...(options.controlBaseUrl
          ? { ONMYAGENT_CONTROL_BASE_URL: options.controlBaseUrl }
          : {}),
        ...(options.controlToken
          ? { ONMYAGENT_CONTROL_TOKEN: options.controlToken }
          : {}),
      },
    },
  );

  prefixStream(child.stdout, 'onmyagent-server', 'stdout', options.logger, child.pid ?? undefined);
  prefixStream(child.stderr, 'onmyagent-server', 'stderr', options.logger, child.pid ?? undefined);

  return child;
}

export async function startOpenCodeRouter(options: {
  bin: string;
  workspace: string;
  opencodeUrl?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  opencodeRouterHealthPort?: number;
  opencodeRouterDataDir?: string;
  logger: RuntimeLogger;
  runId: string;
  logFormat: LogFormat;
}) {
  const args = ['serve', options.workspace];
  if (options.opencodeUrl) {
    const supports = await opencodeRouterSupportsOpencodeUrl(options.bin);
    if (supports) {
      args.push('--opencode-url', options.opencodeUrl);
    }
  }

  const resolved = resolveBinCommand(options.bin);
  const child = spawnProcess(
    resolved.command,
    [...resolved.prefixArgs, ...args],
    {
      cwd: options.workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ONMYAGENT_RUN_ID: options.runId,
        ONMYAGENT_LOG_FORMAT: options.logFormat,
        OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(
          {
            'service.name': 'opencode-router',
            'service.instance.id': options.runId,
          },
          process.env.OTEL_RESOURCE_ATTRIBUTES,
        ),
        ...(options.opencodeUrl ? { OPENCODE_URL: options.opencodeUrl } : {}),
        OPENCODE_DIRECTORY: options.workspace,
        ...(options.opencodeRouterHealthPort
          ? {
              OPENCODE_ROUTER_HEALTH_PORT: String(
                options.opencodeRouterHealthPort,
              ),
            }
          : {}),
        ...(options.opencodeRouterDataDir
          ? { OPENCODE_ROUTER_DATA_DIR: options.opencodeRouterDataDir }
          : {}),
        ...(options.opencodeUsername
          ? { OPENCODE_SERVER_USERNAME: options.opencodeUsername }
          : {}),
        ...(options.opencodePassword
          ? { OPENCODE_SERVER_PASSWORD: options.opencodePassword }
          : {}),
      },
    },
  );

  prefixStream(child.stdout, 'opencode-router', 'stdout', options.logger, child.pid ?? undefined);
  prefixStream(child.stderr, 'opencode-router', 'stderr', options.logger, child.pid ?? undefined);

  return child;
}

export async function opencodeRouterSupportsOpencodeUrl(
  bin: string,
): Promise<boolean> {
  const resolved = resolveBinCommand(bin);
  return new Promise((resolve) => {
    const child = spawnProcess(
      resolved.command,
      [...resolved.prefixArgs, '--help'],
      {
        cwd: tmpdir(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve(output.includes('--opencode-url'));
    }, 1500);

    const onChunk = (chunk: unknown) => {
      output += String(chunk ?? '');
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);

    child.on('exit', () => {
      clearTimeout(timeout);
      resolve(output.includes('--opencode-url'));
    });
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}
