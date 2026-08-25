/**
 * Previous-format golden reads: new code must parse isolationVersion 2 markers,
 * origins v1, and opencode.json disabled_providers without throwing or a false empty catalog.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import { readJsoncFile } from "../src/core/jsonc.js";
import { parseFrontmatter } from "../src/core/frontmatter.js";
import { parseExpertSessionMarker } from "../src/services/expert-session-runtime.js";
import { listSessionOrigins, sessionOriginsPath } from "../src/services/session-origins.js";
import { scanWorkspaceExpertSessionMarkers } from "../src/services/workspace-session-marker-inventory.js";
import {
  legacyOnmyagentSkillsDir,
  opencodeConfigPath,
  profileSkillsDir,
} from "../src/workspace/workspace-files.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/compat/v0.6",
);

function workspace(path: string, id = "ws_compat_v06"): WorkspaceInfo {
  return {
    id,
    name: "compat-v0.6",
    path,
    preset: "default",
    workspaceType: "local",
  };
}

async function readFixtureJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(fixtureDir, name), "utf8"));
}

describe("compat v0.6 previous-format reads", () => {
  test("parseExpertSessionMarker recognizes isolationVersion 2 identity", async () => {
    const raw = await readFixtureJson("onmyagent-session.isolation-v2.json");
    expect(raw).toMatchObject({ isolationVersion: 2 });
    const marker = parseExpertSessionMarker(raw, "ws_compat_v06");
    expect(marker).not.toBeNull();
    expect(marker?.isolationVersion).toBe(2);
    expect(marker?.agentId).toBe("agent-compat-v2");
    expect(marker?.packageName).toBe("pkg.compat-v2");
    expect(marker?.sessionId).toBe("ses_compat_v2");
  });

  test("marker inventory lists a v2 expert instead of a false empty catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "compat-v06-marker-"));
    try {
      const project = resolve(join(root, "project"));
      const runtimeRoot = resolve(join(root, "runtime"));
      await mkdir(project, { recursive: true });
      const ws = workspace(project);
      const workspaceSegment = createHash("sha256")
        .update(`${ws.id}\0${project}`)
        .digest("hex")
        .slice(0, 16);
      const sessionDir = join(runtimeRoot, workspaceSegment, "agent-compat-v2", "ses_compat_v2");
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        join(sessionDir, "onmyagent-session.json"),
        await readFile(join(fixtureDir, "onmyagent-session.isolation-v2.json"), "utf8"),
        "utf8",
      );

      const inventory = await scanWorkspaceExpertSessionMarkers({
        workspace: ws,
        runtimeRoot,
      });
      expect(inventory.entries.length).toBeGreaterThan(0);
      expect(inventory.entries[0]?.marker.isolationVersion).toBe(2);
      expect(inventory.entries[0]?.marker.agentId).toBe("agent-compat-v2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("listSessionOrigins reads a v1 origins file as a non-empty identity list", async () => {
    const root = await mkdtemp(join(tmpdir(), "compat-v06-origins-"));
    try {
      const project = join(root, "project");
      const ws = workspace(project);
      const path = sessionOriginsPath(ws);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        await readFile(join(fixtureDir, "session-origins.v1.json"), "utf8"),
        "utf8",
      );
      const listed = await listSessionOrigins(ws);
      expect(listed.items.length).toBeGreaterThan(0);
      expect(listed.items[0]?.sessionId).toBe("ses_compat_origin_v1");
      expect(listed.items[0]?.agentId).toBe("agent-compat-v2");
      expect(listed.state).toBe("ok");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parseExpertSessionMarker still recognizes isolationVersion 3", async () => {
    const raw = await readFixtureJson("onmyagent-session.isolation-v3.json");
    expect(raw).toMatchObject({ isolationVersion: 3 });
    const marker = parseExpertSessionMarker(raw, "ws_compat_v06");
    expect(marker).not.toBeNull();
    expect(marker?.isolationVersion).toBe(3);
    expect(marker?.sessionId).toBe("ses_compat_v3");
  });

  test("legacy skill SKILL.md still parses after profile-path split", async () => {
    const home = join(tmpdir(), "compat-v06-home-shape");
    expect(legacyOnmyagentSkillsDir(home)).toBe(join(home, ".onmyagent", "skills"));
    expect(profileSkillsDir(home)).toBe(
      join(home, ".onmyagent", "profiles", "local", "config", "skills"),
    );
    expect(legacyOnmyagentSkillsDir(home)).not.toBe(profileSkillsDir(home));
    const markdown = await readFile(join(fixtureDir, "SKILL.md"), "utf8");
    const parsed = parseFrontmatter(markdown);
    expect(parsed.data.name).toBe("compat-legacy-skill");
    expect(String(parsed.data.description ?? "")).toContain("legacy skills");
  });

  test("readJsoncFile parses prior opencode.json disabled_providers identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "compat-v06-opencode-"));
    try {
      await mkdir(root, { recursive: true });
      const dest = join(root, "opencode.json");
      await writeFile(
        dest,
        await readFile(join(fixtureDir, "opencode.json"), "utf8"),
        "utf8",
      );
      expect(opencodeConfigPath(root)).toBe(dest);
      const { data } = await readJsoncFile<Record<string, unknown>>(dest, {});
      const disabled = data.disabled_providers;
      expect(Array.isArray(disabled)).toBe(true);
      expect(disabled).toContain("fixture-provider-disabled");
      const provider = data.provider as Record<string, unknown> | undefined;
      expect(provider && typeof provider === "object" ? "fixture-provider-disabled" in provider : false).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
