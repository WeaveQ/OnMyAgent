---
title: FAQ
---

# 常见问题

### OnMyAgent 是什么？

本地优先的办公 Agent 工作台：派活、执行、交付文件，而不是只聊天。

### 必须登录或上云吗？

**不必。** 默认本机可用；连接 [OnMyCompany](./platform/onmycompany) 是可选项。

### 和飞书 / 钉钉机器人是什么关系？

IM 数字员工属于 **OnMyBuddy**；本机工作台是 **OnMyAgent**。见 [平台三分](./platform/)。

### 支持哪些模型？

BYOK：兼容 API、本机模型（如 Ollama）等。在 [设置 → 模型](./guide/models) 中连接服务商。设置里保存后，首页会话即可选用，顺序与设置一致。

### 第一次打开设置，模型列表一直转圈？

当前预览包装有模型货架快照，一般很快能列出。若仍很久，检查网络后重启，或见 [模型排障](./guide/models#models-troubleshooting)。

### 专家发表格或 PDF 失败？

可以附在对话里发。正文太长请拆开；文件太大请换更小的再发，见 [专家](./guide/experts)。

### 设置在哪里？

左下角齿轮 → **设置**，或 **⌘ ,** / **Ctrl ,**。完整分区说明见 [设置](./guide/settings)。

### Windows 能用吗？

有开发者预览路径；主支持 macOS。见 [Windows](./install/windows)。

### 文件会不会被改坏？

默认在工作区内操作；导入为工作区副本。重要文件请自行版本备份。详见 [文件](./guide/files) 与 [安全](./security)。

### 专家和技能有什么区别？

**专家**偏角色与方法论；**技能**偏可执行能力包。都可在市场安装。见 [专家](./guide/experts) · [技能](./guide/skills)。

### 如何配置个人偏好与记忆？

设置 → **资料**（个人分组）。见 [记忆与资料](./guide/memory)。

### 如何下载？

见 [下载与安装](./download)。

### 如何更新？

设置 → **更新** → **检查更新**（冷启动也会自动查一次）。已经是最新会明确提示。发现新版本后**点提示或「下载更新」**才会下载；打包版下完再点 **重启并安装**。开发构建请从 [GitHub Releases](https://github.com/WeaveQ/OnMyAgent/releases) 安装。macOS 若提示应用已损坏，执行 `xattr -cr /Applications/OnMyAgent.app` 后再打开。
