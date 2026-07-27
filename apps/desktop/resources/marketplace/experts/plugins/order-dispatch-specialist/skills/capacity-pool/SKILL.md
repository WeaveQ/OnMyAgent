---
name: capacity-pool
description: 动态运力池与多因素配载方法论。当需要汇总车辆位置、剩余载重、司机状态、预计空闲时间与方向偏好，维护实时可用运力清单，标记超时未更新车辆，生成司机群回报/催更话术，或把待调度订单与可用运力做成1-3套配载方案（顺路、载重、意愿、时效、空驶）并说明理由与风险时使用。
---

# 动态运力池与配载匹配（Capacity Pool）

将散落在微信与电话中的运力信息整理为可查询、可催更的实时运力池；在有待调度订单时，基于多因素匹配输出 1–3 套配载方案与推荐理由，降低对个人经验的单点依赖和空驶浪费。

## 标准作业流程

### A. 运力池

1. **归并素材**：文字直接解析；语音先转写；表格/截图识别后对模糊项标“识别存疑”；同一司机/车牌多条消息按时间线合并。
2. **对照字段标准抽取**：按 `references/capacity-fields.md` 逐项抽取，标注置信度（高/中/低）。
3. **口语转规范表述**：按 `references/status-and-regions.md` 将状态、方向、车型口语转为行业标准表述。
4. **Upsert 运力池**：以车牌优先、其次司机姓名+电话为键更新；记录 `updatedAt` 与来源。
5. **新鲜度判定**：按阈值标记 fresh / aging / stale，生成催更名单；话术见 `references/pool-scripts.md`。

### B. 配载推荐（订单 + 运力）

6. **结构化待调度订单**：线路、吨/方、时效、车型与特殊要求；缺关键字段先追问或显式假设。
7. **落盘 + 多因素匹配**：按 `references/data-protocol.md` 维护 `capacity-dispatch.json`（订单 + 运力池），按 `references/load-matching.md` 做硬过滤 -> 软排序 -> 取前 1–3 候选。**不输出文字分析表格**，方案与理由由 preview HTML 卡片承担。
8. **逐轮生成配载方案预览 HTML**：每次收到运力/订单信息后跑 preview：
    ```bash
    python3 <Skill根目录>/scripts/build_dispatch_artifacts.py --input capacity-dispatch.json --output-dir . --mode preview
    ```
    preview 生成 `.process/dispatch-preview.html`（配载方案卡片：首选/备选/可选，含综合分、车型、位置、空驶、新鲜度、优势理由、风险与推荐方案高亮）与运力池看板 `.process/capacity-board.md`、未入选运力 `.process/rejected-capacity.md`。脚本按综合分自动推荐最高分候选；可在 `order.recommendation: { plate, reason }` 覆盖。客户端直接读取命令结果中的完整 `inlineWidget` JSON 并渲染，**禁止**把它放进 `show_widget` 围栏、禁止输出 `preview:` 链接、禁止把 HTML 源码或半截 JSON 贴进正文。每轮补全后重跑 preview 刷新。
9. **风险与拍板项**：高风险已在 preview 卡片显示；若需额外提示调度最终确认，正文简述即可，**禁止**用文字表格重复展开方案。
10. **锁定后提示**：若用户选定方案，提示更新对应运力状态，避免重复派车。
11. **导出前格式确认（必须）+ 导出**：用户确认配载方案后**不要**立刻 export。先用选择题请用户点选其一：生成 Excel 和 Word / 只生成 Excel / 只生成 Word / 先不生成。只有用户明确选择前三项之一后才运行：
    ```bash
    python3 <Skill根目录>/scripts/build_dispatch_artifacts.py --input capacity-dispatch.json --output-dir . --mode export
    ```
    export 生成配载方案 Excel（`运力调配方案_<orderId>.xlsx`，含「候选方案」与「订单信息」两个工作表）与配载方案 Word（`运力调配方案对比_<orderId>.docx`，含推荐结论/候选对比表/优劣势/司机确认话术/未入选运力）。**HTML 只是过程预览，不作为结果产物**。
12. **交付产物（强制表格）**：过程 HTML 不提供用户链接。结果 Excel/Word 必须用两列表格交付，不得自由发挥：

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

- 配载推荐结果必须通过 preview HTML 卡片展示，**禁止只输出文字/表格分析而不跑 preview**；未跑 preview 不得声称已完成配载推荐。
- 无依据的字段留空并追问，**禁止编造**位置、载重、空闲时间、可用状态来凑方案。
- **stale 条目默认不得进入配载推荐**，必须先催更或由调度确认仍有效。
- 超载、无资质危化、明显疲劳驾驶风险只做提示，**不给出违规配载方案**。
- 方案是建议；对外锁车与承诺由调度拍板。禁止自动锁车、改运力状态或发送外部消息。
- 过程 HTML（`.process/dispatch-preview.html`）只通过脚本返回的 `inlineWidget` 让客户端实时渲染，禁止 `cat`/读取 HTML 源码到对话、禁止 `file://`/浏览器/`preview:` 打开；禁止在正文输出 `show_widget` 围栏或半截 JSON。
- 结果产物（配载方案 Excel/对比 Word）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。HTML 仅作过程预览，不作为结果产物。

## 参考资料

- `references/capacity-fields.md` — 运力池标准字段、新鲜度阈值、JSON 结构
- `references/status-and-regions.md` — 司机/车辆状态、方向与车型口语对照
- `references/pool-scripts.md` — 群点名、回报、催更与确认话术
- `references/load-matching.md` — 多因素配载因子、方案模板与高风险规则
- `references/data-protocol.md` — `capacity-dispatch.json`、新鲜度和硬过滤协议
- `scripts/build_dispatch_artifacts.py` — 可复现 preview/export 执行器
