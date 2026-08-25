/**
 * Previous-format write-back: upgrading or adding fields must keep old identities.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import { readJsoncFile, updateJsoncTopLevel } from "../src/core/jsonc.js";
import {
  createExpertSessionRuntimeDirectory,
  ensureExpertSessionRuntimeIsolation,
  parseExpertSessionMarker,
} from "../src/services/expert-session-runtime.js";
import { listSessionOrigins, sessionOriginsPath, upsertSessionOrigin } from "../src/services/session-origins.js";

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

describe("compat v0.6 write-back keeps previous identities", () => {
  test("upsertSessionOrigin migrates v1 to v2 without dropping records", async () => {
    const root = await mkdtemp(join(tmpdir(), "compat-v06-origins-write-"));
    try {
      const project = join(root, "project");
      const ws = workspace(project);
      const path = sessionOriginsPath(ws);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await readFile(join(fixtureDir, "session-origins.v1.json"), "utf8"), "utf8");

      await upsertSessionOrigin(ws, "ses_compat_origin_new", { kind: "assistant" });
      const listed = await listSessionOrigins(ws);
      expect(listed.items.map((item) => item.sessionId).sort()).toEqual([
        "ses_compat_origin_new",
        "ses_compat_origin_v1",
      ]);
      const disk = JSON.parse(await readFile(path, "utf8")) as {
        version: number;
        records: Array<{ sessionId: string; agentId?: string }>;
      };
      expect(disk.version).toBe(2);
      expect(disk.records.some((record) =>
        record.sessionId === "ses_compat_origin_v1" && record.agentId === "agent-compat-v2",
      )).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("updateJsoncTopLevel does not drop disabled_providers", async () => {
    const root = await mkdtemp(join(tmpdir(), "compat-v06-opencode-write-"));
    try {
      const dest = join(root, "opencode.json");
      await mkdir(root, { recursive: true });
      await writeFile(dest, await readFile(join(fixtureDir, "opencode.json"), "utf8"), "utf8");
      await updateJsoncTopLevel(dest, { model: "fixture/model" });
      const { data } = await readJsoncFile<Record<string, unknown>>(dest, {});
      expect(data.model).toBe("fixture/model");
      expect(data.disabled_providers).toEqual(["fixture-provider-disabled"]);
      const provider = data.provider as Record<string, unknown>;
      expect("fixture-provider-disabled" in provider).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ensureExpertSessionRuntimeIsolation upgrades v2 without dropping identity keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "compat-v06-marker-write-"));
    try {
      const project = join(root, "project");
      const runtimeRoot = join(root, "runtime");
      await mkdir(project, { recursive: true });
      const ws = workspace(project);
      const created = await createExpertSessionRuntimeDirectory({
        workspace: ws,
        runtimeRoot,
        agentName: "compat expert",
        agentId: "agent-compat-v2",
        packageName: "pkg.compat-v2",
        sessionKey: "1750000000001",
        skillNames: ["compat-skill"],
      });
      const prior = JSON.parse(
        await readFile(join(fixtureDir, "onmyagent-session.isolation-v2.json"), "utf8"),
      ) as Record<string, unknown>;
      await writeFile(
        join(created.directory, "onmyagent-session.json"),
        `${JSON.stringify({ ...prior, workspaceId: ws.id }, null, 2)}\n`,
        "utf8",
      );

      const upgraded = await ensureExpertSessionRuntimeIsolation({
        workspace: ws,
        directory: created.directory,
        runtimeRoot,
        agentId: "agent-compat-v2",
        packageName: "pkg.compat-v2",
        sessionId: "ses_compat_v2",
        skillNames: ["compat-skill"],
      });
      expect(upgraded?.upgraded).toBe(true);
      expect(upgraded?.isolationVersion).toBe(3);
      expect(upgraded?.agentId).toBe("agent-compat-v2");
      expect(upgraded?.sessionId).toBe("ses_compat_v2");

      const disk = JSON.parse(
        await readFile(join(created.directory, "onmyagent-session.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(disk.agentId).toBe("agent-compat-v2");
      expect(disk.packageName).toBe("pkg.compat-v2");
      expect(disk.sessionId).toBe("ses_compat_v2");
      expect(disk.declaredSkills).toEqual(["compat-skill"]);
      expect(parseExpertSessionMarker(disk, ws.id)?.isolationVersion).toBe(
        3,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
