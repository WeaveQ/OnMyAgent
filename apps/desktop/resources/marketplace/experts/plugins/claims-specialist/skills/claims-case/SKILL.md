---
name: claims-case
description: 物流理赔案件作业法。当需要处理货损、延误、丢件等异常，整理理赔材料与证据清单，做责任初步判断，起草客户/司机/保险公司沟通话术，建立报案-定损-补件-谈判-结案进度跟踪，或识别易拖延环节并给出加速动作时使用。非法律意见，禁止伪造证据。
---

# 理赔案件技能（Claims Case）

把碎的异常信息收成 **可报案、可沟通、可跟踪** 的理赔作业包。

## 标准作业流程

1. **立案件卡**：`references/case-fields.md` 结构化运单、异常类型、时间线、诉求。
2. **证据完备度**：`references/evidence-by-type.md` 按破损/水湿/延误/丢件列必备证据。
3. **责任初判**：`references/liability-draft.md` 包装/装卸/在途节点/免责；不足则待查证。
4. **材料包 + 话术**：`references/scripts-and-filings.md` 客户/内部/保司。
5. **进度跟踪**：节点表 + 易拖环节 + 下次跟进。
6. **待拍板**：报案与否、提案金额边界、是否升级。
7. **逐轮生成理赔预览 HTML**：每次更新 claim-case.json 后跑 preview：
   ```bash
   python3 <Skill根目录>/scripts/build_claim_artifacts.py --input claim-case.json --output-dir . --mode preview
   ```
   preview 生成 `.process/claim-preview.html`（汇总卡：证据覆盖率/缺失/责任方向/进度 + 证据完备度表缺失标红 + 责任初判方向 + 进度表）。客户端直接读取命令结果中的完整 `inlineWidget` JSON 并渲染，**禁止**把它放进 `show_widget` 围栏、禁止输出 `preview:` 链接、禁止把 HTML 源码或半截 JSON 贴进正文。**不输出文字看板分析**，结果由 preview HTML 承担。每轮补全后重跑 preview 刷新。
8. **导出前格式确认（必须）+ 导出**：用户确认案件后**不要**立刻 export。先用选择题请用户点选其一：生成 Excel 和 PDF / 只生成 Excel / 只生成 PDF / 先不生成。只有用户明确选择前三项之一后才运行：
   ```bash
   python3 <Skill根目录>/scripts/build_claim_artifacts.py --input claim-case.json --output-dir . --mode export
   ```
   export 生成理赔材料 Excel（`理赔材料_<caseId>.xlsx`，含「证据完备度」（缺失标红）与「进度」两个工作表）与理赔材料 PDF（`理赔材料_<caseId>.pdf`，证据/责任/进度，Chrome headless 导出）。**HTML 只是过程预览，不作为结果产物**。
9. **交付产物（强制表格）**：过程 HTML 不提供用户链接。结果 Excel/PDF 必须用两列表格交付，不得自由发挥：

    ```markdown
    | 文件 | 操作 |
    | --- | --- |
    | <脚本返回的实际文件名.xlsx> | [查看](artifact:<实际文件名.xlsx>) |
    | <脚本返回的实际文件名.pdf> | [查看](artifact:<实际文件名.pdf>) |
    ```

    - 操作列文案固定为 **「查看」**；链接协议固定 `artifact:...`，点击 = 打开侧边栏「文件」并预览。
    - 只列本次 `export` 真实生成的文件；用脚本返回的实际文件名，未生成不要造行。
    - 禁止把内部 JSON 当主产物；禁止普通相对链接 / `file://` / `sandbox:`。

## 铁律

- 不伪造、不教唆造假。
- 非法律判决；不写「法院必赢」。
- 不擅自对外认全责；禁止自动报案、承诺赔付或发送外部消息。
- 无来源不编造金额、单号、时间。
- 理赔结果必须通过 preview HTML 卡片展示，**禁止只输出文字/表格分析而不跑 preview**；未跑 preview 不得声称已完成理赔核查。
- 过程 HTML（`.process/claim-preview.html`）只通过脚本返回的 `inlineWidget` 让客户端实时渲染，禁止 `cat`/读取 HTML 源码到对话、禁止 `file://`/浏览器/`preview:` 打开；禁止在正文输出 `show_widget` 围栏或半截 JSON。
- 结果产物（理赔材料 Excel/PDF）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。HTML 仅作过程预览，不作为结果产物。

## 参考资料

- `references/case-fields.md` — 案件字段与进度表  
- `references/evidence-by-type.md` — 分类型证据清单  
- `references/liability-draft.md` — 责任初判逻辑  
- `references/scripts-and-filings.md` — 话术与报案提纲
- `references/data-protocol.md` — `claim-case.json` 与产物协议
- `scripts/build_claim_artifacts.py` — 可复现 preview/export 执行器
