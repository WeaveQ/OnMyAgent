import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUNDLED_SKILL_PACKAGE_NAMES,
  CORE_PREINSTALL_SKILLS,
} from "./builtin-skills-policy.mjs";

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(electronRoot, "..");
const skillRoot = path.join(
  desktopRoot,
  "resources",
  "bundled-skills",
  "document-processing",
);
const expertsRoot = path.join(
  desktopRoot,
  "resources",
  "marketplace",
  "experts",
  "plugins",
);

const logisticsExperts = [
  "order-dispatch-specialist",
  "fleet-management-specialist",
  "fulfillment-specialist",
  "logistics-finance-specialist",
];

describe("document-processing bundled skill", () => {
  it("has one skill entry and focused format references", () => {
    const skillText = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const frontmatter = skillText.match(/^---\n([\s\S]*?)\n---/);

    assert.ok(frontmatter);
    assert.deepEqual(
      frontmatter[1]
        .split("\n")
        .map((line) => line.split(":")[0])
        .filter(Boolean),
      [
        "name",
        "description",
        "display_name_zh",
        "display_name_en",
        "description_zh",
        "description_en",
      ],
    );
    assert.match(skillText, /name: document-processing/);
    for (const formatSkill of [
      "documents",
      "spreadsheets",
      "pptx",
      "pdf",
    ]) {
      assert.match(skillText, new RegExp(`\\\`${formatSkill}\\\``));
    }
    assert.deepEqual(readdirSync(path.join(skillRoot, "references")).sort(), [
      "pdf.md",
      "presentations.md",
      "quality-and-handoff.md",
      "spreadsheets.md",
      "word.md",
    ]);
    assert.equal(existsSync(path.join(skillRoot, "agents")), false);
    assert.equal(existsSync(path.join(skillRoot, "scripts")), false);
    assert.equal(existsSync(path.join(skillRoot, "schemas")), false);
  });

  it("is shipped and preinstalled for normal and expert sessions", () => {
    assert.ok(BUNDLED_SKILL_PACKAGE_NAMES.includes("document-processing"));
    assert.ok(
      CORE_PREINSTALL_SKILLS.some(
        (entry) =>
          entry.packageName === "document-processing" &&
          entry.skillName === "document-processing",
      ),
    );
  });

  it("routes to document runtimes that are enabled by default", () => {
    for (const skillName of ["documents", "spreadsheets", "pdf"]) {
      const artifactConfig = JSON.parse(
        readFileSync(
          path.join(
            desktopRoot,
            "resources",
            "bundled-plugins",
            skillName,
            ".onmyagent",
            "artifact.json",
          ),
          "utf8",
        ),
      );
      assert.ok(
        artifactConfig.skills.some(
          (skill) =>
            skill.id === skillName && skill.defaultEnabled === true,
        ),
        `${skillName} must be enabled by default`,
      );
    }
    assert.equal(
      existsSync(
        path.join(
          desktopRoot,
          "resources",
          "bundled-skills",
          "pptx",
          "SKILL.md",
        ),
      ),
      true,
    );
  });

  it("is an explicit shared dependency of all four logistics experts", () => {
    for (const expertName of logisticsExperts) {
      const agentPath = path.join(
        expertsRoot,
        expertName,
        "agents",
        `${expertName}.md`,
      );
      const agentText = readFileSync(agentPath, "utf8");
      assert.match(
        agentText,
        /skills: \[[^\]]*document-processing[^\]]*\]/,
        `${expertName} must declare document-processing`,
      );
      assert.match(
        agentText,
        /使用 `document-processing` 技能处理文件/,
        `${expertName} must route document work through the shared skill`,
      );
      assert.match(
        agentText,
        /仍按本专家的业务技能判断/,
        `${expertName} must keep business judgment in its domain skills`,
      );
    }
  });
});
