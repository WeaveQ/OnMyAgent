import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";

import {
  readArtifactPluginEnablement,
  resolveEffectiveArtifactSkills,
  updatePluginEnablement,
  updateSkillEnablement,
} from "../src/services/artifact-plugin-enablement.js";
import { scanArtifactPlugins } from "../src/services/artifact-plugin-registry.js";
import { registerArtifactPluginRoutes } from "../src/routes/artifact-plugin-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";

let tempRoot = "";
let originalPluginsDir: string | undefined;
let originalDataDir: string | undefined;

describe("artifact plugin enablement", () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-artifact-enablement-"));
    originalPluginsDir = process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR;
    originalDataDir = process.env.ONMYAGENT_DATA_DIR;
    process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR = resolve(
      import.meta.dir,
      "../../desktop/resources/bundled-plugins",
    );
    process.env.ONMYAGENT_DATA_DIR = join(tempRoot, "data");
  });

  afterEach(async () => {
    if (originalPluginsDir === undefined) {
      delete process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR;
    } else {
      process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR = originalPluginsDir;
    }
    if (originalDataDir === undefined) {
      delete process.env.ONMYAGENT_DATA_DIR;
    } else {
      process.env.ONMYAGENT_DATA_DIR = originalDataDir;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("plugin and skill toggles survive a new store instance", async () => {
    const file = join(tempRoot, "artifact-plugins.json");
    await updatePluginEnablement(file, "spreadsheets", false);
    await updateSkillEnablement(file, "spreadsheets", "excel-live-control", false);

    const state = await readArtifactPluginEnablement(file);

    expect(state.plugins.spreadsheets?.enabled).toBe(false);
    expect(state.plugins.spreadsheets?.skills["excel-live-control"]).toBe(false);
  });

  test("concurrent updates to different plugins preserve both changes", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const file = join(tempRoot, `plugins-${attempt}.json`);
      await Promise.all([
        updatePluginEnablement(file, "documents", false),
        updatePluginEnablement(`${tempRoot}//plugins-${attempt}.json`, "pdf", false),
      ]);

      const state = await readArtifactPluginEnablement(file);
      expect(state.plugins.documents?.enabled).toBe(false);
      expect(state.plugins.pdf?.enabled).toBe(false);
    }
  });

  test("concurrent updates to different skills in one plugin preserve both changes", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const file = join(tempRoot, `skills-${attempt}.json`);
      await Promise.all([
        updateSkillEnablement(file, "spreadsheets", "spreadsheets", false),
        updateSkillEnablement(
          `${tempRoot}//skills-${attempt}.json`,
          "spreadsheets",
          "excel-live-control",
          false,
        ),
      ]);

      const state = await readArtifactPluginEnablement(file);
      expect(state.plugins.spreadsheets?.skills.spreadsheets).toBe(false);
      expect(
        state.plugins.spreadsheets?.skills["excel-live-control"],
      ).toBe(false);
    }
  });

  test("effective skills combine plugin defaults, skill defaults, and overrides", async () => {
    const catalog = await scanArtifactPlugins(process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR ?? "");
    const defaults = resolveEffectiveArtifactSkills(catalog, { plugins: {} });
    expect(defaults).toEqual(
      new Set([
        "browser-automation",
        "documents",
        "excel-live-control",
        "pdf",
        "spreadsheets",
      ]),
    );

    const effective = resolveEffectiveArtifactSkills(catalog, {
      plugins: {
        documents: { enabled: false, skills: {} },
        spreadsheets: {
          enabled: true,
          skills: { "excel-live-control": false, spreadsheets: true },
        },
      },
    });
    expect(effective).toEqual(
      new Set(["browser-automation", "pdf", "spreadsheets"]),
    );
  });

  test("routes list, inspect, mutate, audit, reload, and report an honest connection", async () => {
    const workspace = await createWorkspace();
    const config = createConfig(workspace);
    const routes: Route[] = [];
    const requiredScopes: string[] = [];
    const reloads: string[] = [];
    let body: Record<string, unknown> = {};

    registerArtifactPluginRoutes({
      routes,
      config,
      ensureWritable: () => {},
      requireClientScope: (_ctx, scope) => requiredScopes.push(scope),
      resolveWorkspace: async () => workspace,
      emitReloadEvent: (_events, _workspace, reason) => reloads.push(reason),
      readJsonBody: async () => body,
    });

    const listed = await callRoute(routes, "GET", "/workspace/workspace-1/artifact-plugins", config, workspace);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((item: { id: string }) => item.id)).toEqual([
      "browser",
      "documents",
      "pdf",
      "spreadsheets",
    ]);
    expect(listed.body.items[3].skills).toEqual([
      { id: "spreadsheets", enabled: true, defaultEnabled: true },
      { id: "excel-live-control", enabled: true, defaultEnabled: true },
    ]);
    expect(listed.body.diagnostics).toEqual([]);

    const detail = await callRoute(routes, "GET", "/workspace/workspace-1/artifact-plugins/spreadsheets", config, workspace);
    expect(detail.status).toBe(200);
    expect(detail.body.item.id).toBe("spreadsheets");

    body = { enabled: false };
    const updated = await callRoute(routes, "PUT", "/workspace/workspace-1/artifact-plugins/spreadsheets/skills/excel-live-control/enabled", config, workspace);
    expect(updated.status).toBe(200);
    expect(updated.body.item).toEqual({
      id: "excel-live-control",
      enabled: false,
      defaultEnabled: true,
    });
    expect(requiredScopes).toEqual(["collaborator"]);
    expect(reloads).toEqual(["skills"]);

    const connection = await callRoute(routes, "GET", "/workspace/workspace-1/artifact-plugins/spreadsheets/connection", config, workspace);
    expect(connection.body).toEqual({
      status: "unavailable",
      reason: "No live provider is registered",
    });

    const enablement = JSON.parse(await readFile(join(tempRoot, "config", "artifact-plugins.json"), "utf8"));
    expect(enablement.plugins.spreadsheets.skills["excel-live-control"]).toBe(false);
    const audit = await readFile(join(tempRoot, "data", "audit", "workspace-1.jsonl"), "utf8");
    expect(audit).toContain("artifact_plugins.skill_enablement.update");
    expect(audit).toContain(join(tempRoot, "config", "artifact-plugins.json"));
  });

  test("mutation routes reject unknown ids and non-boolean bodies", async () => {
    const workspace = await createWorkspace();
    const config = createConfig(workspace);
    const routes: Route[] = [];
    let body: Record<string, unknown> = { enabled: "false" };
    registerArtifactPluginRoutes({
      routes,
      config,
      ensureWritable: () => {},
      requireClientScope: () => {},
      resolveWorkspace: async () => workspace,
      emitReloadEvent: () => {},
      readJsonBody: async () => body,
    });

    await expect(callRoute(routes, "PUT", "/workspace/workspace-1/artifact-plugins/pdf/enabled", config, workspace)).rejects.toMatchObject({ status: 400 });
    body = { enabled: false };
    await expect(callRoute(routes, "PUT", "/workspace/workspace-1/artifact-plugins/missing/enabled", config, workspace)).rejects.toMatchObject({ status: 404 });
    await expect(callRoute(routes, "PUT", "/workspace/workspace-1/artifact-plugins/pdf/skills/missing/enabled", config, workspace)).rejects.toMatchObject({ status: 404 });
  });
});

async function createWorkspace(): Promise<WorkspaceInfo> {
  const path = join(tempRoot, "workspace");
  await mkdir(path, { recursive: true });
  return {
    id: "workspace-1",
    name: "Workspace",
    path,
    preset: "default",
    workspaceType: "local",
  };
}

function createConfig(workspace: WorkspaceInfo): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(tempRoot, "config", "server.json"),
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
}

async function callRoute(
  routes: Route[],
  method: string,
  path: string,
  config: ServerConfig,
  workspace: WorkspaceInfo,
) {
  const route = routes.find((candidate) => candidate.method === method && candidate.regex.test(path));
  expect(route).toBeTruthy();
  if (!route) throw new Error(`Missing route: ${method} ${path}`);
  const match = route.regex.exec(path);
  if (!match) throw new Error(`Route did not match: ${path}`);
  const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1] ?? "")]));
  const url = new URL(`http://localhost${path}`);
  const response = await route.handler({
    request: new Request(url, { method }),
    url,
    params,
    config,
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "collaborator" },
  } satisfies RequestContext);
  return { status: response.status, body: await response.json(), workspace };
}
