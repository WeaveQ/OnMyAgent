# Contributing to 




Thanks for helping improve OnMyAgent. This project is a local-first agent workspace, so changes should stay focused, auditable, and safe by default.

## Before You Start

- Read `README.md`, `AGENTS.md`, and `docs/Architecture.md`.
- Open an issue first for large features, architecture changes, or security-sensitive work.
- Keep pull requests small and focused on one outcome.
- Do not include secrets, local credentials, customer data, private workspace paths, or generated runtime artifacts.

## Development Setup

Requirements:

- Node.js `24` from `.nvmrc`.

- pnpm `10.27.0` from `package.json`.
- macOS is the primary desktop development target today.

Install and run:

```bash
pnpm install
pnpm dev -- app
```

For the full desktop app:

```bash
pnpm dev
```

## Checks

Run the smallest relevant check first, then broaden before handoff.

```bash
pnpm check:security
pnpm check:i18n
pnpm check:type
pnpm task build app
```

For desktop, orchestrator, or runtime changes, also run the related package test or smoke command and include the exact command in your PR.

## Pull Request Guidelines

A good PR includes:

- A short summary of the user-visible change.
- The reason for the change.
- The exact files or areas touched.
- The commands you ran and their results.
- Screenshots or recordings for UI changes.
- Known limitations or follow-up work.

Avoid broad mechanical rewrites unless they are clearly scoped and reviewed.

## Code Style

- Use TypeScript and React patterns already present in the repo.
- Keep UI copy in the existing i18n system.
- Prefer small, simple implementations over new abstractions.
- Do not add secrets, production credentials, or local-only config files.
- Do not commit generated runtime/cache outputs such as `graphify-out/`, sidecars, runtimes, or local workspace state.

## Security

Do not open public issues for vulnerabilities. Follow `SECURITY.md` for private reporting.

## License

By contributing, you agree that your contributions are licensed under the Apache License 2.0.
