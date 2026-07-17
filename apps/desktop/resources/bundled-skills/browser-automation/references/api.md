# Browser API

Return **serializable** values from `onmyagent_browser_node_repl` (strings, numbers, plain objects). Keep Browser/Tab handles in variables — do not expect `return tab` to print the full live object.

## Discovery

```js
await agent.browsers.list()
await agent.browsers.get("in-app") // aliases: "iab", "browser"
await agent.browsers.getDefault()
await agent.browsers.getForUrl("https://example.com")
```

## Browser

```js
const browser = await agent.browsers.getDefault()
await browser.tabs.new({ url, temporary, deliverable, handoff })
await browser.tabs.list()
await browser.tabs.get(tabId)
await browser.tabs.selected()
await browser.tabs.finalize([tab])
await browser.tabs.content(tabId)
await browser.user.openTabs()
await browser.user.claimTab(tabId)
await browser.user.history()
await browser.documentation()
await browser.documentation("api-use-behavior")
await browser.nameSession(name)
```

## Tab lifecycle

```js
await tab.goto(url)
await tab.back()
await tab.forward()
await tab.reload()
await tab.close()
await tab.url()
await tab.title()
await tab.screenshot() // default: jpeg, maxWidth 960, quality 55
await tab.screenshot({ maxWidth: 800, format: "jpeg", quality: 50 })
await tab.markDeliverable()
await tab.markHandoff()
```

### Screenshots (keep them small, map coords if clicking from the image)

Full-page PNG base64 often exceeds tool/transcript limits ("截图过大被截断"). Defaults are jpeg + maxWidth 960.

```js
const shot = await tab.screenshot({ maxWidth: 800, format: "jpeg", quality: 50 })
// Prefer emitting as an image block instead of dumping base64 text:
nodeRepl.emitImage(shot.image)
return {
  width: shot.width,
  height: shot.height,
  viewportWidth: shot.viewportWidth,
  viewportHeight: shot.viewportHeight,
  scaleX: shot.scaleX,
  scaleY: shot.scaleY,
  bytes: shot.bytes,
}
// If you must click from image coordinates:
// await tab.cua.click({ x: imageX * shot.scaleX, y: imageY * shot.scaleY })
```

Prefer `tab.playwright` / `tab.dom_cua` for clicks (no coordinate mapping). Use screenshots for visual understanding; map with `scaleX`/`scaleY` only when using CUA from the image.

`tab.evaluate(expression)` is read-only. It rejects mutation, module loading, process access, and live DOM object results.

## Fast open (preferred)

When the target URL is known, open it directly — do not wait on a separate load helper first:

```js
globalThis.browser ??= await agent.browsers.getDefault()
globalThis.tab ??= await browser.tabs.new({ url: "https://www.xiaohongshu.com/explore" })
// tab is usable even if navigation is still finishing; poll with:
await tab.playwright.waitForLoadState({ timeoutMs: 30_000 })
// or:
await tab.playwright.waitForURL("xiaohongshu.com", { timeoutMs: 30_000 })
return { id: tab.id, url: await tab.url(), title: await tab.title() }
```

## Playwright waits

```js
await tab.playwright.waitForTimeout(500)
await tab.playwright.waitForLoadState({ timeoutMs: 30_000 })
await tab.playwright.waitForURL("partial-or-full-url", { timeoutMs: 30_000 })
await tab.playwright.locator("css").waitFor({ timeoutMs: 10_000 })
```

There is **no** top-level `waitForLoadState` on `tab` — use `tab.playwright.waitForLoadState`.

## Semantic locators

```js
tab.playwright.locator(css)
tab.playwright.getByRole(role, options)
tab.playwright.getByLabel(label, options)
tab.playwright.getByText(text, options)
tab.playwright.getByPlaceholder(text, options)
tab.playwright.getByTestId(testId)
tab.playwright.frameLocator(frameSelector)
```

Locators support `click`, `fill`, `type`, `press`, `hover`, `check`, `uncheck`, `setChecked`, `selectOption`, `textContent`, `innerText`, `count`, `isVisible`, `isEnabled`, `waitFor`, `all`, `first`, `last`, `nth`, and nested `locator` / `getBy*`.

## DOM-CUA and coordinate CUA

```js
const observation = await tab.dom_cua.observe()
await tab.dom_cua.click(observation.nodes[0].ref)
await tab.dom_cua.type(ref, "value")
await tab.dom_cua.scroll(ref, 500)

await tab.cua.click({ x, y })
await tab.cua.doubleClick({ x, y })
await tab.cua.drag({ from, to })
await tab.cua.scroll({ x, y, deltaY })
await tab.cua.type("value")
await tab.cua.keypress("ENTER")
await tab.cua.move({ x, y })
```

DOM refs become stale after navigation or a new observation. Observe again instead of retrying a stale ref.

## Page services

```js
await tab.dialog.accept(promptText)
await tab.dialog.dismiss()
await tab.clipboard.readText()
await tab.clipboard.writeText(text)
await tab.dev.logs()
nodeRepl.emitImage(dataUrl)
await nodeRepl.import(allowedModuleName)
```
