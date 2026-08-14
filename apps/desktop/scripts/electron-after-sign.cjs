const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const computerUseHelperAppName = "OnMyAgent Computer Use.app";
// Large Electron + sidecar bundles often sit In Progress > 60 min on x64.
// Budget covers Apple queue + transient runner network blips.
const NOTARY_WAIT_BUDGET_MS = Number(process.env.NOTARY_WAIT_BUDGET_MS || 9_000_000); // 150 min
const NOTARY_WAIT_SLICE_SEC = Number(process.env.NOTARY_WAIT_SLICE_SEC || 1200); // 20 min per wait
const NOTARY_NETWORK_BACKOFF_SEC = 30;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function sleepSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  spawnSync("sleep", [String(Math.ceil(seconds))], { stdio: "ignore" });
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
    // Submit first (returns immediately with the submission id), then wait
    // separately so notarytool streams its "In Progress" progress instead of
    // staying silent for a large (1GB) archive.
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
        "--output-format",
        "json",
      ],
      // 1GB zip upload to Apple can exceed 5 min on congested runners.
      { encoding: "utf8", timeout: 1_200_000 },
    );

    if (submit.error) {
      if (submit.error.code === "ETIMEDOUT") {
        throw new Error("notarytool submit timed out (1200s) while uploading the notarization zip");
      }
      throw submit.error;
    }
    if (submit.status !== 0) {
      throw new Error(
        `notarytool submit failed with status ${submit.status}: ${(submit.stderr || submit.stdout || "").trim()}`,
      );
    }
    let submissionId = null;
    try {
      const parsed = JSON.parse(submit.stdout || "{}");
      submissionId = parsed.id || parsed.submissionId || null;
    } catch {
      const m = (submit.stdout || "").match(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
      );
      if (m) submissionId = m[0];
    }
    if (!submissionId) {
      throw new Error("notarytool submit did not return a submission id");
    }

    const waitBudgetMin = Math.round(NOTARY_WAIT_BUDGET_MS / 60000);
    console.log(
      `[electron-after-sign] submission ${submissionId}; waiting for Apple notarization (budget ${waitBudgetMin} min, large app often 30-90 min)...`,
    );

    const baseArgs = ["--key", keyPath, "--key-id", keyId, "--issuer", issuer];
    const deadline = Date.now() + NOTARY_WAIT_BUDGET_MS;
    let attempt = 0;
    let accepted = false;
    let networkStreak = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      const remainingMin = Math.max(0, Math.ceil((deadline - Date.now()) / 60000));
      console.log(
        `[electron-after-sign] notarytool wait (attempt ${attempt}, ~${remainingMin} min budget left)...`,
      );
      // Cap each wait slice so we can re-check status and recover from flaky network.
      const wait = spawnSync(
        "xcrun",
        [
          "notarytool",
          "wait",
          submissionId,
          ...baseArgs,
          "--timeout",
          `${NOTARY_WAIT_SLICE_SEC}s`,
        ],
        {
          stdio: "inherit",
          // Node kill slightly after notarytool's own timeout.
          timeout: (NOTARY_WAIT_SLICE_SEC + 60) * 1000,
        },
      );

      if (wait.status === 0) {
        accepted = true;
        break;
      }

      // Non-zero exit can be a transient network error or a definitive
      // Invalid/Rejected. Ask notarytool for the current status to decide.
      let status = null;
      const info = spawnSync(
        "xcrun",
        ["notarytool", "info", submissionId, ...baseArgs, "--output-format", "json"],
        { encoding: "utf8", timeout: 120000 },
      );
      try {
        status = JSON.parse(info.stdout || "{}").status || null;
      } catch {
        status = null;
      }

      if (status === "Accepted") {
        accepted = true;
        break;
      }
      if (status === "Invalid" || status === "Rejected") {
        console.error(`[electron-after-sign] Apple notarization ${status}; dumping log for ${submissionId}:`);
        spawnSync("xcrun", ["notarytool", "log", submissionId, ...baseArgs], { stdio: "inherit" });
        throw new Error(`Apple notarization was ${status} (submission ${submissionId})`);
      }

      const networkLike =
        status == null
        || (wait.error && (wait.error.code === "ETIMEDOUT" || wait.error.code === "ECONNRESET"));
      if (networkLike) {
        networkStreak += 1;
        const backoff = Math.min(NOTARY_NETWORK_BACKOFF_SEC * networkStreak, 120);
        console.warn(
          `[electron-after-sign] wait attempt ${attempt} failed (status=${status || "unknown"}, likely network); sleeping ${backoff}s before retry...`,
        );
        sleepSeconds(backoff);
      } else {
        networkStreak = 0;
        console.warn(
          `[electron-after-sign] wait attempt ${attempt} failed (status=${status || "unknown"}); retrying...`,
        );
      }
    }

    if (!accepted) {
      console.error(
        `[electron-after-sign] notarization did not complete within ${waitBudgetMin} min; dumping log for ${submissionId}:`,
      );
      spawnSync("xcrun", ["notarytool", "log", submissionId, ...baseArgs], { stdio: "inherit" });
      throw new Error(
        `notarization did not complete within ${waitBudgetMin} min (submission ${submissionId})`,
      );
    }

    run("xcrun", ["stapler", "staple", appPath]);
    run("xcrun", ["stapler", "validate", appPath]);
  } finally {
    rmSync(notaryTempDir, { recursive: true, force: true });
  }
}

module.exports = afterSign;
module.exports.default = afterSign;
