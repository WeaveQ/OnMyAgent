---
name: rebate-contract-generator
description: Use when 达人合作完成后需要根据对公返点信息表和业务批准的合同模板批量生成返点合同、回写完成日期，或整理缺失字段。模板形态不限；优先 officecli merge，禁止为当次任务手写 docx 填模引擎。
---

# 返点合同批量生成

**目标：** 兼容各种批准模板与表结构，又快又稳地出合同。  
**主路径：** 发现 → 映射 →（可选）行数据整形 → **`officecli merge` 批量** → 台账日期 → 只登记用户要的交付物。

## 硬路由（必须遵守）

| 情况 | 路径 | 禁止 |
|------|------|------|
| 模板有 `{{…}}`，一行一合同，无需扩表行 | **A** officecli 读表 + 拼 JSON + `merge` 循环 | 自写 zip/xml/docx 替换 |
| 自由文本列（如「公司信息」）、金额大写、文件名规则 | **B** `scripts/prepare_rebate_rows.py` **只出 JSON 行** → 再 `merge` | 在数据脚本里写 docx |
| 明细表多博主需复制表行 | **C** 数据脚本标 `table_rows`；用 officecli 改表，或 skill 降级脚本；优先仍 merge 正文 | 完整自研填模引擎 |
| 仅有黄底、无 `{{}}` | 先在会话内改模板插入 `{{}}`，再走 A/B | 按颜色坐标硬填 |

有 officecli 时：**禁止**新建 `generate_contracts.py` / 当次 docx 引擎。无 officecli 时才用 `scripts/generate_rebate_contracts.py` 降级。

## 输入

- 对公返点信息 Excel（序号 ≈ 合同份数）
- 业务方批准的 DOCX（任意 `{{占位符}}`，中英文均可）
- 可选：用户命名规则、完成日期列位置

上传 inbox 默认只读；但用户明确说“回填源文件 / 修改原表 / 写回原文件”时，这就是对**该 Excel 精确路径**的修改授权。仍须同时把可预览的交付副本写在**当前专家会话 cwd**。

## 标准流程

### 1. 发现（一次）

```bash
# 模板占位符
officecli view 批准模板.docx text | head
# 或离线
python3 scripts/generate_rebate_contracts.py --inspect --input 表.xlsx --template 模板.docx
```

记录：全部 `{{…}}`、Excel 表头、是否需拆「公司信息」/多博主。

### 2. 映射

产出 `mapping`（占位符 → 列/字段）。高置信直接跑；低置信**一次**列缺失项。

### 3. 行数据（仅 B/C 需要）

```bash
python3 scripts/prepare_rebate_rows.py \
  --input 对公返点信息.xlsx \
  --out-dir .opencode/tmp \
  --rows rows.jsonl
```

过程文件**只**写到 `.opencode/tmp/` 或 `os.tmpdir()`（与 document-processing 交付分层一致）。  
脚本只出 JSON 行，**不**写 docx，**不**打产物卡。

### 4. 批量 merge（主交付）

```bash
mkdir -p 合同输出
# 对 rows.jsonl 每一行：
officecli merge 批准模板.docx "合同输出/${output_name}.docx" --data row.json --force
```

- `row.json` 的 key = 模板占位符原文（如 `甲方名称`）。
- 文件名按用户规则（如 `【博主-项目-签署-主体】`）；非法字符替换，不要失败整批。

### 5. 完成日期（用户要的 Excel）

先生成并校验**会话内交付副本**。用户明确要求“源文件/原表也回填”时，再用同一份已校验数据原子写回源 Excel；两边都要逐格复核：

```bash
python3 scripts/writeback_completion_date.py \
  --input "$SOURCE_XLSX" \
  --output "对公返点信息_已填写完成日期.xlsx" \
  --date YYYY-MM-DD \
  --completion-column B \
  --source-writeback
```

- `--source-writeback` **只能**在用户明确要求修改源文件/原表时添加；未明确要求就只生成会话副本。
- 源文件只允许使用用户当次提供的精确 Excel 路径，禁止模糊匹配或批量改同目录其他文件。
- 脚本先保存、校验会话副本，再原子替换源文件；任一步失败必须明确报告“源文件未更新”。
- 对会话副本打印 `ONMYAGENT_DELIVERABLE`；源上传路径不另打产物标记，避免把输入文件误当新增产物。

### 6. 产物卡与文件分层（位置规则，不靠文件名黑名单）

| 层级 | 放哪里 | 产物卡 / 文件·专家 |
|------|--------|-------------------|
| 用户要的合同、回写完成日期的台账 | 会话 cwd，如 `合同输出/` | 是：`ONMYAGENT_DELIVERABLE`（相对路径） |
| 映射 JSON、rows.jsonl、内部生成日志、当次辅助脚本 | **`.opencode/tmp/`** 或 **`os.tmpdir()`** | 否（路径在 tmp / 点目录，平台自动不当交付） |
| `opencode.json`、`.opencode/` | 运行时自有 | 否 |

- **只对用户点名的终稿打标记**；过程 xlsx/脚本即使写出来也不得打 `ONMYAGENT_DELIVERABLE`。
- **同一轮**打齐全部合同标记，再总结。
- 禁止把过程文件写到会话根（写到根就会进侧边栏）。
- 有 officecli 时禁止在会话根新建填模脚本。

## 降级（无 officecli）

```bash
python3 scripts/generate_rebate_contracts.py \
  --input 表.xlsx --template 模板.docx \
  --output-dir 合同输出 --report .opencode/tmp/generate-log.xlsx
```

- 默认**只**对合同 `.docx` 打标记；`--report` 必须落在 tmp，且默认不打标记。

## 输出给用户

- 合同列表 + 状态 + 需人工项
- 交付：合同 +（若要求）已填日期的 Excel
- 正文不提过程脚本 / 内部日志

## 边界

- 不编造法律模板、不 e签宝、不代签署开票
- 金额/主体/税号人工复核
- 缺乙方等信息标【待确认】，不瞎填

## 依赖

officecli（优先）· openpyxl（prepare / 降级）· 缺依赖时明确说明，不静默 pip install
