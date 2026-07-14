# Composer Mode and Tool Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Pursue goal from office collaboration choices and add searchable Skills and Connectors panels.

**Architecture:** Move option construction and fuzzy filtering into a small Composer-local pure model module, then keep UI state and rendering in the existing Composer. Reuse `Input`, Lucide icons, `MenuRowButton`, and the installed `fuzzysort` dependency.

**Tech Stack:** TypeScript, React, fuzzysort, Bun test, pnpm, project i18n.

## Global Constraints

- Office shows exactly Craft, Ask, and Plan; code/legacy retains Plan mode and Pursue goal.
- Search names and descriptions case-insensitively with fuzzy matching.
- Reuse project primitives and DLS tokens; do not add a generic menu abstraction.
- Add English, Simplified Chinese, and Traditional Chinese copy.
- Do not add hardcoded CJK in renderer files or forbidden type assertions.
- Commit and push independently after the cancellation fix.

---

### Task 1: Add a testable Composer menu model

**Files:**
- Create: `apps/app/src/react-app/domains/session/surface/composer/tool-menu-model.ts`
- Create: `apps/app/scripts/composer-tool-menu.test.ts`
- Modify: `apps/app/src/react-app/domains/session/surface/composer/composer.tsx`

**Interfaces:**
- Produces: `collaborationModeOptionKeys(variant: "office" | "legacy")`
- Produces: `filterToolMenuItems<T>(items: T[], query: string, target: (item: T) => string): T[]`

- [ ] **Step 1: Write failing option and filter tests**

```ts
expect(collaborationModeOptionKeys("office")).toEqual(["craft", "ask", "plan"]);
expect(collaborationModeOptionKeys("legacy")).toEqual(["planning", "pursueGoal"]);

const items = [
  { name: "review", description: "Review branch changes" },
  { name: "xlsx", description: "Create spreadsheets" },
];
expect(filterToolMenuItems(items, "branch", (item) => `${item.name} ${item.description}`))
  .toEqual([items[0]]);
expect(filterToolMenuItems(items, "", (item) => item.name)).toEqual(items);
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/app exec bun test scripts/composer-tool-menu.test.ts`

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement the pure model**

Use `items.filter((item) => fuzzysort.single(query.trim(), target(item)) !== null)` so matching preserves the existing source order. Return the input array unchanged for an empty trimmed query. Export a `CollaborationModeOptionKey` union and exact variant key arrays.

- [ ] **Step 4: Run and confirm GREEN**

Run: `pnpm --dir apps/app exec bun test scripts/composer-tool-menu.test.ts`

Expected: PASS.

### Task 2: Render search fields and filtered content

**Files:**
- Modify: `apps/app/src/react-app/domains/session/surface/composer/composer.tsx`
- Modify: `apps/app/src/i18n/locales/en/composer.ts`
- Modify: `apps/app/src/i18n/locales/zh/composer.ts`
- Modify: `apps/app/src/i18n/locales/zh-TW/composer.ts`
- Modify: `apps/app/scripts/composer-tool-menu.test.ts`

**Interfaces:**
- Consumes: pure model functions from Task 1
- Produces: independent `skillSearchQuery` and `connectorSearchQuery` local state

- [ ] **Step 1: Add failing source-contract assertions**

Assert the Composer imports and renders `Input`, uses localized `composer.search_skills`, `composer.search_connectors`, `composer.no_matching_skills`, and `composer.no_matching_connectors`, and office option keys contain no `pursueGoal`.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --dir apps/app exec bun test scripts/composer-tool-menu.test.ts`

Expected: FAIL because the search fields and keys are absent.

- [ ] **Step 3: Add localized copy**

Add these semantic keys in all three locale files:

```ts
"composer.search_skills": "Search skills",
"composer.search_connectors": "Search connectors",
"composer.no_matching_skills": "No matching skills",
"composer.no_matching_connectors": "No matching connectors",
```

Use accurate Simplified and Traditional Chinese translations in their locale modules.

- [ ] **Step 4: Implement UI state and filtering**

Add independent query state. Reset both queries whenever the quick-actions menu closes or a different secondary section is selected. Render an `Input` with `Search size={14}` and localized `aria-label` in Skills and Connectors headers. Filter commands, skills, plugin files, MCP servers, and composer extensions by their visible name plus description/detail. Keep loading copy distinct from no-match copy and preserve existing order.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `pnpm --dir apps/app exec bun test scripts/composer-tool-menu.test.ts`

Expected: PASS.

- [ ] **Step 6: Run UI verification**

Run:

```bash
pnpm task check app
pnpm check:forbidden-types
pnpm check:i18n:cjk
pnpm check:boundaries
.agents/skills/frontend-primitive-refactor/scripts/ui-primitive-scan.sh .
git diff --check
```

Expected: all gates exit 0; scanner introduces no new violations in touched files.

- [ ] **Step 7: Commit and push only Composer files**

```bash
git add apps/app/src/react-app/domains/session/surface/composer/tool-menu-model.ts apps/app/src/react-app/domains/session/surface/composer/composer.tsx apps/app/scripts/composer-tool-menu.test.ts apps/app/src/i18n/locales/en/composer.ts apps/app/src/i18n/locales/zh/composer.ts apps/app/src/i18n/locales/zh-TW/composer.ts
git commit -m "feat(composer): search skills and connectors"
git push origin codex/session-composer-fixes
```
