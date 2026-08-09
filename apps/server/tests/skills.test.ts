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

  test("lists profile skills as onmyagent and project skills as local", async () => {
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

    // Packaged bundled-skills are not session-available until installed to user root.
    expect(scopes.has("builtin-only")).toBe(false);
    expect(scopes.get("onmyagent-only")).toBe("onmyagent");
    expect(scopes.get("local-only")).toBe("local");
  });

  test("skips skills with invalid YAML frontmatter instead of failing the whole list", async () => {
    const workspace = join(tempRoot, "workspace");
    const onmyagent = join(tempRoot, "onmyagent-skills");
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = onmyagent;

    await writeSkill(onmyagent, "good-skill", "A valid skill description");
    const badDir = join(onmyagent, "bad-skill");
    await mkdir(badDir, { recursive: true });
    // Unquoted colon in description is invalid YAML compact mapping (e.g. "TL;DR: ...").
    await writeFile(
      join(badDir, "SKILL.md"),
      "---\nname: bad-skill\ndescription: TL;DR: broken yaml frontmatter\n---\nBody\n",
      "utf8",
    );

    const items = await listSkills(workspace, true);
    const names = new Set(items.map((item) => item.name));
    expect(names.has("good-skill")).toBe(true);
    expect(names.has("bad-skill")).toBe(false);
  });

  test("exposes the bundled artifact plugins to workspace sessions", async () => {
    const workspace = join(tempRoot, "workspace");
    await mkdir(workspace, { recursive: true });
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = join(tempRoot, "onmyagent-skills");
    process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = resolve(
      import.meta.dir,
      "../../desktop/resources/bundled-skills",
    );

    const pluginRoot = resolve(
      import.meta.dir,
      "../../desktop/resources/bundled-plugins",
    );
    const names = ["documents", "pdf", "spreadsheets"];
    const items = await listSkills(workspace, true, {
      artifactSkillIds: new Set([...names, "excel-live-control"]),
      effectiveArtifactSkillIds: new Set(names),
      artifactSkills: names.map((name) => ({
        name,
        path: join(pluginRoot, name, "skills", name, "SKILL.md"),
      })),
    });
    const artifactSkills = new Map(
      items
        .filter((item) =>
          ["documents", "pdf", "spreadsheets", "excel-live-control"].includes(item.name),
        )
        .map((item) => [item.name, item]),
    );

    expect([...artifactSkills.keys()].sort()).toEqual([
      "documents",
      "pdf",
      "spreadsheets",
    ]);
    for (const item of artifactSkills.values()) {
      expect(item.scope).toBe("built-in");
      expect(item.path.endsWith("/SKILL.md")).toBe(true);
      expect(item.description.length).toBeGreaterThan(20);
    }
  });

  test("filters disabled built-in artifact skills without deleting user-root skills", async () => {
    const workspace = join(tempRoot, "workspace");
    const bundled = join(tempRoot, "bundled-skills");
    const project = join(workspace, ".opencode", "skills");
    const onmyagent = join(tempRoot, "onmyagent-skills");
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = onmyagent;
    process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = bundled;

    await writeSkill(bundled, "documents", "Bundled documents skill");
    await writeSkill(bundled, "pdf", "Bundled PDF skill");
    await writeSkill(bundled, "weather", "Unrelated bundled skill");
    await writeSkill(onmyagent, "weather", "Installed weather skill");
    await writeSkill(project, "documents", "Local documents policy");
    const pluginPdf = join(tempRoot, "plugins", "pdf", "SKILL.md");
    await writeSkill(join(tempRoot, "plugins"), "pdf", "Plugin PDF skill");

    const items = await listSkills(workspace, false, {
      artifactSkillIds: new Set(["documents", "pdf"]),
      effectiveArtifactSkillIds: new Set(["pdf"]),
      artifactSkills: [{ name: "pdf", path: pluginPdf }],
    });

    expect(items.some((item) => item.scope === "built-in" && item.name === "documents")).toBe(false);
    // Project local documents is listed under local scope.
    expect(items.some((item) => item.scope === "local" && item.name === "documents")).toBe(true);
    expect(items.some((item) => item.scope === "built-in" && item.name === "pdf")).toBe(true);
    // weather only via user root install, not raw bundled tree.
    expect(items.some((item) => item.scope === "onmyagent" && item.name === "weather")).toBe(true);
    expect(items.filter((item) => item.name === "weather")).toHaveLength(1);
  });

  test("skill list and content routes share effective Artifact filtering", async () => {
    const workspaceRoot = join(tempRoot, "workspace");
    const bundled = join(tempRoot, "bundled-skills");
    const userSkills = join(tempRoot, "onmyagent-skills");
    const configPath = join(tempRoot, "config", "server.json");
    await writeSkill(bundled, "documents", "Bundled documents skill");
    await writeSkill(bundled, "pdf", "Bundled PDF skill");
    // User-root install remains listable even when artifact "documents" is disabled.
    await writeSkill(userSkills, "documents", "User installed documents skill");
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = userSkills;
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
      globalSkillsDir: () => userSkills,
      readJsonBody: async () => ({}),
    });

    const listResponse = await callSkillRoute(routes, "GET", "/workspace/workspace-1/skills", config);
    const listedDocuments = listResponse.items.filter((item: { name: string }) => item.name === "documents");
    expect(listedDocuments).toEqual([
      expect.objectContaining({ name: "documents", scope: "onmyagent" }),
    ]);

    const detailResponse = await callSkillRoute(routes, "GET", "/workspace/workspace-1/skills/documents", config);
    expect(detailResponse.item).toEqual(expect.objectContaining({ name: "documents", scope: "onmyagent" }));
    expect(detailResponse.content).toContain("User installed documents skill");
  });

  test("resolves user skills root to profile path only", async () => {
    const home = join(tempRoot, "home");
    const profile = join(home, ".onmyagent", "profiles", "local", "config", "skills");
    const legacy = join(home, ".onmyagent", "skills");
    await writeSkill(profile, "find-skills", "Discover skills");
    await writeSkill(legacy, "legacy-only", "Legacy skill");

    const { resolveGlobalSkillsDir, resolveGlobalSkillsDirs } = await import(
      "../src/workspace/workspace-files.js"
    );
    expect(resolveGlobalSkillsDir(home)).toBe(profile);
    expect(resolveGlobalSkillsDirs(home)).toEqual([profile]);

    process.env.OPENCODE_GLOBAL_SKILLS_DIR = profile;
    try {
      const items = await listSkills(join(tempRoot, "workspace"), true);
      const names = new Set(items.map((item) => item.name));
      expect(names.has("find-skills")).toBe(true);
      expect(names.has("legacy-only")).toBe(false);
    } finally {
      delete process.env.OPENCODE_GLOBAL_SKILLS_DIR;
    }
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
