import { createDecipheriv } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createIlinkClient } from "./ilink-client.mjs";
import {
  aesEcbPaddedSize,
  buildCdnUploadUrl,
  extractLocalMarkdownLinks,
  selectOutboundFiles,
  uploadAndSendOutboundFile,
} from "./outbound-files.mjs";

async function tempRoot() {
  return await mkdtemp(path.join(os.tmpdir(), "onmyagent-weixin-outbound-"));
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
}

function markdownTarget(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return process.platform === "win32" ? `/${normalized}` : normalized;
}

describe("Weixin outbound file selection", () => {
  it("selects explicit runtime artifacts in deterministic link order and removes local paths", async () => {
    const root = await tempRoot();
    try {
      const first = path.join(root, "summary.md");
      const second = path.join(root, "changes.diff");
      await writeFile(first, "summary", "utf8");
      await writeFile(second, "diff", "utf8");
      const output = [
        `下载 [变更](${`<${markdownTarget(second)}>`})`,
        `再看 [总结](${`<${markdownTarget(first)}>`})`,
        `重复 [总结](${`<${markdownTarget(first)}>`})`,
      ].join("\n");

      const links = extractLocalMarkdownLinks(output);
      assert.equal(links.length, 3);
      const selected = await selectOutboundFiles({
        output,
        artifacts: [{ kind: "file", name: "summary.md" }, { kind: "file", name: "changes.diff" }],
        allowedRoots: [root],
      });

      assert.deepEqual(selected.attachments.map((item) => item.name), ["changes.diff", "summary.md"]);
      assert.equal(selected.rejected.length, 0);
      assert.doesNotMatch(selected.cleanedOutput, /[A-Za-z]:[\\/]|\/tmp\//);
      assert.match(selected.cleanedOutput, /变更/);
      assert.match(selected.cleanedOutput, /总结/);
    } finally {
      await cleanup(root);
    }
  });

  it("rejects untracked, missing, sensitive, unsupported, oversized, outside-root, and excess files", async () => {
    const root = await tempRoot();
    const outsideRoot = await tempRoot();
    try {
      const files = {
        untracked: path.join(root, "untracked.txt"),
        missing: path.join(root, "missing.txt"),
        sensitive: path.join(root, "credentials.txt"),
        unsupported: path.join(root, "data.xyz"),
        oversized: path.join(root, "large.txt"),
        first: path.join(root, "first.txt"),
        second: path.join(root, "second.txt"),
        outside: path.join(outsideRoot, "outside.txt"),
      };
      await Promise.all(Object.entries(files)
        .filter(([key]) => key !== "missing")
        .map(([key, filePath]) => writeFile(filePath, key === "oversized" ? "123456" : "12345", "utf8")));
      const output = Object.values(files)
        .map((filePath) => `[${path.basename(filePath)}](<${markdownTarget(filePath)}>)`)
        .join("\n");
      const artifacts = Object.values(files)
        .filter((filePath) => filePath !== files.untracked)
        .map((filePath) => ({ kind: "file", name: path.basename(filePath) }));

      const selected = await selectOutboundFiles({
        output,
        artifacts,
        allowedRoots: [root],
        maxFiles: 1,
        maxFileBytes: 5,
        maxTotalBytes: 5,
      });

      assert.deepEqual(selected.attachments.map((item) => item.name), ["first.txt"]);
      assert.deepEqual(new Set(selected.rejected.map((item) => item.reason)), new Set([
        "not-runtime-artifact",
        "missing-file",
        "sensitive-or-executable",
        "unsupported-type",
        "file-too-large",
        "outside-workspace",
        "too-many-files",
      ]));
      assert.equal(selected.cleanedOutput.includes("（未发送）"), true);
    } finally {
      await cleanup(root);
      await cleanup(outsideRoot);
    }
  });

  it("enforces exact file and total byte limits", async () => {
    const root = await tempRoot();
    try {
      const large = path.join(root, "large.txt");
      const one = path.join(root, "one.txt");
      const two = path.join(root, "two.txt");
      await writeFile(large, "123456", "utf8");
      await writeFile(one, "1234", "utf8");
      await writeFile(two, "5678", "utf8");
      const all = [large, one, two];
      const selected = await selectOutboundFiles({
        output: all.map((filePath) => `[file](<${markdownTarget(filePath)}>)`).join("\n"),
        artifacts: all.map((filePath) => ({ kind: "file", name: path.basename(filePath) })),
        allowedRoots: [root],
        maxFileBytes: 5,
        maxTotalBytes: 5,
      });
      assert.deepEqual(selected.attachments.map((item) => item.name), ["one.txt"]);
      assert.deepEqual(selected.rejected.map((item) => item.reason), ["file-too-large", "total-too-large"]);
    } finally {
      await cleanup(root);
    }
  });

  it("rejects exact runtime-recorded artifact paths outside the workspace and same-name substitutions", async () => {
    const root = await tempRoot();
    const artifactRoot = await tempRoot();
    try {
      const recorded = path.join(artifactRoot, "result.txt");
      const substituted = path.join(root, "result.txt");
      await writeFile(recorded, "recorded", "utf8");
      await writeFile(substituted, "substituted", "utf8");
      const artifact = { kind: "file", name: "result.txt", path: recorded };
      const outside = await selectOutboundFiles({
        output: `[result](<${markdownTarget(recorded)}>)`,
        artifacts: [artifact],
        allowedRoots: [root],
      });
      assert.equal(outside.attachments.length, 0);
      assert.deepEqual(outside.rejected.map((item) => item.reason), ["outside-workspace"]);

      const rejected = await selectOutboundFiles({
        output: `[result](<${markdownTarget(substituted)}>)`,
        artifacts: [artifact],
        allowedRoots: [root],
      });
      assert.equal(rejected.attachments.length, 0);
      assert.deepEqual(rejected.rejected.map((item) => item.reason), ["artifact-path-mismatch"]);

      const missingRecorded = await selectOutboundFiles({
        output: `[result](<${markdownTarget(substituted)}>)`,
        artifacts: [{ kind: "file", name: "result.txt", path: path.join(artifactRoot, "missing-result.txt") }],
        allowedRoots: [root],
      });
      assert.equal(missingRecorded.attachments.length, 0);
      assert.deepEqual(missingRecorded.rejected.map((item) => item.reason), ["artifact-path-mismatch"]);
    } finally {
      await cleanup(root);
      await cleanup(artifactRoot);
    }
  });

  it("rejects a safe-name symlink to a sensitive file inside the workspace", { skip: process.platform === "win32" }, async () => {
    const root = await tempRoot();
    try {
      const sensitive = path.join(root, ".env");
      const linked = path.join(root, "report.txt");
      await writeFile(sensitive, "TOKEN=secret", "utf8");
      await symlink(sensitive, linked);
      const selected = await selectOutboundFiles({
        output: `[report](<${markdownTarget(linked)}>)`,
        artifacts: [{ kind: "file", name: "report.txt", path: linked }],
        allowedRoots: [root],
      });
      assert.equal(selected.attachments.length, 0);
      assert.deepEqual(selected.rejected.map((item) => item.reason), ["not-regular-file"]);
    } finally {
      await cleanup(root);
    }
  });
});

describe("Weixin outbound file protocol", () => {
  it("rejects a same-size symlink swap after selection", { skip: process.platform === "win32" }, async () => {
    const root = await tempRoot();
    const outsideRoot = await tempRoot();
    try {
      const filePath = path.join(root, "result.txt");
      const secretPath = path.join(outsideRoot, "secret.txt");
      await writeFile(filePath, "SAFE!!", "utf8");
      await writeFile(secretPath, "SECRET", "utf8");
      const selected = await selectOutboundFiles({
        output: `[result](<${markdownTarget(filePath)}>)`,
        artifacts: [{ kind: "file", name: "result.txt", path: filePath }],
        allowedRoots: [root],
      });
      assert.equal(selected.attachments.length, 1);

      await rm(filePath);
      await symlink(secretPath, filePath);
      const selectedAfterSwap = await selectOutboundFiles({
        output: `[result](<${markdownTarget(filePath)}>)`,
        artifacts: [{ kind: "file", name: "result.txt", path: filePath }],
        allowedRoots: [root],
      });
      assert.deepEqual(selectedAfterSwap.rejected.map((item) => item.reason), ["not-regular-file"]);

      let uploadRequests = 0;
      await assert.rejects(() => uploadAndSendOutboundFile({
        client: {
          getUploadUrl: async () => {
            uploadRequests += 1;
            return { upload_full_url: "https://novac2c.cdn.weixin.qq.com/c2c/upload" };
          },
        },
        account: { baseUrl: "https://ilinkai.weixin.qq.com", cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c", token: "secret" },
        to: "user-1",
        attachment: selected.attachments[0],
      }), /file changed before upload/);
      assert.equal(uploadRequests, 0);
    } finally {
      await cleanup(root);
      await cleanup(outsideRoot);
    }
  });

  it("uses the current getuploadurl, AES-128-ECB, CDN header, and type-4 file item contract", async () => {
    const root = await tempRoot();
    try {
      const filePath = path.join(root, "报告.txt");
      const plaintext = Buffer.from("hello outbound weixin", "utf8");
      await writeFile(filePath, plaintext);
      const calls = {};
      const client = {
        getUploadUrl: async (input) => {
          calls.uploadRequest = input;
          return { upload_full_url: "https://novac2c.cdn.weixin.qq.com/c2c/upload?ticket=ok" };
        },
        uploadCdn: async (input) => {
          calls.cdn = input;
          return { encryptedQueryParam: "download-param" };
        },
        sendMessageItem: async (input) => {
          calls.message = input;
          return { ret: 0 };
        },
      };

      await uploadAndSendOutboundFile({
        client,
        account: { baseUrl: "https://ilinkai.weixin.qq.com", cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c", token: "secret" },
        to: "user-1",
        contextToken: "ctx-1",
        attachment: { path: filePath, name: "报告.txt", size: plaintext.length },
      });

      assert.equal(calls.uploadRequest.mediaType, 3);
      assert.equal(calls.uploadRequest.rawSize, plaintext.length);
      assert.equal(calls.uploadRequest.encryptedSize, aesEcbPaddedSize(plaintext.length));
      assert.match(calls.uploadRequest.rawFileMd5, /^[a-f0-9]{32}$/);
      const keyHex = Buffer.from(calls.message.item.file_item.media.aes_key, "base64").toString("utf8");
      assert.equal(keyHex, calls.uploadRequest.aesKey);
      const decipher = createDecipheriv("aes-128-ecb", Buffer.from(keyHex, "hex"), null);
      const decrypted = Buffer.concat([decipher.update(calls.cdn.encrypted), decipher.final()]);
      assert.deepEqual(decrypted, plaintext);
      assert.equal(calls.message.item.type, 4);
      assert.equal(calls.message.item.file_item.media.encrypt_query_param, "download-param");
      assert.equal(calls.message.item.file_item.media.encrypt_type, 1);
      assert.equal(calls.message.item.file_item.file_name, "报告.txt");
      assert.equal(calls.message.item.file_item.len, String(plaintext.length));
      assert.equal(calls.message.contextToken, "ctx-1");
    } finally {
      await cleanup(root);
    }
  });

  it("rejects untrusted upload URLs and builds the official CDN fallback URL", async () => {
    assert.equal(
      buildCdnUploadUrl({
        cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        uploadParam: "a+b&c",
        fileKey: "file key",
      }),
      "https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=a%2Bb%26c&filekey=file%20key",
    );
    const root = await tempRoot();
    try {
      const filePath = path.join(root, "safe.txt");
      await writeFile(filePath, "safe", "utf8");
      await assert.rejects(() => uploadAndSendOutboundFile({
        client: {
          getUploadUrl: async () => ({ upload_full_url: "https://attacker.example/upload" }),
          uploadCdn: async () => assert.fail("must not upload to an untrusted host"),
        },
        account: { baseUrl: "https://ilinkai.weixin.qq.com", cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c", token: "secret" },
        to: "user-1",
        attachment: { path: filePath, name: "safe.txt", size: 4 },
      }), /host is not allowed/);
    } finally {
      await cleanup(root);
    }
  });

  it("stops before CDN upload when getuploadurl reports an iLink error", async () => {
    const root = await tempRoot();
    try {
      const filePath = path.join(root, "safe.txt");
      await writeFile(filePath, "safe", "utf8");
      await assert.rejects(() => uploadAndSendOutboundFile({
        client: {
          getUploadUrl: async () => ({ ret: -14, errcode: -14, errmsg: "expired" }),
          uploadCdn: async () => assert.fail("must not upload after getuploadurl failed"),
        },
        account: { baseUrl: "https://ilinkai.weixin.qq.com", cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c", token: "secret" },
        to: "user-1",
        attachment: { path: filePath, name: "safe.txt", size: 4 },
      }), /getuploadurl failed ret=-14 errcode=-14/);
    } finally {
      await cleanup(root);
    }
  });

  it("posts getuploadurl, raw CDN bytes, and one structured item through the iLink client", async () => {
    const calls = [];
    const client = createIlinkClient({
      fetchFn: async (url, options) => {
        calls.push({ url, options });
        if (url.includes("/c2c/upload")) {
          return new Response("", { status: 200, headers: { "x-encrypted-param": "download-param" } });
        }
        return new Response(JSON.stringify({ ret: 0, upload_full_url: "https://novac2c.cdn.weixin.qq.com/c2c/upload" }), { status: 200 });
      },
    });
    await client.getUploadUrl({
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "secret",
      fileKey: "file-key",
      mediaType: 3,
      toUserId: "user-1",
      rawSize: 4,
      rawFileMd5: "abcd",
      encryptedSize: 16,
      aesKey: "0011",
    });
    assert.equal((JSON.parse(calls[0].options.body)).media_type, 3);
    assert.equal((JSON.parse(calls[0].options.body)).no_need_thumb, true);
    assert.deepEqual(await client.uploadCdn({
      uploadUrl: "https://novac2c.cdn.weixin.qq.com/c2c/upload",
      encrypted: Buffer.from("cipher"),
    }), { encryptedQueryParam: "download-param" });
    await client.sendMessageItem({
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "secret",
      to: "user-1",
      contextToken: "ctx-1",
      clientId: "client-1",
      item: { type: 4, file_item: { file_name: "x.txt" } },
    });
    const sent = JSON.parse(calls[2].options.body);
    assert.equal(sent.msg.item_list.length, 1);
    assert.equal(sent.msg.item_list[0].type, 4);
    assert.equal(sent.msg.context_token, "ctx-1");
  });

  it("does not retry CDN client errors and requires the encrypted download header", async () => {
    let clientErrorCalls = 0;
    const rejectedClient = createIlinkClient({
      fetchFn: async () => {
        clientErrorCalls += 1;
        return new Response("denied", { status: 403, headers: { "x-error-message": "denied" } });
      },
    });
    await assert.rejects(() => rejectedClient.uploadCdn({
      uploadUrl: "https://novac2c.cdn.weixin.qq.com/c2c/upload",
      encrypted: Buffer.from("cipher"),
    }), /upload rejected HTTP 403/);
    assert.equal(clientErrorCalls, 1);

    let missingHeaderCalls = 0;
    const missingHeaderClient = createIlinkClient({
      fetchFn: async () => {
        missingHeaderCalls += 1;
        return new Response("", { status: 200 });
      },
    });
    await assert.rejects(() => missingHeaderClient.uploadCdn({
      uploadUrl: "https://novac2c.cdn.weixin.qq.com/c2c/upload",
      encrypted: Buffer.from("cipher"),
    }), /missing x-encrypted-param/);
    assert.equal(missingHeaderCalls, 3);
  });
});
