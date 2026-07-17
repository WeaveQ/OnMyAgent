import { describe, expect, test } from "bun:test";

import { buildTranscriptToolPresentation } from "../src/react-app/domains/session/surface/transcript/tool-presentation";

describe("session transcript WorkBuddy resources and image generation", () => {
  test("normalizes nested image generation results and preserves every usable source", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "image_gen",
      toolInput: { prompt: "A quiet workspace at night" },
      toolOutput: {
        result: {
          result: {
            status: "completed",
            prompt: "A quiet workspace at night",
            images: [
              { b64_json: "aGVsbG8=" },
              { url: "https://example.com/generated.png" },
              { localPath: "/workspace/generated/local.png" },
              { ignored: true },
            ],
          },
        },
      },
    });

    expect(presentation.family).toBe("image-gen");
    expect(presentation.details).toEqual({
      kind: "image-gen",
      prompt: "A quiet workspace at night",
      status: "completed",
      images: [
        { base64: "aGVsbG8=", localPath: null, url: null },
        { base64: null, localPath: null, url: "https://example.com/generated.png" },
        { base64: null, localPath: "/workspace/generated/local.png", url: null },
      ],
      errorMessage: null,
    });
  });

  test("normalizes failed and still-generating image states", () => {
    const failed = buildTranscriptToolPresentation({
      toolName: "ImageGen",
      toolInput: { prompt: "Broken image" },
      toolOutput: { result: { status: "failed", error: "Provider unavailable" } },
    });
    const generating = buildTranscriptToolPresentation({
      toolName: "image-gen",
      toolInput: { prompt: "Still rendering" },
      toolOutput: undefined,
    });

    expect(failed.details).toEqual({
      kind: "image-gen",
      prompt: "Broken image",
      status: "error",
      images: [],
      errorMessage: "Provider unavailable",
    });
    expect(generating.details).toEqual({
      kind: "image-gen",
      prompt: "Still rendering",
      status: "generating",
      images: [],
      errorMessage: null,
    });
  });

  test("routes image generation through its full card and user files through compact chips", async () => {
    const [messageList, specializedTools, resourceChip] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/message-list.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/specialized-tool-details.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/transcript-resource-chip.tsx",
        import.meta.url,
      )).text(),
    ]);

    expect(messageList).toContain("ImageGenerationToolCard");
    expect(messageList).toContain("block.isUser ? (");
    expect(messageList).toContain("<TranscriptResourceChip");
    expect(specializedTools).toContain("checkerboardStyle");
    expect(specializedTools).toContain("usableImages.map");
    expect(resourceChip).toContain("max-w-[200px]");
    expect(resourceChip).toContain("text-xs");
  });
});
