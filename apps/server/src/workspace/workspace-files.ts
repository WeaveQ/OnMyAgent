import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function opencodeConfigPath(workspaceRoot: string): string {
  const jsoncPath = join(workspaceRoot, "opencode.jsonc");
  const jsonPath = join(workspaceRoot, "opencode.json");
  const hiddenJsoncPath = join(workspaceRoot, ".opencode", "opencode.jsonc");
  const hiddenJsonPath = join(workspaceRoot, ".opencode", "opencode.json");
  if (existsSync(jsoncPath)) return jsoncPath;
  if (existsSync(jsonPath)) return jsonPath;
  if (existsSync(hiddenJsoncPath)) return hiddenJsoncPath;
  if (existsSync(hiddenJsonPath)) return hiddenJsonPath;
  return jsoncPath;
}

export function onmyagentConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent.json");
}

/**
 * OnMyAgent 用户安装 Skill 全局目录，与工作区解耦。
 * 新安装/创建的 Skills 写入此目录，而不是 OpenCode 或工作区目录。
 * 支持通过环境变量 `OPENCODE_GLOBAL_SKILLS_DIR` 覆盖，用于测试。
 */
export function globalSkillsDir(): string {
  const envOverride = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  if (envOverride && envOverride.trim().length > 0) {
    return envOverride;
  }
  return join(homedir(), ".onmyagent", "skills");
}

export function legacyOpencodeSkillsDir(): string {
  return join(homedir(), ".config", "opencode", "skills");
}

export function legacyClaudeSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

export function legacyAgentsSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

export function legacyAgentSkillsDir(): string {
  return join(homedir(), ".agent", "skills");
}

export function bundledSkillsDir(): string | null {
  const value = process.env.ONMYAGENT_BUNDLED_SKILLS_DIR?.trim();
  return value && existsSync(value) ? value : null;
}

export function bundledArtifactPluginsDir(): string | null {
  const value = process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR?.trim();
  return value && existsSync(value) ? value : null;
}

export function projectCommandsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "commands");
}

export function projectPluginsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "plugins");
}
