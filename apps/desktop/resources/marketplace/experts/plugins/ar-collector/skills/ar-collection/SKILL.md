---
name: ar-collection
description: 物流应收台账与催收方法论。根据账期、开票、回款与运单维护 ar-ledger.json，计算账龄节点，生成看板/Excel(风险标红)/CSV/话术包，并在用户确认后创建 OnMyAgent 定时催收任务。禁止非法催收与编造金额。
---

# 应收催收技能（AR Collection）

把账期、发票、回款、运单收成 **可看、可催、可跟、可定时** 的台账与产物。

## 标准作业流程

1. **立规则**：账期起算（对账确认日 / 开票日 / 月结固定日）、是否接受承兑。见 `references/ar-ledger.md`。  
2. **维护单一数据源**：更新会话根 `ar-ledger.json`（结构见 `references/data-protocol.md`）。禁止手改 Excel/CSV 当主数据。  
3. **算账龄与节点**：`references/aging-nodes.md` 默认 D-7 / due / +3 / +15。  
4. **逐轮生成催收看板预览 HTML**：每次更新 ar-ledger.json 后跑 preview：
   ```bash
   python3 <Skill根目录>/scripts/build_ar_artifacts.py --input ar-ledger.json --output-dir . --mode preview
   ```
   preview 生成 `.process/ar-preview.html`（汇总卡：未结清/逾期/D-7/到期/风险 + 账龄节点分桶 D-7/due/+3/+15 + 应收台账表逾期行标红）。客户端直接读取命令结果中的完整 `inlineWidget` JSON 并渲染，**禁止**把它放进 `show_widget` 围栏、禁止输出 `preview:` 链接、禁止把 HTML 源码或半截 JSON 贴进正文。**不输出文字看板分析**，结果由 preview HTML 承担。每轮补全后重跑 preview 刷新。
5. **定力度与话术**：`references/scripts-by-stage.md`。
6. **导出前格式确认（必须）+ 导出**：用户确认台账后**不要**立刻 export。先用选择题请用户点选其一：生成 Excel 和 PDF / 只生成 Excel / 只生成 PDF / 先不生成。只有用户明确选择前三项之一后才运行：
   ```bash
   python3 <Skill根目录>/scripts/build_ar_artifacts.py --input ar-ledger.json --output-dir . --mode export
   ```
   export 生成应收台账 Excel（`应收台账_<stamp>.xlsx`，超期/风险行浅红底）与应收台账 PDF（`应收台账_<stamp>.pdf`，看板+台账，Chrome headless 导出）、催收话术包、每日看板 proposal + 每票节点 once proposal。**HTML 只是过程预览，不作为结果产物**。
7. **交付产物（强制表格）**：过程 HTML 不提供用户链接。结果 Excel/PDF 必须用两列表格交付，不得自由发挥：

    ```markdown
    | 文件 | 操作 |
    | --- | --- |
    | <脚本返回的实际文件名.xlsx> | [查看](artifact:<实际文件名.xlsx>) |
    | <脚本返回的实际文件名.pdf> | [查看](artifact:<实际文件名.pdf>) |
    ```

    - 操作列文案固定为 **「查看」**；链接协议固定 `artifact:...`，点击 = 打开侧边栏「文件」并预览。
    - 只列本次 `export` 真实生成的文件；未生成不要造行。定时任务提案不进表格，由 AutomationCreateResultCard 单独交付。
    - 禁止把内部 JSON 当主产物；禁止普通相对链接 / `file://` / `sandbox:`。
8. **定时任务**：按 `references/onmyagent-automations.md` 列出建议任务 -> **用户确认** -> 由宿主问答面板批量创建 OnMyAgent automation；创建结果卡才是成功依据。
9. **回款后**：更新核销，重跑 preview；必要时调整/停用定时任务。

## 铁律

- 无来源不编造金额、票号、客户承诺。  
- 不威胁、不骚扰式催收；停运/法务升级须用户授权。  
- 承兑未兑付 ≠ 现金已回清。  
- 话术默认「你确认后再发」。  
- **禁止未确认创建定时任务**。  
- 节点任务只生成话术并提醒负责人，禁止自动向客户发送消息。
- 会话根直接落文件，禁止多余 `output/` 套层。
- 催收看板必须通过 preview HTML 卡片展示，**禁止只输出文字/表格分析而不跑 preview**；未跑 preview 不得声称已完成对账。
- 过程 HTML（`.process/ar-preview.html`）只通过脚本返回的 `inlineWidget` 让客户端实时渲染，禁止 `cat`/读取 HTML 源码到对话、禁止 `file://`/浏览器/`preview:` 打开；禁止在正文输出 `show_widget` 围栏或半截 JSON。
- 结果产物（应收台账 Excel/PDF）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。HTML 仅作过程预览，不作为结果产物。

## 参考资料

- `references/data-protocol.md` — JSON/产物/命令  
- `references/onmyagent-automations.md` — 定时任务门禁与载荷  
- `references/ar-ledger.md` — 台账字段、核销、状态  
- `references/aging-nodes.md` — 账龄与催收节点  
- `references/scripts-by-stage.md` — 分阶段话术与力度  
- `scripts/build_ar_artifacts.py` — 看板/Excel(风险标红)/CSV/话术/提案生成  
