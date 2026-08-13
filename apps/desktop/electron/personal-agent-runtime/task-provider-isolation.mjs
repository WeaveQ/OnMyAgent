// @ts-check

const CODEX_TASK_FEATURE_OVERRIDES = Object.freeze({
  multi_agent: false,
  multi_agent_v2: false,
});
const OPENCODE_TASK_TOOL_OVERRIDES = Object.freeze({ task: false });

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Task Center owns delegation through its durable MCP control plane. Provider
 * native collaboration tools must therefore be disabled for every Task
 * attempt, including depth-one workers, or child work can escape leases,
 * budgets, recovery, and the audit log. Only providers with a documented
 * native config surface are changed here; ordinary Personal sessions remain
 * untouched.
 *
 * The override is process-local. Existing provider config values are
 * preserved in memory and never logged; malformed values fail closed for
 * Task runs.
 * Ordinary Personal Agent sessions are returned unchanged.
 *
 * @param {Record<string, string | undefined>} environment
 * @param {{provider?: unknown, taskId?: unknown}} context
 */
export function isolateTaskProviderEnvironment(environment, context = {}) {
  const provider = String(context.provider ?? "").trim();
  if (!String(context.taskId ?? "").trim() || !["codex", "opencode"].includes(provider)) {
    return environment;
  }

  const configKey = provider === "codex" ? "CODEX_CONFIG" : "OPENCODE_CONFIG_CONTENT";
  const raw = String(environment[configKey] ?? "").trim();
  let existing = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("not an object");
      existing = parsed;
    } catch {
      throw new Error(`Task ${provider === "codex" ? "Codex" : "OpenCode"} isolation requires ${configKey} to be a JSON object`);
    }
  }
  const next = provider === "codex"
    ? {
        ...existing,
        features: {
          ...(isRecord(existing.features) ? existing.features : {}),
          ...CODEX_TASK_FEATURE_OVERRIDES,
        },
      }
    : {
        ...existing,
        tools: {
          ...(isRecord(existing.tools) ? existing.tools : {}),
          ...OPENCODE_TASK_TOOL_OVERRIDES,
        },
      };
  return {
    ...environment,
    [configKey]: JSON.stringify(next),
  };
}

export const TASK_CODEX_DISABLED_NATIVE_FEATURES = Object.freeze(Object.keys(CODEX_TASK_FEATURE_OVERRIDES));
export const TASK_OPENCODE_DISABLED_NATIVE_TOOLS = Object.freeze(Object.keys(OPENCODE_TASK_TOOL_OVERRIDES));
