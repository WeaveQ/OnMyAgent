---
name: rebate-contract-checker
description: "This skill should be used when users need to verify rebate contract data across three types of documents - invoice applications (Excel), rebate contracts (PDF), and project execution plans (Excel). It automates the cross-checking of company names, tax IDs, invoice amounts, invoice types, and blogger rebate amounts to generate a verification report. Trigger keywords: 返点核对, 返点协议核对, 开票核对, 博主返点核对, rebate contract check, invoice verification, 对公返点核对."
agent_created: true
---

# Rebate Contract Checker (返点协议核对工具)

## Overview

Automate cross-checking of rebate contract data across three document types: invoice applications, rebate contracts (PDF), and project execution plans. Generate a verification Excel report highlighting mismatches, missing records, and duplicate bloggers.

## When to Use

- When a user provides invoice application Excel files alongside rebate contract PDFs and project plan Excel files
- When checking if invoice details (company name, tax ID, amount, invoice type) match the rebate contract
- When verifying blogger rebate amounts in project plans match the channel service fees in rebate contracts
- When processing batches of 3 to 50+ files of the same workflow

## Workflow

### Step 1: Collect File Paths

Accept three sets of file paths from the user:
1. **Invoice applications** (Excel): Typically named like `开票申请-*.xlsx`
2. **Rebate contracts** (PDF): Typically named like `*返点*.pdf`
3. **Project plans** (Excel): Typically named like `*计划单*.xlsx`

### Step 2: Parse Each Document Type

#### Invoice Application (Excel)
- Read the first sheet
- Extract: project name, company name, invoice title, tax ID, invoice amount, invoice type, invoice content
- Handle merged cells and line breaks in cell values
- **Column mapping**: The script uses common Chinese column names, but supports configurable mapping via `COLUMN_MAP` parameter

#### Rebate Contract (PDF)
- Extract text using `pdfplumber`
- Extract:甲方名称 (company name), 税号 (tax ID), 渠道服务费金额 (total rebate amount), 发票类型 (invoice type), 开票内容 (invoice content)
- Extract blogger tables: 博主名称, 合作金额, 渠道服务费 (the blogger's individual rebate amount)
- Handle multi-page PDFs with embedded tables

#### Project Plan (Excel)
- Read the `推广计划单-立项及结案PM更新` sheet
- Extract the **bottom-right settlement area** (after the "支出小计" / "支出合计" row)
- Each row contains: 日期, 付款方式, 博主名称, 返点金额
- The rebate amount is the key value to cross-check with the contract's "渠道服务费"

### Step 3: Cross-Check Logic

#### 3.1 Invoice vs Contract (协议级别)
- Match by: `发票抬头 == 甲方名称`
- Check: 开票金额 == 协议渠道服务费金额 (within ¥1 tolerance)
- Check: 发票类型 == 协议发票类型
- Check: 税号 == 协议税号
- Check: 开票内容 == 协议开票内容

#### 3.2 Plan vs Contract (博主级别)
- For each blogger in the contract, find the same blogger name in the plan's settlement area
- Check: `返点协议渠道服务费 == 计划单返点金额` (within ¥1 tolerance)
- Mark `N/A` if blogger not found in plan
- Flag **duplicate bloggers** (same name appearing in multiple plans)

### Step 4: Generate Report

Output an Excel file with two sheets:
1. **核对清单**: One row per blogger, with columns for all fields and verification results
2. **核对摘要**: Summary statistics (total records, passed, failed, not found)

**Report columns include:**
- 所属项目, 服务项目名称, 发票抬头, 税号, 开票金额, 发票类型, 开票内容
- 博主名称, 返点协议合作金额, 返点协议渠道服务费
- 对应返点协议, 协议甲方名称, 协议税号, 协议金额, 协议发票类型, 协议开票内容
- 金额是否一致, 发票类型是否一致, 税号是否一致, 开票内容是否一致
- 计划单返点金额, 计划单来源文件, 计划单付款方式, 计划单日期
- 博主金额是否一致, 重复博主标记, 核对结果

### Step 5: Handle Edge Cases

- **No matching contract**: Mark as "⚠️ 未找到对应返点协议"
- **Blogger not in plan**: Mark as "❌ 计划单中未找到该博主"
- **Amount mismatch**: Show difference value (e.g., "否（差异-820.0）")
- **Duplicate blogger**: Flag with "⚠️ 出现在N个计划单中" and list all plan files + amounts
- **Merged cells / Line breaks**: Clean up newlines and extra text in company names and tax IDs

## Column Mapping Configuration

Different companies may use different column names in their Excel templates. The script supports a configurable mapping. The default mapping assumes standard names:

```python
DEFAULT_COLUMN_MAP = {
    'invoice': {
        '店铺名称（必填）': '项目',
        '服务项目名称（必填）': '服务项目名称',
        '发票抬头': '发票抬头',
        '税号': '税号',
        '开票金额': '开票金额',
        '发票类型': '发票类型',
        '开票内容': '开票内容',
        '地址电话': '地址电话',
        '开户行及账号': '开户行及账号',
    }
}
```

If the user's Excel uses different column names, read the first row and map them accordingly before running the script.

## Dependencies

This skill requires the following Python packages (installed in the isolated Python environment):
- `pandas` - Excel reading/writing
- `openpyxl` - Excel engine for .xlsx files
- `pdfplumber` - PDF text and table extraction

Install via:
```bash
pip install pandas openpyxl pdfplumber
```

## Scripts

### `scripts/check_rebate_contracts.py`

The main reconciliation script. Accepts file paths or folder paths as arguments and outputs the verification Excel.

**Usage:**
```python
from check_rebate_contracts import RebateContractChecker

checker = RebateContractChecker()
results = checker.check(
    invoice_files=['/path/to/invoice1.xlsx'],
    contract_files=['/path/to/contract1.pdf'],
    plan_files=['/path/to/plan1.xlsx']
)
checker.save_results(results, '/path/to/output.xlsx')
```

Or via command line:
```bash
python check_rebate_contracts.py \
  --invoice-folder /path/to/invoices/ \
  --contract-folder /path/to/contracts/ \
  --plan-folder /path/to/plans/ \
  --output /path/to/output.xlsx
```

## Batch Processing Mode

For 50+ files, organize them into three folders and run the batch mode:

```python
checker = RebateContractChecker()
results = checker.batch_check(
    invoice_folder='/path/to/invoices/',
    contract_folder='/path/to/contracts/',
    plan_folder='/path/to/plans/'
)
checker.save_results(results, '/path/to/output.xlsx')
```

## Important Notes

1. **File naming**: The script does NOT rely on file names for matching. It uses content-based matching (发票抬头 ↔ 甲方名称, 博主名称 ↔ 博主名称). This means files can be named arbitrarily.

2. **Sheet name**: The project plan script specifically looks for the sheet named `推广计划单-立项及结案PM更新`. If the user's sheet name is different, read the sheet name first and pass it to the parser.

3. **Tolerance**: Amount comparisons use a tolerance of ¥1 to handle floating point rounding differences.

4. **Duplicate blogger handling**: When a blogger appears in multiple plans, the script:
   - Matches the first found plan by default
   - Flags the row with a warning message listing all plans and amounts
   - The user should manually verify which plan amount is correct

5. **Special characters**: Blogger names may contain emoji (e.g., "elvis🧢") or special punctuation. The script preserves these exactly as written.

6. **Merged cells**: If the Excel has merged cells (e.g., project name spanning multiple rows), the first non-empty value is used for all rows in the group.
