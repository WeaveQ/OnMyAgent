import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const softwareEnvironmentSource = readFileSync(
  new URL("../src/react-app/domains/settings/pages/software-environment-section.tsx", import.meta.url),
  "utf8",
);
const extensionConfigSource = readFileSync(
  new URL("../src/react-app/domains/settings/browser-extension-config.tsx", import.meta.url),
  "utf8",
);

describe("Browser Use software settings placement", () => {
  test("loads and renders Browser Use status in the software environment table", () => {
    expect(softwareEnvironmentSource).toContain('invokeDesktop?.("browserUseStatus")');
    expect(softwareEnvironmentSource).toContain('id: "browser-use"');
    expect(softwareEnvironmentSource).toContain("browserUseVersion");
  });

  test("does not query Browser Use runtime status from the extension config", () => {
    expect(extensionConfigSource).not.toContain("browserUseStatus");
    expect(extensionConfigSource).not.toContain("browserUseVersion");
  });
});
