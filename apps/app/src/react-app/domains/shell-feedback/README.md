# domains/shell-feedback

Shell-level user feedback: reload workspace toast, floating toast frame, status toasts,
top-right notifications.

## Public surface

`./index.ts` barrel. Prefer this domain over any historical `shared` toast paths.

## Lateral dependencies

- Allowed: `app/lib`, design-system / UI primitives.
- Product domains may import feedback helpers; this domain should not import product domains.
