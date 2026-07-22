import { describe, expect, test } from "bun:test";

import {
  fileFromAppshotPayload,
  formatAttachmentSuccessDisplayName,
  formatOversizeAttachmentName,
  parseAppshotPayload,
  processAttachmentFiles,
} from "../src/react-app/domains/session/surface/composer/attachments";
import { MAX_ATTACHMENT_BYTES } from "../src/react-app/domains/session/surface/composer/composer-helpers";

function makeFile(name: string, size: number, type = "application/octet-stream") {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type, lastModified: 1 });
}

describe("processAttachmentFiles", () => {
  test("returns empty result for empty input", async () => {
    await expect(processAttachmentFiles([])).resolves.toEqual({
      accepted: [],
      oversizeNames: [],
    });
  });

  test("accepts files under the limit without compressing non-images", async () => {
    const small = makeFile("note.txt", 100, "text/plain");
    const result = await processAttachmentFiles([small], {
      compressImage: async () => {
        throw new Error("should not compress text");
      },
    });
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.name).toBe("note.txt");
    expect(result.oversizeNames).toEqual([]);
  });

  test("rejects files over the byte limit after optional image compress", async () => {
    const huge = makeFile("big.bin", MAX_ATTACHMENT_BYTES + 1);
    const result = await processAttachmentFiles([huge]);
    expect(result.accepted).toEqual([]);
    expect(result.oversizeNames).toEqual(["big.bin"]);
  });

  test("compresses images then size-gates the result", async () => {
    const image = makeFile("photo.png", 10, "image/png");
    const compressed = makeFile("photo.jpg", MAX_ATTACHMENT_BYTES + 50, "image/jpeg");
    const result = await processAttachmentFiles([image], {
      compressImage: async () => compressed,
    });
    expect(result.accepted).toEqual([]);
    expect(result.oversizeNames).toEqual(["photo.jpg"]);
  });

  test("keeps accepted images when compress stays under limit", async () => {
    const image = makeFile("photo.png", 10, "image/png");
    const compressed = makeFile("photo.jpg", 500, "image/jpeg");
    const result = await processAttachmentFiles([image], {
      compressImage: async () => compressed,
    });
    expect(result.accepted).toEqual([compressed]);
    expect(result.oversizeNames).toEqual([]);
  });
});

describe("appshot payload helpers", () => {
  test("parseAppshotPayload rejects incomplete payloads", () => {
    expect(parseAppshotPayload(null)).toBeNull();
    expect(parseAppshotPayload({})).toBeNull();
    expect(parseAppshotPayload({ name: "x", mimeType: "image/jpeg" })).toBeNull();
  });

  test("parseAppshotPayload accepts well-formed payloads", () => {
    expect(
      parseAppshotPayload({
        name: "Appshot-1.jpg",
        mimeType: "image/jpeg",
        data: "AAAA",
      }),
    ).toEqual({
      name: "Appshot-1.jpg",
      mimeType: "image/jpeg",
      data: "AAAA",
    });
  });

  test("fileFromAppshotPayload decodes base64 and sanitizes name", () => {
    const file = fileFromAppshotPayload({
      name: "Appshot-demo.png",
      mimeType: "image/png",
      data: btoa("png-bytes"),
    });
    expect(file.name).toBe("Appshot-demo.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe("png-bytes".length);
  });
});

describe("attachment notice name helpers", () => {
  test("truncates long safe names for success notices", () => {
    const long = `${"a".repeat(50)}.txt`;
    const display = formatAttachmentSuccessDisplayName(long);
    expect(display).not.toBeNull();
    expect(display!.endsWith("…")).toBe(true);
    // 37-char prefix + ellipsis
    expect(display!.length).toBe(38);
  });

  test("rejects unsafe / dump-like names", () => {
    expect(
      formatAttachmentSuccessDisplayName("JoinedSequence<ArraySlice>"),
    ).toBeNull();
    expect(
      formatOversizeAttachmentName("JoinedSequence", "file"),
    ).toBe("file");
    expect(formatOversizeAttachmentName("ok.pdf", "file")).toBe("ok.pdf");
  });
});
