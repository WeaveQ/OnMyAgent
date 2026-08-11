# Expert module engineering gates

These opt-in gates support P11-03/P11-04 without changing the package script
surface. They are intentionally executable directly so a CI workflow can add
them after reviewing the command budget.

## Per-commit type gate

```bash
node scripts/checks/check-commit-types.mjs \
  --base "$BASE_SHA" \
  --head "$HEAD_SHA" \
  --max-commits 20
```

The script also reads GitHub push/PR event JSON (`GITHUB_EVENT_PATH`) and the
existing local `GITHUB_*`/`TYPE_GATE_*` SHA variables. It resolves only objects
already present in the checkout: it never fetches, checks out, resets, or
rewrites the caller's current worktree. Each commit is checked with
`pnpm task check types` in a detached temporary worktree. A missing base is a
typed `BASE_UNAVAILABLE` error; an oversized range is `RANGE_TOO_LARGE`.

Focused coverage, including a dirty-worktree integration fixture:

```bash
node --test scripts/checks/check-commit-types.test.mjs
```

## Expert architecture contracts

```bash
node scripts/checks/check-expert-architecture-contract.mjs
node --test scripts/checks/check-expert-architecture-contract.test.mjs
```

The checker reads one source snapshot and verifies:

- removed Expert renderer recovery/delete/event-bus symbols and modules are not
  reintroduced;
- inventory/query consumers never infer Expert or session deletion from an
  HTTP 404 / `session_not_found` response;
- renderer consumers do not synchronously read custom-agent identity, and the
  Expert Directory cache key has one storage owner;
- `writeExpertDirectoryCache` has one cache owner and one query call site;
- the renderer uses one `scope: "workspace"` aggregate request and the server
  aggregate/route symbols remain present; and
- if P9's `assertExpertRuntimeContract` (or its ensure-and-assert hook) exists,
  a `prompt_async` proxy path invokes it. When P9 is absent this check is
  explicitly skipped.
