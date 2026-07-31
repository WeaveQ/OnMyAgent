# 设置页优化 — 已落地摘要

| 字段 | 值 |
|------|-----|
| 状态 | **已落地**（历史需求收集稿已收束） |
| 创建 | 2026-07-30 |
| 落地 | 2026-07-30 起 · `feat(settings): system options, shortcuts, app snapshot, width, Win perms` 等 |
| 权威 | 产品行为以代码为准；本文件只保留范围与入口指针，不再作实现 backlog |

---

## 已交付范围

| # | 能力 | 主要入口 |
|---|------|----------|
| 1 | 系统选项（开机自启 / 保持唤醒 / 通知 / Dock 未读 / 声音） | 设置 · 系统级选项 · `system-prefs-runtime` |
| 2 | 快捷键页（搜索 / 分组 / 录制；**无 QuickPick**） | 设置 · 快捷键 · `keymap-dispatcher` |
| 3 | 应用快照（能力说明 + 权限引导 + 全局键） | 设置 · 应用快照 |
| 4 | 偏好 · 对话宽度（默认固定 max-width / 加宽随主内容区） | 设置 · 偏好 · `content-column` |
| 5 | 系统权限列表补齐（平台过滤） | 设置 · 系统授权 |
| 6 | Windows 专轮：可做真实现；mac 专用项 **隐藏**（不做假 granted） | 桌面 Win 权限矩阵 |

### 明确不做（拍板保留）

- **QuickPick**（全局快速任务窗口）
- **Web 端**设置/快捷键/系统项单独适配（本批仅桌面）
- 系统设置截图中未框选的「任务未读状态 / 全部标为已读」
- v1 **位置服务**权限项

---

## 代码指针（替代长计划表）

| 主题 | 位置 |
|------|------|
| 设置路由 / Tab body | `apps/app/src/react-app/shell/settings-route/` |
| 系统 prefs 运行时 | `apps/app/src/react-app/shell/system-prefs-runtime.tsx` |
| 快捷键分发 | `apps/app/src/react-app/shell/keymap-dispatcher.tsx` |
| 偏好（含对话宽度） | `apps/app/src/react-app/domains/settings/pages/preferences-view.tsx` |
| 内容列宽度 token | `apps/app/src/react-app/capabilities/layout/content-column.ts` |
| i18n | `apps/app/src/i18n/locales/*/settings.ts` |
| 桌面 bridge | `apps/app/src/app/lib/desktop.ts` |

---

## 文档约定

1. **新需求**写本地 `.loop/plans/` 或 issue，不在本文件追加实现 checklist。
2. **Tokens / shell 选择态**以根目录 [`DESIGN.md`](../../DESIGN.md) 与 [`theme-system.md`](./theme-system.md) 为准。
3. 若需恢复完整 2026-07-30 需求收集原文，查 git history：`docs/design/2026-07-30-settings-optimization-plan.md`。
