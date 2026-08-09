---
title: 远程运行与沙箱
---

# 远程运行与沙箱

高级用户可以用 OnMyAgent Server 与 Orchestrator 在另一台机器上运行工作区、OpenCode 和路由器，也可以把 Agent 进程放入 Docker 或 Apple container 沙箱。

本页是高级能力说明，不是首次上手必需步骤。

## 1. 组件关系

| 组件 | 作用 |
|------|------|
| OnMyAgent Server | 工作区、文件、会话、审批、自动化、归档和 SSE 的 HTTP API |
| OpenCode | 主会话执行引擎 |
| Orchestrator | 启动并协调 Server、OpenCode、可选消息路由和沙箱 |
| Desktop | 连接本机或远程 Server，提供 UI 和本机能力 |

远程访问只应暴露 OnMyAgent Server；OpenCode 本身使用 basic auth 并监听 loopback，不应直接公开到互联网。

## 2. Token 与权限范围

- client token 用于普通远程访问；
- collaborator、owner、host token 的写入和管理能力更高；
- pairing secret 和原始 token 不应出现在录屏或普通日志；
- Orchestrator 的 JSON 输出可能包含原始配对信息，只有确实需要机器读取时才使用并妥善保护。

远程文件、MCP、审批和管理动作会按 token scope 再检查，不要因为能打开首页就认为拥有全部权限。

## 3. 启动前检查

1. 使用专门的 data directory 和测试 workspace。
2. 确认 OpenCode 版本、模型凭据和端口策略。
3. 运行 health/check 和事件检查。
4. 从客户端以只读方式连接并验证 workspace 身份。
5. 再逐步启用写入、自动化或消息路由。

## 4. 沙箱模式

| 模式 | 行为 |
|------|------|
| `auto` | 尝试选择 Apple container 或 Docker；找不到时可能退化为 `none` |
| `docker` | 使用 Docker 容器和 Linux sidecar |
| `container` | 使用 Apple container；仅适用于支持的 macOS arm64 环境 |
| `none` | Agent 直接在宿主环境运行，不具有容器隔离 |

参数写了 `auto` 不等于已经隔离。每次运行都应检查最终选中的 backend。

## 5. 挂载和环境变量

- 默认只挂载需要的工作区和运行目录。
- 额外挂载会经过敏感路径拒绝或从读写降级为只读。
- 不挂载 Home、SSH、浏览器 Profile、云凭据或系统配置目录。
- 沙箱可能透传用户环境变量和常见模型 API key；把它视为敏感执行环境。

## 6. 远程配对与网络

- 使用 TLS、可信网络或受控隧道保护远程 Server。
- 配对完成后轮换或撤销不再需要的凭据。
- CORS allowlist、authorized roots 和只读模式应与实际部署一致。
- 不把本机开发端口或 Webhook 地址直接当成生产公网入口。

## 7. 排障

| 现象 | 检查 |
|------|------|
| 客户端能连但找不到 workspace | token scope、workspace ID、authorized roots |
| `auto` 没有隔离 | 最终 backend、Docker/Apple container CLI 是否存在 |
| 容器内模型不可用 | 环境变量透传、网络、sidecar 架构与版本 |
| 文件只读 | Server readOnly、collaborator 权限、挂载降级、审批 |
| 事件不更新 | SSE、Server/Archive 状态、网络代理 |

## 8. 相关

- [工作区](./workspaces) · [审批与权限](./approvals) · [安全与数据](../security)
- [平台能力状态](./capability-status)
