import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPUTER_USE_PROTOCOL_VERSION,
  computerUseHelperInfoPlist,
  desktopPackageVersion,
} from "./computer-use-helper-manifest.mjs";

test("Computer Use helper plist shares the desktop version and protocol", () => {
  const version = desktopPackageVersion();
  const plist = computerUseHelperInfoPlist();
  assert.match(plist, new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${version}</string>`));
  assert.match(plist, new RegExp(`<key>OnMyAgentComputerUseProtocolVersion</key>\\s*<integer>${COMPUTER_USE_PROTOCOL_VERSION}</integer>`));
});
