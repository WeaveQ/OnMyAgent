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
7. **落盘 preview**：按 `references/data-protocol.md` 维护 `claim-case.json`：
   ```bash
   python3 <Skill根目录>/scripts/build_claim_artifacts.py --input claim-case.json --output-dir . --mode preview
   ```
8. **人工核对后 export**：
   ```bash
   python3 <Skill根目录>/scripts/build_claim_artifacts.py --input claim-case.json --output-dir . --mode export
   ```
   export 生成材料包、客户话术、保司提纲和进度 CSV；过程目录保留证据、责任初判与进度看板。

## 铁律

- 不伪造、不教唆造假。
- 非法律判决；不写「法院必赢」。
- 不擅自对外认全责；禁止自动报案、承诺赔付或发送外部消息。
- 无来源不编造金额、单号、时间。

## 参考资料

- `references/case-fields.md` — 案件字段与进度表  
- `references/evidence-by-type.md` — 分类型证据清单  
- `references/liability-draft.md` — 责任初判逻辑  
- `references/scripts-and-filings.md` — 话术与报案提纲
- `references/data-protocol.md` — `claim-case.json` 与产物协议
- `scripts/build_claim_artifacts.py` — 可复现 preview/export 执行器
