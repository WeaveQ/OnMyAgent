---
name: browser-automation
description: Control OnMyAgent's in-app browser through a persistent Node REPL for navigation, page inspection, clicking, typing, screenshots, uploads, downloads, dialogs, and local web testing. Use when a task requires interacting with a website or browser UI; prefer purpose-built APIs or connectors for semantic operations when available.
---

# Browser Automation

Use `onmyagent_browser_node_repl` for every browser operation. State persists within the current session, so keep Browser and Tab handles in variables instead of rediscovering them after each action.

## Workflow

1. Get the default Browser and inspect its tabs.
2. Reuse a suitable owned Tab or create a background Tab.
3. Observe before acting. Prefer role, label, text, placeholder, or test-id locators.
4. Perform the smallest safe action and verify the resulting state.
5. Use DOM-CUA when semantic locators are insufficient and coordinate CUA only as a last resort.
6. Finalize temporary Tabs when the task is complete. Leave user-owned Tabs open unless the user requests otherwise.

```js
globalThis.browser ??= await agent.browsers.getDefault()
globalThis.tab ??= await browser.tabs.new({ url: "https://example.com" })
await tab.playwright.getByRole("link", { name: "More information" }).click()
await tab.screenshot()
```

Do not request or invent a session ID. The tool binds workspace, session, message, turn, agent, and backend identity from its hidden execution context.

Never bypass an approval by switching between Locator, DOM-CUA, coordinate CUA, raw CDP, or evaluation. Ask the user to take over for authentication, CAPTCHA, payment confirmation, or other sensitive handoff states.

Read [references/api.md](references/api.md) when an operation needs an API not shown above.
