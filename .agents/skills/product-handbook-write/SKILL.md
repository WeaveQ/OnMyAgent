---
name: product-handbook-write
description: >
  Write or extend the OnMyAgent public product handbook under website/docs
  (VitePress). Use when adding feature guides, intro sections, aligning the
  docs sidebar with the app main rail / account menu, numbering headings for
  快速导航, or syncing product copy from i18n into handbook pages.
display_name_zh: "产品手册写作"
display_name_en: "Product Handbook Write"
user-invocable: true
---

# Product Handbook Write

## Goal

Ship accurate, scannable **product handbook** pages under `website/docs/**` that match the live app (menus, labels, module boundaries)—not engineering README/AGENTS audits.

## When to use

| Use this skill | Use something else |
| --- | --- |
| 补/写功能指南、简介、模块说明 | `documentation-audit` — 工程文档一致性 |
| 侧栏排序对齐主栏/账号菜单 | `docs-screenshot-capture` — 只截图挂图 |
| H2 序号、大纲结构、交叉链接 | `ui-regression-audit` — 产品 UI 回归 |

Screenshots for the page → load **`docs-screenshot-capture`** after (or with) this skill.

## Sources of truth (priority)

1. **App navigation order** — `apps/app/src/react-app/domains/session/sidebar/main-rail.tsx` (`TOP_RAIL_ITEMS` / account menu).  
2. **User-visible labels** — `apps/app/src/i18n/locales/zh/nav.ts` and domain locale files (`local_agent.ts`, `agent_manager.ts`, …).  
3. **Domain README / UI** — e.g. `apps/app/src/react-app/domains/local-agents/README.md`.  
4. **Existing guide style** — `website/docs/guide/experts.md`, `sessions.md`, `agent-chat.md`.  
5. **Sidebar config** — `website/docs/.vitepress/config.mjs` (`sidebarZh`).

Do not invent menu labels; copy product wording.

## Fixed sidebar order (功能指南)

Mirror product chrome (see `references/sidebar-order.md`):

```text
界面与工作区
会话                    ← 主栏 首页
专家                    ← 主栏 专家
自动化                  ← 主栏 自动
文件与产物              ← 主栏 文件
技能                    ← 市场 · 技能
MCP / 连接              ← 市场 · 连接器
Agent 对话              ← 账号菜单
Agent 管理              ← 账号菜单
审批与权限 / 模型 / 记忆 / 设置   ← 设置相关
```

When adding a page, insert it in this order—do not park new modules at a random place.

## Page template

New guide under `website/docs/guide/<slug>.md`:

```markdown
---
title: <中文标题>
---

# <标题>

<一句话是什么 + 和相近模块的边界>

![…](/images/<slug-or-shot>.png)   <!-- if capture ready -->

<p class="oma-shot-caption">…</p>

## 1. …

## 2. …

### 可选嵌套（进大纲二级）

## N. 相关

- [邻接页](./x) · …
```

Required content blocks:

| Block | Why |
| --- | --- |
| 与相近模块的区别表 | 会话 vs Agent 对话、市场 vs Agent 管理… |
| 入口 | 主栏 / 账号菜单 / 设置路径 |
| 界面结构 or 能做什么 | 可扫表 |
| 建议 or 注意 | 权限、验收、失败态 |
| 相关 | 交叉链接 |

Heading rules for **快速导航**:

- Number **H2** as `## 1. …` `## 2. …` (Arabic).  
- Use **H3** for nested TOC (e.g. 适用场景下的子场景).  
- Prefer not to invent outline groups without real headings.  
- Outline CSS lives in `website/docs/.vitepress/theme/custom.css` — do not fight it with unnumbered walls of H2.

## Workflow

### 1. Preflight

```sh
git status --short --branch
```

Do not overwrite unrelated dirty work.

### 2. Discover

```sh
# rail order
rg -n "TOP_RAIL_ITEMS|BOTTOM_RAIL_ITEMS|nav\.(assistant|experts|local_agent|management)" \
  apps/app/src/react-app/domains/session/sidebar apps/app/src/i18n/locales/zh -g '*.{ts,tsx}'

# existing guides
ls website/docs/guide/
rg -n "text: \"功能指南\"" -A 25 website/docs/.vitepress/config.mjs
```

### 3. Write

- Create/update `website/docs/guide/<page>.md` (zh handbook is primary).  
- EN skeleton under `website/docs/en/` only if user asked or page already exists.  
- Update `sidebarZh` in `config.mjs` in **menu order**.  
- Cross-link: `overview.md`, `sessions.md`, intro `index.md` reading path when the module is user-facing.

### 4. Screenshots

If the page needs a shot and none exists:

- Invoke **`docs-screenshot-capture`** (or tell the user shots are deferred).  
- Asset: `/images/<name>.png` with light/dark under `public/images/light|dark/`.

### 5. Validate

```sh
cd website && pnpm build
git diff --check
```

Optional: open local docs after `pnpm --filter @onmyagent/website dev:docs`.

### 6. Ship

- Commit only handbook-related paths.  
- Push to `main` only if user asked (triggers Pages on `website/**`).  
- Avoid hammering `workflow_dispatch` for Pages.

## Hard rules

| Rule | Detail |
| --- | --- |
| Menu = IA | Sidebar follows rail + account menu |
| No brand leak | Screenshots/copy without customer-identifying secrets; see screenshot skill |
| No eng-doc mix-up | Do not “fix” AGENTS/BUILD under this skill unless user asked |
| Chinese primary | Full guides in zh; en may stay skeleton |
| Neutral commits | Commit messages describe product docs, not scrubbing history |

## Boundary map

| Skill | Boundary |
| --- | --- |
| **This skill** | Write/structure handbook content + sidebar |
| `docs-screenshot-capture` | Capture + place dual-theme images |
| `documentation-audit` | README/AGENTS/command drift across repo |
| `ui-regression-audit` | App UI visual/i18n regression |

## Report format

- Pages added/updated  
- Sidebar order change (yes/no)  
- Screenshots (done / deferred)  
- Validation commands  
- Remaining gaps (missing modules, en, dark shots)

## References

- `references/sidebar-order.md` — menu ↔ doc map  
- `references/page-template.md` — full template + caption patterns  
