# Task Center v2

Task Center is the renderer surface for the detached desktop Task Supervisor and
its SQLite-backed Task Orchestrator v2.
It starts from one freeform idea, loads the live Personal Local Agent catalog,
and freezes a primary/worker selection into the task definition.

The user path is:

1. Enter an idea while the selected workspace and catalog-selected primary summary are shown read-only.
2. Submit the idea with safe catalog/end-condition defaults, or expand Advanced settings to tune workers, permission, finalization, and bounded end conditions.
3. Continue an alignment conversation. The primary proposes a structured contract with outcome, deliverables, acceptance, scope, and verification.
4. Manual mode confirms the proposal before starting; automatic mode freezes the primary recommendation and starts without a confirmation click.
5. Execution shows one primary owner and any nested primary-to-worker attempts. A task can succeed without workers, and retry is only offered for the latest failed/blocked/cancelled primary attempt.
6. Long runs advance through bounded durable turns. Context rollover, pause, restart, and transport recovery resume from a redacted continuation capsule in a fresh provider session.
7. Select an immutable historical run from the run selector; events and artifact metadata load through Supervisor keyset pages, while full artifact content loads on demand.

Agent and model values are never free text. The selector uses the live Personal
catalog and sends `agentId`, provider, labels, model, `catalogSource`, and
`catalogRevision` in the create payload. An empty or failed catalog is an
explicit refreshable state.

Task Center must not render the removed fixed stage workflow or treat legacy v1
records as v2. Approval gates remain visible for restricted runs; full-allow
explains that task approval prompts are suppressed.
