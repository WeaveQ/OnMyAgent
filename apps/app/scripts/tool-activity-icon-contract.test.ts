import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const toolActivityPath = resolve(
  root,
  "apps/app/src/react-app/domains/session/surface/message-list/tool-activity-icon.tsx",
);

describe("tool-activity icon semantics", () => {
  test("browser category uses Compass, not Eye (read/viewed)", () => {
    const src = readFileSync(toolActivityPath, "utf8");
    expect(src).toContain("Compass");
    // browser branch must not return Eye
    expect(src).toMatch(/case "browser":\s*[\s\S]*?return <Compass/);
    expect(src).not.toMatch(/case "browser":\s*[\s\S]*?return <Eye/);
    // read still uses Eye
    expect(src).toMatch(/case "read":\s*[\s\S]*?return <Eye/);
  });
});
