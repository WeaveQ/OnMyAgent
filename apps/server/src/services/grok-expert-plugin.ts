import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GrokExpertProfile } from "./grok-expert-profile-compiler.js";

export async function materializeGrokExpertPlugin(input: {
  directory: string;
  profile: GrokExpertProfile;
}): Promise<{ pluginDir: string; agentName: string }> {
  const pluginDir = input.directory;
  const agentName = input.profile.name;
  await mkdir(join(pluginDir, "agents"), { recursive: true });
  await writeFile(
    join(pluginDir, "plugin.json"),
    `${JSON.stringify({ name: agentName, agents: [`./agents/${agentName}.md`] }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(pluginDir, "agents", `${agentName}.md`),
    [
      "---",
      `name: ${agentName}`,
      `description: ${JSON.stringify(input.profile.description)}`,
      "promptMode: full",
      "permissionMode: default",
      "injectDefaultTools: false",
      "discoverSkills: false",
      "inheritSkills: false",
      "agentsMd: false",
      "mcpInheritance: none",
      "---",
      "",
      input.profile.promptBody,
      "",
    ].join("\n"),
    "utf8",
  );
  return { pluginDir, agentName };
}

export function grokNativeAgentProfilePayload(profile: GrokExpertProfile): Record<string, unknown> {
  return {
    name: profile.name,
    description: profile.description,
    promptMode: profile.promptMode,
    promptBody: profile.promptBody,
    permissionMode: profile.permissionMode,
    discoverSkills: profile.discoverSkills,
    inheritSkills: profile.inheritSkills,
    injectDefaultTools: profile.injectDefaultTools,
    agentsMd: profile.agentsMd,
    skills: profile.skills,
    mcpInheritance: profile.mcpInheritance,
    toolConfig: profile.toolConfig,
  };
}
