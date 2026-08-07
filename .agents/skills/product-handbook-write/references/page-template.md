# Guide page template

```markdown
---
title: <模块中文名>
---

# <模块中文名>

<1–2 句：是什么 + 用户何时用。>

产品入口：<主栏 X / 账号菜单 → Y>。

![…](/images/<shot>.png)

<p class="oma-shot-caption"><一句说明画面></p>

## 1. 和「…」有什么区别

| | A | B |
|--|--|--|
| 对象 | | |
| 入口 | | |
| 典型用途 | | |

## 2. 从哪里打开

1. …
2. …

## 3. 界面结构（概念）

| 区域 | 作用 |
|------|------|
| | |

## 4. 能做什么

| 操作 | 说明 |
|------|------|
| | |

## 5. 使用建议

1. …
2. …

## 6. 常见状态 / 注意（可选）

| 状态 | 含义 | 建议 |
|------|------|------|
| | | |

## 7. 相关

- [邻接](./x) · [设置](./settings)
```

## Caption pattern

```html
<p class="oma-shot-caption">首页：最近会话与输入区</p>
```

CSS: `website/docs/.vitepress/theme/custom.css` (`.oma-shot-caption`).

## Image path

Markdown always:

```markdown
![alt](/images/foo.png)
```

Runtime dual-theme: `public/images/light/foo.png` + `public/images/dark/foo.png`  
(see `docs-screenshot-capture`).

## Outline (快速导航)

- Number H2: `## 1. 标题`  
- Nested: `### 子场景` under a numbered section  
- Title string of outline comes from heading text — numbers must be in the body.
