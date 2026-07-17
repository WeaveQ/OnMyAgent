import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";

import { listSkills } from "../src/services/skills.js";
import { updatePluginEnablement } from "../src/services/artifact-plugin-enablement.js";
import { registerSkillRoutes } from "../src/routes/skill-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";

let tempRoot = "";
let originalGlobalSkillsDir: string | undefined;
let originalBundledSkillsDir: string | undefined;
let originalBundledPluginsDir: string | undefined;

async function writeSkill(root: string, name: string, description: string) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${description}\n`,
    "utf8",
  );
}

describe("skills", () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-skills-"));
    originalGlobalSkillsDir = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
    originalBundledSkillsDir = process.env.ONMYAGENT_BUNDLED_SKILLS_DIR;
    originalBundledPluginsDir = process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR;
  });

  afterEach(async () => {
    if (originalGlobalSkillsDir === undefined) {
      delete process.env.OPENCODE_GLOBAL_SKILLS_DIR;
    } else {
      process.env.OPENCODE_GLOBAL_SKILLS_DIR = originalGlobalSkillsDir;
    }
    if (originalBundledSkillsDir === undefined) {
      delete process.env.ONMYAGENT_BUNDLED_SKILLS_DIR;
    } else {
      process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
    }
    if (originalBundledPluginsDir === undefined) {
      delete process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR;
    } else {
      process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR = originalBundledPluginsDir;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("classifies bundled, OnMyAgent, and local project skills separately", async () => {
    const workspace = join(tempRoot, "workspace");
    const onmyagent = join(tempRoot, "onmyagent-skills");
    const bundled = join(tempRoot, "bundled-skills");

    process.env.OPENCODE_GLOBAL_SKILLS_DIR = onmyagent;
    process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = bundled;

    await writeSkill(join(workspace, ".opencode", "skills"), "local-only", "Local skill");
    await writeSkill(onmyagent, "onmyagent-only", "OnMyAgent skill");
    await writeSkill(bundled, "builtin-only", "Built-in skill");

    const items = await listSkills(workspace, true);
    const scopes = new Map(items.map((item) => [item.name, item.scope]));

    expect(scopes.get("builtin-only")).toBe("built-in");
    expect(scopes.get("onmyagent-only")).toBe("onmyagent");
    expect(scopes.get("local-only")).toBe("local");
  });

  test("exposes the bundled artifact plugins to workspace sessions", async () => {
    const workspace = join(tempRoot, "workspace");
    await mkdir(workspace, { recursive: true });
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = join(tempRoot, "onmyagent-skills");
    process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = resolve(
      import.meta.dir,
      "../../desktop/resources/bundled-skills",
    );

    const items = await listSkills(workspace, true);
    const artifactSkills = new Map(
      items
        .filter((item) =>
          ["documents", "pdf", "spreadsheets", "excel-live-control"].includes(item.name),
        )
        .map((item) => [item.name, item]),
    );

    expect([...artifactSkills.keys()].sort()).toEqual([
      "documents",
      "excel-live-control",
      "pdf",
      "spreadsheets",
    ]);
    for (const item of artifactSkills.values()) {
      expect(item.scope).toBe("built-in");
      expect(item.path.endsWith("/SKILL.md")).toBe(true);
      expect(item.description.length).toBeGreaterThan(20);
    }
  });

  test("filters disabled built-in artifact skills without deleting local or unrelated skills", async () => {
    const workspace = join(tempRoot, "workspace");
    const bundled = join(tempRoot, "bundled-skills");
    const project = join(workspace, ".opencode", "skills");
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = join(tempRoot, "onmyagent-skills");
    process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = bundled;

    await writeSkill(bundled, "documents", "Bundled documents skill");
    await writeSkill(bundled, "pdf", "Bundled PDF skill");
    await writeSkill(bundled, "weather", "Unrelated bundled skill");
    await writeSkill(project, "documents", "Local documents policy");

    const items = await listSkills(workspace, false, {
      artifactSkillIds: new Set(["documents", "pdf"]),
      effectiveArtifactSkillIds: new Set(["pdf"]),
    });

    expect(items.some((item) => item.scope === "built-in" && item.name === "documents")).toBe(false);
    expect(items.some((item) => item.scope === "local" && item.name === "documents")).toBe(true);
    expect(items.some((item) => item.scope === "built-in" && item.name === "pdf")).toBe(true);
    expect(items.some((item) => item.scope === "built-in" && item.name === "weather")).toBe(true);
  });

  test("skill list and content routes share effective Artifact filtering", async () => {
    const workspaceRoot = join(tempRoot, "workspace");
    const bundled = join(tempRoot, "bundled-skills");
    const configPath = join(tempRoot, "config", "server.json");
    await writeSkill(bundled, "documents", "Bundled documents skill");
    await writeSkill(bundled, "pdf", "Bundled PDF skill");
    await writeSkill(join(workspaceRoot, ".opencode", "skills"), "documents", "Local documents policy");
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = join(tempRoot, "onmyagent-skills");
    process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = bundled;
    process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR = resolve(
      import.meta.dir,
      "../../desktop/resources/bundled-plugins",
    );
    await updatePluginEnablement(join(tempRoot, "config", "artifact-plugins.json"), "documents", false);

    const workspace: WorkspaceInfo = {
      id: "workspace-1",
      name: "Workspace",
      path: workspaceRoot,
      preset: "default",
      workspaceType: "local",
    };
    const config: ServerConfig = {
      host: "127.0.0.1",
      port: 0,
      token: "token",
      hostToken: "host-token",
      configPath,
      approval: { mode: "auto", timeoutMs: 1000 },
      corsOrigins: [],
      workspaces: [workspace],
      authorizedRoots: [workspace.path],
      readOnly: false,
      startedAt: Date.now(),
      tokenSource: "cli",
      hostTokenSource: "cli",
      logFormat: "pretty",
      logRequests: false,
    };
    const routes: Route[] = [];
    registerSkillRoutes({
      routes,
      config,
      ensureWritable: () => {},
      requireClientScope: () => {},
      resolveWorkspace: async () => workspace,
      requireApproval: async () => {},
      emitReloadEvent: () => {},
      globalSkillsDir: () => join(tempRoot, "onmyagent-skills"),
      readJsonBody: async () => ({}),
    });

    const listResponse = await callSkillRoute(routes, "GET", "/workspace/workspace-1/skills", config);
    const listedDocuments = listResponse.items.filter((item: { name: string }) => item.name === "documents");
    expect(listedDocuments).toEqual([
      expect.objectContaining({ name: "documents", scope: "local" }),
    ]);

    const detailResponse = await callSkillRoute(routes, "GET", "/workspace/workspace-1/skills/documents", config);
    expect(detailResponse.item).toEqual(expect.objectContaining({ name: "documents", scope: "local" }));
    expect(detailResponse.content).toContain("Local documents policy");
  });
});

async function callSkillRoute(
  routes: Route[],
  method: string,
  path: string,
  config: ServerConfig,
) {
  const route = routes.find((candidate) => candidate.method === method && candidate.regex.test(path));
  if (!route) throw new Error(`Missing route: ${method} ${path}`);
  const match = route.regex.exec(path);
  if (!match) throw new Error(`Route did not match: ${path}`);
  const params = Object.fromEntries(route.keys.map((key, index) => [key, match[index + 1] ?? ""]));
  const url = new URL(`http://localhost${path}`);
  const response = await route.handler({
    request: new Request(url, { method }),
    url,
    params,
    config,
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "viewer" },
  } satisfies RequestContext);
  return response.json();
}
