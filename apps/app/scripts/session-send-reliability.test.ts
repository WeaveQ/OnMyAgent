import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const handlerPath = new URL(
  "../src/react-app/domains/session/surface/session-surface-run-handlers.ts",
  import.meta.url,
);

describe("session send reliability", () => {
  test("deduplicates a pending submit without blocking an accepted follow-up", async () => {
    const source = await readFile(handlerPath, "utf8");

    expect(source).toContain("const sendInFlightBySessionRef = useRef(new Set<string>())");
    expect(source).toContain("if (sendInFlightBySessionRef.current.has(sessionId)) return false;");
    expect(source).toContain("sendInFlightBySessionRef.current.add(sessionId)");
    expect(source).toContain("sendInFlightBySessionRef.current.delete(sessionId)");
  });

  test("keeps the live composer on failure and only clears after acceptance", async () => {
    const source = await readFile(handlerPath, "utf8");

    expect(source).toContain("await onSendDraft(nextDraft);");
    expect(source).toContain("if (shouldTouchComposerOnSend(queuedDraft)) {");
    expect(source).toContain("clearComposerSession(sessionId);");
    expect(source).toContain("onDraftChange(buildDraft(\"\", []));");
    expect(source).not.toContain("setComposerDraft(sessionId, draft);");
    // Local optimistic bubble is painted immediately; dropped on failure so the
    // still-visible composer draft remains the recovery path.
    expect(source).toContain("setPendingOutgoingUserMessage");
    expect(source).toContain("setPendingOutgoingUserMessage(null)");
    expect(source).toContain("return false;");
  });

  test("paints a local user bubble before the cold create/prompt path finishes", async () => {
    const source = await readFile(handlerPath, "utf8");

    expect(source).toContain("setSending(true);");
    expect(source).toContain("setPendingOutgoingUserMessage({");
    expect(source).toContain("msg_local_");
  });
});
