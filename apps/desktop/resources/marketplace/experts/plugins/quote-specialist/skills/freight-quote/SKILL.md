---
name: freight-quote
description: 专线/零担询价与结构报价方法论。当需要根据线路、重量/体积、车型、时效、装卸、回单等生成参考报价，输出最快/最便宜/平衡多档方案，识别含税/回单/装卸/旺季等隐藏条件，按油费路桥折旧司机分摊等构成测算成本区间，检查附加费漏项，保护底价并生成报价与砍价话术，或沉淀本票指导价备忘时使用。无成本库时不编造真实市价。
---

# 货运报价技能（Freight Quote）

把客户询价变成 **结构清晰、三档可选、隐藏条件显性、附加费不漏、话术可发、口径可沉淀** 的参考报价草稿。经验底盘：专线与零担实战、车型（4.2/6.8/9.6 等）与整车/配货口径、成本构成意识、薄利线与易漏附加费提醒。

## 标准作业流程

1. **复述需求**：线路、重量/体积、货品、车型/方式、时效、装卸、回单、提送；写清计费口径（吨/方/车/抛重）。
2. **补全字段**：`references/inquiry-fields.md` 一次追问；可先给带假设结构表。
3. **隐藏条件 + 成本口径**：`references/cost-and-hidden.md` 扫含税/回单/装卸/旺季等；对内过成本构成检查项。
4. **附加费扫描**：`references/surcharge-checklist.md` 逐项 含/不含/另计/待确认。
5. **三档方案**：`references/three-options.md` 最快 / 最便宜 / 平衡。
6. **结构填表**：`references/quote-structure.md`；非用户成本数字标 `示意`。
7. **底价与成交带**：有成本/历史价则汇总；无则公式 + 待填；附本票价格备忘便于沉淀。
8. **话术**：`references/sales-scripts.md`（含运力紧张、老客户弹性、守底价）。
9. **落盘实算**：按 `references/data-protocol.md` 维护 `quote-request.json`，先 preview：
   ```bash
   python3 <Skill根目录>/scripts/build_quote_artifacts.py --input quote-request.json --output-dir . --mode preview
   ```
10. **人工核对后 export**：
    ```bash
    python3 <Skill根目录>/scripts/build_quote_artifacts.py --input quote-request.json --output-dir . --mode export
    ```
    export 生成三档 Markdown/CSV 与砍价话术；底价保护看板在 `.process/quote-floor-guard.md`。

## 铁律

- **示意 ≠ 市价保证**；禁止编造「满帮/全网真实成交底价」。
- 不建议隐瞒亏损的超低价接单；可提示风险与减配路径。
- 拒绝为明显超载、假吨方、无资质危化出违法建议。
- 总价 = 分项之和；折扣写在成交带，不偷偷改表。
- 历史合作价值/运力松紧 **仅在有依据时** 写入策略，禁止虚构客户等级。
- 缺少任一成本字段时只输出结构和缺口，禁止生成貌似真实的报价金额。
- 禁止自动向客户发送报价；最终档位、成交价与服务边界必须由用户拍板。

## 参考资料

- `references/inquiry-fields.md` — 询价必填/选填与追问
- `references/cost-and-hidden.md` — 成本构成、隐藏条件、历史价沉淀
- `references/surcharge-checklist.md` — 附加费防漏清单
- `references/three-options.md` — 三档方案定义与对比
- `references/quote-structure.md` — 费用结构表与计费口径
- `references/sales-scripts.md` — 报价与砍价话术
- `references/data-protocol.md` — `quote-request.json` 字段、公式与产物协议
- `scripts/build_quote_artifacts.py` — 可复现 preview/export 执行器
