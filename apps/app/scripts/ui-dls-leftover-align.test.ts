import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CUSTOM_CONNECTOR_AVATAR_TONES } from "../src/react-app/domains/plugins/custom-connector-dialog";

const appRoot = resolve(import.meta.dir, "..");

function readShipped(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

const RAW_FIELD_SURFACES = [
  "src/react-app/domains/plugins/dingtalk-plugin.tsx",
  "src/react-app/domains/plugins/wecom-plugin.tsx",
  "src/react-app/domains/plugins/kdocs-plugin.tsx",
  "src/react-app/domains/plugins/tencent-meeting-plugin.tsx",
  "src/react-app/domains/plugins/baidu-drive-plugin.tsx",
  "src/react-app/domains/workspace/workspace-files-move-dialog.tsx",
] as const;

const PALETTE_LEFTOVERS =
  /bg-rose-500|bg-sky-500|bg-violet-500|bg-amber-500|bg-emerald-500|bg-orange-500/;

const RAW_FIELD = /<(input|textarea)\b/;
const NEW_CHROME = /text-\[[0-9]+px\]|bg-blue-|bg-gray-|text-zinc-/;

describe("UI DLS leftover alignment", () => {
  test("custom-connector avatar tones are shipped DLS fills", () => {
    expect(CUSTOM_CONNECTOR_AVATAR_TONES.length).toBeGreaterThan(0);
    for (const tone of CUSTOM_CONNECTOR_AVATAR_TONES) {
      expect(tone.startsWith("bg-dls-")).toBe(true);
    }
    const source = readShipped("src/react-app/domains/plugins/custom-connector-dialog.tsx");
    expect(source).toContain("CUSTOM_CONNECTOR_AVATAR_TONES");
    expect(source).not.toMatch(PALETTE_LEFTOVERS);
    expect(source).not.toMatch(NEW_CHROME);
  });

  test("plugin credentials and create-folder use Input/Textarea, not raw fields", () => {
    for (const rel of RAW_FIELD_SURFACES) {
      const source = readShipped(rel);
      expect(source, rel).not.toMatch(RAW_FIELD);
      expect(source, rel).toMatch(/<(Input|Textarea)\b/);
      expect(source, rel).not.toMatch(PALETTE_LEFTOVERS);
      expect(source, rel).not.toMatch(NEW_CHROME);
    }
  });
});
