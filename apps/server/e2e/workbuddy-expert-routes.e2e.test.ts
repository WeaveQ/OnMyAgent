import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "@onmyagent/types/server";

import { startServer } from "../src/server.js";

const CLIENT_TOKEN = "owt_workbuddy_client_token";
const HOST_TOKEN = "owt_workbuddy_host_token";
let tempRoot = "";
let server: Awaited<ReturnType<typeof startServer>> | null = null;
let refreshCalls = 0;
let refreshFailure: Error | null = null;
const previousEnvironment = new Map<string, string | undefined>();

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-workbuddy-route-"));
  const sourceRoot = join(tempRoot, "workbuddy");
  const skillsRoot = join(tempRoot, "profile", "skills");
  const expertsRoot = join(tempRoot, "profile", "experts", "installed");
  await writePackage(sourceRoot);
  setTestEnvironment("ONMYAGENT_WORKBUDDY_EXPERTS_DIR", sourceRoot);
  setTestEnvironment("ONMYAGENT_EXPERTS_DIR", expertsRoot);
  setTestEnvironment("OPENCODE_GLOBAL_SKILLS_DIR", skillsRoot);
  setTestEnvironment("ONMYAGENT_TOKEN_STORE", join(tempRoot, "tokens.json"));
  refreshCalls = 0;
  refreshFailure = null;
  server = await startServer(baseConfig(), {
    onGlobalSkillsChanged: async () => {
      refreshCalls += 1;
      if (refreshFailure) throw refreshFailure;
    },
  });
});

afterEach(async () => {
  server?.stop(true);
  server = null;
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnvironment.clear();
  await rm(tempRoot, { recursive: true, force: true });
});

describe("WorkBuddy expert routes", () => {
  test("requires auth, lists packages, and imports through the local API", async () => {
    const base = `http://127.0.0.1:${server?.port ?? 0}`;
    const unauthenticated = await fetch(`${base}/third-party/workbuddy/packages`);
    expect(unauthenticated.status).toBe(401);

    const listed = await fetch(`${base}/third-party/workbuddy/packages`, { headers: authHeaders() });
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(recordValue(listBody, "count")).toBe(1);

    const previewed = await fetch(`${base}/third-party/workbuddy/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query: "高级开发工程师", kind: "agent", mode: "preview" }),
    });
    expect(previewed.status).toBe(200);
    const previewBody = await previewed.json();
    expect(recordValue(previewBody, "action")).toBe("would-add");
    expect(recordValue(previewBody, "committable")).toBe(true);
    expect(await fileExists(join(tempRoot, "profile", "experts", "installed", "senior-developer")))
      .toBe(false);

    const imported = await fetch(`${base}/third-party/workbuddy/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        query: "高级开发工程师",
        kind: "agent",
        mode: "commit",
        confirmationToken: recordValue(previewBody, "confirmationToken"),
      }),
    });
    expect(imported.status).toBe(201);
    const importBody = await imported.json();
    expect(recordValue(importBody, "action")).toBe("added");
    expect(
      await readFile(
        join(tempRoot, "profile", "experts", "installed", "senior-developer", ".expert-plugin", "plugin.json"),
        "utf8",
      ),
    ).toContain('"importedFrom": "workbuddy"');
    expect(
      await readFile(join(tempRoot, "profile", "skills", "fullstack-dev", "SKILL.md"), "utf8"),
    ).toContain("name: fullstack-dev");
    expect(refreshCalls).toBe(1);
    const refresh = recordValue(importBody, "refresh");
    expect(recordValue(refresh, "skillLinksRefreshed")).toBe(true);
  });

  test("rejects a stale preview after the source changes", async () => {
    const base = `http://127.0.0.1:${server?.port ?? 0}`;
    const previewed = await fetch(`${base}/third-party/workbuddy/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query: "senior-developer", mode: "preview" }),
    });
    const previewBody = await previewed.json();
    await writeFile(
      join(tempRoot, "workbuddy", "senior-developer", "agents", "senior-developer.md"),
      "---\nname: senior-developer\ndescription: Changed\n---\n# Changed\n",
    );
    const committed = await fetch(`${base}/third-party/workbuddy/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        query: "senior-developer",
        mode: "commit",
        confirmationToken: recordValue(previewBody, "confirmationToken"),
      }),
    });
    expect(committed.status).toBe(409);
    expect(refreshCalls).toBe(0);
  });

  test("reports a refresh failure without turning a committed import into HTTP 500", async () => {
    const base = `http://127.0.0.1:${server?.port ?? 0}`;
    const previewed = await fetch(`${base}/third-party/workbuddy/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query: "senior-developer", mode: "preview" }),
    });
    const previewBody = await previewed.json();
    refreshFailure = new Error("refresh exploded");

    const committed = await fetch(`${base}/third-party/workbuddy/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        query: "senior-developer",
        mode: "commit",
        confirmationToken: recordValue(previewBody, "confirmationToken"),
      }),
    });

    expect(committed.status).toBe(201);
    const body = await committed.json();
    expect(recordValue(body, "action")).toBe("added");
    const refresh = recordValue(body, "refresh");
    expect(recordValue(refresh, "skillLinksRefreshed")).toBe(false);
    expect(recordValue(refresh, "error")).toBe("refresh exploded");
    expect(await fileExists(
      join(tempRoot, "profile", "experts", "installed", "senior-developer", ".expert-plugin", "plugin.json"),
    )).toBe(true);
  });
});

function baseConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: CLIENT_TOKEN,
    hostToken: HOST_TOKEN,
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${CLIENT_TOKEN}`, "Content-Type": "application/json" };
}

function setTestEnvironment(key: string, value: string): void {
  if (!previousEnvironment.has(key)) previousEnvironment.set(key, process.env[key]);
  process.env[key] = value;
}

function recordValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await readFile(target);
    return true;
  } catch {
    return false;
  }
}

async function writePackage(sourceRoot: string): Promise<void> {
  const root = join(sourceRoot, "senior-developer");
  await mkdir(join(root, ".codebuddy-plugin"), { recursive: true });
  await mkdir(join(root, "agents"), { recursive: true });
  await mkdir(join(root, "skills", "fullstack-dev"), { recursive: true });
  await writeFile(
    join(root, ".codebuddy-plugin", "plugin.json"),
    `${JSON.stringify({
      name: "senior-developer",
      version: "1.0.0",
      displayName: { zh: "吴八哥", en: "Will" },
      profession: { zh: "高级开发工程师", en: "Senior Developer" },
      expertType: "agent",
      agentName: "senior-developer",
      agents: ["./agents/senior-developer.md"],
      skills: ["./skills/fullstack-dev"],
    }, null, 2)}\n`,
  );
  await writeFile(
    join(root, "agents", "senior-developer.md"),
    "---\nname: senior-developer\ndescription: Senior developer\n---\n# Senior Developer\n",
  );
  await writeFile(
    join(root, "skills", "fullstack-dev", "SKILL.md"),
    "---\nname: fullstack-dev\ndescription: Full stack development\n---\n# Fullstack\n",
  );
}
