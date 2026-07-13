---
name: browser-use
description: Use when the user asks an assistant, coding agent, or expert to open websites, inspect pages, click, type, upload, download, capture screenshots, extract web data, or otherwise automate the browser.
allowed-tools: Bash(browser-use:*)
display_name_zh: "浏览器自动化"
display_name_en: "Browser Use"
description_zh: "通过 OnMyAgent 内置浏览器完成网页导航、交互、截图和数据提取"
description_en: "Automate navigation, interaction, screenshots, and extraction in the OnMyAgent embedded browser"
---

# Browser Use

For autonomous multi-step browser work, prefer the **Browser Use Agent** expert
from the expert marketplace. It runs the upstream `browser_use.Agent`, inherits
the model selected in the desktop session, shows progress and approvals in the
conversation, and keeps its embedded tabs owner-scoped.

The managed `browser-use` command remains the deterministic compatibility layer
for Assistant/Code sessions and expert packages that need direct scripted page
inspection. OnMyAgent provides Python, Browser Use, the signed-in embedded
browser, CDP, and per-conversation tab isolation; users do not install these
dependencies separately.

## Routing

- Use the Browser Use Agent expert for open-ended goals that require repeated
  observe → plan → act → verify cycles.
- Use the managed CLI below for a small, explicit sequence where the calling
  assistant owns each browser action.
- Never invoke the CLI from inside the Browser Use Agent expert; its dedicated
  runtime already owns the upstream Agent lifecycle.

## Hard rules

- Do not install Browser Use, Python, Chrome, Playwright, or browser drivers.
- Do not run `connect`, `setup`, profile, cloud, or raw CDP target-creation
  commands.
- Never select or automate the OnMyAgent application renderer.
- Create and close tabs only with the managed helpers below.
- Stop for passwords, MFA, CAPTCHA, consent, or ambiguous account selection.
- Verify every interaction from fresh browser state or a screenshot.

## Workflow

Run Python through the CLI:

```sh
browser-use <<'PY'
ensure_real_tab()
print(page_info())
print(capture_screenshot())
PY
```

Open a managed embedded tab:

```sh
browser-use <<'PY'
new_tab("https://example.com")
wait_for_load()
print(page_info())
PY
```

Inspect first, then interact and verify:

```sh
browser-use <<'PY'
ensure_real_tab()
print(page_info())
print(capture_screenshot())
# Use js(...) for reliable DOM inspection or extraction.
# Use click_at_xy(...), fill_input(...), type_text(...), or press_key(...)
# only after identifying the current control.
print(page_info())
PY
```

## Managed tabs

- `list_onmyagent_tabs()`: list only tabs owned by this conversation.
- `new_tab(url)`: create a visible tab in OnMyAgent's browser panel.
- `switch_onmyagent_tab(tab_id)`: select an owned tab.
- `ensure_real_tab()`: reject the app renderer and select an owned tab.
- `close_tab()`: close the current owned tab.
- `list_tabs()`: diagnostic only; it may include the app renderer and
  DevTools, so never choose targets from it for normal work.

Browser login state is shared across OnMyAgent conversations, while tab
ownership and Browser Use daemons are isolated. Keep needed tabs open unless
the user asks to close them or the task is complete.
