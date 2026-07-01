---
name: qqbrowser-skill
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, or automating any browser task.
version: 0.9.0
homepage: https://browser.qq.com/
source: https://pypi.org/project/qqbrowser-skill/
permissions:
  - network: Required for browser navigation and web page interaction
  - filesystem: Required for downloading files and saving screenshots to temporary directories
display_name: "QQ浏览器自动化"
display_name_en: "QQ Browser Automation"
description_zh: "QQBrowserUse 是一个面向 AI 代理的浏览器自动化技能工具。它允许 AI 通过命令行操控 QQ 浏览器，完成各种网页交互任务，包括页面导航、表单填写、按钮点击、截图、数据提取和文件下载等。"
description_en: "QQBrowserUse is a browser automation skill for AI agents. It lets AI drive QQ Browser via command line to perform web interactions including page navigation, form filling, button clicks, screenshots, data extraction, and file downloads."
visibility: "public"
---

# QQBrowserUse

## Platform Support

- **Linux x86_64**: Supported
- **Windows**: Supported
- **macOS**: Supported
- Other Linux architectures (ARM, etc.) are not supported.

## Installation

**Linux:**
```bash
pipx install qqbrowser-skill
qqbrowser-skill install   # Download and install QQ Browser
```

**Windows:**
```bash
pip install qqbrowser-skill
qqbrowser-skill install   # Download and install QQ Browser
```

**macOS:**
```bash
pipx install qqbrowser-skill
qqbrowser-skill install   # Download and install QQ Browser
```

## Security

### Permissions

This skill requires the following permissions to function properly:

| Permission | Scope | Purpose |
|------------|-------|--------|
| **Network Access** | Outbound HTTP/HTTPS | Required for browser navigation, page loading, and web interaction |
| **File System (Read/Write)** | Temporary directories only | Required for saving screenshots (`.webp`) and downloaded files |

### QQBrowser Binary

The `qqbrowser-skill install` command downloads the QQ Browser package from official Tencent distribution channels via HTTPS:

- **Base URL**: `https://dldir1v6.qq.com/invc/tt/QB/Public/`
- `dldir1v6.qq.com` is Tencent's official software distribution CDN.
- All downloads are performed over **HTTPS** to ensure transport-level security.

### File Storage

- **Screenshots**: Saved to the system's temporary directory (e.g., `/tmp/` on Linux) and returned as file paths.
- **Downloaded files**: Saved to the system's temporary directory or user-specified path via `browser_download_file` / `browser_download_url`.
- This skill does **not** access or modify files outside of its designated directories.

## Note:
Each command will return a snapshot of the current page after execution, including the index of elements.
Please call the standalone qqbrowser-skill browser_snapshot command only when necessary to avoid unnecessary token consumption.

## Core Workflow

Every browser automation follows this pattern:

1. **Navigate**: `qqbrowser-skill browser_go_to_url --url <url>`
2. **Snapshot**: `qqbrowser-skill browser_snapshot` (get indexed element refs)
3. **Interact**: Use element index to click, fill, select
4. **Re-snapshot**: After navigation or DOM changes, get fresh refs

```bash
qqbrowser-skill browser_go_to_url --url https://example.com/form
qqbrowser-skill browser_snapshot
# Output includes element indices: [1] input "email", [2] input "password", [3] button "Submit"

qqbrowser-skill browser_input_text --index 1 --text "user@example.com"
qqbrowser-skill browser_input_text --index 2 --text "password123"
qqbrowser-skill browser_click_element --index 3
qqbrowser-skill browser_wait --seconds 2
qqbrowser-skill browser_snapshot  # Check result
```

## Essential Commands

