---
name: fuel-audit
description: 车队油费稽核方法论。当需要根据加油记录、行驶里程、油卡流水计算单车油耗，与车型正常范围对比，标记少加多开/非定点/套现嫌疑/时空矛盾等异常，并输出优先级稽核报告时使用。结论为稽核线索，禁止编造流水。
---

# 油费稽核技能（Fuel Audit）

用「里程 + 加油量 + 油卡流水」做 **可解释的异常筛选**，让管理者先查高风险车/司机。

## 标准作业流程

1. **归并数据**：`references/data-fields.md` 对齐车牌、时间、升/元、里程。
2. **算油耗**：段耗与 L/100km；里程为 0 或负增量 → 数据质量异常。
3. **套基准**：`references/consumption-baselines.md`（用户基准优先，否则示意）。
4. **扫规则**：`references/anomaly-rules.md` 偏离、频次、非定点、时空、金额。
5. **出报告**：摘要 + 异常表 + Top 风险 + 待补数据。

## 铁律

- 不编造流水与轨迹。  
- 异常=线索，不定罪。  
- 缺里程/车型时先降级为数据问题，不硬判偷油。  
- 示意基准必须标注。

## 参考资料

- `references/data-fields.md` — 字段与对齐  
- `references/consumption-baselines.md` — 车型油耗范围模板  
- `references/anomaly-rules.md` — 异常规则与优先级  
