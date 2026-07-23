# 物流单数据协议与状态门禁

所有预览和导出必须使用同一份 `waybill-data.json`。Agent 只负责从对话中维护这份数据，HTML、PDF、Excel 必须交给 `scripts/generate_waybill.py` 生成，禁止分别手工填写造成字段不一致。

## 目录约定

| 路径 | 用途 |
| --- | --- |
| `waybill-data.json` | 单一业务数据源（写在会话工作区根目录） |
| `.process/*.html` | 过程产物：三联 HTML 预览（可覆盖更新） |
| `.process/export-fingerprint` | 最近一次成功导出时的数据指纹（内部） |
| `*.pdf` / `*.xlsx` | 结果产物：用户确认并选择格式后直接写在会话根目录 |

会话工作区本身已按专家/会话隔离，**禁止再套一层 `output/` 目录**。过程产物与结果产物不得混放。过程 HTML 由客户端从命令结果直接展示，不向用户输出预览链接；结果产物使用 `artifact:实际文件名.ext`。

## 状态机

| 状态 | 进入条件 | 允许产物 |
| --- | --- | --- |
| `awaiting_template` | 用户尚未说明是否有指定模板 | 不生成版式，只抽取字段 |
| `collecting` | 模板已确定，但客户必填信息缺失或有冲突/低置信度字段 | HTML 草稿预览（`.process`） |
| `awaiting_confirmation` | 客户必填信息齐全，等待用户确认 | HTML 待确认预览 |
| `pending_dispatch` | 客户必填信息齐全并经用户确认，但车辆/司机未齐 | 用户选择格式后：HTML + 可选 PDF/XLSX「待派车确认稿」 |
| `final` | 客户必填、车辆/司机均齐全，无冲突/低置信度字段，且用户明确确认 | 用户选择格式后：HTML + 可选 PDF/XLSX「最终版」 |

不得跳过状态。用户说“照旧”“就这样”只能确认当前回复中明确列出的字段；没有明确展示过的空字段不能据此补全。

## 数据示例

```json
{
  "document": {
    "number": "WX-20260721-001",
    "date": "2026-07-21"
  },
  "route": {
    "origin": "深圳市宝安区福永街道 1 号门",
    "destination": "东莞市长安镇乌沙社区 2 号门"
  },
  "shipper": {
    "name": "深圳某机械有限公司",
    "contact": "张经理",
    "phone": "13800000000",
    "address": "深圳市宝安区福永街道 1 号门"
  },
  "consignee": {
    "name": "东莞某工厂",
    "contact": "刘经理",
    "phone": "13900000000",
    "address": "东莞市长安镇乌沙社区 2 号门"
  },
  "cargo": [
    {
      "name": "注塑机",
      "quantity": "2 台",
      "packaging": "木架",
      "weight": "4.8 吨",
      "volume": "",
      "declaredValue": "",
      "insuranceFee": "",
      "codAmount": ""
    }
  ],
  "timeline": {
    "pickup": "2026-07-22 上午",
    "delivery": "2026-07-22 18:00 前"
  },
  "vehicleRequirement": "9.6 米尾板车",
  "vehicle": {
    "plate": "粤B12345",
    "licenseNumber": "4403XXXXXXXXXXXXXX",
    "driverName": "王师傅",
    "driverPhone": "13700000000",
    "driverAddress": ""
  },
  "carrier": {
    "name": "",
    "address": "",
    "phone": ""
  },
  "payment": {
    "method": "到付",
    "amount": "3200.00",
    "amountUppercase": "叁仟贰佰元整"
  },
  "handover": "送货",
  "remarks": "计划提货：2026-07-22 上午；要求到达：2026-07-22 18:00 前；车型：9.6 米尾板车",
  "userConfirmed": true,
  "conflicts": [],
  "lowConfidenceFields": [],
  "fieldMeta": {
    "consignee.phone": { "source": "客户微信原文", "confidence": "high" }
  }
}
```

## 客户必填门禁

- `document.number`、`document.date`
- `route.origin`、`route.destination`
- `shipper.name/contact/phone/address`
- `consignee.name/contact/phone/address`
- 至少一条货物，且每条有 `name`、`quantity`、`packaging`，并至少有 `weight` 或 `volume`
- `timeline.pickup`、`timeline.delivery`
- `payment.method`
- `handover`
- `conflicts` 与 `lowConfidenceFields` 均为空

缺失金额不阻塞客户确认稿；未确认费用必须显示“待补充”，不能填 0。相对日期必须换成绝对日期并由用户确认。

## 最终版派车门禁

最终版还必须有：

