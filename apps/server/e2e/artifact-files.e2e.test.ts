import { afterEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { startServer } from "../src/server.js";
import type { ServerConfig } from "@onmyagent/types/server";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function createWorkspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-artifacts-"));
  roots.push(root);
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(join(root, "reports", "artifact-eval.md"), "# Artifact Eval\n\nHello markdown.\n", "utf8");
  await writeFile(join(root, "reports", "artifact-eval.csv"), "name,revenue\nAda,10\nGrace,20\n", "utf8");
  await writeFile(join(root, "reports", "index.html"), "<!doctype html><h1>Artifact site</h1>", "utf8");
  await writeFile(join(root, "reports", "artifact-eval.xlsx"), new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]));
  return root;
}

async function startOnMyAgentServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { base: `http://127.0.0.1:${server.port}`, token: config.token };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * POSIX file symlink, or a Windows fallback that preserves resolve() outcomes:
 * - alias: workspace can read the linked name (copy is enough)
 * - escape: realpath leaves the dest parent so exists stays false
 */
async function linkArtifactFixture(
  target: string,
  dest: string,
  mode: "alias" | "escape",
) {
  try {
    await symlink(target, dest);
    return;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code)
      : "";
    if (process.platform !== "win32" || code !== "EPERM") throw error;
  }
  if (mode === "alias") {
    await copyFile(target, dest);
    return;
  }
  await symlink(dirname(target), dest, "junction");
}

