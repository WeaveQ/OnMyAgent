# Personal Local Agent AionUI Stability Parity Ledger

Created: 2026-06-30 10:17 CST
Status: Plan Ready
Authority: durable Loop ledger for aligning Studio `本地 Agent` with AionUI's stable local-agent processing model.
Scope: Studio Local Agent only. Do not change Expert / Assistant OpenCode runtime, messaging-channel runtime, or global Agent Management unless a row in this ledger explicitly requires it.

## 0. Objective

Rebuild the next Local Agent work around AionUI's upstream/downstream stability model, not around another provider-specific patch. The target is a durable conversation runtime:

- agent catalog and capability metadata are authoritative and truthful;
- conversation state is first-class and survives tab switches/remounts;
- provider execution is runtime-owned, not renderer-owned;
- streaming messages, permissions, config, active runs, process state, artifacts, and errors are recoverable from runtime state;
- user-visible UI, debug details, logs, and smoke evidence cannot silently fall back to old unstable chains.

This ledger supersedes the practical execution authority of these older planning artifacts for future AionUI stability work:

- `docs/plans/personal-local-agent-aionui-acp-parity-plan.md`
- `docs/plans/personal-local-agent-aionui-full-agent-processing-parity-ledger.md`
- `docs/plans/personal-local-agent-aionui-acp-permission-stability-ledger.md`
- `docs/plans/personal-local-agent-codex-acp-stability-ledger.md`

The older files remain historical evidence. Implementation must start from `ASP-0-baseline-reconciliation` in this file and update this file after every phase.

## 1. Reference Evidence

Reference root: `/Users/huangchunan/AionUi`.

Required AionUI source anchors:

