---
name: warehouse-ledger
description: 网点仓库存台账方法论。登记入/出/移/盘到 warehouse-ledger.json，扫描异常与滞留，生成简报与 CSV，用户确认后创建 OnMyAgent 每日库存定时任务。
---

# 仓储台账技能（Warehouse Ledger）

中小专线/零担 **网点仓**：「货动账动」、异常可倒查、报表与定时简报可交付。

## 标准作业流程

1. **吃素材** → 2. **维护 `warehouse-ledger.json`**（`ledger-fields.md` + `data-protocol.md`）  
3. **异常扫描**（`anomaly-playbook.md`）→ 4. **货物特性**（`cargo-handling.md`）  
5. **preview**：
   ```bash
   python3 <Skill根目录>/scripts/build_warehouse_artifacts.py --input warehouse-ledger.json --output-dir . --mode preview
   ```
6. **用户确认后 export + 定时任务**（`onmyagent-automations.md`）：
   ```bash
   python3 <Skill根目录>/scripts/build_warehouse_artifacts.py --input warehouse-ledger.json --output-dir . --mode export
   ```
    **交付产物（强制表格）**：过程看板（`.process/`）不提供用户链接。结果台账/流水必须用两列表格交付，不得自由发挥：

    ```markdown
    | 文件 | 操作 |
    | --- | --- |
    | <脚本返回的实际文件名.csv> | [查看](artifact:<实际文件名.csv>) |
    | <脚本返回的实际文件名.csv> | [查看](artifact:<实际文件名.csv>) |
    ```

    - 操作列文案固定为 **「查看」**；链接协议固定 `artifact:...`，点击 = 打开侧边栏「文件」并选中该文件进行预览。
    - 只列本次 `export` 真实生成的文件；未生成不要造行。定时任务提案不进表格，由 AutomationCreateResultCard 单独交付。
    - 禁止普通相对链接 / `file://` / `sandbox:`。

## 铁律

- **货动必有账**；无数量/无运单不静默改账面。  
- **禁止编造** 件数、货位、盘点结果。  
- 负库存与大额盘亏必须标红并给倒查步骤。  
- 危险品仅提示合规隔离。  
- **禁止未确认创建定时任务**。  
- 会话根落文件，禁止多余 `output/`。
- 结果产物（台账/流水）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。

## 参考资料

- `references/data-protocol.md`  
- `references/onmyagent-automations.md`  
- `references/ledger-fields.md`  
- `references/anomaly-playbook.md`  
- `references/cargo-handling.md`  
- `scripts/build_warehouse_artifacts.py`  
