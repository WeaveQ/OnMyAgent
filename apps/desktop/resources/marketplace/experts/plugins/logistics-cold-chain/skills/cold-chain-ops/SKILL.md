---
name: cold-chain-ops
description: "冷运作业：预冷检查、温控异常分级、断链证据链、腐损责任初判、多温区注意。触发：冷链、冷藏、冷冻、断链、腐损、预冷、温控报警。"
description_zh: "冷运：预冷、断链、腐损"
description_en: "Cold chain: pre-cool, break-chain, spoilage"
version: 1.0.0
---

# 冷运作业 skill

## Workflow

1. 锁定货品与 **设定温度**  
2. 预冷 — `references/precool-checklist.md`  
3. 在途异常分级 — `references/temp-alarm-levels.md`  
4. 断链举证 — `references/break-chain-evidence.md`  
5. 腐损责任 — `references/spoilage-liability.md`  
6. 多温区 — `references/multi-temp.md`  
7. 四段回执；索赔金额 `manualReviewRequired=true`  

## 禁止

伪造温度数据；教唆隐瞒断链。
