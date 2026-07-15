# Session Cancellation Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session Stop immediate and idempotent, with one terminal notice per run and duration shown only for Pursue goal.

**Architecture:** Persist a stable run key on terminal notices, migrate corrupt v1 notice history to v2, and make the activity store's local stop request authoritative over stale streaming state. `SessionSurface` coordinates the synchronous local transition before awaiting backend abort.

**Tech Stack:** TypeScript, React, Zustand, Bun test, localStorage, pnpm.

## Global Constraints

- Do not change server APIs, schemas, Electron IPC, or production configuration.
- Do not add `any`, `as any`, or `as unknown as`.
- Preserve all non-terminal persisted transcript notices during migration.
- Keep user-visible copy routed through existing i18n keys.
- Stage only files named by each task; preserve unrelated dirty workspace files.
- Commit this fix independently and push immediately after verification.

---

### Task 1: Version and normalize persisted notices

**Files:**
- Modify: `apps/app/src/app/lib/session-transcript-notices.ts`
- Create: `apps/app/scripts/session-transcript-notices.test.ts`

**Interfaces:**
- Produces: `PersistedSessionTranscriptNotice.runKey?: string`
- Produces: `normalizeSessionTranscriptNotices(value: unknown): Record<string, PersistedSessionTranscriptNotice[]>`
- Produces: v2 read/write behavior under `onmyagent.session-transcript-notices.v2`

- [ ] **Step 1: Write failing migration tests**

```ts
test("migrates repeated legacy terminal notices to the latest one", () => {
  const normalized = normalizeSessionTranscriptNotices({
    ses_1: [
      { id: "a", kind: "cancelled", afterMessageCount: 4, runStartedAt: 100 },
      { id: "b", kind: "cancelled", afterMessageCount: 5, runStartedAt: 200 },
      { id: "c", kind: "stalled", afterMessageCount: 3 },
    ],
  });
  expect(normalized.ses_1?.map((notice) => notice.id)).toEqual(["c", "b"]);
  expect(normalized.ses_1?.[1]?.runKey).toBe("legacy:ses_1");
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm --dir apps/app exec bun test scripts/session-transcript-notices.test.ts`

Expected: FAIL because `normalizeSessionTranscriptNotices` and v2 behavior do not exist.

- [ ] **Step 3: Implement v2 parsing and migration**

```ts
const SESSION_TRANSCRIPT_NOTICES_KEY = "onmyagent.session-transcript-notices.v2";
const LEGACY_SESSION_TRANSCRIPT_NOTICES_KEY = "onmyagent.session-transcript-notices.v1";

export type PersistedSessionTranscriptNotice = {
  id: string;
  kind: SessionTranscriptNoticeKind;
  afterMessageCount: number;
  runKey?: string;
  runStartedAt?: number;
  elapsedMs?: number;
};
```

Parse `runKey` only when it is a non-empty string. Normalize each session by retaining every non-terminal notice and only the latest legacy terminal notice, assigning `legacy:${sessionId}`. When v2 is absent, read v1, normalize, persist v2, and remove the v1 key only after the v2 write succeeds.

- [ ] **Step 4: Run migration tests and confirm GREEN**

Run: `pnpm --dir apps/app exec bun test scripts/session-transcript-notices.test.ts`

Expected: PASS.

### Task 2: Make terminal notice insertion idempotent by run key

**Files:**
- Modify: `apps/app/src/react-app/domains/session/surface/plan-goal/goal-runtime.tsx`
- Modify: `apps/app/scripts/session-run-controller.test.ts`

**Interfaces:**
- Produces: `shouldRecordSessionInterruption({ existing, candidate })` keyed by `runKey`
- Produces: `sessionInterruptionNotice(...)` for goal and non-goal stop semantics

- [ ] **Step 1: Add failing run-key tests**

```ts
test("records one mutually exclusive terminal notice per run key", () => {
  const existing = [{ id: "cancel", kind: "cancelled", runKey: "ses_1:100", afterMessageCount: 4 }];
  expect(shouldRecordSessionInterruption({
    existing,
    candidate: { id: "stop", kind: "stopped", runKey: "ses_1:100", afterMessageCount: 5, elapsedMs: 5000 },
  })).toBe(false);
  expect(shouldRecordSessionInterruption({
    existing,
    candidate: { id: "next", kind: "cancelled", runKey: "ses_1:200", afterMessageCount: 6 },
  })).toBe(true);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/app exec bun test scripts/session-run-controller.test.ts`

