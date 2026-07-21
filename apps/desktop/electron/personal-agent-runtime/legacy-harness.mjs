import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  extractOpenClawPayloadText,
  isOpenClawFallbackSuccessLine,
  isPersonalAgentDiagnosticStderr,
  isPersonalAgentFatalStderr,
  isRecoverableCodexDiagnosticError,
  isRecoverableOpenClawFallbackLine,
} from "../personal-local-agent-runtime.mjs";
import {
  PERSONAL_LOCAL_AGENT_PROVIDERS,
  defaultPersonalLocalAgents,
  isPersonalLocalAgentProvider,
  normalizePersonalLocalAgent,
  personalAgentCapability,
  personalLocalAgentConnectionMode,
} from "./provider-registry.mjs";
import { readSession, writeSession } from "./session-store.mjs";
import {
  appendRunEvent,
  createExecHelpers,
  parseJsonLikeObject,
  readJsonLikeFile,
  reconcileModelOptions,
  runId,
  stableKey,
  stringifyAgentCommand,
  terminateProcessTree,
  uniqueModelOptions,
} from "./utils.mjs";
import { legacyPersonalAssistantRunLogRoot, legacyRunLogRoot, runLogRoot } from "./workdir.mjs";

const AGENT_MANAGEMENT_PREF_FILE = "agent-management.json";
const PERSONAL_LOCAL_AGENT_EMPTY_OUTPUT_RETRIES = 1;
const OPENCODE_PREFERRED_DEFAULT_MODEL = "ark-coding-openai/ark-code-latest";

