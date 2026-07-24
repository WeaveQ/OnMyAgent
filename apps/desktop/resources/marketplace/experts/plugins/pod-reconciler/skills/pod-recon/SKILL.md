---
name: pod-recon
description: 回单跟踪与费用对账方法论。当需要汇总回单回收状态、统计超期与催收优先级，汇总运费及附加费，生成对账单草稿，标注金额/票数差异及可能原因，或生成催回单/催补资料话术时使用。
---

# 回单对账技能（POD Recon）

把回单回收与费用数据收成「能催、能对、能拍板」的台账与对账单草稿。

## 标准作业流程

1. **吃素材**：登记表、运单费用表、对方账单、截图/PDF；模糊识别标「识别存疑」。
2. **定对齐键**：按 `references/pod-and-fee-fields.md`，优先运单号 → 货主单号 → 车牌+发车日+线路。
3. **回单状态机**：更新每票 POD 状态与超期；输出待催清单（优先级规则见字段文档）。
4. **费用归集**：分项汇总；有对方账单则做双边比对。
5. **对账单草稿**：主表 + 无法匹配 + 汇总；差异表与原因码见 `references/variance-and-reasons.md`。
6. **催办话术**：按 `references/chase-scripts.md` 生成可转发文案。
7. **待拍板**：大额差异、规则冲突、材料矛盾最多列 3 项请调度/财务确认。
8. **逐轮生成对账预览 HTML**：按 `references/data-protocol.md` 维护 `pod-recon-data.json`，每次收到回单/费用数据后跑 preview：
   ```bash
   python3 <Skill根目录>/scripts/build_pod_recon_artifacts.py --input pod-recon-data.json --output-dir . --mode preview
   ```
   preview 生成 `.process/recon-preview.html`（汇总卡：我方/对方/差异/差异票数/超期/可结算 + 比价结论 + 对账明细表差异行标红 + 差异清单 + 超期回单）。客户端直接读取命令结果中的完整 `inlineWidget` JSON 并渲染，**禁止**把它放进 `show_widget` 围栏、禁止输出 `preview:` 链接、禁止把 HTML 源码或半截 JSON 贴进正文。**不输出文字表格分析**，对账结果由 preview HTML 承担。每轮补全后重跑 preview 刷新。
9. **导出前格式确认（必须）+ 导出**：用户确认对账单后**不要**立刻 export。先用选择题请用户点选其一：生成 Excel 和 PDF / 只生成 Excel / 只生成 PDF / 先不生成。只有用户明确选择前三项之一后才运行：
   ```bash
   python3 <Skill根目录>/scripts/build_pod_recon_artifacts.py --input pod-recon-data.json --output-dir . --mode export
   ```
   export 生成对账单 Excel（`对账单_<period>.xlsx`，含「对账明细」（差异行标红）与「汇总」两个工作表）与对账单 PDF（`对账单_<period>.pdf`，含汇总/对账表/差异/超期，由 Chrome headless 从 HTML 导出）。若有超期回单，export 另生成 `automations/proposals/pod-overdue-scan.json`（每日回单超期扫描提案，用户确认后由宿主创建）。**HTML 只是过程预览，不作为结果产物**。
10. **交付产物（强制表格）**：过程 HTML 不提供用户链接。结果 Excel/PDF 必须用两列表格交付，不得自由发挥：

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

- 无源数据 **禁止编造** 单号、金额、回单已回。
- 对不上进「无法匹配」，禁止硬凑。
- 只出草稿与建议，不宣称已入账/已付款。
- 不协助伪造回单或虚假签收。
- 禁止自动入账、付款、改回单状态或发送催办消息。
- 对账结果必须通过 preview HTML 卡片展示，**禁止只输出文字/表格分析而不跑 preview**；未跑 preview 不得声称已完成对账。
- 过程 HTML（`.process/recon-preview.html`）只通过脚本返回的 `inlineWidget` 让客户端实时渲染，禁止 `cat`/读取 HTML 源码到对话、禁止 `file://`/浏览器/`preview:` 打开；禁止在正文输出 `show_widget` 围栏或半截 JSON。
- 结果产物（对账单 Excel/PDF）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。HTML 仅作过程预览，不作为结果产物。

## 参考资料

- `references/pod-and-fee-fields.md` — 回单与费用字段、状态、优先级
- `references/variance-and-reasons.md` — 对账主表、差异阈值、原因码
- `references/chase-scripts.md` — 催回单/催补资料话术
- `references/data-protocol.md` — `pod-recon-data.json`、受控原因码与产物协议
- `scripts/build_pod_recon_artifacts.py` — 可复现 preview/export 执行器
