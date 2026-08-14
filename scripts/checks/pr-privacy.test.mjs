import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkPrivacyText,
  findPrivacyHits,
  scanPublicTree,
} from "./pr-privacy.mjs";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FICTIONAL_CN = ["Jane", "Q", "Public"].join(" ");
const FICTIONAL_TEAM = ["ABCD", "123456"].join("");
const FICTIONAL_IDENTITY = `Developer ID Application: ${FICTIONAL_CN} (${FICTIONAL_TEAM})`;
const FICTIONAL_CSC = `CSC_NAME=${FICTIONAL_CN} (${FICTIONAL_TEAM})`;
const FICTIONAL_SHA = `SHA-1: ${"AB".repeat(20)}`;

test("current release.md does not trip shape rules", () => {
  const release = readFileSync(join(repoRoot, "docs/release.md"), "utf8");
  assert.equal(findPrivacyHits(release).length, 0);
});

test("public tree scan is clean", () => {
  const result = scanPublicTree(repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});

test("Developer ID identity with a fictional holder fails", () => {
  const hits = findPrivacyHits(FICTIONAL_IDENTITY);
  assert.equal(hits.some((hit) => hit.rule === "developer-id-identity"), true);
});

test("CSC_NAME assigned a fictional common name fails", () => {
  const hits = findPrivacyHits(FICTIONAL_CSC);
  assert.equal(hits.some((hit) => hit.rule === "csc-name-literal"), true);
});

test("CSC_NAME ad-hoc dash and secret refs pass", () => {
  assert.equal(findPrivacyHits('CSC_NAME: "-"').length, 0);
  assert.equal(findPrivacyHits("CSC_NAME=${{ secrets.CSC_NAME }}").length, 0);
  assert.equal(findPrivacyHits("CI sets CSC_NAME from the repository secret").length, 0);
});

test("labeled fingerprint in docs fails", () => {
  const hits = findPrivacyHits(FICTIONAL_SHA);
  assert.equal(hits.some((hit) => hit.rule === "labeled-fingerprint"), true);
});

test("private key block fails", () => {
  const pem = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(80)}\n-----END PRIVATE KEY-----`;
  const hits = findPrivacyHits(pem);
  assert.equal(hits.some((hit) => hit.rule === "private-key"), true);
});

test("plaintext password assignment fails; secret-name-only passes", () => {
  assert.equal(
    findPrivacyHits('APPLE_CODESIGN_CERT_PASSWORD').length,
    0,
  );
  assert.equal(findPrivacyHits('password="..."').length, 0);
  const hits = findPrivacyHits('password="not-a-real-password"');
  assert.equal(hits.some((hit) => hit.rule === "password-literal"), true);
});

test("PR body including a fenced fictional identity still fails", () => {
  const result = checkPrivacyText({
    title: "docs(release): signing notes",
    body: `Notes:\n\`\`\`\n${FICTIONAL_IDENTITY}\n\`\`\`\n`,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((item) => item.field === "body"), true);
});

test("optional extra tokens stay out of the repo and come from env", () => {
  const result = checkPrivacyText({
    title: "fix: signing",
    body: "Do not paste holder names here.",
    extraTokens: "notarealtokenvalue",
  });
  assert.equal(result.ok, true);
  const blocked = checkPrivacyText({
    title: "fix: signing",
    body: "Contact notarealtokenvalue for the cert.",
    extraTokens: "notarealtokenvalue",
  });
  assert.equal(blocked.ok, false);
});
