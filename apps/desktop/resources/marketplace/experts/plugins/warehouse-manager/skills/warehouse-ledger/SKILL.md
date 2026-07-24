---
name: warehouse-ledger
description: 网点仓库存台账方法论。登记入/出/移/盘到 warehouse-ledger.json，扫描异常与滞留，生成简报与 CSV，用户确认后创建 OnMyAgent 每日库存定时任务。
---

# 仓储台账技能（Warehouse Ledger）

中小专线/零担 **网点仓**：「货动账动」、异常可倒查、报表与定时简报可交付。

## 标准作业流程

1. **吃素材** → 2. **维护 `warehouse-ledger.json`**（`ledger-fields.md` + `data-protocol.md`）  
3. **异常扫描**（`anomaly-playbook.md`）→ 4. **货物特性**（`cargo-handling.md`）  
5. **逐轮生成库存看板预览 HTML**：每次更新 warehouse-ledger.json 后跑 preview：
   ```bash
   python3 <Skill根目录>/scripts/build_warehouse_artifacts.py --input warehouse-ledger.json --output-dir . --mode preview
   ```
   preview 生成 `.process/warehouse-preview.html`（汇总卡：入库/出库/移库/盘点盈亏/滞留/负库存 + 库存台账表滞留/负库存标红 + 异常清单）。客户端直接读取命令结果中的完整 `inlineWidget` JSON 并渲染，**禁止**把它放进 `show_widget` 围栏、禁止输出 `preview:` 链接、禁止把 HTML 源码或半截 JSON 贴进正文。**不输出文字看板分析**，结果由 preview HTML 承担。每轮补全后重跑 preview 刷新。
6. **导出前格式确认（必须）+ 导出** + **定时任务**（`onmyagent-automations.md`）：用户确认台账后**不要**立刻 export。先用选择题请用户点选其一：生成 Excel 和 PDF / 只生成 Excel / 只生成 PDF / 先不生成。只有用户明确选择前三项之一后才运行：
   ```bash
   python3 <Skill根目录>/scripts/build_warehouse_artifacts.py --input warehouse-ledger.json --output-dir . --mode export
   ```
   export 生成库存台账 Excel（`库存台账_<stamp>.xlsx`，含「库存台账」（滞留/负库存标红）与「流水」两个工作表）与库存台账 PDF（`库存台账_<stamp>.pdf`，看板+台账+异常，Chrome headless 导出）、每日库存简报 proposal。**HTML 只是过程预览，不作为结果产物**。
7. **交付产物（强制表格）**：过程 HTML 不提供用户链接。结果 Excel/PDF 必须用两列表格交付，不得自由发挥：

    ```markdown
    | 文件 | 操作 |
    | --- | --- |
    | <脚本返回的实际文件名.xlsx> | [查看](artifact:<实际文件名.xlsx>) |
    | <脚本返回的实际文件名.pdf> | [查看](artifact:<实际文件名.pdf>) |
    ```

    - 操作列文案固定为 **「查看」**；链接协议固定 `artifact:...`，点击 = 打开侧边栏「文件」并预览。
    - 只列本次 `export` 真实生成的文件；未生成不要造行。定时任务提案不进表格，由 AutomationCreateResultCard 单独交付。
    - 禁止把内部 JSON 当主产物；禁止普通相对链接 / `file://` / `sandbox:`。
8. **定时任务**：export 会生成每日库存简报 proposal；用户在 OnMyAgent 确认面板同意后才创建。

## 铁律

- **货动必有账**；无数量/无运单不静默改账面。  
- **禁止编造** 件数、货位、盘点结果。  
- 负库存与大额盘亏必须标红并给倒查步骤。  
- 危险品仅提示合规隔离。  
- **禁止未确认创建定时任务**。  
- 会话根落文件，禁止多余 `output/`。
- 库存看板必须通过 preview HTML 卡片展示，**禁止只输出文字/表格分析而不跑 preview**；未跑 preview 不得声称已完成库存核查。
- 过程 HTML（`.process/warehouse-preview.html`）只通过脚本返回的 `inlineWidget` 让客户端实时渲染，禁止 `cat`/读取 HTML 源码到对话、禁止 `file://`/浏览器/`preview:` 打开；禁止在正文输出 `show_widget` 围栏或半截 JSON。
- 结果产物（库存台账 Excel/PDF）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。HTML 仅作过程预览，不作为结果产物。

## 参考资料

- `references/data-protocol.md`  
- `references/onmyagent-automations.md`  
- `references/ledger-fields.md`  
- `references/anomaly-playbook.md`  
- `references/cargo-handling.md`  
- `scripts/build_warehouse_artifacts.py`  
