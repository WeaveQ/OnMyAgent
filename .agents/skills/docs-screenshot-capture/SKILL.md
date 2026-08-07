---
name: docs-screenshot-capture
description: >
  Capture and wire OnMyAgent product screenshots for the VitePress handbook
  (website/docs). Use when retaking module shots, adding light/dark dual-theme
  assets, fixing stacked light+dark images, or embedding captures under
  /images/ with captions.
display_name_zh: "手册截图采集"
display_name_en: "Docs Screenshot Capture"
user-invocable: true
---

# Docs Screenshot Capture

## Goal

Produce clean product UI captures for `website/docs`, store them under the dual-theme layout, and embed them so **light handbook shows light app UI** and **dark handbook shows dark app UI**—one image at a time.

## When to use

| Use this skill | Use something else |
| --- | --- |
| 「某某模块要截图」「文件重新截图」 | `product-handbook-write` — 写文案/侧栏 |
| 浅色/深色双套资源、叠两张图 bug | `ui-regression-audit` — 应用内 UI 回归（非 handbook） |
| 挂图 + caption | `documentation-audit` — 工程文档巡检 |

## Asset layout

```text
website/docs/public/images/
  foo.png              ← root fallback (prefer dark or latest light)
  light/foo.png        ← light app UI
  dark/foo.png         ← dark app UI
```

Markdown:

```markdown
![说明](/images/foo.png)
<p class="oma-shot-caption">一句话说明</p>
```

Runtime switch: `website/docs/.vitepress/theme/theme-shots.js` wraps imgs into `.oma-theme-shot` with `oma-shot-light` / `oma-shot-dark`.

## Capture workflow

### 1. Preflight

```sh
git status --short --branch
# App running? Prefer desktop dev Electron + UI control discovery file
test -f "$HOME/Library/Application Support/com.differentai.onmyagent.dev/onmyagent-ui-control.json" && echo ui-control-ok
```

Find window id (macOS):

```sh
# CGWindow list filtered to OnMyAgent - Dev; note window number for screencapture -l
```

### 2. Navigate

| Surface | How |
| --- | --- |
| Home / settings routes | UI control `POST /execute` with `route.*` actions when available |
| Agent 对话 / Agent 管理 | Account menu (bottom rail) or in-page **管理 Agent** |
| Main rail | Click 首页 / 专家 / 自动 / 文件 / 市场 |

Prefer product navigation over inventing empty states.

### 3. Theme

- Capture **light** first (偏好 → 主题 → 浅色, or account 外观 chips).  
- Then **dark** (主题 → 深色).  
- Verify mean luminance roughly: light ≫ 0.5, dark ≪ 0.45 (rough ImageMagick `%[fx:mean]`).

### 4. Capture + process

```sh
screencapture -l <WINDOW_ID> -o /tmp/oma-raw.png
magick /tmp/oma-raw.png -resize 1600x -quality 92 \
  website/docs/public/images/light/<name>.png
# after switching app to dark:
magick /tmp/oma-raw-dark.png -resize 1600x -quality 92 \
  website/docs/public/images/dark/<name>.png
# root fallback
cp website/docs/public/images/dark/<name>.png \
   website/docs/public/images/<name>.png
```

Keep full window chrome (traffic lights) unless user asks to crop.

### 5. Embed

Update the guide page with image + caption. Do not leave broken paths.

### 6. Validate dual-theme CSS

**Regression:** light handbook shows **both** light and dark stacked.

Cause: global rule `.vp-doc img[src*="/images/"] { display: block }` beats `.oma-theme-shot > img { display: none }`.

Required CSS contract (`custom.css`):

```css
.vp-doc img[src*="/images/"]:not([data-oma-shot-theme]) { display: block; … }

.oma-theme-shot > img { display: none !important; }
.oma-theme-shot > img.oma-shot-light { display: block !important; }
.dark .oma-theme-shot > img.oma-shot-light { display: none !important; }
.dark .oma-theme-shot > img.oma-shot-dark { display: block !important; }
```

### 7. Build

```sh
cd website && pnpm build
```

## Naming conventions

| Module | Suggested file |
| --- | --- |
| 首页会话 | `home-session.png` |
| 文件 | `files-list.png` |
| 市场·专家 | `marketplace.png` |
| Agent 对话 | `agent-chat.png` |
| Agent 管理 | `agent-management.png` |
| 设置总览 | `settings-page.png` |

Reuse existing names when replacing shots so markdown links stay stable.

## Hard rules

| Rule | Detail |
| --- | --- |
| No captcha / OS overlay | Wait for clean UI; no verification widgets |
| No customer secrets | Paths, tenant names, private chat—prefer generic workspace |
| One theme per pixel | Never ship stacked dual images |
| Don’t spam Pages | One deploy after batch; concurrency + long deploy-pages timeout already in workflow |
| Temp files | Prefer `/tmp` or `.loop/evidence/`; do not commit raw dumps |

## Boundary map

| Skill | Boundary |
| --- | --- |
| **This skill** | Capture + asset paths + dual-theme wiring |
| `product-handbook-write` | Copy, sidebar, structure |
| `ui-regression-audit` | In-app visual QA (not handbook public images) |

## Report format

- Window / theme captured  
- Files written (`light/`, `dark/`, root)  
- Guide pages updated  
- Dual-theme check (pass/fail)  
- Dark deferred? (yes/no + reason)

## References

- `references/asset-layout.md` — paths and CSS checklist  
- `references/capture-checklist.md` — per-surface tips  
