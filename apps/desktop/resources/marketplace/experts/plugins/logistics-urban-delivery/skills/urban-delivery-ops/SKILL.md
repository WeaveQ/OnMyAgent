---
name: urban-delivery-ops
description: "短途城配：多点顺序启发式、时段窗、等候费、末端拒收二次配、日清核对。触发：城配、多点、同城、日清、等通知、拒收。"
description_zh: "城配：多点、等候、日清"
description_en: "Urban delivery: multi-stop, wait, day-clear"
version: 1.0.0
---

# 短途城配 skill

## Workflow

1. 收集点位/时段窗/车型  
2. 顺序启发式 — `references/stop-sequencing.md`  
3. 报价结构 — `references/urban-quote.md`  
4. 异常（不在/拒收）— `references/last-mile-exception.md`  
5. 日清 — `references/day-clear.md`  
6. 四段回执  

## 禁止

指导冲禁行、伪造进场证、隐瞒交通事故。
