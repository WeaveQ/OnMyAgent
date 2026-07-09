import { describe, expect, it } from "bun:test";
import {
  isPersonalLocalAgentProvider,
  isUnsupportedNativeTranscriptError,
  PROVIDER_LABELS,
  TRANSCRIPT_SOFT_ERRORS,
} from "../src/react-app/domains/local-agents/constants";

describe("PROVIDER_LABELS", () => {
  it("exposes a stable label for every known provider", () => {
    expect(PROVIDER_LABELS.opencode).toBe("OpenCode");
    expect(PROVIDER_LABELS.codex).toBe("Codex");
    expect(PROVIDER_LABELS.claude).toBe("Claude Code");
    expect(PROVIDER_LABELS.openclaw).toBe("OpenClaw");
    expect(PROVIDER_LABELS.hermes).toBe("Hermes");
    expect(PROVIDER_LABELS.custom).toBe("Custom");
    expect(Object.keys(PROVIDER_LABELS)).toEqual(["opencode", "codex", "claude", "openclaw", "hermes", "custom"]);
  });
});

describe("isPersonalLocalAgentProvider", () => {
  it("accepts known providers", () => {
    for (const provider of Object.keys(PROVIDER_LABELS)) {
      expect(isPersonalLocalAgentProvider(provider)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isPersonalLocalAgentProvider("slack")).toBe(false);
    expect(isPersonalLocalAgentProvider("")).toBe(false);
    expect(isPersonalLocalAgentProvider("CODEX")).toBe(false);
  });
});

describe("isUnsupportedNativeTranscriptError", () => {
  it("returns false for empty / missing errors", () => {
    expect(isUnsupportedNativeTranscriptError(null)).toBe(false);
    expect(isUnsupportedNativeTranscriptError(undefined)).toBe(false);
    expect(isUnsupportedNativeTranscriptError("")).toBe(false);
  });

  it("returns true for the known soft errors", () => {
    expect(isUnsupportedNativeTranscriptError("This provider does not expose a stable native transcript.")).toBe(true);
    expect(isUnsupportedNativeTranscriptError("Codex session transcript file was not found.")).toBe(true);
    expect(isUnsupportedNativeTranscriptError("Claude session transcript file was not found.")).toBe(true);
  });

  it("returns false for arbitrary errors", () => {
    expect(isUnsupportedNativeTranscriptError("something blew up")).toBe(false);
  });

  it("keeps the soft-error set in sync with the predicate", () => {
    expect(TRANSCRIPT_SOFT_ERRORS.size).toBe(3);
    for (const message of TRANSCRIPT_SOFT_ERRORS) {
      expect(isUnsupportedNativeTranscriptError(message)).toBe(true);
    }
  });
});
