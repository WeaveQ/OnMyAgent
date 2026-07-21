import { describe, expect, test } from "bun:test";

import {
  parseAutoSlashCommandReference,
  parseSkillReference,
} from "../src/react-app/domains/session/surface/skill-reference";

const sampleAutoSlash = `<auto-slash-command>
# /antd Command

**Description**: (project - Skill) Use when the user's task involves Ant Design (antd) – writing antd components.

**User Arguments**: 你是什么技能

**Scope**: skill

---

## Command Instructions

Do antd things carefully.
</auto-slash-command>`;

describe("parseSkillReference", () => {
  test("collapses auto-slash-command harness dump into chip + args", () => {
    expect(parseSkillReference(sampleAutoSlash)).toEqual({
      name: "antd",
      arguments: "你是什么技能",
    });
  });

  test("collapses untagged auto-slash dumps that still carry headers", () => {
    const untagged = sampleAutoSlash
      .replace(/<\/?auto-slash-command>/gi, "")
      .trim();
    expect(parseAutoSlashCommandReference(untagged)).toEqual({
      name: "antd",
      arguments: "你是什么技能",
    });
  });

  test("keeps compact slash form", () => {
    expect(parseSkillReference("/obsidian 你是什么技能")).toEqual({
      name: "obsidian",
      arguments: "你是什么技能",
    });
  });

  test("keeps [[skill:]] marker form", () => {
    expect(parseSkillReference("[[skill:review]] please check this")).toEqual({
      name: "review",
      arguments: "please check this",
    });
  });

  test("returns null for ordinary chat text", () => {
    expect(parseSkillReference("你好，帮我写一段文案")).toBeNull();
  });
});