describe("artifact file routes", () => {
  test("does not fall back to the workspace for an invalid explicit session root", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const runtimeRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-runtime-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "onmyagent-external-session-"));
    roots.push(runtimeRoot, externalRoot);
    await writeFile(join(externalRoot, "linked.md"), "# Linked workspace artifact\n", "utf8");
    await linkArtifactFixture(
      join(externalRoot, "linked.md"),
      join(workspaceRoot, "reports", "linked.md"),
      "alias",
    );
    const wrongWorkspaceRoot = join(runtimeRoot, "managed", "wrong-workspace");
    await mkdir(wrongWorkspaceRoot, { recursive: true });
    await writeFile(
      join(wrongWorkspaceRoot, "onmyagent-session.json"),
      JSON.stringify({ kind: "expert-session", workspaceId: "ws_other" }),
      "utf8",
    );
    const previousRuntimeRoot = process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT;
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    try {
      const { base, token } = await startOnMyAgentServer(workspaceRoot);
      const resolve = async (sessionRoot?: string, value = "reports/artifact-eval.md") => {
        const response = await fetch(`${base}/workspace/ws_1/artifacts/resolve`, {
          method: "POST",
          headers: auth(token),
          body: JSON.stringify({
            ...(sessionRoot === undefined ? {} : { sessionRoot }),
            targets: [{ kind: "file", value, confidence: 95 }],
          }),
        });
        expect(response.status).toBe(200);
        return await response.json() as { items: Array<{ value: string; exists: boolean }> };
      };

      expect((await resolve()).items).toContainEqual(
        expect.objectContaining({ value: "reports/artifact-eval.md", exists: true }),
      );
      expect((await resolve(workspaceRoot)).items).toContainEqual(
        expect.objectContaining({ value: "reports/artifact-eval.md", exists: true }),
      );
      expect((await resolve(undefined, "reports/linked.md")).items).toContainEqual(
        expect.objectContaining({ value: "reports/linked.md", exists: true }),
      );
      expect((await resolve(workspaceRoot, "reports/linked.md")).items).toContainEqual(
        expect.objectContaining({ value: "reports/linked.md", exists: true }),
      );
      expect((await resolve(externalRoot)).items).toEqual([]);
      expect((await resolve(wrongWorkspaceRoot)).items).toEqual([]);
    } finally {
      if (previousRuntimeRoot === undefined) {
        delete process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT;
      } else {
        process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = previousRuntimeRoot;
      }
    }
  });

  test("resolves artifacts from a validated expert session runtime directory only", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const runtimeRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-runtime-"));
    roots.push(runtimeRoot);
    const allowedSessionRoot = join(runtimeRoot, "managed", "session-1");
    await mkdir(allowedSessionRoot, { recursive: true });
    await writeFile(join(allowedSessionRoot, "result.md"), "# Expert result\n", "utf8");
    await mkdir(join(allowedSessionRoot, "合同输出"), { recursive: true });
    await writeFile(join(allowedSessionRoot, "合同输出", "返点合同.docx"), "docx-fixture", "utf8");
    await writeFile(
      join(allowedSessionRoot, "onmyagent-session.json"),
      JSON.stringify({ kind: "expert-session", workspaceId: "ws_1" }),
      "utf8",
    );
    const outsideRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-artifact-outside-"));
    roots.push(outsideRoot);
    await writeFile(join(outsideRoot, "escaped.md"), "# Escaped result\n", "utf8");
    await linkArtifactFixture(
      join(outsideRoot, "escaped.md"),
      join(allowedSessionRoot, "escaped.md"),
      "escape",
    );
    const previousRuntimeRoot = process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT;
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    try {
      const { base, token } = await startOnMyAgentServer(workspaceRoot);
      const resolve = async (sessionRoot: string, value = "result.md") => {
        const response = await fetch(`${base}/workspace/ws_1/artifacts/resolve`, {
          method: "POST",
          headers: auth(token),
          body: JSON.stringify({
            sessionRoot,
            targets: [{ kind: "file", value, confidence: 95 }],
          }),
        });
        expect(response.status).toBe(200);
        return await response.json() as { items: Array<{ value: string; exists: boolean }> };
      };

      expect((await resolve(allowedSessionRoot)).items).toContainEqual(
        expect.objectContaining({ value: "result.md", exists: true }),
      );
      expect((await resolve(allowedSessionRoot, "合同输出/返点合同.docx")).items).toContainEqual(
        expect.objectContaining({
          value: "合同输出/返点合同.docx",
          exists: true,
          preview: "document",
        }),
      );
      expect((await resolve(allowedSessionRoot, "escaped.md")).items).toContainEqual(
        expect.objectContaining({ value: "escaped.md", exists: false }),
      );
    } finally {
      if (previousRuntimeRoot === undefined) {
        delete process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT;
      } else {
        process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = previousRuntimeRoot;
      }
    }
  });

  test("resolve, read, write, and download markdown/csv/xlsx/html artifacts", async () => {
    const root = await createWorkspaceRoot();
    const { base, token } = await startOnMyAgentServer(root);

    const resolveResponse = await fetch(`${base}/workspace/ws_1/artifacts/resolve`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        targets: [
          { kind: "file", value: join(root, "reports", "artifact-eval.md"), confidence: 95 },
          { kind: "file", value: "Workspace/32423/reports/artifact-eval.md", confidence: 80 },
          { kind: "file", value: "reports/artifact-eval.csv", confidence: 80 },
          { kind: "file", value: "reports/artifact-eval.xlsx", confidence: 80 },
          { kind: "file", value: "reports/index.html", confidence: 80 },
          { kind: "file", value: "reports/missing.md", confidence: 80 },
          { kind: "url", value: "http://localhost:4321", confidence: 80 },
          { kind: "url", value: "ws://localhost:4321/socket", confidence: 80 },
        ],
      }),
    });
    expect(resolveResponse.status).toBe(200);
    const resolved = await resolveResponse.json() as { items: Array<any> };
    expect(resolved.items.find((item) => item.value === "reports/artifact-eval.md")).toMatchObject({ exists: true, preview: "markdown", confidence: 95 });
    expect(resolved.items.find((item) => item.value === "reports/artifact-eval.csv")).toMatchObject({ exists: true, preview: "sheet" });
    expect(resolved.items.find((item) => item.value === "reports/artifact-eval.xlsx")).toMatchObject({ exists: true, preview: "sheet" });
    expect(resolved.items.find((item) => item.value === "reports/index.html")).toMatchObject({ exists: true, preview: "html" });
    expect(resolved.items.find((item) => item.value === "reports/missing.md")).toMatchObject({ exists: false });
    expect(resolved.items.find((item) => item.value === "http://localhost:4321/")).toMatchObject({ kind: "url", preview: "browser" });
    expect(resolved.items.find((item) => item.value === "ws://localhost:4321/socket")).toMatchObject({ kind: "url", preview: "browser" });

    const csvRead = await fetch(`${base}/workspace/ws_1/files/content?path=${encodeURIComponent("reports/artifact-eval.csv")}`, { headers: auth(token) });
    expect(await csvRead.json()).toMatchObject({ content: "name,revenue\nAda,10\nGrace,20\n" });

    const mdWrite = await fetch(`${base}/workspace/ws_1/files/content`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ path: "reports/artifact-eval.md", content: "# Updated\n" }),
    });
    expect(mdWrite.status).toBe(200);
    expect(await readFile(join(root, "reports", "artifact-eval.md"), "utf8")).toBe("# Updated\n");

    const xlsxWrite = await fetch(`${base}/workspace/ws_1/files/raw`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ path: "reports/artifact-eval.xlsx", dataBase64: Buffer.from([80, 75, 9, 9]).toString("base64") }),
    });
    expect(xlsxWrite.status).toBe(200);

    const xlsxDownload = await fetch(`${base}/workspace/ws_1/files/raw?path=${encodeURIComponent("reports/artifact-eval.xlsx")}`, { headers: auth(token) });
    expect(xlsxDownload.status).toBe(200);
    expect(Array.from(new Uint8Array(await xlsxDownload.arrayBuffer()))).toEqual([80, 75, 9, 9]);
  });
});
