---
title: Telegram 消息渠道
---

# Telegram 消息渠道

Telegram 渠道由本机 Electron 进程通过 Bot API 长轮询接收消息，再把 Agent 回复发送到原私聊或群组。

产品入口：**消息渠道 → Telegram**。

## 1. 准备 Bot

1. 在 Telegram 中通过官方 BotFather 创建测试 Bot。
2. 保存 Bot Token，不要把它放入聊天记录、截图或代码仓库。
3. 如需群聊，把 Bot 加入测试群；根据用途调整隐私模式和群权限。
4. 确认当前网络可访问 Telegram Bot API。

## 2. 配置和启动

1. 在 Telegram 渠道填写账号标识和 Bot Token。
2. 如页面提供允许用户列表，先只加入测试账号。
3. 选择工作区、Agent、审批模式和允许目录。
4. 保存并启动；页面的处理/发送计数用于排障，但不是 E2E 结论。

## 3. 私聊、群聊与授权

- 私聊最适合首次验证，目标身份最清楚。
- 群聊可能受 Bot 隐私模式影响；必要时 mention Bot 或发送命令。
- 陌生 sender 应先进入配对或被允许列表拦截。
- 不要把公开群配置成完全访问或自动批准。

## 4. 真实闭环验收

从测试 Telegram 账号发送唯一消息，确认 Bot API 真实入站、OnMyAgent 选择正确 Agent、真实执行完成、Bot API 发送成功，并在同一 chat 中看到回复。

仅调用本地模拟、伪造 Update、读取旧聊天历史或看到 polling 正常，都不能替代此闭环。

## 5. 排障

| 现象 | 检查 |
|------|------|
| 启动失败 | Token 是否有效、网络/代理是否能访问 Bot API |
| 私聊有回复、群聊没有 | 隐私模式、Bot 群权限、mention、允许用户 |
| 重复处理 | 是否有另一实例使用同一 Token 拉取 Updates |
| 任务卡住 | Agent 登录/模型、审批和 active run 状态 |

## 6. 相关

- [消息渠道总览](./channels) · [Agent 对话](./agent-chat) · [安全与数据](../security)
