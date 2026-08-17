---
title: Changelog
---

# Changelog

For the complete assets and release notes, use [GitHub Releases](https://github.com/WeaveQ/OnMyAgent/releases) as the source of truth. The entries below highlight recent user-visible changes. Current desktop builds are **prereleases**.

## Unreleased

## 0.5.10

- Preview builds are **notarized** again (Developer ID + Apple notarization)

## 0.5.9

- Main-rail **Knowledge Base**: local Markdown notes, searchable in chat via `knowledge_search`
- Sending `/skill-creator` injects **SKILL.md** into the turn instead of a bare slash command
- Builtin skill cards prefer Chinese copy; builtin skills cannot be uninstalled
- Market **Go to chat** opens a session on the Home primary rail
- Knowledge index can be rebuilt; snippets stay cleaner
- Linux window background and launch / permission fixes

## 0.5.8

- Signed and notarized preview build
- **Recent** lists parent tasks only; parallel subtasks group as **N/M subtasks**
- Context usage follows the model window (million-token windows show as **1M**)
- Market **Create skill** prefills `/skill-creator …`; **New task** keeps that seed
- Expert-attached skills no longer appear under **Installed**; `/` still reaches core bundled skills in a sandbox
- **Projects** is hidden from the main rail (the Files tab remains a preview)
- Conversation body text supports Cut / Copy / Paste / Select all
- Markdown deliverables in a session open as file links, not “open artifact” pills

## 0.5.7

- Signed and notarized preview build

## 0.5.6

- Preview build

## 0.5.5

- Updater: quit-and-install after download works again

## 0.5.4

- Settings → Updates no longer shows a false “download from GitHub only” message while checking
- Windows title bar is drawn by the app
- A successful macOS notarization is no longer overwritten by a second package step

## 0.5.3

- macOS release builds sign with Developer ID and go through notarization

## 0.5.2

- Smaller installer: English/Chinese Electron locales only, drop unused office-lib browser bundles, recompress oversized catalog icons

## 0.5.1

- Smaller installers: drop unused bundled Node/Python extras, duplicate sidecars, and artifact-runtime maps/types
- A found update starts downloading only after you click the notice or **Download update**; cold start also checks once
- Updates are not downloaded automatically in the background after a check, and nothing installs silently

## 0.5.0

- Packaged builds hide the Task Center rail entry (still visible in local dev)

## 0.4.29

- Task Center: durable background orchestration, alignment, approvals, and run history
- Windows tray icon matches the app brand mark
- Taskbar jump list Computer Control uses the brand icon
- Expert marketplace browse grid no longer highlights text on drag

## 0.4.28

- Welcome onboarding is no longer covered by the boot overlay after cold start
- Expert identity snapshots are cached to avoid UI freeze / white screen
- Expert create overlay dismisses after delete
- Expert package-name and real-home resolution are more reliable

## 0.4.27

- Packaged builds download updates in the background; click **Restart and install** (nothing installs silently)
- Expert permanent delete no longer fails on package-name format mismatch
- Settings: provider delete / disconnect unified as **Remove**

## 0.4.26

- Expert / session UI stability (fewer white screens and frozen updates)
- Local session archive and local-agent scans use the real user home

## 0.4.25

- OS notifications and quick capture work outside the session page

## 0.4.22 – 0.4.24

- Packaged boot, welcome assets, and provider-ready state fixes

## 0.4.21

- Fixed packaged-app boot crash
- Refreshed creator / KOL builtin expert packs

## 0.4.19

- Isolated expert runtime (sandboxed HOME)
- Drag-reorder model providers
- Recover summoned expert sessions

## 0.4.17

- Company / OnMyCompany entry and org catalog sync

## 0.4.16

- Local config profiles (Phase 2a) and work memory
- Faster task / expert / session switching

## 0.4.15

- Improved cold start and first-screen loading

## 0.4.14

- Refined expert capability descriptions and logistics offerings in Market
- Polished Files, Computer Use, Terminal, and archived-session experiences

## 0.4.13

- Added BrowserSkill installation and troubleshooting paths alongside the in-app browser capability
- Improved connector experiences

For older versions, see `CHANGELOG.md` at the repository root and the Releases page.
