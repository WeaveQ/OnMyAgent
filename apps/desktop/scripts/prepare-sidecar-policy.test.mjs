import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const policyModule = await import("./prepare-sidecar-policy.mjs").catch(() => null);

test("development can reuse a valid OpenCode sidecar when its version differs from the pin", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  assert.equal(
    policyModule.shouldDownloadOpencode({
      candidateExists: true,
      candidateIsStub: false,
      existingVersion: "1.17.11",
      pinnedVersion: "1.17.20",
      preferExisting: true,
    }),
    false,
  );
});

test("release preparation still downloads when the existing OpenCode version differs from the pin", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  assert.equal(
    policyModule.shouldDownloadOpencode({
      candidateExists: true,
      candidateIsStub: false,
      existingVersion: "1.17.11",
      pinnedVersion: "1.17.20",
      preferExisting: false,
    }),
    true,
  );
});

test("Electron development leaves sidecar preparation unforced when artifacts are fresh", async () => {
  const source = await readFile(new URL("./electron-dev.mjs", import.meta.url), "utf8");
  assert.match(source, /shouldForceDevPreparation\(/);
  assert.match(source, /if \(sidecarForceRequired\) prepareSidecarArgs\.push\("--force"\)/);
  assert.match(source, /prepareSidecarArgs\.push\("--prefer-existing-opencode", "--outdir", electronSidecarDir\)/);
});
