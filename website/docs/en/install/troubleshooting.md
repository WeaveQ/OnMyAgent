---
title: Troubleshooting
---

# Troubleshooting

| Symptom | What to do |
|---------|------------|
| The model does not respond | Check the API key, Base URL, proxy, and quota; see [Models](/en/guide/models) |
| Settings model list keeps spinning | Current builds ship a catalog snapshot. If it still hangs, check the network and restart; see [Models troubleshooting](/en/guide/models#models-troubleshooting) |
| A file cannot be written | Check that the workspace path is writable, disk space is available, and the permission mode is not too restrictive |
| A permission-based capability is unavailable | On macOS, check Accessibility, Screen Recording, Full Disk Access, and related permissions under [Settings → System](/en/guide/settings#system) |
| A Skill fails after an upgrade | Restart OnMyAgent and confirm that the Skill is still installed |
| The interface is blank | Restart OnMyAgent. Check whether a proxy is blocking `127.0.0.1`; add local addresses to the proxy bypass list if needed |
| macOS says the app is damaged | Current preview builds are notarized. If Gatekeeper still blocks the app, run `xattr -cr /Applications/OnMyAgent.app` and open it again |
| Check for updates never shows install | Development builds only open the release page. In a packaged build, click **Download update** first; **Restart and install** appears after the download finishes. If you are already on the latest build, there is a notice and no install button |
| Settings will not open | Use **⌘ ,** / **Ctrl ,**, or open **Settings** from the gear menu |
| Automation does not run | Confirm that the task is **Enabled** and the computer was not asleep for too long; see [Automation](/en/guide/automation) |

If the problem persists, include the **version number** from Settings → Updates, the operating-system version, and a screenshot when filing a [GitHub Issue](https://github.com/WeaveQ/OnMyAgent/issues).

## Related

- [Download and installation](/en/download) · [FAQ](/en/faq) · [Security and data](/en/security)
