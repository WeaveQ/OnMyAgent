# @onmyagent/website

产品介绍首页（`public/`）+ 文档站（`docs/` VitePress）。

```bash
pnpm --filter @onmyagent/website dev        # 首页
pnpm --filter @onmyagent/website dev:docs   # 文档
pnpm --filter @onmyagent/website build      # dist = landing + /docs
pnpm --filter @onmyagent/website check
```

内部计划：`docs/plan/README.md`（不进入文档侧栏）。
