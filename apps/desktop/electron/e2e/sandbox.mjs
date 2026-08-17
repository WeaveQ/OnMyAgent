/**
 * Temp HOME / userData / workspace for desktop OpenCode e2e.
 * Never touches the real ~/.onmyagent or ~/.opencode.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  HOME_CONFIG_SLASH_SKILL_NAMES,
  applyOpencodeSandboxEnv,
  linkHomeConfigOpencodeSkills,
  prepareOpencodeSandboxHome,
  sandboxOpencodeConfigDir,
} from "../opencode-sandbox-home.mjs";

export const POISON_TOOL_ID = "sisyphus_poison_tool";

export const POISON_PLUGIN_SOURCE = `import { tool } from "@opencode-ai/plugin"

export default async () => ({
  tool: {
    ${POISON_TOOL_ID}: tool({
      description: "Isolation canary. Must never load in the product sandbox.",
      args: {
        ping: tool.schema.string().optional(),
      },
      async execute() {
        return "poison"
      },
    }),
  },
})
`;

/**
 * @param {{
 *   prefix?: string,
 *   poisonPlugin?: boolean,
 *   linkSlashSkills?: boolean,
 *   slashSkillNames?: readonly string[],
 *   seedAuthJson?: string,
 * }} [opts]
 */
export async function createDesktopE2eSandbox(opts = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), opts.prefix ?? "oma-desktop-e2e-"));
  const realHome = path.join(root, "real-home");
  const userData = path.join(root, "user-data");
  const workspace = path.join(root, "workspace");
  const realConfigDir = path.join(realHome, ".config", "opencode");
  const poisonPath = path.join(realHome, ".opencode", "plugin", "poison.mjs");
  await mkdir(realConfigDir, { recursive: true });
  await mkdir(path.join(workspace, ".opencode"), { recursive: true });
  if (opts.poisonPlugin) {
    await mkdir(path.dirname(poisonPath), { recursive: true });
    await writeFile(poisonPath, POISON_PLUGIN_SOURCE, "utf8");
  }
  const seedAuth = String(opts.seedAuthJson ?? "").trim();
  if (seedAuth && existsSync(seedAuth)) {
    const authDst = path.join(realHome, ".local", "share", "opencode", "auth.json");
    await mkdir(path.dirname(authDst), { recursive: true });
    await copyFile(seedAuth, authDst);
  }
  await writeFile(
    path.join(realConfigDir, "opencode.json"),
    `${JSON.stringify(
      {
        plugin: opts.poisonPlugin ? [poisonPath] : [],
        provider: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const paths = await prepareOpencodeSandboxHome({
    userDataDir: userData,
    realHomeDir: realHome,
  });
  const configDir = sandboxOpencodeConfigDir(paths);
  if (opts.linkSlashSkills) {
    const names = opts.slashSkillNames ?? HOME_CONFIG_SLASH_SKILL_NAMES;
    for (const name of names) {
      const skillDir = path.join(configDir, "skills", name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: desktop e2e ${name}\n---\n`,
        "utf8",
      );
    }
    await linkHomeConfigOpencodeSkills({
      homeDir: paths.homeDir,
      configDir,
    });
  }
  return { root, realHome, userData, workspace, paths, poisonPath, configDir };
}

/**
 * @param {Awaited<ReturnType<typeof createDesktopE2eSandbox>>} sandbox
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
export function sandboxChildEnv(sandbox, baseEnv = process.env) {
  return applyOpencodeSandboxEnv(
    {
      ...baseEnv,
      OPENCODE_CLIENT: "onmyagent-desktop-e2e",
      ONMYAGENT_REAL_HOME: sandbox.realHome,
    },
    sandbox.paths,
  );
}
