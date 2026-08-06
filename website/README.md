# @onmyagent/website

产品落地页（`public/`）+ 文档站（`docs/` VitePress）。

```bash
pnpm --filter @onmyagent/website dev        # 落地页 + 已构建 docs 静态预览（默认 5198）
pnpm --filter @onmyagent/website dev:docs   # 文档热更新
pnpm --filter @onmyagent/website build      # dist = landing + /docs
pnpm --filter @onmyagent/website check
pnpm --filter @onmyagent/website preview    # 预览 dist
```

## 本地 base

默认 VitePress `base` 为 `/docs/`（`localhost` 直接可开）。

模拟 GitHub 项目 Pages 子路径：

```bash
DOCS_BASE=/OnMyAgent/docs/ pnpm --filter @onmyagent/website build
pnpm --filter @onmyagent/website preview
```

## GitHub Pages 部署

工作流：`.github/workflows/deploy-website.yml`

- **只在** `website/**` 或该 workflow 变更、并推到 `main` 时运行（**不跟桌面端/app 打包绑在一起**）
- 也可在 Actions 里手动 **Run workflow**
- 构建时 `DOCS_BASE=/{repo}/docs/`（例如 `/OnMyAgent/docs/`）

### 你需要在 GitHub 上点一次

1. 打开仓库 **Settings → Pages**
2. **Source** 选 **GitHub Actions**
3. 合并含 workflow 的 PR / 推送到 `main`，或手动跑一次 **Deploy website**
4. 部署成功后地址一般为：

   - 落地页：`https://weaveq.github.io/OnMyAgent/`
   - 中文文档：`https://weaveq.github.io/OnMyAgent/docs/`
   - 英文简介：`https://weaveq.github.io/OnMyAgent/docs/en/`

（org/repo 名若不同，把路径里的 `OnMyAgent` 换成实际仓库名。）

内部计划：`docs/plan/README.md`（不进入文档侧栏）。
