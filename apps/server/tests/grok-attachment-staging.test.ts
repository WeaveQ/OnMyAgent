import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertStagedPathInSessionRoot,
  buildGrokPromptFromRuntimeParts,
  cleanupGrokStagedAttachments,
  grokPromptFromBlocks,
  grokStagingUsesWorkspaceCopy,
  resolveGrokAttachmentStagingRoot,
  stageWorkspaceAttachments,
} from "../src/services/grok-attachment-staging.js";

describe("Grok attachment staging", () => {
  test("copies workspace files into the host runtime staging root and inlines text", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-stage-"));
    const dataRoot = join(root, "user-data");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "notes.md"), "hello", "utf8");
    const staged = await stageWorkspaceAttachments({
      workspaceRoot: workspace,
      sessionId: "session-1",
      dataRoot,
      files: [{ url: "notes.md", filename: "notes.md", mime: "text/markdown" }],
    });
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({
      type: "staged_file",
      name: "notes.md",
      content: "hello",
    });
    const stagedPath = String((staged[0] as { path: string }).path);
    const stagingRoot = await realpath(resolveGrokAttachmentStagingRoot(dataRoot));
    expect(stagedPath.startsWith(stagingRoot)).toBe(true);
    expect(grokStagingUsesWorkspaceCopy(stagedPath)).toBe(false);
    expect(stagedPath).not.toContain(".onmyagent-runtime/grok-staging");
    expect(await readFile(stagedPath, "utf8")).toBe("hello");
    expect(grokPromptFromBlocks([
      { type: "text", text: "Summarize" },
      staged[0]!,
    ])[0]?.text).toContain("hello");

    await cleanupGrokStagedAttachments({ sessionId: "session-1", dataRoot });
    await expect(readFile(stagedPath, "utf8")).rejects.toThrow();
  });

  test("rejects client staged_file paths outside the session staging root", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-stage-client-"));
    const dataRoot = join(root, "user-data");
    const workspace = join(root, "workspace");
    const outside = join(root, "secret.txt");
    await mkdir(workspace, { recursive: true });
    await writeFile(outside, "classified", "utf8");
    await expect(assertStagedPathInSessionRoot({
      sessionId: "session-client",
      path: outside,
      dataRoot,
    })).rejects.toMatchObject({ code: "grok_attachment_outside_staging" });
    await expect(buildGrokPromptFromRuntimeParts({
      text: "read this",
      workspaceRoot: workspace,
      sessionId: "session-client",
      dataRoot,
      parts: [{ type: "staged_file", path: outside, filename: "secret.txt" }],
    })).rejects.toMatchObject({ code: "grok_attachment_outside_staging" });
  });

  test("accepts staged_file paths that already live under the session staging root", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-stage-inside-"));
    const dataRoot = join(root, "user-data");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const staged = await stageWorkspaceAttachments({
      workspaceRoot: workspace,
      sessionId: "session-inside",
      dataRoot,
      files: [{
        url: `data:text/plain;base64,${Buffer.from("safe", "utf8").toString("base64")}`,
        filename: "safe.txt",
        mime: "text/plain",
      }],
    });
    const stagedPath = String((staged[0] as { path: string }).path);
    const prompt = await buildGrokPromptFromRuntimeParts({
      text: "use file",
      workspaceRoot: workspace,
      sessionId: "session-inside",
      dataRoot,
      parts: [{ type: "staged_file", path: stagedPath, filename: "safe.txt" }],
    });
    expect(prompt[0]?.text).toContain("safe");
  });

  test("rejects lexical paths whose realpath escapes the workspace via an intermediate symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-stage-escape-"));
    const dataRoot = join(root, "user-data");
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(join(workspace, "keep"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "classified", "utf8");
    await symlink(outside, join(workspace, "inner"));
    await expect(stageWorkspaceAttachments({
      workspaceRoot: workspace,
      sessionId: "session-escape",
      dataRoot,
      files: [{ url: "inner/secret.txt" }],
    })).rejects.toMatchObject({ code: "grok_attachment_outside_workspace" });
  });

  test("stages data URLs under the runtime root without treating them as workspace paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-stage-data-"));
    const dataRoot = join(root, "user-data");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const staged = await stageWorkspaceAttachments({
      workspaceRoot: workspace,
      sessionId: "session-data",
      dataRoot,
      files: [
        {
          url: `data:text/markdown;base64,${Buffer.from("inline notes", "utf8").toString("base64")}`,
          filename: "notes.md",
          mime: "text/markdown",
        },
        {
          url: `data:image/png;base64,${png.toString("base64")}`,
          filename: "shot.png",
          mime: "image/png",
        },
      ],
    });
    expect(staged[0]).toMatchObject({ type: "staged_file", content: "inline notes" });
    expect(staged[1]).toMatchObject({ type: "image", name: "shot.png" });
    const imagePath = String((staged[1] as { path: string }).path);
    expect(imagePath.startsWith(await realpath(resolveGrokAttachmentStagingRoot(dataRoot)))).toBe(true);
  });

  test("rejects files outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-stage-"));
    const dataRoot = join(root, "user-data");
    await mkdir(join(root, "inner"), { recursive: true });
    await expect(stageWorkspaceAttachments({
      workspaceRoot: join(root, "inner"),
      sessionId: "session-2",
      dataRoot,
      files: [{ url: "../secret.txt" }],
    })).rejects.toMatchObject({ code: "grok_attachment_outside_workspace" });
  });
});
