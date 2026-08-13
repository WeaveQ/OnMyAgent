// ACP connection probing for the personal-agent runtime.
//
// This module owns the "test connection / health check" surface. It is a pure
// composition over the legacy detection layer and the ACP probe command; the
// runtime passes in the small set of dependencies it needs so this file stays
// free of the big createPersonalAgentRuntime closure.

import { probeAcpCommand } from "./acp-probe.mjs";
import { extractProbeMetadata } from "./conversation-runtime-api.mjs";
import { resolveManagedAcpTool } from "./managed-acp-tools.mjs";
import { classifySpawnErrorStep, mapProbeStepToTestStep } from "./run-helpers.mjs";

/**
 * @param {object} deps
 * @param {object} deps.legacy                 legacy runtime (normalizeAgent, detectAgent)
 * @param {Record<string, unknown>} deps.injectedAdapters
 * @param {(input?: object) => Promise<object>} deps.listAgents  bound listAgents (for health-by-id)
 * @param {NodeJS.ProcessEnv} deps.providerEnvironment
 */
export function createConnectionProbes(deps) {
  const { legacy, injectedAdapters, listAgents, providerEnvironment } = deps;

  // Run a two-step ACP probe (CLI spawn -> initialize -> session/new) against
  // an agent and return a structured connection result the UI can render.
  async function testConnection(input = {}) {
    const checkedAt = Date.now();
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const detected = await legacy.detectAgent(agent, workspaceRoot).catch((error) => ({
      ...agent,
      status: "offline",
      error: error instanceof Error ? error.message : String(error),
    }));
    if (detected.status && detected.status !== "online") {
      // Collapse legacy "error" status into "offline" so the 5-state model
      // (online / needs_auth / offline / missing / unknown) is always returned.
      const rawStatus = detected.status === "error" ? "offline" : detected.status;
      const errorText = String(detected.error ?? "");
      const errorCode = detected.errorInfo?.code ?? detected.errorCode ?? "";
      // A missing binary (not installed) is reported as "missing" with a clean
      // human message — never the raw "spawn X ENOENT" / "未配置可执行命令".
      const isMissing =
        rawStatus === "missing" ||
        String(errorCode).toLowerCase() === "missing_binary" ||
        /enoent|not found|command not found|no such file|未配置|未安装/i.test(errorText);
      let status = rawStatus;
      if (isMissing) {
        status = "missing";
      } else if (rawStatus === "offline" && /auth|login|unauthorized|forbidden|api key|credential|认证|登录|未授权|凭证/i.test(errorText)) {
        status = "needs_auth";
      }
      return {
        ok: false,
        status,
        step: status === "missing" ? "fail_cli" : status === "needs_auth" ? "needs_auth" : "fail_cli",
        error: isMissing ? `${detected.name ?? agent.name ?? agent.provider} 未安装` : (detected.error ?? `${detected.name ?? agent.name ?? agent.provider} unavailable`),
        capabilities: null,
        models: [],
        configOptions: [],
        checkedAt,
      };
    }
    const provider = detected.provider ?? agent.provider;
    let executablePath = detected.executablePath || provider;
    // Built-in providers expose ACP via the `acp` subcommand, but custom / cli
    // agents (incl. the discoverable catalog) switch into ACP mode via their
    // own flag (e.g. `--acp`) carried on `acpArgs`.
    const detectedAcpArgs = Array.isArray(detected.acpArgs) ? detected.acpArgs.filter(Boolean) : [];
    const detectedCustomArgs = Array.isArray(detected.customArgs) ? detected.customArgs : [];
    let args =
      (provider === "custom" || detected.connectionType === "cli") && detectedAcpArgs.length
        ? [...detectedAcpArgs, ...detectedCustomArgs]
        : ["acp", ...detectedCustomArgs];
    try {
      if (provider === "codex" || provider === "claude") {
        const tool = await resolveManagedAcpTool(provider);
        if (tool?.installed && tool.binPath) {
          executablePath = tool.binPath;
          args = [...(Array.isArray(detected.customArgs) ? detected.customArgs : [])];
        }
      }
      const probe = await probeAcpCommand({ command: executablePath, args, cwd: workspaceRoot || process.cwd(), env: providerEnvironment, timeoutMs: Number(input.timeoutMs) || 12_000 });
      const meta = probe.sessionResult ? extractProbeMetadata(probe.sessionResult, probe.initialized) : extractProbeMetadata(probe.initialized);
      // If the probe determined the binary is not installed, replace the raw
      // "spawn X ENOENT" with a clean "未安装" message.
      const probeMissing = probe.status === "missing";
      return {
        ok: probe.ok,
        status: probe.status,
        step: probe.step,
        error: probeMissing ? `${detected.name ?? agent.name ?? agent.provider} 未安装` : (probe.error ?? null),
        capabilities: probe.initialized?.capabilities ?? null,
        models: meta.models,
        configOptions: meta.configOptions,
        checkedAt,
      };
    } catch (error) {
      return {
        ok: false,
        status: "offline",
        step: "fail_cli",
        error: error instanceof Error ? error.message : String(error),
        capabilities: null,
        models: [],
        configOptions: [],
        checkedAt,
      };
    }
  }

  // Test a custom agent configuration before saving: success / fail_cli / fail_acp.
  async function testCustomAgent(input = {}) {
    const command = String(input.command ?? "").trim();
    if (!command) {
      return { step: "fail_cli", error: "command is required", durationMs: 0 };
    }
    const args = Array.isArray(input.args) ? input.args.filter(Boolean) : [];
    const acpArgs = Array.isArray(input.acpArgs) ? input.acpArgs.filter(Boolean) : [];
    const env = input.env && typeof input.env === "object" && !Array.isArray(input.env)
      ? { ...providerEnvironment, ...input.env }
      : providerEnvironment;
    const timeoutMs = Math.max(1000, Math.min(30000, Number(input.timeoutMs) || 8000));
    const cwd = String(input.cwd ?? process.cwd()).trim();
    const startedAt = Date.now();
    try {
      const probe = await probeAcpCommand({ command, args: acpArgs.length > 0 ? acpArgs : args, cwd, timeoutMs, env });
      const durationMs = Date.now() - startedAt;
      const step = mapProbeStepToTestStep(probe.step);
      return { step, error: probe.error ?? null, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      // Spawn errors are CLI-layer; JSON-RPC errors are ACP-layer.
      return { step: classifySpawnErrorStep(message), error: message, durationMs };
    }
  }

  async function checkProviderHealth(input = {}) {
    const checkedAt = Date.now();
    try {
      const agent = await legacy.normalizeAgent(input.agent ?? {});
      if (Object.prototype.hasOwnProperty.call(injectedAdapters, agent.provider)) {
        // Injected adapters are not health-checked by sending a real prompt,
        // because that would pollute the conversation context.
        const workspaceRoot = String(input.workspaceRoot ?? "").trim();
        const detected = await legacy.detectAgent(agent, workspaceRoot).catch((error) => ({
          ...agent,
          status: "offline",
          error: error instanceof Error ? error.message : String(error),
        }));
        const healthy = detected.status === "online";
        return {
          ok: true,
          healthy,
          status: healthy ? "online" : "offline",
          reason: detected.error ?? null,
          step: healthy ? "online" : "fail_detect",
          checkedAt,
          capabilities: null,
          models: [],
          configOptions: [],
        };
      }
      const result = await testConnection(input);
      return {
        ok: true,
        healthy: Boolean(result.ok),
        status: result.status ?? (result.ok ? "online" : "offline"),
        reason: result.error ?? null,
        step: result.step ?? null,
        checkedAt,
        capabilities: result.capabilities ?? null,
        models: result.models ?? [],
        configOptions: result.configOptions ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        healthy: false,
        status: "offline",
        reason: error instanceof Error ? error.message : String(error),
        step: "failed",
        checkedAt,
        capabilities: null,
        models: [],
        configOptions: [],
      };
    }
  }

  async function checkManagedAgentHealthById(input = {}) {
    const id = String(input.id ?? input.agentId ?? input.provider ?? "").trim();
    if (!id) return { ok: false, healthy: false, status: "unknown", reason: "agent id is required", checkedAt: Date.now() };
    const agents = await listAgents({ workspaceRoot: input.workspaceRoot });
    const agent = (agents.agents ?? []).find((item) => item.id === id || item.provider === id);
    if (!agent) return { ok: false, healthy: false, status: "missing", reason: `agent ${id} was not found`, checkedAt: Date.now() };
    return checkProviderHealth({ ...input, agent });
  }

  return { testConnection, testCustomAgent, checkProviderHealth, checkManagedAgentHealthById };
}
