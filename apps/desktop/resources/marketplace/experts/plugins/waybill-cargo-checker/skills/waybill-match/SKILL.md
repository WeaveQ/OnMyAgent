---
name: waybill-match
description: 运单与货物实收实发核对方法论。当需要对比托运单/运单与实际收货或发货清点，识别有单没货、有货没单、数量品名包装不符，输出差异点、当场证据清单与核对结果记录时使用。收货当场核对优先。
---

# 运单货物核对技能（Waybill Match）

在收货/发货环节做 **单货一致** 校验，把差异留在当场解决。

## 标准作业流程

1. **抽字段**：`references/match-fields.md` 从运单与实绩两侧抽取。
2. **匹配归类**：`references/mismatch-types.md` 一致 / 有单没货 / 有货没单 / 数量不符等。
3. **证据与动作**：`references/evidence-and-log.md` 当场固证与结果表。
4. **输出** 逐票结果 + 可选当日汇总。

## 铁律

- 不编造清点数据。  
- 识别不清先存疑再结论。  
- 重大差异建议阻断流转直至确认。  
- 不指导造假单据。

## 参考资料

- `references/match-fields.md` — 核对维度与字段  
- `references/mismatch-types.md` — 差异类型与原因线索  
- `references/evidence-and-log.md` — 证据清单与记录模板  
