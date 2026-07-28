# 挂靠车合规台账字段

## 车辆

| 中文 | JSON | 说明 |
|------|------|------|
| 车牌 | plateNo | 主键 |
| 车型 | vehicleType | 可选 |
| 挂靠单位 | affiliateOrg | 公司名 |
| 登记所有人 | registeredOwner | 行驶证所有人 |
| 实际控制人/车主 | actualOwner | 与登记不一致时标风险 |
| 营运证号 | transportPermitNo | 若有 |
| 营运证/审验到期 | transportPermitExpiry | |
| 行驶证检验有效期 | vehicleLicenseInspectExpiry | 年检相关 |
| 交强险止期 | ctlInsuranceEnd | |
| 商业险止期 | commercialInsuranceEnd | |
| 状态 | vehicleStatus | active / suspended / exited |

## 司机

| 中文 | JSON | 说明 |
|------|------|------|
| 姓名 | driver.name | |
| 电话 | driver.phone | |
| 驾驶证到期 | driver.licenseExpiry | |
| 准驾车型 | driver.licenseClass | |
| 从业资格到期 | driver.qualificationExpiry | 货运从业等 |
| 绑定车牌 | driver.boundPlates[] | 人车绑定 |

## 违章汇总

| 中文 | JSON | 说明 |
|------|------|------|
| 未处理条数 | violations.openCount | |
| 未处理记分 | violations.openPoints | 可选 |
| 最近违章日 | violations.lastAt | |
| 备注 | violations.notes | |

## 台账输出行

| 车牌 | 司机 | 所有人/实际 | 驾驶证到期 | 资格证到期 | 年检/营运审验 | 交强险 | 商业险 | 未处理违章 | 风险标记 | 最近提醒 |

## 单车合规卡模板

```markdown
### 合规卡 {plateNo}
- 司机：…
- 证件：…（剩余天/过期）
- 保险：交强… 商业…
- 年检/营运：…
- 违章：未处理 {n}
- 风险：…
- 派长途建议：建议可派 / 建议暂缓 / 建议禁止（作业建议，由你拍板）
- 缺口：…
```

## 日期规则

- 统一为 `YYYY-MM-DD`；仅年月则记月末并标注「粗粒度」。  
- 识别不清：`待确认`，不参与「可派」绿灯。  
