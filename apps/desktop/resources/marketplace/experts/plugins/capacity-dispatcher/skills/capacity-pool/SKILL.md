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
7. **多因素匹配**：按 `references/load-matching.md` 做硬过滤 → 软排序 → 生成 **1–3 套** 方案（首选/备选/可选），写清顺路、载重、意愿、时效、空驶等理由。
8. **风险与拍板项**：高风险单独列出，明确建议调度最终确认；输出表格 + JSON。
9. **锁定后提示**：若用户选定方案，提示更新对应运力状态，避免重复派车。
10. **落盘实算**：按 `references/data-protocol.md` 维护 `capacity-dispatch.json`，先 preview：
    ```bash
    python3 <Skill根目录>/scripts/build_dispatch_artifacts.py --input capacity-dispatch.json --output-dir . --mode preview
    ```
11. **人工核对后 export**：
    ```bash
    python3 <Skill根目录>/scripts/build_dispatch_artifacts.py --input capacity-dispatch.json --output-dir . --mode export
    ```
    export 生成配载方案、候选 CSV 与司机确认话术；`.process` 保留动态池、候选和未入选原因。

## 铁律

- 无依据的字段留空并追问，**禁止编造**位置、载重、空闲时间、可用状态来凑方案。
- **stale 条目默认不得进入配载推荐**，必须先催更或由调度确认仍有效。
- 超载、无资质危化、明显疲劳驾驶风险只做提示，**不给出违规配载方案**。
- 方案是建议；对外锁车与承诺由调度拍板。禁止自动锁车、改运力状态或发送外部消息。

## 参考资料

- `references/capacity-fields.md` — 运力池标准字段、新鲜度阈值、JSON 结构
- `references/status-and-regions.md` — 司机/车辆状态、方向与车型口语对照
- `references/pool-scripts.md` — 群点名、回报、催更与确认话术
- `references/load-matching.md` — 多因素配载因子、方案模板与高风险规则
- `references/data-protocol.md` — `capacity-dispatch.json`、新鲜度和硬过滤协议
- `scripts/build_dispatch_artifacts.py` — 可复现 preview/export 执行器
