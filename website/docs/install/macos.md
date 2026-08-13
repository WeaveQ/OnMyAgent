---
title: macOS 安装
---

# macOS 安装

macOS 为 **主支持** 平台（Apple Silicon / Intel）。

## 步骤

1. 从 [GitHub Releases](https://github.com/WeaveQ/OnMyAgent/releases) 下载 macOS 安装包（`.dmg` 或指定架构包）
2. 打开安装器，将应用拖入「应用程序」
3. 首次打开若被拦截或提示「已损坏」：先执行 `xattr -cr /Applications/OnMyAgent.app`，或到系统设置 → **隐私与安全性** → **仍要打开**
4. 启动后按 [快速开始](../quickstart) 配置工作区与模型

## 可能需要的系统权限

| 能力 | 权限 |
|------|------|
| 工作区读写 | 文件与文件夹访问 |
| 通知 | 通知 |
| 截图 / Computer Use | 屏幕录制、辅助功能 |
| 语音 | 麦克风 |

可在应用 [设置 → 系统设置](../guide/settings#系统设置) 中查看授权状态。

## 相关

- [下载总览](../download) · [排障](./troubleshooting) · [Windows](./windows)
