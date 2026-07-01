import { describe, expect, test } from "bun:test";

import {
  getExtensionId,
  isOnMyAgentExtensionEnabled,
  isOnMyAgentExtensionHidden,
  ONMYAGENT_EXTENSION_STATE_CHANGED,
} from "../src/react-app/domains/shared/extension-state";

const defaultEnabledExtension = {
  id: "ext-default-on",
  name: "Default On",
  description: "Enabled by default",
  command: "node",
  args: ["server.js"],
  defaultEnabled: true,
};

const defaultDisabledExtension = {
  id: "ext-default-off",
  name: "Default Off",
  description: "Disabled by default",
  command: "node",
  args: ["server.js"],
  defaultEnabled: false,
};

const hiddenExtension = {
  id: "ext-hidden",
  name: "Hidden",
  description: "Hidden by default",
  command: "node",
  args: ["server.js"],
  defaultHidden: true,
};

describe("shared extension state contract", () => {
  test("resolves stable extension ids from catalog entries", () => {
    expect(getExtensionId(defaultEnabledExtension)).toBe("ext-default-on");
    expect(getExtensionId({ ...defaultEnabledExtension, id: undefined, serverName: "server-alpha" })).toBe("server-alpha");
  });

  test("keeps SSR defaults independent from browser storage", () => {
    expect(isOnMyAgentExtensionEnabled(defaultEnabledExtension)).toBe(true);
    expect(isOnMyAgentExtensionEnabled(defaultDisabledExtension)).toBe(false);
    expect(isOnMyAgentExtensionHidden(hiddenExtension)).toBe(false);
  });

  test("uses a shared event name for settings and session listeners", () => {
    expect(ONMYAGENT_EXTENSION_STATE_CHANGED).toBe("onmyagent:extension-state-changed");
  });
});
