---
title: 下载与安装
---

# 下载与安装

## 获取安装包

请从官方发布渠道获取当前版本：

- **GitHub Releases**：<https://github.com/WeaveQ/OnMyAgent/releases>  
- 本地从源码打包：见 monorepo 根目录 `BUILD.md`  

> 站点不内嵌易过期的直链；请以 Release 页资产名为准。

## 系统要求

| 平台 | 状态 | 说明 |
|------|------|------|
| macOS (Apple Silicon / Intel) | **主支持** | 日常 dogfood 与发布目标 |
| Windows | **开发者预览** | 详见 monorepo `docs/windows-compat.md` |
| Linux | 暂不支持 | — |

## macOS

1. 下载 `.dmg` 或指定架构安装包  
2. 拖入「应用程序」或按安装器完成  
3. 首次打开若遇安全提示，在「系统设置 → 隐私与安全性」中允许  
4. 启动后进入 [快速开始](./quickstart)  

更多：[macOS 安装](./install/macos)

## Windows

1. 使用 NSIS 安装包（若 Release 提供）或本地 `package:electron`  
2. 安装后从开始菜单启动  
3. 未签名时可能出现 SmartScreen 提示  

更多：[Windows 安装](./install/windows)

## 权限说明

按功能可能需要系统授权：

| 能力 | 可能涉及的权限 |
|------|----------------|
| 工作区读写 | 文件与文件夹访问 |
| 通知 | 通知权限 |
| Computer Use / 截图 | 辅助功能、屏幕录制（macOS 等） |

## 安装后检查

- [ ] 能打开首页并看到 **+ 新建任务**  
- [ ] 设置中能配置模型  
- [ ] 文件页能列出工作区内容  

若失败，见 [排障](./install/troubleshooting)。
