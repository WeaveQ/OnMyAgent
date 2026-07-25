import { afterEach, describe, expect, test } from "bun:test";

import {
  invalidateOpenCodeManagedProvidersCache,
  peekOpenCodeManagedProvidersCache,
  resetOpenCodeInventoryInflightForTests,
  seedOpenCodeManagedProvidersCache,
} from "../src/react-app/domains/settings/state/ai-providers-controller";
import type { AgentManagementManagedProvider } from "../src/app/lib/desktop";

const sample: AgentManagementManagedProvider[] = [
  {
    id: "openai",
    appType: "opencode",
    name: "OpenAI",
    settingsConfig: {},
    isCurrent: false,
    inFailoverQueue: false,
    liveManaged: true,
    livePresent: true,
    configPath: "/tmp/opencode.json",
    models: [],
  },
];

describe("OpenCode inventory prewarm cache", () => {
  afterEach(() => {
    resetOpenCodeInventoryInflightForTests();
  });

  test("seed + peek return providers within TTL", () => {
    seedOpenCodeManagedProvidersCache("/ws/a", sample);
    expect(peekOpenCodeManagedProvidersCache("/ws/a")).toEqual(sample);
    expect(peekOpenCodeManagedProvidersCache(" /ws/a ")).toEqual(sample);
  });

  test("invalidate clears a single workspace", () => {
    seedOpenCodeManagedProvidersCache("/ws/a", sample);
    seedOpenCodeManagedProvidersCache("/ws/b", sample);
    invalidateOpenCodeManagedProvidersCache("/ws/a");
    expect(peekOpenCodeManagedProvidersCache("/ws/a")).toBeNull();
    expect(peekOpenCodeManagedProvidersCache("/ws/b")).toEqual(sample);
  });

  test("empty root is ignored", () => {
    seedOpenCodeManagedProvidersCache("   ", sample);
    expect(peekOpenCodeManagedProvidersCache("")).toBeNull();
  });
});
