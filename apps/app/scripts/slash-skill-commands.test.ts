import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createInjectedSkillContentLoader,
  isInjectedSkillCommand,
  resolveSlashSkillSend,
} from "../src/react-app/domains/session/sync/slash-skill-commands";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readHookSource() {
  return readFileSync(
    join(appRoot, "src/react-app/shell/session-route/surface-props-hook-impl.ts"),
    "utf8",
  );
}

describe("isInjectedSkillCommand", () => {
  test("treats skill-creator like expert-manager even without command.list source", () => {
    expect(isInjectedSkillCommand("skill-creator")).toBe(true);
    expect(isInjectedSkillCommand("expert-manager")).toBe(true);
    expect(isInjectedSkillCommand("review")).toBe(false);
    expect(isInjectedSkillCommand("review", "skill")).toBe(true);
    expect(isInjectedSkillCommand("")).toBe(false);
  });
});

describe("resolveSlashSkillSend — shipped send-path decision", () => {
  test("succeeding load injects SKILL.md and a visible [[skill:]] marker", async () => {
    const decision = await resolveSlashSkillSend({
      commandName: "skill-creator",
      arguments: '请帮我创建一个可以实现「截图」的skill',
      loadSkillContent: async () => "# Skill Creator\nWrite to installed-skills.",
    });
    expect(decision.kind).toBe("inject");
    if (decision.kind !== "inject") return;
    expect(decision.systemPrompt).toContain("# Skill Creator");
    expect(decision.systemPrompt).toContain("Write to installed-skills.");
    expect(decision.systemPrompt).toContain("```markdown");
    expect(decision.visiblePrompt).toBe(
      "[[skill:skill-creator]] 请帮我创建一个可以实现「截图」的skill",
    );
  });

  test("failed load is a visible fail, not the bare session.command branch", async () => {
    const missing = await resolveSlashSkillSend({
      commandName: "skill-creator",
      arguments: "make a skill",
      loadSkillContent: async () => null,
    });
    expect(missing).toEqual({ kind: "fail", commandName: "skill-creator" });
    expect(missing.kind).not.toBe("command");

    const thrown = await resolveSlashSkillSend({
      commandName: "skill-creator",
      commandSource: "command",
      arguments: "make a skill",
      loadSkillContent: async () => {
        throw new Error("skill_not_found");
      },
    });
    expect(thrown).toEqual({ kind: "fail", commandName: "skill-creator" });
  });

  test("non-skill slash stays on the command branch and does not load a body", async () => {
    let loaded = false;
    const decision = await resolveSlashSkillSend({
      commandName: "review",
      arguments: "this pr",
      loadSkillContent: async () => {
        loaded = true;
        return "# should not load";
      },
    });
    expect(decision).toEqual({ kind: "command" });
    expect(loaded).toBe(false);
  });
});

describe("createInjectedSkillContentLoader", () => {
  test("ensures install first, then falls back through installed root and bundled copy", async () => {
    const calls: string[] = [];
    const load = createInjectedSkillContentLoader({
      getSkill: async () => {
        calls.push("getSkill");
        throw new Error("skill_not_found");
      },
      ensureInstalled: async (name) => {
        calls.push(`ensure:${name}`);
      },
      readInstalled: async () => {
        calls.push("readInstalled");
        return null;
      },
      bundledByName: { "skill-creator": "# bundled skill-creator" },
    });
    await expect(load("skill-creator")).resolves.toBe("# bundled skill-creator");
    expect(calls).toEqual(["ensure:skill-creator", "getSkill", "readInstalled"]);
  });

  test("returns null only after every loader misses", async () => {
    const load = createInjectedSkillContentLoader({
      getSkill: async () => {
        throw new Error("missing");
      },
    });
    await expect(load("skill-creator")).resolves.toBeNull();
  });
});

describe("session send path wires inject-or-visible-fail", () => {
  test("hook uses the shared decision and never swallows into session.command", () => {
    const hook = readHookSource();
    expect(hook).toContain("resolveSlashSkillSend");
    expect(hook).toContain("createInjectedSkillContentLoader");
    expect(hook).toContain("session.skill_inject_failed");
    expect(hook).toContain("installBuiltinSkillPackage");
    expect(hook).not.toContain("falling back to command");
    expect(hook).not.toContain('command.name === "expert-manager"');
    expect(hook).not.toContain("domains/session/sync/slash-skill-commands");
    const barrel = readFileSync(
      join(appRoot, "src/react-app/domains/session/index.ts"),
      "utf8",
    );
    expect(barrel).toContain("resolveSlashSkillSend");
    expect(barrel).toContain("createInjectedSkillContentLoader");
    expect(barrel).toContain("CORE_SLASH_SKILL_COMMAND_NAMES");
  });
});
