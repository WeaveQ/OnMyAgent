# Context usage panel

## Goal

Show session context occupancy: percent, used/total, optional category breakdown.

## Total resolution order

1. Runtime `context_usage.total` (or aliases)
2. Provider catalog `contextWindow` for the active model
3. Static `MODEL_CONTEXT_LIMITS` table
4. `DEFAULT_CONTEXT_LIMIT` = 200_000

If `used > total`, raise `total` to `used`.

## Breakdown

Optional buckets: `system`, `tools`, `messages`, `connectors`, `skills`, `other`.  
If missing, UI shows total only (no fabricated categories).

## Surfaces

- Local Agent: live via ACP `context_usage` (Phase A+B)
- Task/expert sessions: reuse the same component when usage is available (follow-up)
