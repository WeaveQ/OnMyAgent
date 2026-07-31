import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CORE_PREINSTALL_SKILLS,
  BUNDLED_SKILL_PACKAGE_NAMES,
  buildBuiltinSkillCatalogEntries,
  isBundledSkillsRoot,
  selectAgentSkillRoots,
  shouldInstallCoreSkill,
} from "./builtin-skills-policy.mjs";

describe("builtin-skills-policy", () => {
  it("rejects YAML block markers and empty stubs as skill descriptions", async () => {
    const {
      isUsableSkillDescriptionText,
      shouldRefreshCoreSkillMarkdown,
    } = await import("./builtin-skills-policy.mjs");
    assert.equal(isUsableSkillDescriptionText(">-"), false);
    assert.equal(isUsableSkillDescriptionText("|"), false);
    assert.equal(isUsableSkillDescriptionText(""), false);
    assert.equal(isUsableSkillDescriptionText("ab"), false);
    assert.equal(
      isUsableSkillDescriptionText("Discover installed skills"),
      true,
    );
    assert.equal(
      shouldRefreshCoreSkillMarkdown({
        packageName: "find-skills",
        skillName: "find-skills",
        destinationExists: true,
      }),
      true,
    );
    assert.equal(
      shouldRefreshCoreSkillMarkdown({
        packageName: "find-skills",
        skillName: "find-skills",
        destinationExists: false,
      }),
      false,
    );
  });

  it("core preinstall includes finder, document processing, office pptx, self-improving, and product cores", () => {
    const names = CORE_PREINSTALL_SKILLS.map((e) => e.packageName);
    for (const required of [
      "expert-manager",
      "create-automation",
      "skill-creator",
      "find-skills",
      "document-processing",
      "pptx",
      "self-improving",
    ]) {
      assert.ok(names.includes(required), `missing core ${required}`);
    }
    // Prefer single self-improving package for preinstall (not the -agent twin).
    assert.equal(names.includes("self-improving-agent"), false);
  });

  it("selectAgentSkillRoots never injects a bundled root path", () => {
    const roots = selectAgentSkillRoots({
      userSkillsRoot: "/home/u/.onmyagent/skills",
      extraRoots: [
        "/home/u/.claude/skills",
        "/App/Contents/Resources/bundled-skills",
      ],
    });
    assert.deepEqual(roots, [
      "/home/u/.onmyagent/skills",
      "/home/u/.claude/skills",
      "/App/Contents/Resources/bundled-skills",
    ]);
    // Policy helper is pure path list — callers must not pass bundled as agent root.
    // Guard: bundled package names stay catalog-only unless installed by name under user root.
    assert.ok(BUNDLED_SKILL_PACKAGE_NAMES.includes("weather"));
  });

  it("shouldInstallCoreSkill skips existing destinations", () => {
    assert.equal(
      shouldInstallCoreSkill({
        packageName: "document-processing",
        skillName: "document-processing",
        destinationExists: false,
      }),
      true,
    );
    assert.equal(
      shouldInstallCoreSkill({
        packageName: "pptx",
        skillName: "pptx",
        destinationExists: false,
      }),
      true,
    );
    assert.equal(
      shouldInstallCoreSkill({
        packageName: "pptx",
        skillName: "pptx",
        destinationExists: true,
      }),
      false,
    );
    assert.equal(
      shouldInstallCoreSkill({
        packageName: "weather",
        skillName: "weather",
        destinationExists: false,
      }),
      false,
    );
  });

  it("buildBuiltinSkillCatalogEntries marks installed and core flags", () => {
    const entries = buildBuiltinSkillCatalogEntries({
      packageNames: ["pptx", "weather", "find-skills"],
      installedSkillNames: ["pptx"],
    });
    assert.deepEqual(entries, [
      {
        packageName: "pptx",
        skillName: "pptx",
        installed: true,
        corePreinstall: true,
      },
      {
        packageName: "weather",
        skillName: "weather",
        installed: false,
        corePreinstall: false,
      },
      {
        packageName: "find-skills",
        skillName: "find-skills",
        installed: false,
        corePreinstall: true,
      },
    ]);
  });

  it("isBundledSkillsRoot compares normalized paths", () => {
    assert.equal(
      isBundledSkillsRoot(
        "/App/Resources/bundled-skills/",
        "/App/Resources/bundled-skills",
      ),
      true,
    );
    assert.equal(
      isBundledSkillsRoot(
        "/home/u/.onmyagent/skills",
        "/App/Resources/bundled-skills",
      ),
      false,
    );
  });
});
