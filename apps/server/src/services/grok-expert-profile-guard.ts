import { ApiError } from "../core/errors.js";

const FORBIDDEN_PROFILE_KEYS = new Set([
  "hooks",
  "bashConfig",
  "injectDefaultTools",
  "inheritSkills",
  "discoverSkills",
  "mcpInheritance",
  "permissionMode",
  "agentsMd",
]);

const ALLOWED_PROFILE_KEYS = new Set([
  "name",
  "description",
  "promptMode",
  "promptBody",
  "permissionMode",
  "discoverSkills",
  "inheritSkills",
  "injectDefaultTools",
  "agentsMd",
  "skills",
  "mcpInheritance",
  "toolConfig",
]);

export const GROK_TOOL_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  "GrokBuild:run_terminal_cmd": [
    "GrokBuild:get_task_output",
    "GrokBuild:kill_task",
  ],
};

export function closeGrokToolDependencies(toolIds: readonly string[]): string[] {
  const closed = new Set(toolIds);
  for (const toolId of toolIds) {
    for (const dependency of GROK_TOOL_DEPENDENCIES[toolId] ?? []) {
      closed.add(dependency);
    }
  }
  return [...closed].sort();
}

export function assertSafeGrokExpertProfile(profile: unknown): void {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new ApiError(409, "grok_expert_profile_invalid", "Grok Expert profile must be an object");
  }
  const value = profile as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!ALLOWED_PROFILE_KEYS.has(key)) {
      throw new ApiError(409, "grok_expert_profile_field_forbidden", `Grok Expert profile field is not allowed: ${key}`);
    }
  }
  if (value.injectDefaultTools !== false) {
    throw new ApiError(409, "grok_expert_profile_default_tools", "Grok Expert must keep injectDefaultTools=false");
  }
  if (value.inheritSkills !== false || value.discoverSkills !== false) {
    throw new ApiError(409, "grok_expert_profile_skill_inheritance", "Grok Expert must not inherit or discover skills");
  }
  if (value.mcpInheritance !== "none") {
    throw new ApiError(409, "grok_expert_profile_mcp", "Grok Expert must keep mcpInheritance=none");
  }
  if (value.permissionMode !== "default") {
    throw new ApiError(409, "grok_expert_profile_permission", "Grok Expert must keep permissionMode=default");
  }
  if (value.agentsMd !== false) {
    throw new ApiError(409, "grok_expert_profile_agents_md", "Grok Expert must not load agents.md");
  }
  if (Object.prototype.hasOwnProperty.call(value, "hooks")) {
    throw new ApiError(409, "grok_expert_profile_hooks", "Grok Expert profile must not include hooks");
  }
  const toolConfig = value.toolConfig;
  if (!toolConfig || typeof toolConfig !== "object" || Array.isArray(toolConfig)) {
    throw new ApiError(409, "grok_expert_tool_config_invalid", "Grok Expert toolConfig must be an object");
  }
  if (!Object.prototype.hasOwnProperty.call(toolConfig, "tools")
    || !Array.isArray((toolConfig as { tools?: unknown }).tools)) {
    throw new ApiError(409, "grok_expert_tool_config_invalid", "Grok Expert toolConfig.tools must be an array");
  }
  for (const forbidden of FORBIDDEN_PROFILE_KEYS) {
    if (forbidden === "injectDefaultTools"
      || forbidden === "inheritSkills"
      || forbidden === "discoverSkills"
      || forbidden === "mcpInheritance"
      || forbidden === "permissionMode"
      || forbidden === "agentsMd") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(value, forbidden)) {
      throw new ApiError(409, "grok_expert_profile_field_forbidden", `Grok Expert profile field is not allowed: ${forbidden}`);
    }
  }
}
