# domains/messaging

Automations and personal-agent messaging channels (Feishu, Weixin, pairing).

## Ownership

- Automation page + model + session groups
- Messaging channels page
- Channel panels: Feishu, Weixin, pairing

## Public surface

`./index.ts` barrel exports pages, automation model helpers, and channel panels.
Shell and settings should import from `domains/messaging`, not from
Session chrome lives under `session/sidebar/` (no shared-pages middleman).

## Lateral dependencies

- Allowed: `domains/shared` (infra), `app/lib`, `packages/types`.
- Prefer not depending on `session/` for new code.
