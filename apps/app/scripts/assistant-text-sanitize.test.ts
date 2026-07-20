import { describe, expect, test } from "bun:test";

import {
  looksLikeSkillCatalogDump,
  sanitizeAssistantTranscriptText,
  stripSkillCatalogDump,
} from "../src/react-app/capabilities/conversation/assistant-text-sanitize";

const SAMPLE_DUMP = [
  '{"scope":"bundled","path":"/Users/work/.grok/bundled/skills/resume-claude/SKILL.md"}',
  '{"name":"resume-codex","description":"Continue from a recent Codex session","input":{"hint":["words describing the session | session id"]},"_meta":{"scope":"bundled","path":"/Users/work/.grok/bundled/skills/resume-codex/SKILL.md"}}',
  '{"name":"resume-cursor","description":"Continue from a recent Cursor session","input":{"hint":["words describing the session | session id"]},"_meta":{"scope":"bundled","path":"/Users/work/.grok/bundled/skills/resume-cursor/SKILL.md"}}',
  '{"name":"review","description":"Run a reviewer subagent against uncommitted local changes","input":{"hint":["--local | --branch | --pr | "]},"_meta":{"scope":"bundled","path":"/Users/work/.grok/bundled/skills/review/SKILL.md"}}',
].join("");

describe("assistant-text-sanitize skill catalog dumps", () => {
  test("detects concatenated bundled skill JSON walls", () => {
    expect(looksLikeSkillCatalogDump(SAMPLE_DUMP)).toBe(true);
    expect(looksLikeSkillCatalogDump("Hello. How can I help you today?")).toBe(false);
    expect(looksLikeSkillCatalogDump("Use the review skill to check the PR.")).toBe(false);
  });

  test("strips pure dumps to empty and keeps real greetings", () => {
    expect(stripSkillCatalogDump(SAMPLE_DUMP)).toBe("");
    const mixed = `${SAMPLE_DUMP}\n\nHello. How can I help you today?`;
    const cleaned = stripSkillCatalogDump(mixed);
    expect(cleaned).toContain("Hello");
    expect(cleaned).not.toContain("SKILL.md");
  });

  test("sanitizeAssistantTranscriptText reports dump metadata", () => {
    const pure = sanitizeAssistantTranscriptText(SAMPLE_DUMP);
    expect(pure.wasSkillCatalogDump).toBe(true);
    expect(pure.text).toBe("");
    expect(pure.skillCatalogCount).toBeGreaterThanOrEqual(3);

    const greeting = sanitizeAssistantTranscriptText("Hello. How can I help you today?");
    expect(greeting.wasSkillCatalogDump).toBe(false);
    expect(greeting.text).toBe("Hello. How can I help you today?");
  });
});
