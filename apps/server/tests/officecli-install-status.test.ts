import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isOfficeCliInstalled } from "../src/services/officecli-install-status.js";

describe("isOfficeCliInstalled", () => {
  test("detects profile skill path", async () => {
    const home = await mkdtemp(join(tmpdir(), "oma-officecli-status-"));
    try {
      expect(await isOfficeCliInstalled(home)).toBe(false);
      const skillDir = join(
        home,
        ".onmyagent",
        "profiles",
        "local",
        "config",
        "skills",
        "officecli",
      );
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "---\nname: officecli\n---\n", "utf8");
      expect(await isOfficeCliInstalled(home)).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("detects legacy skill path", async () => {
    const home = await mkdtemp(join(tmpdir(), "oma-officecli-legacy-"));
    try {
      const skillDir = join(home, ".onmyagent", "skills", "officecli");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "---\nname: officecli\n---\n", "utf8");
      expect(await isOfficeCliInstalled(home)).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
