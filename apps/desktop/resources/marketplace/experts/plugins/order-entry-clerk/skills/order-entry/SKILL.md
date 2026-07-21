---
name: order-entry
description: 物流单据录入与生成方法论。当需要把客户微信文字、语音、手写单图片等碎片信息整理成物流单、发货单、发车单/派车单或运单，校验字段完整性，合并追问缺失信息，实时更新白红黄三联 HTML 效果图，或在确认后按用户选择分别生成 PDF 与/或 Excel 时使用。
---

# 物流单据录入技能（Order Entry）

将碎片化素材逐步转化为字段齐全、可预览、可打印的物流单据。本技能不宣称通用版式是法定统一样式；用户、承运商或业务系统提供的模板始终优先。

## 单据与模板决策

1. 先识别用户要生成的单据类型：物流单（默认）、发货单、发车单/派车单、运单或其他单据。
2. 在首次制作前询问一次：“是否有指定模板？有的话请发图片/文件；没有我就按通用格式制作。”
3. 用户已附模板时不再追问，直接识别标题、字段、分区、联次、签章位和纸张方向，保持原模板。
4. 用户回复无模板时，物流单必须使用 `assets/logistics-waybill-template.html` 的固定版式，并读取 `references/waybill-fields.md` 与 `references/waybill-data-protocol.md`；其他单据先读 `references/document-types.md`。
5. 用户中途更换单据类型或模板时，保留已确认的业务数据，重新映射版式，不要让用户重复提供。

## 标准作业流程

1. **确认单据与模板**：按上述决策确认。用户首条已给发货信息且未提模板时，默认通用格式并先出草稿预览，不要空轮只问模板。
2. **还原素材并精准映射**：文字直接解析；语音先转写再按口语习惯理解；图片识别后对潦草字迹标注“识别存疑”。按 `references/waybill-fields.md`「字段抽取铁律」把内容拆进专用字段（提货→`handover`、结算→`payment.method`、时效→`timeline.*`、车型→`vehicleRequirement`、货物→`cargo.*` 等）。**禁止**把大段对话或已映射字段原文塞进 `remarks`；备注只保留 1～3 条短履约要点（≤80 字）。展示层脚本可能把提货/到达/车型摘要拼进备注格，JSON 里 `remarks` 仍只存操作要点。
3. **维护单一数据源**：按 `references/waybill-data-protocol.md` 更新 `output/waybill-data.json`。每个字段保留来源与置信度；冲突放入 `conflicts`，低置信度字段放入 `lowConfidenceFields`，禁止直接覆盖旧值掩盖冲突。
4. **生成 HTML 初稿（过程产物，仅 HTML）**：模板确认后调用
   `python3 <Skill根目录>/scripts/generate_waybill.py --input output/waybill-data.json --output-dir output --mode preview`
   **preview 只生成过程 HTML**，写入 `output/.process/`；**不启动浏览器，不生成 PDF/XLSX**。结果 PDF/Excel 仅在用户选择格式后的 export 阶段生成。用户无指定模板且制作物流单时，脚本必须读取 `assets/logistics-waybill-template.html`，只替换有 `data-field`/`data-check` 标识的值；禁止增删区块、重排字段、改变合并单元格、配色、字体、边框、联次或自行重做版式。用户有模板时才通过 `--template` 使用忠实复刻的用户模板。不要用普通 Markdown 表格代替效果图。
5. **规范表述并校验**：按 `references/goods-and-requirements.md` 规范化品名、时效与特殊要求；将缺失或存疑项标记为待补。
6. **生成追问话术**：按 `references/follow-up-scripts.md` 把当前所有缺失/存疑项合并为一次礼貌追问，优先询问会阻断派车与交付的必填项；追问写在预览之后的正常正文，不要放进 code 围栏。
7. **逐轮内嵌三联效果图**：每次收到用户补充后，原位更新同一份 JSON 并重跑 preview 命令，让脚本同步覆盖白、红、黄三个独立 HTML（位于 `output/.process/`）；不要每轮新建预览。把脚本返回的完整 `inlineWidget` JSON **原样**放入 `show_widget` 围栏（含 `artifactCopies`）；当前单据以 Tab 显示，默认白色存根联；围栏之后分别给三个脚本实际返回的 `[放大查看](preview:output/.process/实际文件名.html)`。**禁止**把脚本 stdout、HTML 源码、半截 JSON 贴进用户可见正文。
8. **手动编辑字段**：预览内支持“编辑字段 → 保存修改”。用户保存后会给出 `waybill-patch` 代码块；收到后必须立刻执行
   `python3 <Skill根目录>/scripts/generate_waybill.py --input output/waybill-data.json --output-dir output --mode preview --patch <临时patch.json> --write-input`
   （或先把 patch 写入 JSON 再 preview）。脚本会回写 `waybill-data.json`、刷新 `.process` 预览，并在数据指纹变化时**自动删除**旧 PDF/XLSX，避免结果产物残留旧数据。后续一切生成/导出都必须基于修改后的 JSON。
9. **请求最终确认**：脚本状态为 `awaiting_confirmation` 时，向用户展示线路、双方、货物、时间、结算、车辆/司机摘要，明确询问“是否确认按以上信息生成单据”。只有用户肯定回复后才把 `userConfirmed` 写为 `true`。
10. **导出前格式选择（必须）**：确认后**不要**立刻 export。先用选择题请用户点选其一：
    - 生成 PDF 和 Excel
    - 只生成 PDF
    - 只生成 Excel
    - 先不生成
    只有用户明确选择前三项之一后才运行 export。选择“先不生成”时只保持 HTML 预览，不生成结果产物。
