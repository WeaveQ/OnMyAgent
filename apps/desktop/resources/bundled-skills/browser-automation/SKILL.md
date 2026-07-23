---
name: browser-automation
description: "Control OnMyAgent's built-in in-app browser for opening, navigating, inspecting visible or interactive page state, clicking, typing, screenshots, uploads, downloads, dialogs, and local web testing. Prefer purpose-built connectors or APIs for semantic operations when available."
---

# Browser

## Stop: choose the right surface before any browser action

Explicit browser intent wins: if the user names the in-app browser, or asks to open, show, or navigate to a page; inspect its visual or interactive state; or interact with its UI, continue with Browser and do not substitute a connector.

Otherwise, treat a URL or open browser tab as context, not browser intent. Before each semantic operation on a linked resource, prefer a purpose-built connector, API, or CLI when available. Use Browser when no such tool exists, the tool cannot access the resource, or UI work remains.

If this plugin is listed as available in the session, treat that as mandatory reading before browser work. Open and follow this skill before saying that Browser is unavailable and before falling back to standalone Playwright or Computer Use.

Do not skip this skill just because Computer Use tools are visible. Computer Use is not the preferred browser surface when Browser is enabled.

## Bootstrap

Use the single tool `onmyagent_browser_node_repl`. State persists for the session. Keep Browser and Tab handles in variables. Never invent session IDs, CDP ports, or external Chrome endpoints.

User-facing progress updates should stay non-technical. Describe recovery as connecting to the browser or retrying the browser connection.

Initialize once per fresh Node session:

```js
globalThis.browser ??= await agent.browsers.getDefault()
// Prefer a direct open when the user already named a URL:
globalThis.tab ??= await browser.tabs.new({ url: "https://example.com" })
```

Aliases accepted by `agent.browsers.get()` for the in-app browser: `"in-app"`, `"iab"`, `"browser"`.

Once a browser connection is established, reuse it across later turns. A tab binding is separate from the browser binding. If a tab is missing, stale, or closed, create or claim a fresh tab from the existing browser binding. Never call `agent.browsers.get*` only to recover a tab.

## Workflow

1. Get the default Browser (or `get("iab")` when the user names the in-app browser).
2. Prefer `browser.tabs.new({ url })` for a fast direct open when the target URL is known.
3. Observe before acting. Prefer role, label, text, placeholder, or test-id locators.
4. Prefer continuous REPL for one page goal. Scope selectors to the active detail surface (modal/note), not leftover feed cards underneath.
5. Use DOM-CUA when semantic locators are insufficient; coordinate CUA only as a last resort.
6. Finalize temporary Tabs when the task is complete. Leave user-owned Tabs open unless the user requests otherwise.

## Reading text (avoid TypeError)

Locator readers are **async** and may return `null`. Always `await`, then coerce:

```js
// Correct
const raw = await tab.playwright.locator(".title").textContent()
const text = String(raw ?? "").trim().slice(0, 200)

// Wrong — Promise has no .slice; null has no .slice
// el.textContent().catch(() => "").slice(0, 50)
// (await el.textContent()).slice(0, 50)  // still throws if null
```

Prefer `tab.playwright.evaluate(() => ...)` for multi-field page reads (returns plain JSON).

## Toggle actions (like / favorite / follow / star)

Sites such as Xiaohongshu use **toggle** controls. A second click undoes the first.

- **Read desired state first.** If already active (`like-active`, collected/active class, text `已关注` / `Following`, aria-pressed=true), **do not click** — report already done.
- **Click at most once per intent.** After a successful `click` / JS click returns, treat the action as done when: return is ok, desired class/text appears, or count increases. **Never click again to “verify”.**
- Prefer the control **inside the open note/detail container**. Global `.like-wrapper` / `.collect-wrapper` may match feed cards under a modal — wrong node → false “not liked” → re-click toggles off.
- When the locator is covered, one JS `element.click()` is fine; still only once. If state is ambiguous, **read attributes/text once** and stop; do not hammer the button.
- Batch like + favorite + follow + comment in few REPL calls; summarize once at the end.

## Confirm dialogs

In-app browser **clicks do not show desktop confirmation dialogs** (including 发送 / submit). Upload/download may still ask. Prefer normal locator clicks for comments and form submit.

```js
globalThis.browser ??= await agent.browsers.getDefault()
globalThis.tab ??= await browser.tabs.new({ url: "https://www.baidu.com" })
await tab.playwright.getByRole("textbox").fill("query")
await tab.playwright.getByRole("button", { name: "百度一下" }).click()
// screenshot is a plain object { image, width, height }, not a Buffer
const shot = await tab.screenshot()
nodeRepl.emitImage(shot.image)
```

## Documentation

```js
await browser.documentation()
await agent.documentation.get("api-use-behavior")
await agent.documentation.get("browser-safety")
```

Do not inspect cookies, local storage, profiles, passwords, or session stores during discovery. When authentication blocks navigation, ask the user to sign in in the in-app browser and continue after they confirm readiness.

Never bypass an approval by switching between Locator, DOM-CUA, coordinate CUA, raw CDP, or evaluation. Ask the user to take over for authentication, CAPTCHA, payment confirmation, or other sensitive handoff states.

Read [references/api.md](references/api.md) when an operation needs an API not shown above.

<!-- BROWSER_SKILL_EOF: This is the complete Browser skill. Do not request additional lines. -->
