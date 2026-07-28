import { describe, expect, test } from "bun:test";

import {
  buildCustomInstructionsSystemPrompt,
  buildResponseToneSystemPrompt,
  normalizeResponseTone,
} from "../src/react-app/kernel/response-tone";

describe("response tone", () => {
  test("maps legacy business to pragmatic and keeps friendly", () => {
    expect(normalizeResponseTone("business")).toBe("pragmatic");
    expect(normalizeResponseTone("friendly")).toBe("friendly");
    expect(normalizeResponseTone("unknown")).toBe("pragmatic");
    expect(normalizeResponseTone(null)).toBe("pragmatic");
  });

  test("default tone injects no system prompt", () => {
    expect(buildResponseToneSystemPrompt("default")).toBeNull();
  });

  test("named tones inject style guidance", () => {
    const pragmatic = buildResponseToneSystemPrompt("pragmatic");
    expect(pragmatic).toContain("high-density");
    const socratic = buildResponseToneSystemPrompt("socratic");
    expect(socratic).toContain("Socratic");
  });

  test("custom instructions are trimmed and bounded", () => {
    expect(buildCustomInstructionsSystemPrompt("  ")).toBeNull();
    const prompt = buildCustomInstructionsSystemPrompt("Use Chinese.");
    expect(prompt).toContain("Use Chinese.");
    expect(prompt).toContain("custom instructions");
  });
});
