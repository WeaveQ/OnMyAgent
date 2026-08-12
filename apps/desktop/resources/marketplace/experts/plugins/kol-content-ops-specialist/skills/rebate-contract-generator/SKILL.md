---
name: rebate-contract-generator
description: Use when 达人合作完成后需要根据对公返点信息表和业务批准的合同模板批量生成返点合同、检查主体与开票字段，或整理缺失和冲突信息。模板形态不限（中英文占位符、用户自定义字段名均可）。
---

# 返点合同批量生成

**目标：不绑定某一种模板格式。** 用户给的 DOCX 模板可能是中文/英文/混排占位符，Excel 列名也可能各异。流程是「发现 → 映射确认 → 填充」，不是「只认内置英文字段」。

## 输入

- 对公返点信息 Excel（或等价表格）
- **业务方审核通过**的 DOCX 合同模板（任意 `{{占位符名}}`，中英文皆可）
- 可选：字段映射 JSON（用户确认后的 `--map`）

禁止：内置/编造法律模板；未批准模板不得使用。

## 工具优先级

1. **首选 OfficeCLI**（已安装 `officecli` 时）
   - 读模板 / 表：`officecli view` / `get` / `query`
   - 单份填充：`officecli merge <模板.docx> <输出.docx> --data <row.json> --force`
   - `merge` 支持任意 `{{key}}`（含中文），并回报 `replacedKeys` / `unresolvedPlaceholders`
2. **回退**：本 skill 的 `scripts/generate_rebate_contracts.py`（与 merge 同一占位符模型，离线/无 officecli 时用）
3. 模板需人工改结构时：`document-processing` / `officecli-docx`；通用映射不够时再写当次辅助脚本

## 处理流程（强制）

### 1. 发现（inspect）

- 从批准模板列出全部 `{{…}}` 占位符（原样保留，不要翻译成英文再要求用户改模板）
- 从 Excel 列出表头 / 可读字段（非常规布局时用 officecli 读合并区，或请用户确认取值位置）
- 产出**建议映射草案** + 缺失/歧义项，**一次列清**

```bash
# 离线回退 inspect
python3 scripts/generate_rebate_contracts.py \
  --inspect --input 对公返点信息.xlsx --template 批准模板.docx
```

### 2. 映射确认

- 将「模板占位符名 → 数据字段/列」写成 `mapping.json`，等人确认后再批量生成
- 不要把用户模板改成内置英文字段名；映射在数据侧完成
- 默认业务必填（可被 map 覆盖）：主体、税号、账号、开户行、发票内容/类型、返点金额、合作周期

`mapping.json` 示例：

```json
{
  "placeholders": {
    "甲方名称": "counterparty_name",
    "统一社会信用代码": "unified_social_credit_code",
    "银行账号": "bank_account",
    "开户行": "bank_name",
    "发票内容": "invoice_content",
    "发票类型": "invoice_type",
    "返点金额": "rebate_amount",
    "合作周期": "cooperation_period"
  },
  "columns": {
    "counterparty_name": ["主体名称", "对公主体", "公司名称"],
    "bank_account": ["银行账号", "账号"]
  },
  "required_fields": [
    "counterparty_name",
    "unified_social_credit_code",
    "bank_account",
    "bank_name",
    "invoice_content",
    "invoice_type",
    "rebate_amount",
    "cooperation_period"
  ]
}
```

### 3. 生成

**OfficeCLI 路径（推荐）：**

```bash
# 每完整行一份 row.json，键 = 模板里的占位符原文
officecli merge 批准模板.docx "合同输出/返点合同_主体_2.docx" --data row.json --force
```

**脚本回退：**

```bash
python3 scripts/generate_rebate_contracts.py \
  --input 对公返点信息.xlsx \
  --template 批准模板.docx \
  --output-dir 合同输出 \
  --report 生成报告.xlsx \
  --map mapping.json
```

规则：

- 每行独立校验；缺必填或字段冲突 → **不生成该行**，只进待办
- 生成后必须复查未替换占位符（officecli 的 `unresolvedPlaceholders` 或报告列）
- 非常规布局（如合并单元格）优先映射 / officecli 读表 / 请用户确认；仍搞不定时可写当次辅助脚本

## 输出

- 每个完整数据行一份 DOCX 合同
- 生成报告：来源行、输出文件、状态、缺失字段、未替换占位符
- 待处理事项清单

## 边界

- 不内置或编造法律合同模板
- 不接入 e签宝，不签署、不盖章、不提交开票
- 所有合同和金额必须人工复核
- **不**假设模板必须是 `{{counterparty_name}}` 英文字段

## 依赖与降级

| 环境 | 行为 |
|------|------|
| 已装 officecli | 优先 `merge` + view/get |
| 无 officecli | `generate_rebate_contracts.py` + openpyxl |
| 依赖缺失 | 明确提示，不自动安装系统 Python 包 |

需要改模板版式时优先 `document-processing` / officecli-docx；仍不够再写当次辅助脚本。
