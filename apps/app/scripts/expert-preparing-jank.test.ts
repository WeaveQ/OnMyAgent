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
    const marker = "onCreateFreshSessionForAgent={(workspaceId) => {";
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const slice = source.slice(start, start + 8_000);
    const end = slice.indexOf("\n          sidebar=");
    const body = end > 0 ? slice.slice(0, end) : slice;
    expect(body).toContain("openExpertFreshIdleDraft(");
    expect(body).toContain("scheduleIdleExpertColdPrewarm(");
    expect(body).not.toContain("await claimOrCreateExpertColdSession(");
    expect(body).not.toContain("await opencodeClient.session.create");
    expect(body).not.toMatch(/\bawait\b/);
    expect(body).not.toMatch(/\bstartRun\s*\(/);
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
    expect(source).toContain("composerShowsStopButton({ busy: props.busy, canSend })");
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
    const envKickoffIdx = source.indexOf("envSystemContextPromise = buildOnMyAgentEnvSystemContext(");
    // Send-path cold claim (prewarm effect also references createIsolated earlier).
    const isolateIdx = source.indexOf("claimOrCreateExpertColdSession(");
    const joinIdx = source.indexOf("Join early install + env prep");
    expect(kickoffIdx).toBeGreaterThan(0);
    expect(envKickoffIdx).toBeGreaterThan(kickoffIdx);
    expect(isolateIdx).toBeGreaterThan(envKickoffIdx);
    expect(joinIdx).toBeGreaterThan(isolateIdx);
    expect(source).toContain("installBeforePrompt");
    expect(source).toContain("envSystemContextPromise");
    expect(source).toContain("Promise.all([");
    // Env must not re-fetch per sessionId (that stretched 准备中).
    expect(source).not.toContain("cacheKey: sessionId");
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
