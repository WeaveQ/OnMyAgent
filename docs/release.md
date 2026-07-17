# Release Process

**Source of truth** for PR merge → tag → GitHub Release → signing / notarize / sidecar publish.

Local `package:electron` smoke only: see [`../BUILD.md`](../BUILD.md). Full doc map: [`README.md`](README.md).

This repository uses pull requests for code changes and GitHub Actions for release packaging.

### Desktop update discovery (installed apps)

Packaged desktop builds use a **lightweight checker** (`apps/desktop/electron/updater.mjs`):

- Poll GitHub `releases/latest` (stable only; no alpha feed).
- Compare the release tag to the packaged app version.
- On a newer release: OS notification + Settings UI; the user opens the **release page** in a browser.
- **No in-app download / silent install** and no `electron-updater` / `latest.yml` requirement for prompts.

Release packaging and code signing still follow the flows below; the checker only needs a normal GitHub Release with a semver tag.

## Developer preview (unsigned, no Apple Developer cert)

When you **do not** have Developer ID + notarization yet, ship GitHub builds as **developer preview** only:

```text
draft: false
prerelease: true
notarize: false
build_electron: true
```

### Who it is for

- Developers and internal testers who can run one Terminal command
- **Not** for end users who expect “download and double-click”

### macOS “damaged / can’t be opened”

Unsigned preview builds are **not corrupt**. Gatekeeper blocks apps downloaded from the internet without notarization. Local `pnpm dev` / local package often works because those paths usually have no `com.apple.quarantine` flag.

After installing the `.app` (e.g. into Applications):

```bash
xattr -cr /Applications/OnMyAgent.app
```

Then open the app again. Alternatively: **System Settings → Privacy & Security → Open Anyway**.

Put the same instructions in the GitHub Release notes for every preview tag.

### Updater / latest

`releases/latest` ignores prereleases. Preview tags will not drive the desktop “check for updates → latest” path until you publish a **non-prerelease** release (preferably notarized).

## Daily PR Flow

1. Start from the latest `main`.

   ```bash
   git switch main
   git pull --ff-only
   git switch -c codex/<short-change-name>
   ```

2. Make focused changes, then run the narrowest useful local checks.

   ```bash
   pnpm check
   pnpm test:unit
   ```

   If the change touches the desktop shell or renderer, also run a local smoke:

   ```bash
   pnpm dev
   ```

3. Commit and push the branch.

   ```bash
   git add <changed-files>
   git commit -m "type: short summary"
   git push -u origin codex/<short-change-name>
   ```

4. Open a pull request into `main` and wait for the required checks.

   - `OnMyAgent Tests` runs workspace checks and unit/API/runtime/UI tests.
   - `i18n Audit` checks translation coverage.
   - `onmyagent-ui-mcp` checks MCP package changes when `packages/onmyagent-ui-mcp/**` is touched.
   - `Build Electron Desktop` can be run manually when packaging behavior changes.

5. Merge only after the PR checks are green and the review notes are resolved.

After a merge to `main`, the same mainline branch is the source for automated CI and release-channel workflows:

- `OnMyAgent Tests` and `i18n Audit` run on matching `main` pushes.
- `onmyagent-ui-mcp` runs on `main` pushes that touch the MCP package and still publishes only from `onmyagent-ui-mcp-v*` tags.
- `Alpha Channel (macOS arm64)` publishes the rolling alpha channel from `main`; use `Release App` for tagged preview or stable releases.

## Preview Release Flow

Use this flow before Apple signing and notarization are configured.

1. Make sure `main` contains the release commit.

   ```bash
   git switch main
   git pull --ff-only
   ```

2. Create and push a version tag.

   ```bash
   git tag -a v0.1.1 -m "OnMyAgent v0.1.1"
   git push origin v0.1.1
   ```

3. Open GitHub Actions and run `Release App` manually if the tag push did not start it.

   Recommended preview inputs:

   ```text
   tag: v0.1.1
   release_name: OnMyAgent v0.1.1
   release_body: Preview release.
   draft: true
   prerelease: true
   notarize: false
   publish_sidecars: false
   publish_npm: false
   build_electron: true
   ```

4. Confirm the generated GitHub Release contains the macOS artifacts.

   Expected assets include:

   - `onmyagent-mac-arm64-<version>.dmg`
   - `onmyagent-mac-arm64-<version>.zip`
   - `onmyagent-mac-x64-<version>.dmg`
   - `onmyagent-mac-x64-<version>.zip`
   - `latest-mac.yml`

## Production Release Requirements

Before publishing a stable public release, configure Apple signing and notarization secrets in GitHub Actions:

- `APPLE_CODESIGN_CERT_P12_BASE64`
- `APPLE_CODESIGN_CERT_PASSWORD`
- `APPLE_NOTARY_API_KEY_P8_BASE64`
- `APPLE_NOTARY_API_KEY_ID`
- `APPLE_NOTARY_API_ISSUER_ID`

Then run `Release App` with:

```text
draft: false
prerelease: false
notarize: true
build_electron: true
```

Only enable these after the release destinations are intentionally configured:

```text
publish_sidecars: true
publish_npm: true
```
