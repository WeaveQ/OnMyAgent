---
name: rebate-contract-generator
description: Use when 达人合作完成后需要根据对公返点信息 Excel 和业务批准的 DOCX 模板批量生成返点合同、检查主体与开票字段，或整理缺失和冲突信息。
---

# 返点合同批量生成

## 输入

- 对公返点信息 Excel；
- 业务方审核通过的 DOCX 合同模板，使用 `{{field_key}}` 占位符；
- 可选列名映射 JSON。

标准字段：`project_name`、`counterparty_name`、`unified_social_credit_code`、`bank_account`、`bank_name`、`registered_address`、`phone`、`contact_name`、`contact_phone`、`signing_method`、`invoice_content`、`invoice_type`、`rebate_amount`、`cooperation_period`、`payment_method`。

## 处理

1. 先检查模板和输入表，不使用未批准模板。
2. 每行独立校验；主体、税号、账户、开户行、发票内容/类型、返点金额、合作周期缺失时不生成该行合同。
3. 用 `scripts/generate_rebate_contracts.py` 填充占位符，生成后复查未替换占位符。
4. 完整行生成合同；不完整行只进入待处理事项。

命令：

```bash
python3 scripts/generate_rebate_contracts.py --input 对公返点信息.xlsx --template 批准模板.docx --output-dir 合同输出 --report 生成报告.xlsx
```

## 输出

- 每个完整数据行一份 DOCX 合同；
- 生成报告：来源行、输出文件、状态、缺失字段、未解析占位符；
- 待处理事项。

## 边界

- 不内置或编造法律合同模板；
- 不接入 e签宝，不签署、不盖章、不提交开票；
- 所有合同和金额必须人工复核。

## 依赖与降级

依赖缺失时给出明确提示，不自动安装或修改系统 Python。需要人工编辑模板时使用 `document-processing`。
