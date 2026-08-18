import test from "node:test";
import assert from "node:assert/strict";
import { detectRecommendedPackage } from "./detect-download-target.mjs";

test("detectRecommendedPackage picks Windows from UA", () => {
  assert.equal(
    detectRecommendedPackage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }),
    "win-x64",
  );
});

test("detectRecommendedPackage uses UA-CH architecture on Mac", () => {
  assert.equal(
    detectRecommendedPackage({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      uaDataPlatform: "macOS",
      architecture: "arm",
    }),
    "mac-arm64",
  );
  assert.equal(
    detectRecommendedPackage({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      architecture: "x86",
    }),
    "mac-x64",
  );
});

test("detectRecommendedPackage uses WebGL renderer when architecture is missing", () => {
  assert.equal(
    detectRecommendedPackage({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      webglRenderer: "Apple M4",
    }),
    "mac-arm64",
  );
  assert.equal(
    detectRecommendedPackage({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      webglRenderer: "Intel Iris Plus Graphics",
    }),
    "mac-x64",
  );
});

test("detectRecommendedPackage defaults modern Mac to Apple Silicon", () => {
  assert.equal(
    detectRecommendedPackage({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
    }),
    "mac-arm64",
  );
});

test("detectRecommendedPackage returns null on Linux", () => {
  assert.equal(
    detectRecommendedPackage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }),
    null,
  );
});
