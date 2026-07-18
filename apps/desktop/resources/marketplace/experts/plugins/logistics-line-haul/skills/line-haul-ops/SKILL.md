---
name: line-haul-ops
description: "专线干线作业：抛重计费、网点中转时效拆解、配载拼载启发式、外请车约束、回单账期。触发：专线、中转、抛重、配载、外请、回单周期。"
description_zh: "专线干线：抛重、中转、配载、外请"
description_en: "Line-haul: throw-weight, hubs, co-load, hired trucks"
version: 1.0.0
---

# 专线干线作业 skill

## When to Use

专线询价、中转延误定责、今晚拼载、外请结算约束、回单账期谈判。

## Workflow

1. **定口径** — 线路、是否中转、吨/方/车、时效承诺  
2. **抛重** — 见 `references/throw-weight.md`  
3. **中转拆解** — 见 `references/hub-transfer.md`  
4. **配载** — 见 `references/coload-heuristics.md`（启发式，非 OR）  
5. **外请** — 见 `references/hired-truck-checklist.md`  
6. **四段回执 + 待拍板**

## 与通用对账/异常

金额对账、通用货损仍用总台公式；本 skill 只叠加 **专线字段与原因**（中转延误、抛重争议、外请违约）。
