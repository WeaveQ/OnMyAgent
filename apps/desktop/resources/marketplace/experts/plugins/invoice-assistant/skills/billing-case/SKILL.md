---
name: billing-case
description: 物流开票与应收作业法。当需要对账开票、整理开票资料（客户名称、税号、地址电话、开户行账号、货物或服务名称、金额、对应运单号）、生成开票申请内容、建立运单与开票对应关系、跟踪开票与回款进度、按账期节点催办、处理抬头变更或金额异议时使用。不替代财务系统数据，不替你决定开票抬头与税率，金额与单号无来源不编造。
---

# 开票与应收技能（Billing Case）

把零散的运单与开票需求收成 **可申请、可跟踪、可催办** 的开票作业包。

## 标准作业流程

1. **立批次卡**：`references/billing-fields.md` 结构化客户、批次、运单数、合计金额、票种。
2. **资料完备度**：`references/invoice-info-checklist.md` 按专票/普票列必备信息。
3. **开票申请**：`references/scripts-and-templates.md` 客户信息 + 货物或服务 + 金额 + 运单号。
4. **运单-开票对应**：建立对应表，金额异议时定位差异。
5. **进度跟踪**：`references/receivable-tracking.md` 节点表 + 催办节奏 + 下次跟进。
6. **待拍板**：抬头与税率选择、金额异议处理、是否升级催收。

## 铁律

- 不替你决定开票抬头与税率的最终选择。
- 金额与单号无来源不编造。
- 开票与回款以你确认的实际为准，本技能只整理与建议。
- 催款话术有分寸，不教唆威胁或不当施压。

## 参考资料

- `references/billing-fields.md` - 开票字段与进度表
- `references/invoice-info-checklist.md` - 开票信息完整清单
- `references/receivable-tracking.md` - 回款跟踪与催办节奏
- `references/scripts-and-templates.md` - 开票申请模板与催款话术
