import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readPairingPanel() {
  return readFileSync(
    join(repoRoot, "apps/app/src/react-app/domains/messaging/ChannelPairingPanel.tsx"),
    "utf8",
  );
}

describe("messaging pairing panel contract", () => {
  test("renders pushed pairing requests before background reconciliation settles", () => {
    const source = readPairingPanel();
    expect(source).toContain("parsePairingRequest(payload)");
    expect(source).toContain("applyPairingRequest(request)");
    expect(source).toContain("loadGenerationRef");
    expect(source).toContain("const generation = ++loadGenerationRef.current");
    expect(source).toContain("if (generation !== loadGenerationRef.current) return");
    expect(source).toContain("onChannelUserAuthorized");
  });

  test("loads session metrics for every supported messaging platform", () => {
    const source = readPairingPanel();
    for (const platform of ["wechat", "feishu", "telegram", "discord"]) {
      expect(source).toContain(`channelGetSessionsByPlatform("${platform}")`);
    }
  });
});
