---
name: affiliate-fleet
description: 挂靠车队合规台账方法论。汇总证件/保险/年检/违章为 fleet-ledger.json，生成到期与高风险看板、CSV 与催办话术，用户确认后创建 OnMyAgent 定时扫描任务。非法律意见。
---

# 挂靠车队合规技能（Affiliate Fleet）

把分散的挂靠车/司机资料收成 **可查、可催、可预警、可定时** 的合规作业。

## 标准作业流程

1. **收资料** → 2. **维护 `fleet-ledger.json`**（`ledger-fields.md` + `data-protocol.md`）
3. **算提醒**（`expiry-alerts.md`）→ 4. **扫高风险**（`risk-and-scripts.md`）
5. **逐轮生成合规看板预览 HTML**：每次更新 fleet-ledger.json 后跑 preview：
   ```bash
   python3 <Skill根目录>/scripts/build_fleet_artifacts.py --input fleet-ledger.json --output-dir . --mode preview
   ```
   preview 生成 `.process/fleet-preview.html`（汇总卡：过期/D-7/D-15/D-30/正常 + 车辆台账表到期标红 + 高风险预警）。客户端直接读取命令结果中的完整 `inlineWidget` JSON 并渲染，**禁止**把它放进 `show_widget` 围栏、禁止输出 `preview:` 链接、禁止把 HTML 源码或半截 JSON 贴进正文。**不输出文字看板分析**，结果由 preview HTML 承担。每轮补全后重跑 preview 刷新。
6. **导出前格式确认（必须）+ 导出** + **定时任务**（`onmyagent-automations.md`）：用户确认台账后**不要**立刻 export。先用选择题请用户点选其一：生成 Excel 和 PDF / 只生成 Excel / 只生成 PDF / 先不生成。只有用户明确选择前三项之一后才运行：
   ```bash
   python3 <Skill根目录>/scripts/build_fleet_artifacts.py --input fleet-ledger.json --output-dir . --mode export
   ```
   export 生成挂靠车台账 Excel（`挂靠车台账_<stamp>.xlsx`，含「台账汇总」（到期行标红）与「到期详情」两个工作表）与挂靠车台账 PDF（`挂靠车台账_<stamp>.pdf`，看板+台账+高风险，Chrome headless 导出）、催办话术、每日扫描提案，并为每台车计算证件/保险/年检中最近的 D-30 / D-15 / D-7 / 到期日 once 提案。宿主仅在用户确认后创建，并用结果卡反馈成功或失败。**HTML 只是过程预览，不作为结果产物**。
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

## 铁律

- 不编造日期与证件信息。
- 风险提醒 ≠ 法律结论。
- 日期不清标待确认。
- **禁止自动停运、清退、处罚或发送外部消息**；相关动作须用户授权。
- **禁止未确认创建定时任务**。
- 会话根落文件，禁止多余 `output/`。
- 合规看板必须通过 preview HTML 卡片展示，**禁止只输出文字/表格分析而不跑 preview**；未跑 preview 不得声称已完成合规核查。
- 过程 HTML（`.process/fleet-preview.html`）只通过脚本返回的 `inlineWidget` 让客户端实时渲染，禁止 `cat`/读取 HTML 源码到对话、禁止 `file://`/浏览器/`preview:` 打开；禁止在正文输出 `show_widget` 围栏或半截 JSON。
- 结果产物（挂靠车台账 Excel/PDF）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。HTML 仅作过程预览，不作为结果产物。

## 参考资料

- `references/data-protocol.md`
- `references/onmyagent-automations.md`
- `references/ledger-fields.md`
- `references/expiry-alerts.md`
- `references/risk-and-scripts.md`
- `scripts/build_fleet_artifacts.py`