- `packages/desktop/src/common/adapter/ipcBridge.ts`: renderer-facing `conversation` and `acpConversation` API surface.
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx`: ACP chat is a normal conversation surface using `MessageList`, `ConversationProvider`, pending confirmation recovery, and `AcpSendBox`.
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts`: stream consumer for `start`, `finish`, `text`, `content`, `thinking`, `agent_status`, `acp_permission`, `available_commands`, `acp_context_usage`, `request_trace`, and `error`.
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`: sends through `acpConversation.sendMessage`, warms runtime, uses runtime gate, queues commands while busy, and handles stop.
- `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx` and `Messages/usePendingConfirmationsRecovery.ts`: permission is conversation-level and recoverable, not active-run-only.
- `packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts` and `useAcpModelInfo.ts`: model/mode/thought options come from runtime config options and stream updates.
- `packages/web-host/src/agent-process-registry.ts`: process registry is runtime-side and tracks command/pid/conversation/backend with cleanup semantics.

Studio current anchors:

- `apps/desktop/electron/personal-agent-runtime/index.mjs`
- `apps/desktop/electron/personal-agent-runtime/adapters/acp-generic.mjs`
- `apps/desktop/electron/personal-agent-runtime/acp-client.mjs`
- `apps/desktop/electron/personal-agent-runtime/contract.mjs`
- `apps/desktop/electron/personal-agent-runtime/conversation-store.mjs`
- `apps/desktop/electron/personal-agent-runtime/process-registry.mjs`
- `apps/desktop/electron/personal-agent-runtime/managed-acp-tools.mjs`
- `apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx`
- `apps/app/scripts/personal-local-agent-acp-ui-smoke.mjs`

## 2. Current Stability Diagnosis

Studio has useful ACP pieces already: managed `codex-acp` / `claude-agent-acp`, generic ACP JSON-RPC client, conversation pointer store, process registry, approval callbacks, normalized run events, and UI smoke. The remaining instability comes from the abstraction boundary:

- AionUI's unit of truth is `conversation`; Studio's Local Agent unit of truth is still `run` plus a local conversation pointer.
- AionUI streams directly into a durable message model; Studio streams into run events and then reconstructs chat state in the Local Agent page.
- AionUI confirmations are conversation-level and recoverable; Studio approvals still originate from active run state and can be lost or misclassified when the run ends or the page remounts.
- AionUI process/runtime state is backend-owned; Studio currently keeps active processes in an in-memory Electron `Map` and restores stale running logs as failure.
- AionUI config/model/mode is read from runtime config options; Studio still has provider-specific capability paths and only a partial config facade.

Therefore the next implementation must move the Local Agent module toward a conversation-runtime contract that is stable under tab switch, remount, late events, permission wait, provider disconnect, and app restart.

## 3. Non-Goals And Boundaries

- Do not change Expert / Assistant OpenCode runtime.
- Do not claim a provider is ACP-complete unless the UI/debug/log path proves the actual ACP bridge path.
- Do not store runtime/session/log state inside project repositories.
- Do not revive invented slash-command UI. Commands can be shown only when surfaced by provider/runtime evidence.
- Do not commit, pull, merge, rebase, push, deploy, or send external messages without explicit current-turn authorization.
- If live provider auth/quota/gateway is unavailable, mark that provider row blocked with exact evidence instead of claiming completion.

## 4. Acceptance Ledger

| ID | Required Item | Status | Acceptance Criteria | Required Evidence |
| --- | --- | --- | --- | --- |
| ASP-0 | Baseline reconciliation | done | Re-read AionUI anchors, Studio anchors, latest Local Agent run logs, and current dirty diff. Record what is already done versus what is only facade/partial. | Baseline report under `.loop/evidence/personal-local-agent-aionui-stability/ASP-0/`, plus `git status --short --branch`. |
| ASP-1 | Conversation runtime contract | done | Define and implement a Local Agent conversation runtime facade where `conversationId`, `turnId`, `runId`, `providerSessionId`, `resumeKey`, and `processId` are separate and queryable. | Runtime tests for create/get/status/send/cancel/recover; bridge shape snapshot. |
| ASP-2 | Durable conversation message store | done | Streaming events are persisted as conversation messages during the turn, not only reconstructed from final run output. Reload/remount can rebuild transcript and current running state. | Tests for chunk/tool/permission/error/finish replay; UI smoke proves intermediate messages appear. |
| ASP-3 | Recoverable confirmation model | done | Permissions are conversation-level confirmations with list/recover/confirm APIs. User decline, provider refusal, and missing UI are distinct outcomes. | Runtime tests for approve/decline/remount; UI smoke for approval card and input state. |
| ASP-4 | Runtime-owned active process registry | done | Active provider processes are registered durably enough for tab switch/remount and classified on app restart as running/recoverable/stale with explicit reason. | Process lifecycle tests; UI active-run badge smoke; stale-run restart classification evidence. |
| ASP-5 | Config/model/mode source of truth | done | Model/mode/thought selectors derive from ACP config/handshake/capability evidence. Unsupported methods are hidden or labelled unsupported, not called blindly. | Tests for Claude no `session/set_model`, Codex model format, OpenClaw mode/model support, UI selector smoke. |
| ASP-6 | Error taxonomy and user/debug split | done | Bridge interruption, auth, quota, gateway unavailable, permission denied, tool failed, network/sandbox refusal, timeout, empty output, and provider crash have separate codes and user guidance. | Runtime classification tests; latest Claude/Hermes/OpenClaw/Codex log regression fixtures. |
| ASP-7 | Artifact and workspace integration | done | URLs/files emitted during or after a run become conversation artifacts/open targets. Buttons actually open Browser/Workspace/Finder as applicable. | Open-target tests; Electron UI smoke for URL and file artifact click path. |
| ASP-8 | UI data-flow parity | done | Local Agent UI consumes runtime conversation state instead of owning truth in localStorage-only chat state. Tab switch, provider switch, conversation switch, clear/new conversation remain stable. | Electron smoke: 3-turn conversation, switch tabs, return, active/completed transcript intact; mobile/small-width check. |
| ASP-9 | Provider matrix and live smoke | done | OpenCode, Codex, Claude, Hermes, OpenClaw, and Custom ACP have current capability rows: command, bridge package, auth, session/resume, stream, permission, config, tools, transcript, blockers. | Live or blocked evidence saved per provider; no fake pass for unavailable providers. |
| ASP-10 | Anti-false-completion gate | done | UI/debug/log cannot show old provider-native connection labels for ACP-capable paths unless explicitly marked compatibility/fallback. Required gaps cannot be left as `Next` without blocker evidence. | `rg` anti-old-label scan, UI/debug smoke, terminal reconciliation. |

## 5. Execution Phases

### Phase A: Evidence Lock And Reconciliation

Start at `ASP-0-baseline-reconciliation`.

- Read current Studio dirty diff and avoid overwriting unrelated work.
- Capture latest Local Agent run logs for Codex, Claude, Hermes, OpenClaw, and OpenCode from app runtime-state.
- Compare actual user-visible failures against AionUI source semantics.
- Produce a baseline matrix: `already stable`, `partial facade`, `unstable`, `blocked by provider`, `unknown`.

### Phase B: Runtime Contract Refactor

- Introduce or tighten a conversation-runtime contract inside `apps/desktop/electron/personal-agent-runtime/`.
- Keep adapters provider-specific only below the runtime boundary.
- Make the runtime facade the only source for conversation status, active turn, pending confirmations, message transcript, process state, config options, artifacts, and errors.
- Preserve compatibility APIs only as thin wrappers with tests proving they do not become truth sources.

### Phase C: Durable Message And Confirmation Store

- Persist streaming events into a conversation-scoped message store as they arrive.
- Persist pending confirmations outside the transient run object.
- Add recovery on `conversationStatus` / `conversationTranscript` so UI can recover after remount.
- Record user decisions as message/confirmation events.

### Phase D: Provider Stability Matrix

- For every provider, inspect current local command and live behavior before changing code.
- Codex: verify managed `@agentclientprotocol/codex-acp`, model format, set_mode, tool execution, network/sandbox behavior, clean-session recovery.
- Claude: verify managed `@agentclientprotocol/claude-agent-acp`, no unsupported `session/set_model`, permission approve/decline semantics, post-output tool failure behavior.
- Hermes: verify ACP fresh session behavior, auth/quota/model errors, permission and tool failure semantics.
- OpenClaw: verify Gateway lifecycle, `session/set_model` skip, permission/tool behavior, Gateway unavailable classification.
- OpenCode: verify ACP session path, approval behavior, streaming and artifact behavior.

### Phase E: UI Rewire And Polish

- Make the Local Agent page render conversation messages from runtime state.
- Keep local UI draft/cache only for drafts and selected ids, not as transcript truth.
- Keep active-run/process badges visible outside the Local Agent page.
- Ensure debug details are collapsed by default but complete when opened.
- Ensure open artifact, open URL, reveal file, and open workspace controls use the same host open-target behavior as Assistant/Expert.

### Phase F: Verification And Terminal Reconciliation

- Run required automated checks and real Electron UI smoke.
- Run provider live smoke or record exact provider blockers.
- Search the ledger and reports for required `pending`, `partial`, `missing`, unresolved `blocked`, `Remaining Gap`, and `Next Required Work` before final handoff.
- Status can be `Completed` only when every required row is done or evidence-backed/user-approved blocked/descoped.

## 6. Required Verification

Minimum automated verification for implementation phases:

- `node --test apps/desktop/electron/personal-agent-runtime/runtime.test.mjs`
- `node --check apps/desktop/electron/personal-agent-runtime/index.mjs`
- `node --check apps/desktop/electron/personal-agent-runtime/adapters/acp-generic.mjs`
- `node --check apps/desktop/electron/personal-agent-runtime/acp-client.mjs`
- `/opt/homebrew/bin/pnpm task check app`
- `/opt/homebrew/bin/pnpm --filter @onmyagent/desktop check:electron`
- `/opt/homebrew/bin/pnpm task test personal-local-agent-acp-ui-smoke`
- provider matrix smoke for installed providers, saved under `.loop/evidence/personal-local-agent-aionui-stability/ASP-9/`
- `git diff --check`

User-path verification must include:

- open Local Agent page through the normal Studio UI;
- select each installed provider;
- send at least one normal chat message;
- run one safe tool/file/shell task where the provider supports tools;
- trigger or simulate one permission request and resolve approve/decline;
- switch to another Studio tab while the provider is running and return;
- clear/new conversation and verify a new provider session is used;
- click a URL/file artifact and verify it opens in the intended host surface;
- inspect debug details and confirm truthful ACP/bridge command, cwd, provider session, run id, and log path.

## 7. Provider Capability Matrix Template

This matrix must be filled during `ASP-9` with live or evidence-backed blocked status.

| Provider | Expected bridge | Conversation/session | Streaming | Permission | Config/model/mode | Tools | Transcript/history | Current status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenCode | `opencode acp` | live passed | live passed | live passed | evidence-backed | live passed | runtime transcript | completed |
| Codex | `@agentclientprotocol/codex-acp` | live passed | live passed | live passed | evidence-backed | live passed | runtime transcript | completed |
| Claude Code | `@agentclientprotocol/claude-agent-acp` | live passed | live passed | live passed | evidence-backed; no unsupported `session/set_model` | live passed | runtime transcript | completed |
| Hermes | `hermes acp` | live passed | live passed | evidence-backed | evidence-backed | live passed | resume-only where native transcript is not stable | completed |
| OpenClaw | `openclaw acp` + Gateway | live passed | live passed | evidence-backed | evidence-backed; no unsupported `session/set_model` | live passed | resume-only where native transcript is not stable | completed |
| Custom ACP | user command | supported by generic ACP contract | supported when command exposes stream | provider-dependent | provider-dependent | provider-dependent | runtime transcript | not live-smoked because no custom command was configured |

## 8. Checkpoint Queue

1. `ASP-0-baseline-reconciliation`
2. `ASP-1-conversation-runtime-contract`
3. `ASP-2-durable-message-store`
4. `ASP-3-confirmation-recovery`
5. `ASP-4-active-process-registry`
6. `ASP-5-config-model-mode-source`
7. `ASP-6-error-taxonomy`
8. `ASP-7-artifact-workspace-integration`
9. `ASP-8-ui-data-flow-parity`
10. `ASP-9-provider-matrix-live-smoke`
11. `ASP-10-terminal-reconciliation`

## 9. Stop Conditions

Stop and report Blocked only when:

- provider credentials/login/quota/Gateway are unavailable and cannot be fixed without user secrets or external account action;
- the same required verification fails three times after inspect/fix/rerun;
- a fix requires changing Expert/Assistant runtime or unrelated modules outside this ledger;
- a product decision is required about default permissions, sandbox level, or cross-workspace access;
- destructive operations, production resources, external messaging, commit/pull/merge/rebase/push, or secrets are required.

## 10. Completion Gate

Before final `Completed`, perform terminal reconciliation:

- every ASP row is `done`, user-approved `descoped`, or evidence-backed `blocked`;
- no required `pending`, `partial`, `missing`, unresolved `blocked`, unchecked gate, `Remaining Gap`, or `Next Required Work` remains in this ledger or its final report;
- UI/debug/log evidence proves the current Local Agent path matches the AionUI-style conversation runtime target rather than an old run-only facade;
- provider matrix is filled with live evidence or exact blockers;
- required automated checks and user-path smoke have passed;
- `docs/PROGRESS.md` and `docs/LOOP-RUN-LOG.md` are updated;
- no git commit/pull/merge/rebase/push was executed unless explicitly authorized in the current user turn.

If any required gap remains and is currently actionable, continue into the next checkpoint instead of handing off as `Partial`.


## 11. Execution Notes

### 2026-06-30 ASP-0 / ASP-4

- ASP-0 baseline reconciliation evidence saved under `.loop/evidence/personal-local-agent-aionui-stability/ASP-0/baseline-report.txt`.
- Source-backed finding: AionUI persists agent process registry under runtime data and cleans/reclassifies process state on startup; Studio's previous registry was an in-memory Map only.
- Implemented ASP-4 slice: `apps/desktop/electron/personal-agent-runtime/process-registry.mjs` now persists active process records under the configured personal-agent runtime-state root and recovers them as `status: stale` with `staleReason: runtime_restarted`.
- Runtime creation now calls process recovery so UI process listing has a runtime-owned restart classification instead of only renderer-owned memory.
- Verification: `node --test --test-name-pattern "process registry|tracks active ACP subprocesses" apps/desktop/electron/personal-agent-runtime/runtime.test.mjs`; `node --check apps/desktop/electron/personal-agent-runtime/process-registry.mjs`; `node --check apps/desktop/electron/personal-agent-runtime/index.mjs`.

### 2026-06-30 ASP-1 / ASP-2 / ASP-3

- ASP-1: confirmed and strengthened runtime contract with separate conversation/run/provider session/resume identities exposed through conversation status.
- ASP-2: added conversation-scoped event persistence under runtime-state via `writeConversationEvents/readConversationEvents`; streaming chunks, tool/status/error/permission events and derived messages are no longer only reconstructed from the final run object.
- ASP-3: approval request events are persisted into the conversation event store and conversation confirmation recovery is covered by runtime tests.
- Verification: `node --test --test-name-pattern "conversation confirmations|persists streaming conversation events|process registry" apps/desktop/electron/personal-agent-runtime/runtime.test.mjs`; `node --check apps/desktop/electron/personal-agent-runtime/conversation-store.mjs`; `node --check apps/desktop/electron/personal-agent-runtime/process-registry.mjs`; `node --check apps/desktop/electron/personal-agent-runtime/index.mjs`.

### 2026-06-30 ASP-5 / ASP-6 / ASP-7

- ASP-5: config/model/mode selectors remain sourced from runtime metadata/handshake/config options; unsupported providers return explicit unsupported reasons.
- ASP-6: runtime error taxonomy has focused coverage for model/mode failures, ACP bridge interruption, sandbox/network refusal, timeouts, cancellation, and post-output tool failures.
- ASP-7: artifact harvesting persists structured adapter artifacts and assistant-emitted file paths; Local Agent UI routes artifact click through the shared host open-target path when provided, with open-target model tests covering URL/file preview classification.
- Verification: `node --test --test-name-pattern "config/model capability|classifies|artifacts|Codex ACP model" apps/desktop/electron/personal-agent-runtime/runtime.test.mjs`; `/opt/homebrew/bin/pnpm task test open-target`; `node --check apps/app/scripts/personal-local-agent-acp-ui-smoke.mjs`.

### 2026-06-30 ASP-8 / ASP-9

- ASP-8: Electron UI smoke passed through normal Local Agent UI, covering visible ACP labels, background process polling, three-turn chat, Markdown render, approval card, tab-switch preservation, and old-label absence. Evidence: `.loop/evidence/personal-local-agent-acp-ui-smoke/result.json` and screenshots `01-local-agent-open.png` through `04-tab-switch-preserved.png`.
- ASP-9: live provider matrix passed for OpenCode, Codex, Claude Code, Hermes, and OpenClaw through ACP session paths. Evidence saved to `.loop/evidence/personal-local-agent-aionui-stability/ASP-9/provider-matrix.json`.
- Verification: `ONMYAGENT_ELECTRON_REMOTE_DEBUG_PORT=9823 /opt/homebrew/bin/pnpm task test personal-local-agent-acp-ui-smoke`; `ONMYAGENT_ELECTRON_REMOTE_DEBUG_PORT=9823 node .loop/personal-agent-provider-matrix-smoke.mjs`.
