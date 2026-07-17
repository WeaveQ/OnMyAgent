# Browser API

## Discovery

```js
await agent.browsers.list()
await agent.browsers.get("in-app")
await agent.browsers.getDefault()
await agent.browsers.getForUrl("https://example.com")
```

## Browser

```js
await browser.tabs.new({ url, temporary, deliverable, handoff })
await browser.tabs.list()
await browser.tabs.get(tabId)
await browser.tabs.selected()
await browser.tabs.finalize([tab])
await browser.tabs.content(tabId)
await browser.user.openTabs()
await browser.user.claimTab(tabId)
await browser.user.history()
await browser.documentation(topic)
await browser.nameSession(name)
```

## Tab lifecycle

```js
await tab.goto(url)
await tab.back()
await tab.forward()
await tab.reload()
await tab.close()
await tab.screenshot({ format: "png" })
```

`tab.evaluate(expression)` is read-only. It rejects mutation, module loading, process access, and live DOM object results.

## Semantic locators

```js
tab.playwright.locator(css)
tab.playwright.getByRole(role, options)
tab.playwright.getByLabel(label, options)
tab.playwright.getByText(text, options)
tab.playwright.getByPlaceholder(text, options)
tab.playwright.getByTestId(testId)
```

Locators support `click`, `fill`, `type`, `press`, `hover`, `check`, `uncheck`, `selectOption`, `textContent`, `count`, `first`, `nth`, and nested `locator`.

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
await tab.clipboard.read()
await tab.clipboard.write(text)
await tab.dev.logs()
nodeRepl.emitImage(dataUrl)
await nodeRepl.import(allowedModuleName)
```
