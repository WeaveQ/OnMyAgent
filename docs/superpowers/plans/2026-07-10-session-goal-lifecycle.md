# 会话目标生命周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make goal, plan, and access behavior session-scoped and expose the goal lifecycle before and after sending.

**Architecture:** Normalize goal-mode detection independently of assistant category, use the existing session-keyed goal-runtime map as the single source of truth, and render a preview when goal mode is selected but no runtime exists. Keep plan and goal mutually exclusive at the session boundary.

**Tech Stack:** React, TypeScript, Zustand, Bun tests, localStorage session memory.

## Global Constraints

- Do not add server schemas or dependencies.
- Do not use `any` or hard-coded CJK UI copy.
- Preserve the `draft:<workspaceId>` to real-session migration boundary.
- Verify each change with Bun tests, app typecheck, and `git diff --check`.

---

### Task 1: Normalize session collaboration semantics

**Files:**
- Modify: `apps/app/src/react-app/shell/session-route-composer.ts`
- Modify: `apps/app/src/react-app/domains/session/surface/session-run-controller.ts`
- Test: `apps/app/scripts/session-route-composer.test.ts`
- Test: `apps/app/scripts/session-run-controller.test.ts`

**Interfaces:**
- Produces: category-independent goal detection for `{ planning: false, pursueGoal: true }`.
- Produces: `craft` mode that is not a goal mode.

- [x] Write failing tests for legacy goal mode and office/expert goal visibility.
- [x] Run `pnpm --dir apps/app exec bun test scripts/session-route-composer.test.ts scripts/session-run-controller.test.ts` and confirm the new expectations fail.
- [x] Implement minimal normalized goal detection and remove category gating from goal visibility.
- [x] Re-run the focused tests and confirm they pass.
- [ ] Commit and push `fix(session): normalize goal mode lifecycle`.

### Task 2: Show the session-scoped goal lifecycle above the composer

**Files:**
- Modify: `apps/app/src/react-app/domains/session/surface/session-surface.tsx`
- Test: `apps/app/scripts/session-run-controller.test.ts`

**Interfaces:**
- Consumes: normalized collaboration mode and `CollaborationGoalRuntime` keyed by current session.
- Produces: goal preview before first send and runtime panel after a goal exists.

- [ ] Write a failing visibility test for goal preview and goal runtime isolation.
- [ ] Run the focused test and confirm it fails because preview state is absent.
- [ ] Render a small preview panel only for the active session when goal mode is selected without a runtime; keep plan panel precedence.
- [ ] Re-run focused tests and app typecheck.
- [ ] Commit and push `feat(session): show goal lifecycle in composer`.

### Task 3: Verify session isolation and user flow

**Files:**
- Test: `apps/app/scripts/session-memory.test.ts`
- Test: `apps/app/scripts/session-run-controller.test.ts`

- [ ] Add a regression test proving goal, plan, and access records for one session do not alter another session.
- [ ] Run all session-focused tests, `pnpm --dir apps/app typecheck`, and `git diff --check`.
- [ ] Run `pnpm check:type` as the final cross-package gate.
- [ ] Commit and push any dedicated regression change.
