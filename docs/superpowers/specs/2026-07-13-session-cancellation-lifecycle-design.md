# Session cancellation lifecycle

## Goal

Make manual session cancellation immediate and idempotent: the activity indicator disappears as soon as Stop is clicked, each run produces one terminal notice, and elapsed time appears only for Pursue goal runs.

## Confirmed behavior

- In Craft, Ask, and Plan collaboration modes, Stop immediately renders exactly one localized `User cancelled` transcript divider.
- In Pursue goal mode, Stop pauses the goal and renders exactly one localized `You stopped after {duration}` divider using the current run's real start time.
- A late backend cancellation error confirms the local stop but never adds another divider.
- Leaving the cancelled session open, receiving late messages, refreshing snapshots, or remounting the Composer does not increase the number of cancellation dividers.
- The inline `Thinking` activity indicator disappears synchronously when Stop is clicked and cannot be restored by a stale streaming snapshot.

## Root cause

The current stop path records every manual stop as `stopped`, including non-goal modes. When the active run start time is unavailable, it falls back to the current time, which produces `0s`.

The session activity store marks the run locally stopped, but `shouldShowSessionActivity` still treats the stale backend `chatStreaming` flag as sufficient to display activity. The stale flag therefore keeps `Thinking` visible until the abort and snapshot refresh settle.

Finally, the cancellation-error effect depends on `recordSessionInterruption`, whose identity changes with message count and active-run state. The same retained cancellation error can execute the effect repeatedly. Because fallback timestamps create different notice identities, the existing dedupe accepts each execution and persists the growing list to local storage.

## Run identity

Each locally started session run receives a stable `runKey` derived from the session id and the run's captured start timestamp. The key is created once at the same point as `activeRunStartedAt` and remains available through terminal backend confirmation.

Transcript terminal notices gain a `runKey`. For a given run key:

- `cancelled` and `stopped` are mutually exclusive terminal representations.
- Repeating the same event is a no-op.
- A late backend cancellation cannot replace a locally recorded terminal notice.
- Notice identity no longer depends on the current message count or a newly generated fallback timestamp.

Message count remains presentation metadata for divider placement, not event identity.

## Stop flow

The stop handler performs local state changes before awaiting network work:

1. Capture the active run key and start time.
2. Determine the collaboration kind.
3. For Pursue goal, record one `stopped` notice with elapsed milliseconds and optimistically pause the goal runtime.
4. For every other collaboration kind, record one `cancelled` notice without elapsed milliseconds.
5. Mark the activity store run stopped and clear local waiting/responding baselines.
6. Abort the backend session and refresh its snapshot.

The backend cancellation-error path uses the same run key. It only records a cancellation when no local terminal notice exists, which preserves genuine remote cancellations while suppressing manual-stop duplicates.

## Activity visibility

The activity store's existing `stopRequested` state becomes part of the visibility decision. A locally stopped run is not visible even while `chatStreaming` remains temporarily true. Starting a new run clears `stopRequested`, so a later legitimate run can display `Thinking` normally.

This state is scoped by workspace and session. Stopping one session cannot hide activity in another session.

## Persisted notice migration

Persisted transcript notices move from storage version v1 to v2.

- V2 notices support `runKey`.
- On first v1 read, retain all non-terminal notices (`compacting`, `compacted`, `stalled`, and permission notices).
- For legacy `cancelled` / `stopped` entries, retain only the latest terminal entry per session and normalize it to a single legacy run key.
- Persist the normalized v2 result so the cleanup runs once.

This deliberately removes corrupted duplicate terminal history while preserving unrelated transcript notices. All new terminal history is retained once per real run.

## Component boundaries

- `session-transcript-notices.ts` owns v1 parsing, v2 parsing, migration, and persistence normalization.
- `goal-runtime.tsx` owns pure terminal-notice idempotency rules and terminal labels.
- `session-activity-store.ts` owns local stop-request state and exposes the read needed by the session surface.
- `session-surface.tsx` coordinates run start, immediate stop, backend abort, and late cancellation confirmation.
- `session-run-controller.ts` owns the pure activity-visibility decision.

No server API, schema, Electron IPC, or production configuration changes are required.

## Error handling

- If backend abort fails, local cancellation UI remains settled; the existing error path may report a non-cancellation failure without restoring the stopped run.
- A backend-originated cancellation without a preceding local stop still produces one `User cancelled` divider.
- Missing legacy timestamps never produce an elapsed-time label.
- Local-storage parse or write failure keeps the timeline usable and does not affect runtime cancellation.

## Testing

Use test-driven development with focused pure and store tests:

1. A failing controller test proves stale `chatStreaming` cannot display activity after local stop.
2. A failing activity-store test proves `stopRequested` is set immediately, survives stale running snapshots, and clears on the next run.
3. Failing notice tests prove one terminal notice per `runKey`, mutual exclusion of `cancelled` and `stopped`, and acceptance of a genuine new run.
4. Failing persistence tests prove v1 duplicate terminal entries migrate to one latest entry while non-terminal entries remain.
5. Failing behavior tests prove non-goal stops have no elapsed duration and Pursue goal stops use the captured run start.
6. Run the focused session tests, App typecheck, forbidden-type gate, i18n CJK gate, boundary check, `git diff --check`, and the relevant UI smoke test.

## Commit and push boundaries

This fix is independent of Composer collaboration-mode/search work. Implement and verify it in its own commit, then push that commit to the current remote feature branch before starting the next fix. Do not stage or commit unrelated existing workspace changes.

## Acceptance criteria

- Clicking Stop removes `Thinking` immediately.
- Non-goal modes display one `User cancelled` divider and no duration divider.
- Pursue goal displays one accurate duration divider and no duplicate cancellation divider.
- Late events, snapshot refreshes, and idle time do not add dividers.
- Existing corrupted duplicate cancellation rows are reduced to one after v2 migration.
- A new run after cancellation displays activity and can later create its own single terminal divider.