Expected: FAIL because dedupe still relies on `runStartedAt`.

- [ ] **Step 3: Implement run-key terminal rules**

For terminal candidates with `runKey`, reject any existing `cancelled` or `stopped` notice with the same key. Retain existing semantics for non-terminal notices. Delete `shouldSuppressCancelledAfterStop`; the single run-key rule replaces it.

- [ ] **Step 4: Run and confirm GREEN**

Run: `pnpm --dir apps/app exec bun test scripts/session-run-controller.test.ts`

Expected: PASS.

### Task 3: Make local stop authoritative for activity visibility

**Files:**
- Modify: `apps/app/src/react-app/domains/session/status/session-activity-store.ts`
- Modify: `apps/app/src/react-app/domains/session/surface/session-run-controller.ts`
- Modify: `apps/app/scripts/session-activity-store.test.ts`
- Modify: `apps/app/scripts/session-run-controller.test.ts`

**Interfaces:**
- Produces: `getStopRequested(workspaceId: string, sessionId: string): boolean`
- Extends: `shouldShowSessionActivity({ chatStreaming, activityStatus, goalRuntime, stopRequested })`

- [ ] **Step 1: Add failing local-stop visibility tests**

```ts
expect(shouldShowSessionActivity({
  chatStreaming: true,
  activityStatus: "idle",
  goalRuntime: null,
  stopRequested: true,
})).toBe(false);
```

Add a store assertion that `markRunStopped` sets `getStopRequested(...)` true, stale busy seeding keeps it true, and `startRun` resets it false.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/app exec bun test scripts/session-activity-store.test.ts scripts/session-run-controller.test.ts`

Expected: FAIL because the getter and visibility argument do not exist.

- [ ] **Step 3: Implement getter and visibility precedence**

```ts
if (input.stopRequested) return false;
if (input.goalRuntime?.status === "paused") return false;
return input.chatStreaming || input.activityStatus !== "idle";
```

Expose `getStopRequested` from the store without exposing the record type.

- [ ] **Step 4: Run and confirm GREEN**

Run: `pnpm --dir apps/app exec bun test scripts/session-activity-store.test.ts scripts/session-run-controller.test.ts`

Expected: PASS.

### Task 4: Coordinate stable run identity and immediate stop in SessionSurface

**Files:**
- Modify: `apps/app/src/react-app/domains/session/surface/session-surface.tsx`
- Modify: `apps/app/scripts/session-run-controller.test.ts`

**Interfaces:**
- Consumes: v2 `runKey`, run-key dedupe, `getStopRequested`, updated visibility helper
- Produces: one local terminal notice before `abortSessionSafe`

- [ ] **Step 1: Add failing pure behavior assertions**

Add helper coverage proving non-goal stop creates `{ kind: "cancelled", elapsedMs: undefined }`, goal stop creates `{ kind: "stopped", elapsedMs: now - startedAt }`, and both use the captured `runKey`.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/app exec bun test scripts/session-run-controller.test.ts`

Expected: FAIL because the helper is absent.

- [ ] **Step 3: Implement the synchronous stop transition**

Keep `activeRunStartedAtRef` and `activeRunKeyRef` synchronized at every run start. In `handleAbort`, determine `resolveSessionCollaborationKind(...)`: call the goal pause path for `goal`; otherwise record `cancelled`. Call `markRunStopped` and clear local baselines before awaiting `abortSessionSafe`. Pass `getStopRequested(...)` into activity visibility. The late cancellation effect reuses `activeRunKeyRef` and becomes a no-op after local insertion.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm --dir apps/app exec bun test scripts/session-transcript-notices.test.ts scripts/session-run-controller.test.ts scripts/session-activity-store.test.ts scripts/session-transcript-divider.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm task check app
pnpm check:forbidden-types
pnpm check:i18n:cjk
pnpm check:boundaries
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit and push only cancellation files**

```bash
git add apps/app/src/app/lib/session-transcript-notices.ts apps/app/scripts/session-transcript-notices.test.ts apps/app/src/react-app/domains/session/surface/plan-goal/goal-runtime.tsx apps/app/src/react-app/domains/session/status/session-activity-store.ts apps/app/src/react-app/domains/session/surface/session-run-controller.ts apps/app/src/react-app/domains/session/surface/session-surface.tsx apps/app/scripts/session-activity-store.test.ts apps/app/scripts/session-run-controller.test.ts
git commit -m "fix(session): make cancellation lifecycle idempotent"
git push -u origin codex/session-composer-fixes
```
