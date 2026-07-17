import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");

export const COMPUTER_USE_PROTOCOL_VERSION = 1;

export function desktopPackageVersion() {
  const packageJson = JSON.parse(
    readFileSync(resolve(desktopRoot, "package.json"), "utf8"),
  );
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("Desktop package.json must declare a version.");
  }
  return packageJson.version;
}

export function computerUseHelperInfoPlist() {
  const version = desktopPackageVersion();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>OnMyAgent Computer Use</string>
  <key>CFBundleExecutable</key>
  <string>ComputerUse</string>
  <key>CFBundleIdentifier</key>
  <string>com.differentai.onmyagent.computer-use</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>OnMyAgent Computer Use</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>OnMyAgentComputerUseProtocolVersion</key>
  <integer>${COMPUTER_USE_PROTOCOL_VERSION}</integer>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
</dict>
</plist>
`;
}