11. **确定性三联导出**：用户选定格式后运行：
    - 两者：`--mode export --formats pdf,xlsx`
    - 仅 PDF：`--mode export --formats pdf`
    - 仅 Excel：`--mode export --formats xlsx`
    状态为 `pending_dispatch` 时，白/红/黄三联生成带“待派车确认稿”后缀的对应格式；状态为 `final` 时用“最终版”后缀。每个 Excel 固定有 `物流单` 与 `字段数据` 两个工作表。脚本会先删除该单号下旧的 PDF/XLSX 再写入新文件。PDF 必须单页（A4 横向、不分页）。脚本失败或任一约定文件不存在时如实说明，禁止宣称已生成。导出成功后必须把这次 export 返回的完整 `inlineWidget` 再次放入 `show_widget` 围栏；其中包含三联导出映射，客户端会在当前 Tab 右上角菜单提供导出/打开对应 PDF 或 Excel。
12. **交付产物**：三个 HTML 只给各自 `preview:output/.process/...` 链接；已生成的 PDF/XLSX 分别给 `[打开产物](artifact:output/脚本返回的实际文件名)`。不得把内部 JSON 作为用户主产物，也不得使用 `[下载](output/...)`、普通相对链接、`file://` 或 `sandbox:` 链接。
13. **信息变更后重生**：用户确认后若再次修改字段（对话补充或预览内手动编辑），必须先更新 JSON + preview，旧结果产物会被脚本清掉；再次需要 PDF/Excel 时，重新走第 10 步格式选择再 export，禁止在旧文件上“假装已更新”。

## 铁律

- 无依据的字段留空并追问，**禁止编造**手机号、地址、数量、价格。
- 未确认模板选择前，禁止把通用格式宣称为用户或承运商的正式模板。
- 无指定模板的物流单必须以 `assets/logistics-waybill-template.html` 为唯一版式来源，逐项对照后生成，**禁止自由发挥**；业务确需增加但模板没有的内容，只能写入“备注”，不得新造区块。
- `assets/` 必须相对当前 Skill 根目录解析，不得去会话工作区搜索。若运行时未提供 Skill 根目录，使用安装路径 `~/.onmyagent/marketplaces/experts/order-entry-clerk/skills/order-entry/assets/logistics-waybill-template.html`。两个位置都不可读时停止生成并报告“专家模板安装异常”，禁止绕过模板继续制作。
- 必填信息未齐全时，HTML 只是“草稿”，不标记“已确认”、不伪造签名或盖章。
- 待确认 HTML 不使用蒙层、透明度或整体淡化表达状态；只在缺失字段所在格子标注“待补充”，保证整张单据清晰可读。
- 客户必填齐全但车辆/司机缺失时只允许“待派车确认稿”；车牌、驾驶证号、司机姓名、司机电话全部齐全后才允许“最终版”。
- 白、红、黄三联的 PDF、Excel 和 HTML 必须来自同一份 `waybill-data.json`；禁止人工分别生成或修改九份产物。
- **过程产物**只放 `output/.process/`；**结果产物** PDF/XLSX 放 `output/` 根目录。
- **`--mode preview` 禁止生成 PDF/XLSX**，也禁止为预览启动 Chrome；每轮补全只重跑 preview 刷新 HTML。
- **禁止在用户未选择格式时自动 export**；禁止在数据已变时继续交付旧 PDF/XLSX。
- 只有导出脚本成功且返回的 PDF/XLSX 文件存在时才能回复“产物已生成”。
- 导出的 PDF 必须单页适配物流单据，禁止分页裁切。
- 追问一次问清，语气礼貌，给客户选择题而非问答题。
- 危化品、冷链、超限超重等特殊货物必须提示承运资质与包装要求。
- **禁止调用浏览器打开本地 HTML**，也不要使用 `file://`、浏览器工具或网页搜索工具展示效果图；只写入工作区文件并输出 `preview:` 产物链接。
- `show_widget` 围栏必须包含脚本返回的完整 `inlineWidget` JSON，不得自己重画简化版；该围栏用于会话内直接展示，不是让用户阅读的代码块。
- **禁止** `cat`/读取 `.process` HTML 到对话；**禁止**创建 README 或其它非单据占位文件。
- 确认后必须先问导出格式（PDF+Excel / 仅 PDF / 仅 Excel / 先不生成），话术不得写「确认即生成 PDF 和 Excel」。

## 参考资料

- `references/waybill-fields.md` — 物流运单标准字段定义（必填/选填、格式校验规则、JSON 字段名）
- `references/document-types.md` — 物流单、发货单、派车单与运单的用途、字段差异和公开标准依据
- `references/goods-and-requirements.md` — 常见货物描述对照、时效表达、特殊要求表达与风险提示
- `references/follow-up-scripts.md` — 缺失信息追问话术模板（按场景分类）
- `references/waybill-data-protocol.md` — 单一数据源、状态机、确认与 PDF/XLSX 导出门禁
- `assets/logistics-waybill-template.html` — 无指定模板时使用的可打印通用物流单 HTML 底稿
- `scripts/generate_waybill.py` — 从同一份 JSON 生成白、红、黄三联独立 HTML、PDF 与 Excel 的确定性脚本
