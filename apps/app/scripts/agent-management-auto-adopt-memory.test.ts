import { afterEach, describe, expect, it } from "bun:test";

import {
  autoAdoptFingerprint,
  hasAutoAdopted,
  markAutoAdopted,
  resetAutoAdoptedForTests,
} from "../src/react-app/domains/local-agents/agent-management/agent-management-auto-adopt-memory";

const agent = {
  id: "grok",
  provider: "xai",
  executablePath: "/usr/local/bin/grok",
};

describe("agent-management-auto-adopt-memory", () => {
  afterEach(() => {
    resetAutoAdoptedForTests();
  });

  it("builds a stable lowercase fingerprint from id/provider/path", () => {
    expect(
      autoAdoptFingerprint({
        id: "GROK",
        provider: "XAI",
        executablePath: "/usr/local/bin/grok",
      }),
    ).toBe(autoAdoptFingerprint(agent));
  });

  it("treats missing and empty fields as empty strings", () => {
    expect(autoAdoptFingerprint({})).toBe("||");
    expect(autoAdoptFingerprint({ id: null, provider: undefined })).toBe("||");
  });

  it("starts unadopted, then remembers after mark", () => {
    expect(hasAutoAdopted(agent)).toBe(false);
    markAutoAdopted(agent);
    expect(hasAutoAdopted(agent)).toBe(true);
  });

  it("does not cross-contaminate agents with different paths", () => {
    markAutoAdopted(agent);
    expect(
      hasAutoAdopted({ ...agent, executablePath: "/opt/homebrew/bin/grok" }),
    ).toBe(false);
  });

  it("is idempotent when marked twice", () => {
    markAutoAdopted(agent);
    markAutoAdopted(agent);
    expect(hasAutoAdopted(agent)).toBe(true);
  });

  it("reset wipes the memory", () => {
    markAutoAdopted(agent);
    resetAutoAdoptedForTests();
    expect(hasAutoAdopted(agent)).toBe(false);
  });
});
