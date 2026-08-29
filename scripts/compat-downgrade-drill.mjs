#!/usr/bin/env node
/**
 * Simulated downgrade drill (no previous app binary):
 * new writer upgrades origins v1 → v2; a v1-shaped reader still sees identities.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(
  repoRoot,
  "apps/server/tests/fixtures/compat/v0.6/session-origins.v1.json",
);

function v1ShapedReader(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.records)) {
    throw new Error("downgrade reader: missing records");
  }
  return parsed.records.map((record) => ({
    sessionId: record.sessionId,
    agentId: record.agentId,
    packageName: record.packageName,
  }));
}

const { listSessionOrigins, sessionOriginsPath, upsertSessionOrigin } = await import(
  join(repoRoot, "apps/server/src/services/session-origins.ts")
);

const root = await mkdtemp(join(tmpdir(), "compat-downgrade-"));
const project = join(root, "project");
const workspace = {
  id: "ws_compat_v06",
  name: "compat-v0.6",
  path: project,
  preset: "default",
  workspaceType: "local",
};
try {
  const path = sessionOriginsPath(workspace);
  await mkdir(dirname(path), { recursive: true });
  const fixture = await readFile(fixturePath, "utf8");
  await writeFile(path, fixture, "utf8");
  const before = v1ShapedReader(fixture);
  if (!before.some((row) => row.sessionId === "ses_compat_origin_v1")) {
    throw new Error("fixture missing origin identity");
  }
  await listSessionOrigins(workspace);
  await upsertSessionOrigin(workspace, "ses_compat_origin_new", { kind: "assistant" });
  const afterRaw = await readFile(path, "utf8");
  const after = v1ShapedReader(afterRaw);
  if (!after.some((row) => row.sessionId === "ses_compat_origin_v1" && row.agentId === "agent-compat-v2")) {
    throw new Error("upgrade dropped previous origin identity");
  }
  const disk = JSON.parse(afterRaw);
  if (disk.version !== 2) throw new Error(`expected version 2, got ${disk.version}`);
  console.log("compat-downgrade-drill ok", {
    previousSessionId: "ses_compat_origin_v1",
    records: after.length,
  });
} finally {
  await rm(root, { recursive: true, force: true });
}
