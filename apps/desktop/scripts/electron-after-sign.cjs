const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const computerUseHelperAppName = "OnMyAgent Computer Use.app";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to notarize the Electron macOS app`);
  }
  return value;
}

function computerUseHelperPath(appPath) {
  return path.join(appPath, "Contents", "Resources", "helpers", computerUseHelperAppName);
}

function verifyComputerUseHelper(appPath, requireDistributionSignature) {
  const helperPath = computerUseHelperPath(appPath);
  if (!existsSync(helperPath)) {
    throw new Error(`Computer Use helper app is missing from packaged app: ${helperPath}`);
  }

  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", helperPath]);

  if (!requireDistributionSignature) return;
  const result = spawnSync("codesign", ["--display", "--verbose=4", helperPath], { encoding: "utf8", timeout: 60000 });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error("codesign --display timed out (60s) while verifying Computer Use helper");
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`codesign --display failed for Computer Use helper with status ${result.status}`);
  }
  if (result.stderr.includes("Signature=adhoc")) {
    throw new Error("Computer Use helper app is ad-hoc signed; notarized builds require a Developer ID signature.");
  }
}

async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  if (process.env.MACOS_NOTARIZE !== "true") {
    console.warn("[electron-after-sign] MACOS_NOTARIZE is not true; skipping notarization.");
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  verifyComputerUseHelper(appPath, process.env.MACOS_NOTARIZE === "true");

  const notaryTempDir = mkdtempSync(path.join(tmpdir(), "onmyagent-electron-notary-"));
  const notaryZipPath = path.join(notaryTempDir, `${context.packager.appInfo.productFilename}-notary.zip`);
  const keyPath = requireEnv("APPLE_API_KEY_PATH");
  const keyId = requireEnv("APPLE_API_KEY");
  const issuer = requireEnv("APPLE_API_ISSUER");

  try {
    const du = spawnSync("du", ["-sh", appPath], { encoding: "utf8" });
    if (du.stdout) console.log("[electron-after-sign] app size:", du.stdout.trim());

    console.log("[electron-after-sign] creating notarization zip (ditto)...");
    const ditto = spawnSync("ditto", ["-c", "-k", "--keepParent", appPath, notaryZipPath], { stdio: "inherit", timeout: 600000 });
    if (ditto.error) {
      if (ditto.error.code === "ETIMEDOUT") {
        throw new Error("ditto timed out (600s) while creating the notarization zip");
      }
      throw ditto.error;
    }
    if (ditto.status !== 0) {
      throw new Error(`ditto failed with status ${ditto.status}`);
    }
    console.log("[electron-after-sign] notarization zip created.");

    console.log("[electron-after-sign] submitting to Apple notary service...");
    // Submit and capture structured output so a non-Accepted result
    // (status "Invalid" / "Rejected") can be explained via the Apple log.
    const submit = spawnSync(
      "xcrun",
      [
        "notarytool",
        "submit",
        notaryZipPath,
        "--key",
        keyPath,
        "--key-id",
        keyId,
        "--issuer",
        issuer,
        "--wait",
        "--output-format",
        "json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 900000 },
    );

    if (submit.error && submit.error.code === "ETIMEDOUT") {
      throw new Error("notarytool submit timed out (900s)");
    }
    if (submit.error) throw submit.error;
    if (submit.stdout) process.stdout.write(submit.stdout);

    let submissionId = null;
    let status = null;
    try {
      const parsed = JSON.parse(submit.stdout || "{}");
      submissionId = parsed.id || parsed.submissionId || null;
      status = parsed.status || null;
    } catch {
      const m = (submit.stdout || "").match(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
      );
      if (m) submissionId = m[0];
    }

    if (status && status !== "Accepted") {
      console.error(
        `[electron-after-sign] Apple notarization returned "${status}" (submission ${submissionId || "unknown"}); dumping notary log:`,
      );
      if (submissionId) {
        spawnSync(
          "xcrun",
          [
            "notarytool",
            "log",
            submissionId,
            "--key",
            keyPath,
            "--key-id",
            keyId,
            "--issuer",
            issuer,
          ],
          { stdio: "inherit" },
        );
      }
      throw new Error(`Apple notarization was not accepted (status: ${status})`);
    }

    run("xcrun", ["stapler", "staple", appPath]);
    run("xcrun", ["stapler", "validate", appPath]);
  } finally {
    rmSync(notaryTempDir, { recursive: true, force: true });
  }
}

module.exports = afterSign;
module.exports.default = afterSign;
