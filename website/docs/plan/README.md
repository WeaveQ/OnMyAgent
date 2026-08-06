# Website 开发计划

完整执行计划见本文件所在迭代约定：静态首页 + VitePress `/docs` 同构建。

- 技术：`public/index.html` + VitePress `base: /docs/`
- 构建：`pnpm build` → `dist/`（landing + docs）
- `plan/` 目录 `srcExclude`，不进文档侧栏
