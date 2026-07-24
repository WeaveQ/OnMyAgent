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
9. **逐轮生成三档预览 HTML**：按 `references/data-protocol.md` 维护 `quote-request.json`，每次收到信息后跑 preview：
   ```bash
   python3 <Skill根目录>/scripts/build_quote_artifacts.py --input quote-request.json --output-dir . --mode preview
   ```
   preview 生成 `.process/quote-preview.html`（三档卡片：最快/平衡/最便宜，含价格、时效、毛利率、优劣势与推荐档位高亮）与底价保护看板 `.process/quote-floor-guard.md`。脚本按档位特征自动生成默认优劣势与推荐（默认推荐平衡档）；可在 `optionAdjustments.<档>.pros/cons` 与 `recommendation` 覆盖。客户端直接读取命令结果中的完整 `inlineWidget` JSON 并渲染，**禁止**把它放进 `show_widget` 围栏、禁止输出 `preview:` 链接、禁止把 HTML 源码或半截 JSON 贴进正文。每轮补全后重跑 preview 刷新。
10. **导出前格式确认（必须）+ 导出**：用户确认报价后**不要**立刻 export。先用选择题请用户点选其一：生成 Excel 和 Word / 只生成 Excel / 只生成 Word / 先不生成。只有用户明确选择前三项之一后才运行：
    ```bash
    python3 <Skill根目录>/scripts/build_quote_artifacts.py --input quote-request.json --output-dir . --mode export
    ```
    export 生成报价 Excel（`报价方案_<quoteId>.xlsx`，含「三档对比」与「成本明细」）与报价方案 Word（`报价方案对比_<quoteId>.docx`，含推荐结论/三档对比表/优劣势/砍价话术）。**HTML 只是过程预览，不作为结果产物**。数据指纹变化时 export 会清旧产物。
11. **交付产物（强制表格）**：过程 HTML 不提供用户链接。结果 Excel/Word 必须用两列表格交付，不得自由发挥：

    ```markdown
    | 文件 | 操作 |
    | --- | --- |
    | <脚本返回的实际文件名.xlsx> | [查看](artifact:<实际文件名.xlsx>) |
    | <脚本返回的实际文件名.docx> | [查看](artifact:<实际文件名.docx>) |
    ```

    - 操作列文案固定为 **「查看」**；链接协议固定 `artifact:...`，点击 = 打开侧边栏「文件」并预览。
    - 只列本次 `export` 真实生成的文件；用脚本返回的实际文件名，未生成不要造行。
    - 禁止把内部 JSON 当主产物；禁止普通相对链接 / `file://` / `sandbox:`。

## 铁律

- **示意 ≠ 市价保证**；禁止编造「满帮/全网真实成交底价」。
- 不建议隐瞒亏损的超低价接单；可提示风险与减配路径。
- 拒绝为明显超载、假吨方、无资质危化出违法建议。
- 总价 = 分项之和；折扣写在成交带，不偷偷改表。
- 历史合作价值/运力松紧 **仅在有依据时** 写入策略，禁止虚构客户等级。
- 缺少任一成本字段时只输出结构和缺口，禁止生成貌似真实的报价金额。
- 禁止自动向客户发送报价；最终档位、成交价与服务边界必须由用户拍板。
- 过程 HTML（`.process/quote-preview.html`）只通过脚本返回的 `inlineWidget` 让客户端实时渲染，禁止 `cat`/读取 HTML 源码到对话、禁止 `file://`/浏览器/`preview:` 打开；禁止在正文输出 `show_widget` 围栏或半截 JSON。
- 结果产物（报价 Excel/对比 Word）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。HTML 仅作过程预览，不作为结果产物。

## 参考资料

- `references/inquiry-fields.md` — 询价必填/选填与追问
- `references/cost-and-hidden.md` — 成本构成、隐藏条件、历史价沉淀
- `references/surcharge-checklist.md` — 附加费防漏清单
- `references/three-options.md` — 三档方案定义与对比
- `references/quote-structure.md` — 费用结构表与计费口径
- `references/sales-scripts.md` — 报价与砍价话术
- `references/data-protocol.md` — `quote-request.json` 字段、公式与产物协议
- `scripts/build_quote_artifacts.py` — 可复现 preview/export 执行器
