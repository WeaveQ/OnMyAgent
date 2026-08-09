---
title: Browser and Computer Use
---

# Browser and Computer Use

Browser tools navigate and read web pages. Computer Use operates desktop applications through the screen, accessibility APIs, or a platform driver. Appshot attaches the current application view to a session. These three capabilities require different permissions.

## 1. Capability comparison

| Capability | Primary target | Typical use | Key permission |
|------------|----------------|-------------|----------------|
| Built-in browser runtime | Web pages | Open pages, click, type, and capture screenshots | Website sign-in and network access |
| BrowserSkill / `bsk` | External browser bridge | Reuse Chrome/Edge extensions and a real browser session | External CLI, extension, and browser permissions |
| Computer Use | Desktop applications | Recognize the interface and operate controls | Accessibility and Screen Recording, depending on platform |
| Appshot | Current application window | Attach the visible interface to the current task | Screen-capture permission |

The built-in browser and BrowserSkill are separate paths. Detecting a browser does not prove that the external `bsk` CLI is installed or its extension is connected.

## 2. macOS and Windows

| | macOS | Windows |
|--|-------|---------|
| Product position | Primary release and day-to-day dogfood platform | Unsigned Electron / NSIS developer preview |
| Computer Use | HandsFree helper, AX, and Skysight when the helper is ready | Staged Cua Driver; MCP is off by default |
| Appshot | Supported | Supported |
| Additional limitation | Requires Accessibility and Screen Recording permission | Does not have full HandsFree/Skysight parity |

Linux desktop is not a current product release target. Linux use in CI or a sandbox does not imply a supported Linux client.

## 3. First-time setup

1. Open **Settings → System → Computer Use**.
2. Follow the setup guide to connect the helper or platform driver.
3. Grant Screen Recording, Accessibility, and other required permissions in the operating system.
4. Return to OnMyAgent and inspect the runtime state. Restarting the app or helper may be required after a system-permission change.
5. Run a read-only recognition test against a window with no private data, then test a click.

Do not perform the first automated-click test in a real production application, payment page, or administrator console.

## 4. Browser recommendations

- For sign-in checks, prefer an existing browser session that the user has explicitly authorized.
- If the site has a dedicated API, MCP server, or connector, the semantic tool is usually more stable than screen clicking.
- After a page refresh, reacquire control references; do not reuse old coordinates or DOM refs.
- The user must handle verification codes, system dialogs, and security confirmations. Do not continue those actions outside the recorded view.

## 5. Appshot and attachments

Before attaching an Appshot from the session composer, check the image for chats, email, notifications, accounts, paths, or secrets. Appshot is an attachment of the current view; it does not grant the Agent permission to control the entire system.

## 6. Security boundaries

- Visible on screen does not mean all information is authorized for reading or outbound transfer.
- Accessibility is a powerful permission. Grant it only to trusted local applications and test users.
- Keep human approval for Computer Use actions that write, send, delete, buy, or publish.
- Describe the Windows preview only within its tested scope; do not copy macOS capability claims.

## 7. Troubleshooting

| Symptom | Check |
|---------|-------|
| No image is visible | Screen Recording permission and whether the target window is minimized or obscured |
| Image is visible, but controls cannot be operated | Accessibility permission, helper state, and whether the control belongs to another process |
| Click lands in the wrong place | Display scaling, multiple displays, window movement, stale coordinates, or a layout change |
| BrowserSkill is unavailable | `bsk` CLI, browser extension, browser process, and version |
| Windows driver is missing | Whether Cua Driver was staged and MCP was explicitly enabled |

## 8. Related

- [Sessions](/en/guide/sessions) · [Approvals and permissions](/en/guide/approvals) · [Feature and platform status](/en/guide/capability-status)
- [Install on macOS](/en/install/macos) · [Install on Windows](/en/install/windows)
