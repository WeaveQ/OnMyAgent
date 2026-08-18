import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComposerAttachment, ComposerDraft } from "../src/app/types";
import { composeGrokPromptInputFromDraft } from "../src/react-app/shell/session-route/composer";
import {
  buildGrokPromptFromRuntimeParts,
  cleanupGrokStagedAttachments,
  resolveGrokAttachmentStagingRoot,
} from "../../server/src/services/grok-attachment-staging.js";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function draft(input: Partial<ComposerDraft>): ComposerDraft {
  return {
    mode: "prompt",
    parts: [],
    attachments: [],
    text: "",
    ...input,
  };
}

function attachment(
  input: Partial<ComposerAttachment> & { name: string; kind: "image" | "file" },
): ComposerAttachment {
  return {
    id: input.name,
    name: input.name,
    mimeType: input.mimeType ?? (input.kind === "image" ? "image/png" : "text/plain"),
    size: input.size ?? 12,
    kind: input.kind,
    file: input.file ?? new File(["payload"], input.name, { type: input.mimeType ?? "text/plain" }),
    sourcePath: input.sourcePath,
    previewUrl: input.previewUrl,
  };
}

describe("Grok composer attachment pipeline", () => {
  test("real File attachments become staged prompt blocks, and data images do not 400", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-composer-attach-"));
    const dataRoot = join(root, "user-data");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "local.txt"), "workspace copy", "utf8");

    const prompt = await composeGrokPromptInputFromDraft(
      draft({
        text: "Summarize the attachments",
        attachments: [
          attachment({
            name: "notes.md",
            kind: "file",
            mimeType: "text/markdown",
            file: new File(["hello from paperclip"], "notes.md", { type: "text/markdown" }),
          }),
          attachment({
            name: "local.txt",
            kind: "file",
            mimeType: "text/plain",
            sourcePath: join(workspace, "local.txt"),
            file: new File(["ignored blob"], "local.txt", { type: "text/plain" }),
          }),
          attachment({
            name: "shot.png",
            kind: "image",
            mimeType: "image/png",
            file: new File([PNG_BYTES], "shot.png", { type: "image/png" }),
          }),
        ],
      }),
      workspace,
      { messageId: "msg-attach" },
    );

    expect(prompt.text).toBe("Summarize the attachments");
    expect(prompt.messageId).toBe("msg-attach");
    expect(prompt.parts).toHaveLength(3);
    expect(prompt.parts?.every((part) => part.type === "file")).toBe(true);
    expect(prompt.parts?.[0]).toMatchObject({
      type: "file",
      filename: "notes.md",
      mime: "text/markdown",
    });
    expect(String((prompt.parts?.[0] as { url: string }).url)).toMatch(/^data:text\/markdown/);
    expect(prompt.parts?.[1]).toMatchObject({
      type: "file",
      filename: "local.txt",
      url: `file://${join(workspace, "local.txt")}`,
    });
    expect(String((prompt.parts?.[2] as { url: string }).url)).toMatch(/^data:image\/png/);

    const blocks = await buildGrokPromptFromRuntimeParts({
      text: prompt.text,
      parts: prompt.parts,
      workspaceRoot: workspace,
      sessionId: "session-attach",
      dataRoot,
    });
    const text = blocks[0]?.text ?? "";
    expect(text).toContain("hello from paperclip");
    expect(text).toContain("workspace copy");
    expect(text).toContain("shot.png");
    expect(text).not.toContain("The user uploaded the following files");
    const stagingRoot = await realpath(resolveGrokAttachmentStagingRoot(dataRoot));
    expect(text).toContain(stagingRoot);
    expect(text).not.toContain(".onmyagent-runtime/grok-staging");

    await cleanupGrokStagedAttachments({ sessionId: "session-attach", dataRoot });
    await expect(readFile(join(stagingRoot, "session-attach"), "utf8")).rejects.toThrow();
  });
});
