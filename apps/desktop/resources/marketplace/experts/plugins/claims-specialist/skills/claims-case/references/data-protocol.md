# 理赔案件数据协议

会话根目录维护 `claim-case.json`。原始照片/单据仍保留原文件，本 JSON 只记录事实、证据索引和进度。

```json
{
  "caseId": "CLM-YD8899",
  "asOfDate": "2026-07-23",
  "incidentType": "damage",
  "waybillNo": "YD8899",
  "route": "广州→杭州",
  "incidentTime": "2026-07-22T16:30:00+08:00",
  "customerDemandAmount": 8000,
  "facts": {
    "packagingAtPickup": "外箱完好，交接单有签字",
    "deliveryCondition": "外箱破损，仪器面板开裂",
    "initialCause": "待查证"
  },
  "evidence": [
    { "type": "waybill", "status": "available", "description": "电子运单" },
    { "type": "delivery_photos", "status": "available", "description": "卸货照片3张" },
    { "type": "loading_photos", "status": "missing", "description": "待司机补" }
  ],
  "progress": [
    { "node": "立案", "status": "done", "owner": "客服", "nextDate": "2026-07-23" },
    { "node": "报案", "status": "pending", "owner": "理赔", "nextDate": "2026-07-24" }
  ]
}
```

`incidentType` 支持 `damage`、`wet`、`delay`、`loss`。证据状态支持 `available`、`weak`、`missing`；未列出的固定证据同样视为 missing。

## 产物

- preview：`.process/evidence-checklist.md`、`.process/liability-draft.md`、`.process/claim-progress.md`
- export：`理赔材料包_<caseId>.md`、`客户沟通话术_<caseId>.md`、`保司报案提纲_<caseId>.md`、`理赔进度_<caseId>.csv`

所有责任表述均为作业级初判，必须保留条件句与缺口。脚本不得自动认责、报案、承诺赔付或发送外部消息。
