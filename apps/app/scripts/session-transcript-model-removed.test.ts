import { describe, expect, test } from "bun:test";

import {
  isTranscriptModelRemoved,
  resolveConnectedProviderIds,
} from "../src/react-app/domains/session/surface/message-list/connected-providers-context";

describe("transcript model removed badge", () => {
  test("treats a missing or empty connected list as unknown", () => {
    const input = {
      modelId: "doubao-seed-evolving",
      providerId: "ark",
    };
    expect(isTranscriptModelRemoved({ ...input, connectedProviderIds: null })).toBe(false);
    expect(isTranscriptModelRemoved({ ...input, connectedProviderIds: undefined })).toBe(false);
    expect(isTranscriptModelRemoved({ ...input, connectedProviderIds: new Set() })).toBe(false);
    expect(resolveConnectedProviderIds([])).toBeNull();
    expect(resolveConnectedProviderIds(["", "  "])).toBeNull();
    expect(resolveConnectedProviderIds(null)).toBeNull();
  });

  test("badges only when a discovered catalog omits the message provider", () => {
    const connected = resolveConnectedProviderIds(["openai", "anthropic"]);
    expect(connected).not.toBeNull();
    expect(
      isTranscriptModelRemoved({
        modelId: "doubao-seed-evolving",
        providerId: "ark",
        connectedProviderIds: connected,
      }),
    ).toBe(true);
    expect(
      isTranscriptModelRemoved({
        modelId: "gpt-4.1",
        providerId: "openai",
        connectedProviderIds: connected,
      }),
    ).toBe(false);
  });
});
