---
name: fuel-audit
description: 车队油费稽核工作流。当需要把加油记录、行驶里程、油卡流水整理成 fuel-audit-data.json，计算单车/同线油耗，扫描短里程重复加油、非定点、套现组合与时空矛盾，生成可查看的稽核看板、报告、CSV，或在用户确认后创建每周 OnMyAgent 自动化扫描任务时使用。结论只作稽核线索，禁止编造流水。
---

# 油费稽核技能（Fuel Audit）

用「里程 + 加油量 + 油卡流水」做 **可解释的异常筛选**，让管理者先查高风险车/司机。

## 标准作业流程

1. **归并数据**：按 `references/data-fields.md` 对齐车牌、时间、升/元、里程，把单一数据源写到会话根 `fuel-audit-data.json`；字段协议见 `references/data-protocol.md`。
2. **算油耗**：段耗与 L/100km；里程为 0 或负增量时标数据质量异常，不硬算。
3. **套基准**：读取 `references/consumption-baselines.md`。用户/车队同车同线历史优先；否则 `source` 写 `illustrative`。
4. **扫规则**：读取 `references/anomaly-rules.md`，扫描偏离、短里程重复加油、非定点、时空矛盾与套现组合。
5. **每轮预览**：运行
   `python3 <Skill根目录>/scripts/build_fuel_audit.py --input fuel-audit-data.json --output-dir . --mode preview`，把 `.process/fuel-audit-board.md` 与 `.process/fuel-high-risk.md` 用 `artifact:` 链接交付；禁止向用户倾倒 JSON。
6. **确认后导出**：用户需要正式稽核包时运行同脚本 `--mode export`，交付报告、单车汇总 CSV、异常明细 CSV。**结果产物必须用两列表格交付**，不得自由发挥：

    ```markdown
    | 文件 | 操作 |
    | --- | --- |
    | <脚本返回的实际文件名.md> | [查看](artifact:<实际文件名.md>) |
    | <脚本返回的实际文件名.csv> | [查看](artifact:<实际文件名.csv>) |
    | <脚本返回的实际文件名.csv> | [查看](artifact:<实际文件名.csv>) |
    ```

    - 操作列文案固定为 **「查看」**；链接协议固定 `artifact:...`，点击 = 打开侧边栏「文件」并选中该文件进行预览。
    - 只列本次 `export` 真实生成的文件；未生成不要造行。
    - 禁止普通相对链接 / `file://` / `sandbox:`。preview 阶段的 `.process/*.md` 看板保留 `artifact:` 单链接（过程产物，不强制表格）。
7. **询问自动化**：export 会生成 `automations/proposals/fuel-weekly-scan.json`。明确告诉用户可创建“每周异常扫描”；只有用户在 OnMyAgent 确认面板同意后，才由现有自动化链路创建。

## 铁律

- 不编造流水与轨迹。  
- 异常=线索，不定罪。  
- 缺里程/车型时先降级为数据问题，不硬判偷油。  
- 示意基准必须标注。
- 不自动扣款、处罚、停卡或发送外部消息；这些都由管理者拍板。
- 不声称 automation proposal 已经是定时任务；以 OnMyAgent 创建结果卡为准。
- 过程产物只放 `.process/`，最终报告/CSV 放会话根；禁止再建 `output/`。
- 最终报告/CSV 必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；禁止 `file://` / `sandbox:` / 普通相对链接。

## 参考资料

- `references/data-fields.md` — 字段与对齐  
- `references/data-protocol.md` — 单一数据源、脚本与产物协议
- `references/consumption-baselines.md` — 车型油耗范围模板  
- `references/anomaly-rules.md` — 异常规则与优先级  
- `scripts/build_fuel_audit.py` — 确定性计算、看板、CSV 与自动化提案生成器