- `vehicle.plate`
- `vehicle.licenseNumber`
- `vehicle.driverName`
- `vehicle.driverPhone`

缺任一项时只允许“待派车确认稿”。司机家庭住址不是最终版门禁，缺失时显示“—”。

## 固定模板字段映射

- 详细装货/卸货地址：分别写入起运地点、目的地点；过长时保留区县和门牌，并将完整地址写入备注。
- 提货与到达时间、车型要求、装卸/回单/温控等模板外业务信息：按固定顺序写入备注。
- 多条货物：HTML 固定货物行中用“；”分隔摘要；Excel `字段数据` 每条货物独立展开，禁止丢行。
- 用户指定模板：仍使用同一数据协议与状态门禁，但 HTML/PDF 版式改用用户模板；Excel `字段数据` 保持不变。

## 手动字段补丁

预览内“编辑字段 → 保存修改”后：

1. **用户侧**：预览图直接保留改动，可再次点「编辑字段」；界面只提示已保存，**绝不**展示 JSON / 补丁代码。
2. **Agent 侧**：客户端会在用户消息中附带内部 `waybill-patch` 围栏（用户 transcript 会隐藏该围栏）。示例（仅给你解析，禁止回显）：

````markdown
```waybill-patch
{
  "shipper.phone": "13800000001",
  "cargo.quantity": "3 台"
}
```
````

收到后合并进 `waybill-data.json`（`userConfirmed` 置回 `false` 直至用户再次确认），并重跑 preview。可用：

```bash
python3 <Skill根目录>/scripts/generate_waybill.py \
  --input waybill-data.json \
  --output-dir . \
  --mode preview \
  --patch /tmp/waybill-patch.json \
  --write-input
```

数据指纹变化时，脚本会删除该单号下已有 PDF/XLSX，避免结果产物继续展示旧数据。客户端会直接展示命令结果中的预览；回复用户时只给简短确认，禁止粘贴补丁原文或重复输出预览 JSON。

## 导出格式选择

用户确认业务信息后，必须先选择：

1. 生成 PDF 和 Excel → `--formats pdf,xlsx`
2. 只生成 PDF → `--formats pdf`
3. 只生成 Excel → `--formats xlsx`
4. 先不生成 → 不调用 export

每次 export 前脚本会删除同单号旧 PDF/XLSX，再按所选格式重新生成，保证结果来自当前 JSON。

## 生成命令

过程预览（**只生成 HTML，不生成 PDF/Excel**）：

```bash
python3 <Skill根目录>/scripts/generate_waybill.py --input waybill-data.json --output-dir . --mode preview
```

用户确认并选定格式后导出（才涉及 PDF/Excel）：

```bash
python3 <Skill根目录>/scripts/generate_waybill.py --input waybill-data.json --output-dir . --mode export --formats pdf,xlsx
```

脚本以 JSON 输出实际生成的文件、状态、`processDir` 和 `inlineWidget`。

- **preview**：只写白/红/黄三个 HTML 到 `.process/`，不启动浏览器，不写 PDF/XLSX；`artifactCopies` 为空。
- **export**：在用户选定 `--formats` 后，才为三联生成 PDF 与/或 XLSX 到会话根目录（与 `waybill-data.json` 同级，不进 `output/`）。PDF 单页横向、不分页。

每次生成命令保留完整 `inlineWidget` 工具结果，客户端会直接渲染；回复正文禁止重复输出 `show_widget` 围栏、`preview:` 链接或“放大查看”按钮。退出码非 0 或任一返回文件不存在时，必须原样说明失败原因，不得回复“已生成”。

## 结果产物呈现规范（防自由发挥）

export 成功后，用户可见交付区必须是 Markdown 表格（两列）：

| 文件 | 操作 |
| --- | --- |
| `物流单_…_一联-白色存根_待派车确认稿.pdf` | `[查看](artifact:物流单_…_一联-白色存根_待派车确认稿.pdf)` |

| 规则 | 要求 |
| --- | --- |
| 文件列 | 脚本返回的真实 basename，可带联次/用途后缀 |
| 操作列 | 固定文案「查看」+ `artifact:<basename>` |
| 点击效果 | 打开侧边栏「文件」并选中该文件预览，不是下载/打开系统文件夹 |
| 范围 | 只列本次生成的 PDF/XLSX；HTML 过程稿不进此表 |
| 禁止 | 「在文件夹中显示」「打开 PDF」「打开 Excel」「下载」、白/红/黄自定义按钮行、假路径、`file://` |

预览组件右上角菜单对当前联显示「在文件夹中显示 PDF/Excel」，路径来自 `artifactCopies`，仅包含本次真实导出的格式。
