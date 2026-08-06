---
title: MCP / 连接
---

# MCP 与连接器

通过 **MCP（Model Context Protocol）** 与 **连接器** 把外部工具、数据源接到 Agent。

## 在哪里配置

- **市场 → 连接器**  
- 设置中的 MCP / 连接相关页（以当前版本为准）  

![市场入口（含连接器 Tab）](/images/marketplace.png)

## 原则

| 原则 | 说明 |
|------|------|
| 最小权限 | 只开任务需要的连接 |
| 密钥不进聊天 | API Key 走配置，不贴在对话里 |
| 可撤销 | 不用的连接及时关闭 |

## 与公司模式

若连接 [OnMyCompany](../platform/onmycompany)，部分外发可能需走组织 Gateway（按策略）。未连接公司时，以本机配置为准。

## 相关

- [技能](./skills) · [安全与数据](../security)
