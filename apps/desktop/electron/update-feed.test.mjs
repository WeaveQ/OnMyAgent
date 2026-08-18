import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_UPDATE_FEED_URL,
  normalizeFeedUrl,
  parseUpdaterManifest,
  pickFallbackArtifactUrl,
  resolveFeedArtifactUrl,
  resolveUpdateFeedUrl,
  resolveUpdaterManifestUrl,
  updaterManifestName,
} from "./update-feed.mjs";

const SAMPLE_MAC = `version: 0.5.16
files:
  - url: 0.5.16/onmyagent-mac-arm64-0.5.16.zip
    sha512: PmRhgsmfgy3DamA9rCluOK6BO8xNfifskUkDfBbyTTbUJ5/RQAuPt1VetWuHFOy/UgFEUkRyTYS0XjkicTg5bg==
    size: 323562636
  - url: 0.5.16/onmyagent-mac-arm64-0.5.16.dmg
    sha512: xgPLQV9faXwo1M0pp79h7CrTBeiKalU6MGq6Auo81HOhdcf0Vy/ik9wzJ3Bu5xa9Z/iPAVOyMJL3BQgJMo4kzA==
    size: 320949101
  - url: 0.5.16/onmyagent-mac-x64-0.5.16.zip
    sha512: wErcuZwd3QOcugEcxh/5kFpbTjEqICUtEH80oo43+0sxT+We0XMaGNbd835Z35KorTW4kS1VkKMAIY5EsHrbow==
    size: 333561624
  - url: 0.5.16/onmyagent-mac-x64-0.5.16.dmg
    sha512: W2AWMhNBQqo8DXE4lr/f7bPsepM4QE5z8vkDrQCUSQ5WL3vsLZq1zl4KYt2VfJXIy6++6I0EKpTuLsKqbhiZ/Q==
    size: 330863922
releaseDate: '2026-08-18T03:47:58.331Z'
`;

const SAMPLE_WIN = `version: 0.5.16
files:
  - url: 0.5.16/onmyagent-win-x64-0.5.16.exe
    sha512: 8LEkPvll5JAPM8xnM8f/w9c2mUX1RLw3eBzoDk9LXH2iJYhHmBGLfCsM/JjGbUAB5eydIE5c1wbflFZwebOoHg==
    size: 288297107
releaseDate: '2026-08-18T03:48:19.094Z'
`;

test("normalizeFeedUrl strips trailing slashes", () => {
  assert.equal(
    normalizeFeedUrl("https://example.com/onmyagent/"),
    "https://example.com/onmyagent",
  );
  assert.equal(normalizeFeedUrl("  "), "");
});

test("resolveUpdateFeedUrl prefers env override", () => {
  assert.equal(resolveUpdateFeedUrl({}), DEFAULT_UPDATE_FEED_URL);
  assert.equal(
    resolveUpdateFeedUrl({ ONMYAGENT_UPDATE_FEED_URL: "https://cdn.example/app/" }),
    "https://cdn.example/app",
  );
});

test("resolveUpdaterManifestUrl uses platform yml and API override", () => {
  assert.equal(updaterManifestName("darwin"), "latest-mac.yml");
  assert.equal(updaterManifestName("win32"), "latest.yml");
  assert.equal(updaterManifestName("linux"), "latest-linux.yml");
  assert.equal(
    resolveUpdaterManifestUrl("darwin", {}),
    `${DEFAULT_UPDATE_FEED_URL}/latest-mac.yml`,
  );
  assert.equal(
    resolveUpdaterManifestUrl("darwin", {
      ONMYAGENT_UPDATE_API: "https://cdn.example/latest-mac.yml",
    }),
    "https://cdn.example/latest-mac.yml",
  );
});

test("parseUpdaterManifest reads OSS latest-mac.yml", () => {
  const parsed = parseUpdaterManifest(SAMPLE_MAC);
  assert.equal(parsed.version, "0.5.16");
  assert.equal(parsed.releaseDate, "2026-08-18T03:47:58.331Z");
  assert.equal(parsed.files.length, 4);
  assert.equal(parsed.files[0].url, "0.5.16/onmyagent-mac-arm64-0.5.16.zip");
  assert.equal(parsed.files[0].size, "323562636");
});

test("pickFallbackArtifactUrl prefers platform zip/exe", () => {
  const mac = parseUpdaterManifest(SAMPLE_MAC);
  assert.equal(
    pickFallbackArtifactUrl(mac, "darwin", "arm64"),
    "0.5.16/onmyagent-mac-arm64-0.5.16.zip",
  );
  assert.equal(
    pickFallbackArtifactUrl(mac, "darwin", "x64"),
    "0.5.16/onmyagent-mac-x64-0.5.16.zip",
  );
  const win = parseUpdaterManifest(SAMPLE_WIN);
  assert.equal(
    pickFallbackArtifactUrl(win, "win32", "x64"),
    "0.5.16/onmyagent-win-x64-0.5.16.exe",
  );
});

test("resolveFeedArtifactUrl joins relative OSS paths", () => {
  assert.equal(
    resolveFeedArtifactUrl(
      DEFAULT_UPDATE_FEED_URL,
      "0.5.16/onmyagent-mac-arm64-0.5.16.zip",
    ),
    `${DEFAULT_UPDATE_FEED_URL}/0.5.16/onmyagent-mac-arm64-0.5.16.zip`,
  );
  assert.equal(
    resolveFeedArtifactUrl(DEFAULT_UPDATE_FEED_URL, "https://cdn.example/a.zip"),
    "https://cdn.example/a.zip",
  );
});