```bash
# Navigation
qqbrowser-skill browser_go_to_url --url <url>       # Navigate to URL
qqbrowser-skill browser_go_back                      # Go back
qqbrowser-skill browser_wait --seconds 3             # Wait for page load (default 3s)

# Snapshot & Screenshot
qqbrowser-skill browser_snapshot                     # Default mode: page content with element indices (for interaction)
qqbrowser-skill browser_snapshot --markdown          # Markdown mode: clean Markdown of the page (for reading/extraction, no indices)
qqbrowser-skill browser_screenshot                   # Take screenshot (returns temp file path of .webp image)
qqbrowser-skill browser_screenshot --full            # Full-page screenshot (returns temp file path)
qqbrowser-skill browser_screenshot --annotate        # Annotated screenshot with element labels (returns temp file path)

# Click & Input (use indices from snapshot)
qqbrowser-skill browser_click_element --index 1      # Click element
qqbrowser-skill browser_dblclick_element --index 1   # Double-click element
qqbrowser-skill browser_focus_element --index 1      # Focus element
qqbrowser-skill browser_input_text --index 1 --text "hello"  # Input text into element

# Scroll
qqbrowser-skill browser_scroll_down                  # Scroll down one page
qqbrowser-skill browser_scroll_down --amount 300     # Scroll down 300px
qqbrowser-skill browser_scroll_up                    # Scroll up one page
qqbrowser-skill browser_scroll_up --amount 300       # Scroll up 300px
qqbrowser-skill browser_scroll_to_text --text "Section 3"    # Scroll to text
qqbrowser-skill browser_scroll_to_top                # Scroll to top
qqbrowser-skill browser_scroll_to_bottom             # Scroll to bottom
qqbrowser-skill browser_scroll_by --direction down --pixels 500              # Scroll page by direction
qqbrowser-skill browser_scroll_by --direction right --pixels 200 --index 3   # Scroll element by direction
qqbrowser-skill browser_scroll_into_view --index 5   # Scroll element into view

# Keyboard
qqbrowser-skill browser_keypress --key Enter         # Press a key
qqbrowser-skill browser_keyboard_op --action type --text "hello"        # Type text
qqbrowser-skill browser_keyboard_op --action inserttext --text "hello"  # Insert text without key events
qqbrowser-skill browser_keydown --key Shift          # Hold down a key
qqbrowser-skill browser_keyup --key Shift            # Release a key

# Dropdown
qqbrowser-skill browser_get_dropdown_options --index 2           # Get dropdown options
qqbrowser-skill browser_select_dropdown_option --index 2 --text "Option A"  # Select option

# Checkbox
qqbrowser-skill browser_check_op --index 4 --value               # Check checkbox
qqbrowser-skill browser_check_op --index 4 --no-value            # Uncheck checkbox

# Get Information
qqbrowser-skill browser_get_info --type text --index 1   # Get element text
qqbrowser-skill browser_get_info --type url              # Get current URL
qqbrowser-skill browser_get_info --type title            # Get page title
qqbrowser-skill browser_get_info --type html --index 1   # Get element HTML
qqbrowser-skill browser_get_info --type value --index 1  # Get element value
qqbrowser-skill browser_get_info --type attr --index 1 --attribute href   # Get attribute
qqbrowser-skill browser_get_info --type count            # Get element count
qqbrowser-skill browser_get_info --type box --index 1    # Get bounding box
qqbrowser-skill browser_get_info --type styles --index 1 # Get computed styles
qqbrowser-skill browser_check_state --state visible --index 1    # Check visibility
qqbrowser-skill browser_check_state --state enabled --index 1    # Check if enabled
qqbrowser-skill browser_check_state --state checked --index 1    # Check if checked

# Find and Act (semantic locators)
qqbrowser-skill browser_find_and_act --by role --value button --action click --name "Submit"
qqbrowser-skill browser_find_and_act --by text --value "Sign In" --action click
qqbrowser-skill browser_find_and_act --by label --value "Email" --action fill --actionValue "user@test.com"
qqbrowser-skill browser_find_and_act --by placeholder --value "Search" --action type --actionValue "query"
qqbrowser-skill browser_find_and_act --by testid --value "submit-btn" --action click

# Download
qqbrowser-skill browser_download_file --index 5      # Download file by clicking element
qqbrowser-skill browser_download_url                 # Download from URL

# Tab Management
qqbrowser-skill browser_tab_open --url <url>         # Open URL in new tab
qqbrowser-skill browser_tab_list                     # List open tabs
qqbrowser-skill browser_tab_switch --tabId 2         # Switch to tab
qqbrowser-skill browser_tab_close --tabId 2          # Close tab

# Dialog
qqbrowser-skill browser_dialog --action accept       # Accept dialog
qqbrowser-skill browser_dialog --action dismiss      # Dismiss dialog
qqbrowser-skill browser_dialog --action accept --text "input text"  # Accept prompt with text

# JavaScript Evaluation
qqbrowser-skill browser_eval_content_js --script "document.title"                    # Evaluate JS and return result
qqbrowser-skill browser_eval_content_js --script "ZG9jdW1lbnQudGl0bGU=" --base64    # Evaluate base64-encoded JS script

# Task Completion
qqbrowser-skill browser_done --success --text "Task completed"      # Mark task as done
qqbrowser-skill browser_done --text "Still in progress"              # Mark task as incomplete

# Help
qqbrowser-skill list                                 # List all available skills
qqbrowser-skill <skill_name> --help                  # Show help for a specific skill

# Skill Check
qqbrowser-skill status                               # Check skill status
```

## Common Patterns

### Form Submission

```bash
qqbrowser-skill browser_go_to_url --url https://example.com/signup
qqbrowser-skill browser_snapshot
qqbrowser-skill browser_input_text --index 1 --text "Jane Doe"
qqbrowser-skill browser_input_text --index 2 --text "jane@example.com"
qqbrowser-skill browser_select_dropdown_option --index 3 --text "California"
qqbrowser-skill browser_check_op --index 4 --value
qqbrowser-skill browser_click_element --index 5
qqbrowser-skill browser_wait --seconds 2
qqbrowser-skill browser_snapshot  # Verify result
```

### Data Extraction

Choose the right `browser_snapshot` mode based on intent:

- **`browser_snapshot --markdown`** — preferred for **reading/summarizing** page content (articles, docs, search results, product pages). Returns clean Markdown with ads/nav/scripts stripped. Token-efficient, but contains **no element indices** — cannot be used to drive clicks or inputs.
- **`browser_snapshot`** (default) — required for **interacting** with the page. Returns indexed elements for use with `browser_click_element`, `browser_input_text`, etc.

```bash
qqbrowser-skill browser_go_to_url --url https://example.com/products
qqbrowser-skill browser_snapshot --markdown                # Read the whole page as clean markdown

# Use default snapshot + get_info when you need to interact or read a specific element
qqbrowser-skill browser_snapshot
qqbrowser-skill browser_get_info --type text --index 5     # Get a specific element's text
```

### Infinite Scroll Pages

```bash
qqbrowser-skill browser_go_to_url --url https://example.com/feed
qqbrowser-skill browser_scroll_to_bottom     # Trigger lazy loading
qqbrowser-skill browser_wait --seconds 2     # Wait for content
qqbrowser-skill browser_snapshot             # Get updated content
```

## Element Index Lifecycle (Important)

Element indices are invalidated when the page changes. Always re-snapshot after:

- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (dropdowns, modals, AJAX)

```bash
qqbrowser-skill browser_click_element --index 5   # May navigate to new page
qqbrowser-skill browser_snapshot                   # MUST re-snapshot
qqbrowser-skill browser_click_element --index 1   # Use new indices
```

## Evaluation Report

See the full skill evaluation report: [QQBrowserSkillReport](https://bak.res.qq.com/nav/qqbrowser_skills/QQBrowserSkillReport.html)