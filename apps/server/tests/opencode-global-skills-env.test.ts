import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyOpenCodeChildGlobalSkillsDir,
  expertSessionMaterializedSkillsDir,
} from "../src/services/opencode-global-skills-env.js";

describe("OpenCode child global skills env", () => {
  test("expert session dir is the materialized .opencode/skills folder", () => {
    expect(expertSessionMaterializedSkillsDir("/tmp/expert-session")).toBe(
      join(resolve("/tmp/expert-session"), ".opencode", "skills"),
    );
  });

  test("dedicated expert process points OPENCODE_GLOBAL_SKILLS_DIR at materialized skills", () => {
    const session = "/data/expert-sessions/pkg/ses_1";
    const env = applyOpenCodeChildGlobalSkillsDir(
      { OPENCODE_GLOBAL_SKILLS_DIR: "/home/user/.onmyagent/profiles/local/config/skills" },
      { expertSessionDirectory: session },
    );
    expect(env.OPENCODE_GLOBAL_SKILLS_DIR).toBe(expertSessionMaterializedSkillsDir(session));
  });

  test("shared OpenCode child does not inherit the profile skills root", () => {
    const env = applyOpenCodeChildGlobalSkillsDir({
      OPENCODE_GLOBAL_SKILLS_DIR: "/home/user/.onmyagent/profiles/local/config/skills",
      HOME: "/sandbox",
      ONMYAGENT_REAL_HOME: "/Users/work",
    });
    expect(env.OPENCODE_GLOBAL_SKILLS_DIR).toBeUndefined();
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
    expect(env.HOME).toBe("/sandbox");
    expect(env.ONMYAGENT_REAL_HOME).toBeUndefined();
  });

  test("managed OpenCode spawn applies the child skills-dir policy", async () => {
    const source = await readFile(new URL("../src/managed-opencode.ts", import.meta.url), "utf8");
    expect(source).toContain("applyOpenCodeChildGlobalSkillsDir");
    expect(source).toContain("expertSessionDirectory");
  });
});
