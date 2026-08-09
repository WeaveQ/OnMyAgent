import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const pageViewPath = new URL(
  "../src/react-app/shell/session-route/page-view.tsx",
  import.meta.url,
);
const surfacePropsPath = new URL(
  "../src/react-app/shell/session-route/surface-props-hook-impl.ts",
  import.meta.url,
);
const composerPath = new URL(
  "../src/react-app/domains/session/surface/composer/composer.tsx",
  import.meta.url,
);
const surfacePath = new URL(
  "../src/react-app/domains/session/surface/session-surface.tsx",
  import.meta.url,
);

describe("expert preparing jank guards", () => {
  test("empty expert session create does not startRun (avoids stuck 准备中 shell)", async () => {
    const source = await readFile(pageViewPath, "utf8");
    expect(source).toContain(
      "Do NOT startRun here: this path only opens an empty expert",
    );
    expect(source).toContain(
      "session shell. Marking runActive without a prompt leaves the",
    );
    const marker = "onCreateFreshSessionForAgent={async (workspaceId) => {";
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    // Bound the create-fresh handler body until the next sibling prop.
    const slice = source.slice(start, start + 8_000);
    const end =
      slice.indexOf("\n          settingsSlot=") > 0
        ? slice.indexOf("\n          settingsSlot=")
        : slice.indexOf("\n          onCreateSessionForAgent=");
    const body = end > 0 ? slice.slice(0, end) : slice;
    expect(body).not.toMatch(
      /startRun\s*\(\s*workspaceId\s*,\s*newSession\.id\s*\)/,
    );
  });

  test("new-session send seeds optimistic user message before route activation", async () => {
    const source = await readFile(surfacePropsPath, "utf8");
    const seedIdx = source.indexOf(
      "Seed the user turn into the new session transcript",
    );
    const activateIdx = source.indexOf("activateCreatedSessionRoute({");
    expect(seedIdx).toBeGreaterThan(0);
    expect(activateIdx).toBeGreaterThan(seedIdx);
    expect(source).toContain("seedOptimisticSessionUserMessage({");
  });

  test("composer shows stop whenever busy, even if draft text remains", async () => {
    const source = await readFile(composerPath, "utf8");
    expect(source).toContain("{props.busy ? (");
    expect(source).not.toContain("props.busy && !canSend");
    expect(source).toContain('title={t("composer.stop")}');
  });

  test("session surface merges a local pending outgoing user message into the transcript", async () => {
    const source = await readFile(surfacePath, "utf8");
    expect(source).toContain("pendingOutgoingUserMessage");
    expect(source).toContain("addOptimisticSessionUserMessage(filtered, {");
    expect(source).toContain("messageId: pendingOutgoingUserMessage.id");
  });

  test("marketplace install kickoffs early and joins env prep instead of serial pre-prompt wait", async () => {
    const source = await readFile(surfacePropsPath, "utf8");
    const kickoffIdx = source.indexOf("kickoffMarketplaceExpertInstall(");
    const isolateIdx = source.indexOf(
      "createIsolatedExpertSessionRuntimeDirectory({",
    );
    const joinIdx = source.indexOf("Join marketplace install with env context prep");
    expect(kickoffIdx).toBeGreaterThan(0);
    expect(isolateIdx).toBeGreaterThan(kickoffIdx);
    expect(joinIdx).toBeGreaterThan(isolateIdx);
    expect(source).toContain("installBeforePrompt");
    expect(source).toContain("Promise.all([");
  });

  test("empty expert shell create does not await marketplace install", async () => {
    const source = await readFile(pageViewPath, "utf8");
    expect(source).toContain(
      "void installMarketplaceExpertAfterSessionCreated(agentToBind)",
    );
    expect(source).not.toContain(
      "await installMarketplaceExpertAfterSessionCreated(agentToBind)",
    );
  });
});
