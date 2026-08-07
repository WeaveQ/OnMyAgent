# Handbook screenshot assets

## Paths

| Path | Role |
| --- | --- |
| `website/docs/public/images/<name>.png` | Fallback / no-JS / crawlers |
| `website/docs/public/images/light/<name>.png` | Light app chrome |
| `website/docs/public/images/dark/<name>.png` | Dark app chrome |

Markdown always references `/images/<name>.png` (VitePress base applied automatically).

## Runtime

| File | Role |
| --- | --- |
| `website/docs/.vitepress/theme/theme-shots.js` | Inject dual `<img class="oma-shot-light|dark">` |
| `website/docs/.vitepress/theme/image-zoom.js` | Zoom uses **visible** theme src |
| `website/docs/.vitepress/theme/custom.css` | Visibility + caption + outline |

## CSS checklist (stacked dual-image bug)

- [ ] Global image rule excludes `[data-oma-shot-theme]`  
- [ ] `.oma-theme-shot > img` hide uses `!important`  
- [ ] Light mode shows only `.oma-shot-light`  
- [ ] Dark mode shows only `.oma-shot-dark`  

## Process defaults

- Width: resize to **1600** px wide (height proportional).  
- Format: PNG.  
- Caption: `<p class="oma-shot-caption">…</p>` immediately under the image block.
