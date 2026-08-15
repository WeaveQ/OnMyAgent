import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { applyOpenCodeChildGlobalSkillsDir } from "../src/services/opencode-global-skills-env.js";

describe("skill-role OpenCode child env", () => {
  test("shared child disables external skills and drops profile GLOBAL_SKILLS_DIR", () => {
    const env = applyOpenCodeChildGlobalSkillsDir({
      OPENCODE_GLOBAL_SKILLS_DIR: "/home/user/.onmyagent/profiles/local/config/skills",
      HOME: "/sandbox",
    });
    expect(env.OPENCODE_GLOBAL_SKILLS_DIR).toBeUndefined();
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
    expect(env.HOME).toBe("/sandbox");
  });

  test("production spawn does not pass expertSessionDirectory", async () => {
    const embedded = await readFile(new URL("../src/embedded.ts", import.meta.url), "utf8");
    const cli = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(embedded).toContain("createManagedOpencodeServer");
    expect(embedded).not.toContain("expertSessionDirectory");
    expect(cli).not.toContain("expertSessionDirectory");
  });
});
