import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createManagedCliDownloader,
  digestBytes,
  hashFile,
  verifyDigest,
  verifyOptionalBytes,
} from "./download.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("verifyDigest checks sha256 and optional size", () => {
  const bytes = Buffer.from("hello-managed-cli");
  const digest = sha256(bytes);
  assert.equal(
    verifyDigest(bytes.byteLength, digest, { sha256: digest }, "bin"),
    digest,
  );
  assert.equal(
    verifyDigest(bytes.byteLength, digest, {
      sha256: digest,
      size: bytes.byteLength,
    }, "bin"),
    digest,
  );
  assert.throws(
    () =>
      verifyDigest(bytes.byteLength, digest, {
        sha256: digest,
        size: bytes.byteLength + 1,
      }, "bin"),
    (error) => error?.code === "integrity_mismatch",
  );
  assert.throws(
    () =>
      verifyDigest(bytes.byteLength, digest, { sha256: "0".repeat(64) }, "bin"),
    (error) => error?.code === "integrity_mismatch",
  );
});

test("verifyOptionalBytes skips when sha256 absent", () => {
  const bytes = Buffer.from("skill-only-url");
  assert.equal(verifyOptionalBytes(bytes, { url: "https://x" }, "skill"), digestBytes(bytes));
  assert.equal(
    verifyOptionalBytes(bytes, { sha256: sha256(bytes) }, "skill"),
    sha256(bytes),
  );
});

test("hashFile returns size and digest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-managed-dl-"));
  try {
    const target = path.join(root, "payload.bin");
    const payload = Buffer.from("payload-bytes");
    await writeFile(target, payload);
    const digest = await hashFile(target, 1024, "payload");
    assert.equal(digest.size, payload.byteLength);
    assert.equal(digest.sha256, sha256(payload));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createManagedCliDownloader streams and verifies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-managed-dl-stream-"));
  try {
    const payload = Buffer.from("streamed-binary");
    const digest = sha256(payload);
    const downloader = createManagedCliDownloader({
      label: "TestCLI",
      networkRetryCount: 0,
      fetchImpl: async () =>
        new Response(payload, {
          status: 200,
          headers: { "content-length": String(payload.byteLength) },
        }),
    });
    const dest = path.join(root, "out.bin");
    const result = await downloader.downloadToFile({
      url: "https://example.com/bin",
      destPath: dest,
      maximum: 1024,
      expected: { sha256: digest },
      label: "TestCLI binary",
    });
    assert.equal(result.digest, digest);
    assert.equal(result.receivedBytes, payload.byteLength);
    assert.equal(await readFile(dest, "utf8"), "streamed-binary");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