export function createPersonalAgentLegacyHarness(options = {}) {
  const exec = createExecHelpers({ extraPathEntries: () => options.runtimePathEntries?.() ?? [] });
  const runs = new Map();
  const processes = new Map();

  function agentManagementPreferencePath(workspaceRoot) {
    return path.join(workspaceRoot, ".opencode", AGENT_MANAGEMENT_PREF_FILE);
  }

  async function readAgentManagementPreferences(workspaceRoot) {
    const raw = await readJsonLikeFile(agentManagementPreferencePath(workspaceRoot));
    const selections = raw?.selections && typeof raw.selections === "object" ? raw.selections : {};
    return { selections };
  }

  async function writeAgentManagementPreferences(workspaceRoot, preferences) {
    const filePath = agentManagementPreferencePath(workspaceRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    const payload = {
      version: 1,
      updatedAt: Date.now(),
      selections: preferences.selections ?? {},
    };
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return filePath;
  }

  function classifyPersonalAgentError(error, fallbackCode = "unknown") {
    const message = String(error ?? "").trim();
    const lower = message.toLowerCase();
    let code = fallbackCode;
    if (/not found|no such file|enoent|未配置|命令不可用|command not found/.test(lower)) code = "missing_binary";
    else if (/auth|login|unauthorized|forbidden|api key|认证|登录/.test(lower)) code = "auth_required";
    else if (/version|版本|update/.test(lower)) code = "version_unsupported";
    else if (/timeout|timed out|超时/.test(lower)) code = "timeout";
    else if (/parse|json|解析/.test(lower)) code = "parse_failed";
    else if (
      /empty|no assistant|without assistant|no parseable|no output|completed without/.test(lower)
      || /没有.*回复|空输出|无助手文本/.test(message)
    ) {
      code = "empty_output";
    }
    else if (/cancel|取消/.test(lower)) code = "cancelled";
    return { code, message: message || "Unknown local agent error", debug: message || null };
  }

  function personalAgentStatus(agent, status, extra = {}) {
    const error = extra.error ?? null;
    const customAgentContext = agent.provider === "custom" ? agent : null;
    const capabilityExtra = customAgentContext ? { ...extra, customAgent: customAgentContext } : extra;
    return {
      id: agent.id,
      name: agent.name,
      provider: agent.provider,
      executablePath: agent.executablePath,
      model: agent.model,
      customArgs: agent.customArgs,
      acpArgs: agent.acpArgs ?? [],
      connectionType: agent.connectionType ?? null,
      modelOptions: extra.modelOptions ?? [],
      defaultModel: extra.defaultModel ?? null,
      connectionMode: extra.connectionMode ?? personalLocalAgentConnectionMode(agent.provider, customAgentContext),
      status,
      version: extra.version ?? null,
      error,
      errorInfo: error ? classifyPersonalAgentError(error, extra.errorCode ?? "unknown") : null,
      capability: personalAgentCapability(agent.provider, status, capabilityExtra),
      lastCheckedAt: Date.now(),
    };
  }

  function splitProviderModel(value) {
    const normalized = String(value ?? "").trim();
    const slashIndex = normalized.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= normalized.length - 1) return null;
    return { provider: normalized.slice(0, slashIndex), model: normalized.slice(slashIndex + 1) };
  }

  function personalModelLookupKey(id) {
    return String(id ?? "").trim().toLowerCase().replace(/[\s_.]+/g, "-");
  }

  function resolveOpenCodeConfiguredDefaultModel(defaultModel, configOptions = [], cliOptions = []) {
    const direct = cliOptions.find((option) => personalModelLookupKey(option.id) === personalModelLookupKey(defaultModel));
    if (direct) return direct.id;
    const configured = splitProviderModel(defaultModel);
    if (!configured) return defaultModel ?? null;
    const providerPrefix = `${configured.provider}/`;
    const displayKey = personalModelLookupKey(configured.model);
    const configMatch = configOptions.find((option) => {
      const optionId = String(option.id ?? "");
      if (!optionId.startsWith(providerPrefix)) return false;
      const optionModel = optionId.slice(providerPrefix.length);
      return personalModelLookupKey(optionModel) === displayKey || personalModelLookupKey(option.label) === displayKey;
    });
    return configMatch?.id ?? defaultModel ?? null;
  }

  function configHomePath() {
    if (process.env.XDG_CONFIG_HOME?.trim()) return process.env.XDG_CONFIG_HOME.trim();
    if (process.platform === "win32" && process.env.APPDATA?.trim()) return process.env.APPDATA.trim();
    return path.join(os.homedir(), ".config");
  }

  function opencodeConfigCandidates(workspaceRoot) {
    const candidates = [];
    const explicit = process.env.OPENCODE_CONFIG_DIR?.trim();
    const xdg = process.env.XDG_CONFIG_HOME?.trim();
    if (explicit) candidates.push(path.join(explicit, "opencode.jsonc"), path.join(explicit, "opencode.json"));
    if (xdg) candidates.push(path.join(xdg, "opencode", "opencode.jsonc"), path.join(xdg, "opencode", "opencode.json"));
    candidates.push(path.join(configHomePath(), "opencode", "opencode.jsonc"), path.join(configHomePath(), "opencode", "opencode.json"));
    if (workspaceRoot) {
      candidates.push(
        path.join(workspaceRoot, "opencode.jsonc"),
        path.join(workspaceRoot, "opencode.json"),
        path.join(workspaceRoot, ".opencode", "opencode.jsonc"),
        path.join(workspaceRoot, ".opencode", "opencode.json"),
      );
    }
    return [...new Set(candidates)];
  }

  function collectOpenCodeModelsFromConfig(config) {
    const options = [];
    const configuredDefault = typeof config?.model === "string" ? config.model.trim() : "";
    if (configuredDefault) options.push({ id: configuredDefault, label: `默认 · ${configuredDefault}` });
    const providers = config?.provider && typeof config.provider === "object" ? config.provider : {};
    for (const [providerId, provider] of Object.entries(providers)) {
      const models = provider?.models && typeof provider.models === "object" ? provider.models : {};
      for (const modelId of Object.keys(models)) options.push({ id: `${providerId}/${modelId}`, label: `${providerId}/${modelId}` });
    }
    return { options: uniqueModelOptions(options), defaultModel: configuredDefault || null };
  }

  async function readOpenCodeConfiguredModels(workspaceRoot) {
    const all = [];
    let defaultModel = null;
    for (const candidate of opencodeConfigCandidates(workspaceRoot)) {
      const config = await readJsonLikeFile(candidate);
      if (!config) continue;
      const collected = collectOpenCodeModelsFromConfig(config);
      all.push(...collected.options);
      defaultModel = defaultModel ?? collected.defaultModel;
    }
    return { modelOptions: uniqueModelOptions(all), defaultModel };
  }

  async function readCodexConfiguredModels() {
    const candidate = path.join(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "config.toml");
    const options = [];
    let defaultModel = null;
    const raw = await readFile(candidate, "utf8").catch(() => "");
    for (const match of raw.matchAll(/^\s*model\s*=\s*["']([^"']+)["']/gm)) {
      const id = match[1]?.trim();
      if (id) {
        defaultModel = defaultModel ?? id;
        options.push({ id, label: `配置默认 · ${id}` });
      }
    }
    return { modelOptions: uniqueModelOptions(options), defaultModel };
  }

  async function readClaudeConfiguredModels() {
    const options = [];
    let defaultModel = process.env.ANTHROPIC_MODEL?.trim() || process.env.CLAUDE_MODEL?.trim() || null;
    if (defaultModel) options.push({ id: defaultModel, label: `环境默认 · ${defaultModel}` });
    for (const candidate of [path.join(os.homedir(), ".claude", "settings.json"), path.join(os.homedir(), ".claude", "settings.local.json")]) {
      const config = await readJsonLikeFile(candidate);
      const model = typeof config?.model === "string" ? config.model.trim() : typeof config?.defaultModel === "string" ? config.defaultModel.trim() : typeof config?.env?.ANTHROPIC_MODEL === "string" ? config.env.ANTHROPIC_MODEL.trim() : "";
      if (model) {
        defaultModel = defaultModel ?? model;
        options.push({ id: model, label: `配置默认 · ${model}` });
      }
      // 读取 ANTHROPIC_DEFAULT_*_MODEL 角色模型（sonnet/opus/haiku/fable 对应的真实模型）
      const roleEnv = config?.env || {};
      const roleMap = [
        ["ANTHROPIC_DEFAULT_SONNET_MODEL", "sonnet"],
        ["ANTHROPIC_DEFAULT_OPUS_MODEL", "opus"],
        ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "haiku"],
        ["ANTHROPIC_DEFAULT_FABLE_MODEL", "fable"],
      ];
      for (const [envKey, role] of roleMap) {
        const roleModel = typeof roleEnv[envKey] === "string" ? roleEnv[envKey].trim() : "";
        if (roleModel) options.push({ id: roleModel, label: `${role} · ${roleModel}` });
      }
    }
    return { modelOptions: uniqueModelOptions(options), defaultModel };
  }

  function normalizeHermesModelOptionId(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const cleaned = raw.replace(/\/default:\s*/i, "/").replace(/^default:\s*/i, "").trim();
    const slashIndex = cleaned.indexOf("/");
    if (slashIndex > 0 && slashIndex < cleaned.length - 1) return `${cleaned.slice(0, slashIndex)}:${cleaned.slice(slashIndex + 1)}`;
    return cleaned;
  }

  function collectHermesFallbackModels(raw) {
    const options = [];
    const blocks = String(raw ?? "").split(/\n(?=-\s+provider:\s*)/g);
    for (const block of blocks) {
      const provider = block.match(/^-\s+provider:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
      const model = block.match(/^\s+model:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
      if (provider && model) options.push({ id: normalizeHermesModelOptionId(`${provider}/${model}`), label: `可选 · ${normalizeHermesModelOptionId(`${provider}/${model}`)}` });
    }
    return uniqueModelOptions(options);
  }

  async function readHermesConfiguredModels() {
    for (const candidate of [path.join(os.homedir(), ".hermes", "config.yaml"), path.join(os.homedir(), ".hermes", "config.yml")]) {
      const raw = await readFile(candidate, "utf8").catch(() => "");
      if (!raw) continue;
      const provider = raw.match(/^\s*provider\s*:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
      const model = raw.match(/^\s*(?:default|model)\s*:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
      const fallbackModels = collectHermesFallbackModels(raw);
      if (provider && model) {
        const id = normalizeHermesModelOptionId(`${provider}/${model}`);
        return { modelOptions: uniqueModelOptions([{ id, label: `配置默认 · ${id}` }, ...fallbackModels]), defaultModel: id };
      }
      if (model) {
        const id = normalizeHermesModelOptionId(model);
        return { modelOptions: uniqueModelOptions([{ id, label: `配置默认 · ${id}` }, ...fallbackModels]), defaultModel: id };
      }
      if (fallbackModels.length) return { modelOptions: fallbackModels, defaultModel: fallbackModels[0]?.id ?? null };
    }
    return { modelOptions: [], defaultModel: null };
  }

  function parseOpencodeModelOptions(stdout) {
    return uniqueModelOptions(stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:+-]+$/.test(line)).map((id) => ({ id, label: id })));
  }

  function parseCodexModelOptions(stdout) {
    const parsed = parseJsonLikeObject(stdout.trim());
    const models = Array.isArray(parsed?.models) ? parsed.models : [];
    return uniqueModelOptions(models.map((model) => {
      const id = String(model?.slug ?? model?.id ?? "").trim();
      return id ? { id, label: String(model?.display_name ?? model?.name ?? id).trim() || id } : null;
    }).filter(Boolean));
  }

  function parseOpenclawAgentOptions(stdout) {
    const parsed = parseJsonLikeObject(stdout.trim());
    const agents = Array.isArray(parsed) ? parsed : [];
    return uniqueModelOptions(agents.map((agent) => {
      const id = String(agent?.id ?? "").trim();
      if (!id) return null;
      const name = String(agent?.name ?? agent?.identityName ?? id).trim();
      const model = String(agent?.model ?? "").trim();
      return { id, label: model ? `${name} · ${model}` : name };
    }).filter(Boolean));
  }

  function parseHermesDefaultModel(stdout) {
    const modelLine = stdout.split(/\r?\n/).find((line) => line.includes("Model:"));
    if (!modelLine) return null;
    const provider = modelLine.match(/['"]provider['"]\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? "";
    const model = modelLine.match(/['"]default['"]\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? "";
    if (provider && model) return normalizeHermesModelOptionId(`${provider}/${model}`);
    if (model) return normalizeHermesModelOptionId(model);
    return null;
  }

  async function listPersonalLocalAgentModelOptions(agent, workspaceRoot = "") {
    if (!agent.executablePath) return { modelOptions: [], defaultModel: null };
    if (agent.provider === "opencode") {
      const result = await exec.runCommandCapture(agent.executablePath, ["models"], { timeoutMs: 8000 });
      const cliOptions = result.ok ? parseOpencodeModelOptions(result.stdout) : [];
      const configOptions = await readOpenCodeConfiguredModels(workspaceRoot);
      const modelOptions = reconcileModelOptions(configOptions.modelOptions, cliOptions);
      const preferredDefault = modelOptions.some((option) => option.id === OPENCODE_PREFERRED_DEFAULT_MODEL) ? OPENCODE_PREFERRED_DEFAULT_MODEL : null;
      return { modelOptions, defaultModel: agent.model ?? preferredDefault ?? resolveOpenCodeConfiguredDefaultModel(configOptions.defaultModel, configOptions.modelOptions, cliOptions) ?? null };
    }
    if (agent.provider === "codex") {
      const result = await exec.runCommandCapture(agent.executablePath, ["debug", "models"], { timeoutMs: 8000 });
      const cliOptions = result.ok ? parseCodexModelOptions(result.stdout) : [];
      const configOptions = await readCodexConfiguredModels();
      return { modelOptions: uniqueModelOptions([...configOptions.modelOptions, ...cliOptions]), defaultModel: configOptions.defaultModel ?? agent.model ?? null };
    }
    if (agent.provider === "claude") {
      const configOptions = await readClaudeConfiguredModels();
      return { modelOptions: configOptions.modelOptions, defaultModel: configOptions.defaultModel ?? agent.model ?? null };
    }
    if (agent.provider === "openclaw") {
      const result = await exec.runCommandCapture(agent.executablePath, ["agents", "list", "--json"], { timeoutMs: 8000 });
      const modelOptions = result.ok ? parseOpenclawAgentOptions(result.stdout) : [];
      return { modelOptions, defaultModel: modelOptions[0]?.id ?? null };
    }
    if (agent.provider === "hermes") {
      const result = await exec.runCommandCapture(agent.executablePath, ["config", "show"], { timeoutMs: 8000 });
      const defaultModel = result.ok ? parseHermesDefaultModel(result.stdout) : null;
      const configOptions = await readHermesConfiguredModels();
      const displayDefault = defaultModel ?? configOptions.defaultModel;
      return { modelOptions: uniqueModelOptions([...configOptions.modelOptions, ...(displayDefault ? [{ id: displayDefault, label: `当前默认 · ${displayDefault}` }] : [])]), defaultModel: displayDefault };
    }
    return { modelOptions: [], defaultModel: agent.model ?? null };
  }

  async function applyAgentManagementSelection(agent, workspaceRoot) {
    const root = String(workspaceRoot ?? "").trim();
    if (!root || !agent?.provider) return agent;
    const preferences = await readAgentManagementPreferences(root);
    const selected = preferences.selections?.[agent.provider];
    const model = typeof selected?.model === "string" ? selected.model.trim() : "";
    if (!model) return agent;
    const hasOption = (agent.modelOptions ?? []).some((option) => option.id === model);
    return {
      ...agent,
      model,
      defaultModel: model,
      modelOptions: hasOption ? agent.modelOptions : uniqueModelOptions([{ id: model, label: `Agent 管理 · ${model}` }, ...(agent.modelOptions ?? [])]),
    };
  }

  function parseOpenClawVersionText(raw) {
    const match = String(raw ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  function compareVersionTuple(a, b) {
    for (let i = 0; i < 3; i += 1) {
      const delta = (a?.[i] ?? 0) - (b?.[i] ?? 0);
      if (delta !== 0) return delta;
    }
    return 0;
  }

  async function detectPersonalLocalAgent(agentInput, workspaceRoot = "", detectOptions = {}) {
    const agent = normalizePersonalLocalAgent(agentInput);
    const providerSpec = PERSONAL_LOCAL_AGENT_PROVIDERS[agent.provider] ?? PERSONAL_LOCAL_AGENT_PROVIDERS.custom;
    let executablePath = await exec.resolveExecutable(agent.executablePath || providerSpec.executable || "");
    if (!executablePath) return personalAgentStatus(agent, "offline", { error: "未配置可执行命令", errorCode: "missing_binary", minVersionOk: false });
    let version = await exec.runCommandCapture(executablePath, providerSpec.versionArgs ?? ["--version"], { timeoutMs: 5000 });
    if (!version.ok && !executablePath.includes("/") && !executablePath.includes("\\")) {
      const resolved = await exec.resolveCommandFromLoginShell([executablePath]);
      const resolvedPath = resolved.get(executablePath);
      if (resolvedPath) {
        executablePath = resolvedPath;
        version = await exec.runCommandCapture(executablePath, providerSpec.versionArgs ?? ["--version"], { timeoutMs: 5000 });
      }
    }
    const checked = { ...agent, executablePath };
    if (!version.ok) return personalAgentStatus(checked, "offline", { error: (version.stderr || version.stdout || "命令不可用").trim(), errorCode: "missing_binary", minVersionOk: false });
    if (checked.provider === "openclaw") {
      const detectedVersion = parseOpenClawVersionText(version.stdout || version.stderr);
      if (!detectedVersion || compareVersionTuple(detectedVersion, [2026, 5, 5]) < 0) {
        return personalAgentStatus(checked, "offline", {
          version: (version.stdout || version.stderr).trim().split("\n")[0] || null,
          error: "OpenClaw 版本低于 2026.5.5，当前版本的 --json 输出格式不稳定。请运行 `openclaw update` 后重试。",
          errorCode: "version_unsupported",
          minVersionOk: false,
        });
      }
    }
    const includeModels = detectOptions.includeModels !== false;
    const modelInfo = includeModels ? await listPersonalLocalAgentModelOptions(checked, workspaceRoot) : { modelOptions: [], defaultModel: agent.model ?? null };
    const effectiveChecked = { ...checked, model: checked.model || (checked.provider === "hermes" ? null : modelInfo.defaultModel) || null };
    return applyAgentManagementSelection(personalAgentStatus(effectiveChecked, "online", { version: (version.stdout || version.stderr).trim().split("\n")[0] || null, ...modelInfo }), workspaceRoot);
  }

  async function listPersonalLocalAgents(input = {}) {
    const configured = Array.isArray(input?.agents) ? input.agents : [];
    const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
    const includeModels = input?.includeModels !== false;
    const baseAgents = configured.length ? configured : defaultPersonalLocalAgents();
    return { agents: await Promise.all(baseAgents.map((agent) => detectPersonalLocalAgent(agent, workspaceRoot, { includeModels }))) };
  }

  function emptyAgentUsageSummary() {
    return { runs: 0, completed: 0, failed: 0, cancelled: 0, totalDurationMs: 0, lastRunAt: null, lastStatus: null };
  }

  async function readPersonalAgentUsageSummary(workspaceRoot) {
    const summaries = new Map();
    for (const agent of defaultPersonalLocalAgents()) summaries.set(agent.provider, emptyAgentUsageSummary());
    for (const logRoot of [runLogRoot(workspaceRoot), legacyPersonalAssistantRunLogRoot(workspaceRoot), legacyRunLogRoot(workspaceRoot)]) {
      const entries = await readdir(logRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const raw = await readFile(path.join(logRoot, entry.name), "utf8").catch(() => "");
        const events = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => parseJsonLikeObject(line)).filter(Boolean);
        if (!events.length) continue;
        const meta = events.find((event) => event.type === "run_meta") ?? null;
        const first = meta ?? events[0] ?? {};
        const last = meta ?? events.at(-1) ?? {};
        const provider = String(first.agentProvider ?? last.agentProvider ?? first.provider ?? last.provider ?? "unknown").trim();
        const agentId = String(first.agentId ?? last.agentId ?? "").trim();
        const status = String(last.status ?? first.status ?? "completed").trim();
        const startedAt = Number(first.startedAt ?? first.at ?? 0);
        const finishedAt = Number(last.finishedAt ?? last.at ?? 0);
        // The synthetic "custom" provider is shared by EVERY custom/local agent
        // (user-registered agents, the discoverable catalog like kimi/kiro/goose,
        // and extension adapters). Keying it by provider would merge all of their
        // runs into one bucket, so a run of codebuddy would show up on kimi.
        // Key custom logs by their own agentId instead. The real built-in
        // providers (opencode/codex/claude/openclaw/hermes) keep their canonical
        // single-agent key. Orphaned logs (no agentId — e.g. generic
        // "OpenCode SDK session flow started" entries with provider "unknown")
        // fall to the empty key and are matched by no agent, so they are never
        // mis-attributed to any catalog or unlinked custom agent.
        const key = provider === "custom" ? agentId : (isPersonalLocalAgentProvider(provider) ? provider : agentId);
        const summary = summaries.get(key) ?? emptyAgentUsageSummary();
        summary.runs += 1;
        if (status === "completed") summary.completed += 1;
        else if (status === "cancelled") summary.cancelled += 1;
        else if (status === "failed") summary.failed += 1;
        if (startedAt && finishedAt && finishedAt > startedAt) summary.totalDurationMs += finishedAt - startedAt;
        const lastRunAt = finishedAt || startedAt || null;
        if (lastRunAt && (!summary.lastRunAt || lastRunAt > summary.lastRunAt)) {
          summary.lastRunAt = lastRunAt;
          summary.lastStatus = status;
        }
        summaries.set(key, summary);
      }
    }
    return summaries;
  }

  function snapshotRun(state) {
    return {
      ok: state.status === "completed",
      runId: state.runId,
      agentId: state.agentId,
      agentProvider: state.agentProvider,
      connectionMode: state.connectionMode,
      status: state.status,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      pid: state.pid,
      command: state.command,
      output: state.outputParts.join("\n").trim(),
      error: state.error,
      events: [...state.events],
      logPath: state.logPath,
    };
  }

  async function persistRun(state) {
    const meta = { type: "run_meta", at: Date.now(), runId: state.runId, agentId: state.agentId, agentProvider: state.agentProvider, status: state.status, startedAt: state.startedAt, finishedAt: state.finishedAt };
    const lines = [meta, ...state.events].map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(state.logPath, `${lines}${lines ? "\n" : ""}`, "utf8").catch(() => undefined);
  }

  async function buildArgs(detected, workspaceRoot, prompt) {
    const session = await readSession(workspaceRoot, detected.provider, detected.id);
    if (detected.provider === "custom") return [...detected.customArgs, prompt];
    if (detected.provider === "openclaw") {
      const args = ["agent", "--local", "--json", "--session-id", stableKey("openclaw", workspaceRoot, detected.id), "--timeout", "600"];
      if (detected.model) args.push("--agent", detected.model);
      return [...args, ...detected.customArgs, "--message", prompt];
    }
    if (session.sessionId) return [...detected.customArgs, String(session.sessionId), prompt];
    return [...detected.customArgs, prompt];
  }

  function extractText(parsed) {
    const openClawPayloadText = extractOpenClawPayloadText(parsed);
    if (openClawPayloadText) return openClawPayloadText;
    for (const value of [parsed?.item?.text, parsed?.result?.text, parsed?.reply?.text, parsed?.output, parsed?.result, parsed?.response, parsed?.reply, parsed?.final, parsed?.text, parsed?.message, parsed?.content]) {
      if (typeof value === "string" && value.trim()) return value;
    }
    return null;
  }

  function handleLine(state, line, stream) {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (state.agentProvider === "openclaw" && isOpenClawFallbackSuccessLine(trimmed)) {
      state.openClawFallbackSucceeded = true;
      if (state.openClawRecoverableErrors?.length) {
        state.error = null;
        state.fatalError = false;
      }
      appendRunEvent(state.events, { type: "log", text: `${stream}> ${trimmed}` });
      return;
    }
    if (state.agentProvider === "openclaw" && isRecoverableOpenClawFallbackLine(trimmed)) {
      state.openClawRecoverableErrors = [...(state.openClawRecoverableErrors ?? []), trimmed];
      appendRunEvent(state.events, { type: "log", text: `${stream}> ${trimmed}` });
      return;
    }
    const parsed = parseJsonLikeObject(trimmed);
    if (parsed) {
      if (state.agentProvider === "codex" && parsed?.type === "thread.started" && typeof parsed?.thread_id === "string") {
        void writeSession(state.workspaceRoot, state.agentProvider, state.agentId, { threadId: parsed.thread_id.trim(), updatedAt: Date.now() });
      }
      if (state.agentProvider === "claude") {
        const sessionId = String(parsed?.session_id ?? parsed?.sessionId ?? "").trim();
        if (sessionId) void writeSession(state.workspaceRoot, state.agentProvider, state.agentId, { sessionId, updatedAt: Date.now() });
      }
      if (parsed?.type === "error") {
        state.fatalError = true;
        state.error = String(parsed?.error?.message ?? parsed?.message ?? trimmed);
        appendRunEvent(state.events, { type: "error", text: state.error });
        return;
      }
      const text = extractText(parsed);
      if (text) {
        state.outputParts.push(text);
        appendRunEvent(state.events, { type: "assistant", text });
        return;
      }
    }
    if (stream === "stderr") {
      if (isPersonalAgentDiagnosticStderr(trimmed)) appendRunEvent(state.events, { type: "log", text: `${stream}> ${trimmed}` });
      else if (state.fatalError || isPersonalAgentFatalStderr(trimmed)) {
        state.fatalError = true;
        state.error = state.error ? `${state.error}\n${trimmed}` : trimmed;
        appendRunEvent(state.events, { type: "error", text: trimmed });
      } else appendRunEvent(state.events, { type: "log", text: `${stream}> ${trimmed}` });
      return;
    }
    state.outputParts.push(trimmed);
    appendRunEvent(state.events, { type: "assistant", text: trimmed });
  }

  function retryPrompt(prompt) {
    return ["上一次本机 Agent run 已退出但没有产生任何可展示给用户的 text 输出。", "这次不要调用工具，不要只做内部思考，必须直接输出一段中文自然语言回复。", "", "原始请求：", prompt].join("\n");
  }

  async function startAttempt(state, detected, prompt, attempt) {
    const args = await buildArgs(detected, state.workspaceRoot, prompt);
    state.command = stringifyAgentCommand(detected.executablePath, args);
    state.status = "running";
    appendRunEvent(state.events, { type: "log", text: attempt > 0 ? `retrying ${detected.name} after empty text output` : `spawned ${detected.name}` });
    appendRunEvent(state.events, { type: "log", text: state.command });
    const runExec = createExecHelpers({
      extraPathEntries: () => [
        ...(options.runtimePathEntries?.() ?? []),
      ],
    });
    const child = spawn(detected.executablePath, args, {
      cwd: state.workspaceRoot,
      env: runExec.processEnv({
        PWD: state.workspaceRoot,
      }),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    state.child = child;
    state.pid = child.pid ?? null;
    processes.set(state.runId, child);
    appendRunEvent(state.events, { type: "log", text: `pid ${child.pid ?? "unknown"}` });
    void persistRun(state);
    child.stdout?.on("data", (chunk) => {
      state.stdoutBuffer += chunk.toString("utf8");
      const lines = state.stdoutBuffer.split(/\r?\n/);
      state.stdoutBuffer = lines.pop() ?? "";
      lines.forEach((line) => handleLine(state, line, "stdout"));
      void persistRun(state);
    });
    child.stderr?.on("data", (chunk) => {
      state.stderrBuffer += chunk.toString("utf8");
      const lines = state.stderrBuffer.split(/\r?\n/);
      state.stderrBuffer = lines.pop() ?? "";
      lines.forEach((line) => handleLine(state, line, "stderr"));
      void persistRun(state);
    });
    child.on("error", (error) => {
      state.status = "failed";
      state.error = state.error || error.message;
      state.finishedAt = Date.now();
      appendRunEvent(state.events, { type: "error", text: error.message });
      void persistRun(state);
    });
    child.on("close", async (code, signal) => {
      processes.delete(state.runId);
      if (state.stdoutBuffer.trim()) handleLine(state, state.stdoutBuffer, "stdout");
      if (state.stderrBuffer.trim()) handleLine(state, state.stderrBuffer, "stderr");
      if (state.status !== "running") {
        appendRunEvent(state.events, { type: "exit", text: `exit ${code ?? "null"}${signal ? ` signal ${signal}` : ""}` });
        void persistRun(state);
        return;
      }
      appendRunEvent(state.events, { type: "exit", text: `exit ${code ?? "null"}${signal ? ` signal ${signal}` : ""}` });
      if (state.status === "cancelled" || signal === "SIGTERM" || signal === "SIGKILL") {
        state.status = "cancelled";
        state.finishedAt = Date.now();
        void persistRun(state);
        return;
      }
      const hasOutput = state.outputParts.join("\n").trim() !== "";
      const codexCompletedWithOutput = state.agentProvider === "codex" && hasOutput && (code === 0 || isRecoverableCodexDiagnosticError(state.error));
      if ((code === 0 && !state.fatalError) || codexCompletedWithOutput) {
        if (!hasOutput && state.emptyOutputRetries < PERSONAL_LOCAL_AGENT_EMPTY_OUTPUT_RETRIES) {
          state.emptyOutputRetries += 1;
          void persistRun(state);
          void startAttempt(state, detected, retryPrompt(prompt), attempt + 1);
          return;
        }
        state.status = hasOutput ? "completed" : "failed";
        state.error = hasOutput ? null : `${detected.name} run 退出码为 0，但没有产生任何可展示给用户的文本输出；自动重试后仍为空。`;
      } else {
        state.status = "failed";
        if (!state.error) state.error = `进程退出码 ${code ?? "unknown"}`;
      }
      state.finishedAt = Date.now();
      void persistRun(state);
    });
  }

  async function start(input = {}) {
    const agent = normalizePersonalLocalAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const prompt = String(input.prompt ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!prompt) throw new Error("prompt is required");
    const detected = await detectPersonalLocalAgent(agent, workspaceRoot);
    if (detected.status !== "online") throw new Error(detected.error || `${detected.name} 不可用`);
    const id = runId();
    const logRoot = runLogRoot(workspaceRoot);
    await mkdir(logRoot, { recursive: true });
    const state = {
      runId: id,
      agentId: detected.id,
      agentProvider: detected.provider,
      connectionMode: personalLocalAgentConnectionMode(detected.provider),
      status: "running",
      workspaceRoot,
      startedAt: Date.now(),
      finishedAt: null,
      pid: null,
      command: "",
      outputParts: [],
      error: null,
      events: [],
      logPath: path.join(logRoot, `${id}.jsonl`),
      stdoutBuffer: "",
      stderrBuffer: "",
      emptyOutputRetries: 0,
      fatalError: false,
    };
    runs.set(id, state);
    await startAttempt(state, detected, prompt, 0);
    return snapshotRun(state);
  }

  async function run(input = {}) {
    const started = await start(input);
    return new Promise((resolve) => {
      const poll = () => {
        const current = status(started.runId);
        if (current.status !== "running") resolve(current);
        else setTimeout(poll, 250);
      };
      poll();
    });
  }

  function status(idInput) {
    const id = String(idInput ?? "");
    const state = runs.get(id);
    if (!state) return { ok: false, runId: id, agentId: "", status: "missing", startedAt: 0, finishedAt: null, pid: null, command: "", output: "", error: "run not found", events: [], logPath: null };
    return snapshotRun(state);
  }

  function cancel(idInput) {
    const id = String(idInput ?? "");
    const child = processes.get(id);
    const state = runs.get(id);
    if (!child || !state) return { ok: false, error: "run not found" };
    state.status = "cancelled";
    state.error = state.error || "用户取消";
    appendRunEvent(state.events, { type: "log", text: "cancel requested" });
    void persistRun(state);
    void terminateProcessTree(child).catch(() => undefined);
    return { ok: true };
  }

  return {
    normalizeAgent: async (input) => normalizePersonalLocalAgent(input),
    listAgents: listPersonalLocalAgents,
    detectAgent: detectPersonalLocalAgent,
    start,
    run,
    status,
    cancel,
    readAgentManagementPreferences,
    writeAgentManagementPreferences,
    emptyAgentUsageSummary,
    readPersonalAgentUsageSummary,
    runCommandCapture: exec.runCommandCapture,
    processEnv: exec.processEnv,
  };
}
