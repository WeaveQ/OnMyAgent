---
title: Discord 消息渠道
---

# Discord 消息渠道

Discord 渠道通过机器人连接 Discord Gateway，接收私信、服务器频道或话题中的消息，并把 Agent 结果回复到原位置。

产品入口：**消息渠道 → Discord**。

## 1. 准备机器人

1. 在 Discord Developer Portal 创建测试 Application 和 Bot。
2. 按需启用 Gateway intents，尤其是读取消息内容所需的 intent。
3. 用最小权限把 Bot 邀请到测试服务器和测试频道。
4. 保存 Bot Token；Token 一旦出现在公开画面中应立即轮换。

## 2. 配置和启动

1. 在 Discord 渠道填写账号标识和 Bot Token。
2. 配置允许用户，选择工作区、Agent、审批模式和允许目录。
3. 保存并启动，等待 Gateway 状态稳定。
4. 不要因为 Gateway 已连接就跳过真实频道测试。

## 3. 私信、服务器频道和话题

- 私信适合验证一对一授权。
- 服务器频道需要 Bot 具备查看频道、读取历史和发送消息权限。
- 话题或 Thread 需要额外确认 Bot 可见且能在该 Thread 回复。
- 公共频道应要求明确 mention 或使用专门测试频道，避免所有对话都触发 Agent。

## 4. 真实闭环验收

从真实 Discord 测试账号在目标频道发送唯一消息，确认 Gateway 入站事件、OnMyAgent 分发、Agent 真实执行、Discord REST 发送，以及目标频道收到回复。

Gateway `ready`、心跳正常、模拟 event 或本地发送函数成功都不是完整 E2E。

## 5. 排障

| 现象 | 检查 |
|------|------|
| Gateway 连接后无消息 | Message Content intent、频道可见性、Bot 是否在服务器中 |
| 能看不能回 | Send Messages / Send Messages in Threads 权限 |
| 私信失败 | 用户是否允许服务器成员私信、Bot 应用范围 |
| 多次回复 | 是否有重复运行的 Bot 实例或事件重放 |
| Agent 没有执行 | 允许用户、工作区/Agent 绑定、模型与审批状态 |

## 6. 相关

- [消息渠道总览](./channels) · [审批与权限](./approvals) · [安全与数据](../security)
