# Security Policy

OnMyAgent is a local-first desktop workspace for running AI agents, MCP tools, local services, and coding workflows on a user's own machine. This policy explains what security issues we want reported, how to report them, and what boundaries matter for this project.

## Supported Versions

OnMyAgent is under active development. Security fixes are prioritized for:

- The latest public release.
- The current main development branch.
- Release artifacts and package metadata that are still referenced by the project.

Older prerelease builds may not receive backported fixes unless the issue also affects the current release path.

## In Scope

Please report vulnerabilities that affect OnMyAgent itself, including:

- Desktop app security issues in the Electron shell, preload bridge, IPC, or webview/browser surfaces.
- Local server or orchestrator issues that expose APIs beyond intended localhost/token boundaries.
- MCP UI control bridge issues, including missing authentication, token leakage, or unintended remote access.
- Permission or approval bypasses that let an agent perform privileged actions without user approval.
- Unsafe external URL handling, deep-link handling, or shell/open behavior.
- Markdown, artifact, or syntax-highlight rendering issues that can execute untrusted content.
- Secret handling issues involving model provider keys, local tokens, debug exports, logs, or generated reports.
- Release, updater, package, or bundled runtime issues that could allow tampering or unsafe downloads.

## Out of Scope

The following are usually out of scope unless they demonstrate a concrete OnMyAgent vulnerability:

- Vulnerabilities that require full local machine compromise before OnMyAgent is involved.
- Issues caused by a user's intentionally installed malicious MCP server, skill, model provider, or local CLI tool.
- Social engineering, phishing, or physical access attacks.
- Denial-of-service issues that only affect a user's own local development environment and do not cross trust boundaries.
- Reports for upstream dependencies without a demonstrated exploit path through OnMyAgent.
- Missing hardening headers for local-only development servers that are not exposed remotely.

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Report vulnerabilities privately through GitHub private vulnerability reporting when it is enabled for the repository.

If private vulnerability reporting is unavailable, contact the maintainers privately before sharing details publicly. Use the subject `[OnMyAgent security] <short summary>`.

Please include as much of the following as possible:

- A clear description of the vulnerability.
- Affected version, commit, platform, and runtime mode.
- Reproduction steps or proof of concept.
- Expected behavior versus actual behavior.
- Impact assessment, including what data or capability can be accessed.
- Logs, screenshots, or sample files if they are safe to share.
- Suggested remediation, if you have one.

Do not include real provider keys, production tokens, private customer data, or secrets in your report. Redact sensitive values before sending logs or screenshots.

## Response Expectations

We aim to:

- Acknowledge receipt within 3 business days.
- Provide an initial triage status within 7 business days.
- Share remediation or mitigation guidance when available.
- Credit reporters when appropriate and when they want attribution.

Timelines may vary for reports that require upstream dependency fixes, coordinated disclosure, package re-signing, or deeper investigation.

## Disclosure Guidance

Please keep vulnerability details private until a fix or mitigation is available and maintainers confirm public disclosure timing.

If you plan to publish research, contact us first so we can coordinate a responsible disclosure window.

## Project Security Boundaries

OnMyAgent's security model is based on explicit local boundaries:

- Local services should bind to `127.0.0.1` unless the user explicitly configures remote access.
- Local bridge and MCP control surfaces should use bearer-token style protection and should not be exposed as public remote APIs.
- Renderer-triggered external links should remain restricted to safe schemes such as `http:`, `https:`, and `mailto:`.
- Raw Markdown HTML should remain blocked; any generated highlighting HTML must be allowlisted before rendering.
- Agent actions that touch files, shell commands, credentials, browsers, or external services should go through explicit permission or approval flows.
- BYOK credentials are user-managed and must not be committed, logged, exported, or included in debug bundles.
- Debug exports should avoid secrets and should clearly separate local diagnostics from private credentials.

## Secret Handling

Never commit secrets to this repository, including:

- `.env*` files.
- Model provider API keys.
- OAuth tokens or refresh tokens.
- MCP server credentials.
- Local bearer tokens.
- Private keys, signing keys, or release credentials.

If a secret is accidentally committed, rotate it immediately and treat the commit history as compromised.

## Safe Harbor

We will not pursue legal action against good-faith security research that:

- Avoids privacy violations, data destruction, and service disruption.
- Does not access, modify, or exfiltrate data that does not belong to you.
- Reports findings privately and allows reasonable time for remediation.
- Stays within the scope described above.

This safe harbor does not authorize attacks against third-party services, model providers, package registries, or infrastructure not controlled by this project.
