# region_dict.md — 地域(Region)映射字典

> **用途**:LLM 加载本文件,在用户用中文名/英文缩写/行政区指代地域时,映射到 tccli 接受的标准 `ap-xxx` 格式 region ID。
> **使用场景**:所有 subcommand 的 `--region` 参数抽参环节。
> **数据来源**:腾讯云 CVM API 地域列表(https://cloud.tencent.com/document/api/213/15692) + 腾讯云内部官方缩写映射。

---

## 一、地域全量映射表

| Region ID | 中文常用叫法 | 官方缩写 | 大区 |
|---|---|---|---|
| `ap-guangzhou` | 广州 | gz | 华南 |
| `ap-guangzhou-open` | 广州Open | gzopen | 华南 |
| `ap-shenzhen-fsi` | 深圳金融 | szjr | 华南金融专区 |
| `ap-shenzhen` | 深圳 | szx | 华南 |
| `ap-shenzhen-sycft` | 深圳深宇财付通 | szsycft | 华南专区 |
| `ap-shenzhen-jxcft` | 深圳锦绣财付通 | szjxcft | 华南专区 |
| `ap-shanghai` | 上海 | sh | 华东 |
| `ap-shanghai-fsi` | 上海金融 | shjr | 华东金融专区 |
| `ap-shanghai-adc` | 上海自动驾驶云 | shadc | 华东 |
| `ap-shanghai-wxzf` | 上海微信支付 | shwxzf | 华东专区 |
| `ap-nanjing` | 南京 | nj | 华东 |
| `ap-hangzhou-ec` | 杭州 | hzec | 华东 |
| `ap-fuzhou-ec` | 福州 | fzec | 华东 |
| `ap-wuhan-ec` | 武汉 | whec | 华中 |
| `ap-changsha-ec` | 长沙 | csec | 华中 |
| `ap-beijing` | 北京 | bj | 华北 |
| `ap-beijing-fsi` | 北京金融 | bjjr | 华北金融专区 |
| `ap-tianjin` | 天津 | tsn | 华北 |
| `ap-shijiazhuang-ec` | 石家庄 | sjwec | 华北 |
| `ap-qingyuan` | 清远 | qy | 华南 |
| `ap-qingyuan-xinan` | 清远西南 | qyxa | 华南 |
| `ap-chengdu` | 成都 | cd | 西南 |
| `ap-chongqing` | 重庆 | cq | 西南 |
| `ap-xibei-ec` | 西北 | xbec | 西北 |
| `ap-hefei-ec` | 合肥 | hfeec | 华东 |
| `ap-shenyang-ec` | 沈阳 | sheec | 东北 |
| `ap-xian-ec` | 西安 | xiyec | 西北 |
| `ap-zhengzhou-ec` | 郑州 | cgoec | 华中 |
| `ap-jinan-ec` | 济南 | jnec | 华东 |
| `ap-guangzhou-wxzf` | 广州微信支付 | gzwxzf | 华南专区 |
| `ap-hongkong` | 中国香港 / 香港 | hk | 港澳台 |
| `ap-taipei` | 台北 | tpe | 港澳台 |
| `ap-singapore` | 新加坡 | sg | 亚太东南 |
| `ap-bangkok` | 曼谷 | th | 亚太东南 |
| `ap-jakarta` | 雅加达 | jkt | 亚太东南 |
| `ap-mumbai` | 孟买 | in | 亚太南部 |
| `ap-seoul` | 首尔 | kr | 亚太东北 |
| `ap-tokyo` | 东京 | jp | 亚太东北 |
| `na-toronto` | 多伦多 | ca | 北美 |
| `na-ashburn` | 弗吉尼亚 / 美东 | use | 美国东部 |
| `na-siliconvalley` | 硅谷 / 美西 | usw | 美国西部 |
| `eu-frankfurt` | 法兰克福 | de | 欧洲 |
| `eu-moscow` | 莫斯科 | ru | 欧洲 |
| `sa-saopaulo` | 圣保罗 | sao | 南美 |

> **注意**: "官方缩写"列是腾讯云内部系统使用的标准缩写。用户输入 IATA 机场码(如 BKK/SJC/FRA 等)时也应能映射,但内部传参必须使用官方缩写。

---

## 二、抽参规则

### 2.1 命中规则

LLM 在用户提问中识别地域线索时,**按以下优先级**匹配:

1. 用户直接给了 `ap-xxx` / `na-xxx` / `eu-xxx` / `sa-xxx` 格式 → 透传,不做映射
2. 用户给了中文常用叫法(广州 / 上海 / 中国香港...)→ 查上表"中文常用叫法"列
3. 用户给了官方缩写(gz / sh / hk...)或 IATA 机场码(BKK / FRA / SJC...)→ 查上表"官方缩写"列,**大小写不敏感**
4. 用户没提地域,**按场景分**:
   - **列表类查询**(`DescribeAlarmPolicies` / `DescribeApmInstances` / `DescribeProbeTasks` 等)→ 默认 `ap-guangzhou`,**必须在输出里声明**"已默认查广州,如需其他地域请告知"
   - **实例特定查询**(`GetMonitorData ins-xxx` / `DescribeAlarmHistories --AlarmObject ins-xxx` 等)→ **必须反问** region(错 region 返回空数据,用户分不清是 region 错还是真没数据)

### 2.2 一对多场景(行政区)

用户用大区指代(如"华南有哪些告警"),tccli 单次调用**只能查一个 region**,LLM 必须**反问澄清**:

> "您指的是华南哪个具体地域?可选:广州(ap-guangzhou)、深圳(ap-shenzhen)、深圳金融(ap-shenzhen-fsi)、清远(ap-qingyuan)等。"

| 大区 | 包含的 region |
|---|---|
| 华南 | ap-guangzhou / ap-guangzhou-open / ap-shenzhen / ap-shenzhen-fsi / ap-qingyuan / ap-qingyuan-xinan |
| 华东 | ap-shanghai / ap-shanghai-fsi / ap-shanghai-adc / ap-nanjing / ap-hangzhou-ec / ap-fuzhou-ec / ap-hefei-ec / ap-jinan-ec |
| 华北 | ap-beijing / ap-beijing-fsi / ap-tianjin / ap-shijiazhuang-ec |
| 华中 | ap-wuhan-ec / ap-changsha-ec / ap-zhengzhou-ec |
| 西南 | ap-chengdu / ap-chongqing |
| 西北 | ap-xibei-ec / ap-xian-ec |
| 东北 | ap-shenyang-ec |
| 港澳台 | ap-hongkong / ap-taipei |
| 亚太东南 | ap-singapore / ap-bangkok / ap-jakarta |
| 亚太东北 | ap-seoul / ap-tokyo |
| 亚太南部 | ap-mumbai |
| 欧洲 | eu-frankfurt / eu-moscow |
| 美国东部 | na-ashburn |
| 美国西部 | na-siliconvalley |
| 北美 | na-toronto |
| 南美 | sa-saopaulo |

### 2.3 未命中(用户输入无法识别)

| 用户输入示例 | LLM 应对 |
|---|---|
| "火星" / "外太空" 等无效地域 | "未识别地域 \"X\",请使用标准 region ID(如 ap-guangzhou)或常见中文名(广州/上海/北京等),完整列表见 references/common/region_dict.md。" |
| 拼写错误(如 "广洲"、"上每"、"ap-guangzou") | 同上,**不要**自动猜测或纠正 |
| 国内省份名(如 "广东"、"江苏") | "请明确具体城市,如\"广州\"、\"南京\"。" |

---

## 三、抽参示例

| 用户原话 | 抽出的 region |
|---|---|
| "查一下我的告警策略"(列表类) | `ap-guangzhou`(默认,在输出里声明) |
| "查 ins-xxx 最近 1 小时 CPU"(实例特定) | **反问** region |
| "查上海的告警" | `ap-shanghai` |
| "上海金融的策略" | `ap-shanghai-fsi` |
| "北京金融的告警" | `ap-beijing-fsi` |
| "深圳的告警" | `ap-shenzhen` |
| "杭州的监控" | `ap-hangzhou-ec` |
| "天津的策略" | `ap-tianjin` |
| "台北告警" | `ap-taipei` |
| "孟买监控" | `ap-mumbai` |
| "莫斯科告警" | `eu-moscow`(注意是 `eu-` 前缀) |
| "多伦多策略" | `na-toronto`(注意是 `na-` 前缀) |
| "新加坡告警历史" | `ap-singapore` |
| "美西的策略" | **`na-siliconvalley`**(注意是 `na-` 前缀不是 `ap-`) |
| "GZ 的告警" | `ap-guangzhou` |
| "ap-beijing 的告警" | `ap-beijing`(透传) |
| "华南的告警" | **反问**:广州/深圳/深圳金融/清远等? |
| "广东省的告警" | **反问**:请明确城市(广州/深圳/清远等) |
| "火星的告警" | **报错**:未识别地域 |

---

## 四、特殊说明

### 4.1 region 前缀不只 `ap-`

注意:tccli region ID 有 4 个前缀(`ap-` 亚太 / `na-` 北美 / `eu-` 欧洲 / `sa-` 南美),**不能假定全是 `ap-` 开头**。LLM 抽参时必须严格按上表查找,不要自行拼接。

### 4.2 金融专区限制

`ap-shanghai-fsi`、`ap-shenzhen-fsi` 和 `ap-beijing-fsi` 是金融专区,通常需要专属账号才能访问。普通用户查询时若返回 `UnauthorizedOperation`,引导话术:

> "金融专区(ap-shanghai-fsi / ap-shenzhen-fsi / ap-beijing-fsi)需要金融行业专属账号才能访问,请确认账号资质。"

### 4.3 `-ec` / `-adc` / 专区后缀说明

部分 region ID 带有特殊后缀,含义如下:

| 后缀 | 含义 | 示例 |
|---|---|---|
| `-ec` | Edge Cloud(边缘计算节点) | ap-jinan-ec / ap-hangzhou-ec / ap-wuhan-ec 等 |
| `-adc` | Access Domain Controller | ap-shanghai-adc |
| `-fsi` | Financial Services Institution(金融专区) | ap-shanghai-fsi / ap-beijing-fsi |
| `-sycft` / `-jxcft` / `-wxzf` | 政企专区(深业/建信/网信政府) | ap-shenzhen-sycft / ap-guangzhou-wxzf |
| `-open` | 开放区 | ap-guangzhou-open |
| `-xinan` | 西南分区 | ap-qingyuan-xinan |

用户说"济南"/"杭州"/"武汉"等城市时,对应的是带 `-ec` 后缀的 region(如 `ap-jinan-ec`),不要误写成 `ap-jinan`。

### 4.4 跨地域汇总不支持

tccli 单次调用只能指定一个 region。用户需要"跨地域汇总"时,LLM 应:

> "tccli 单次只能查询一个地域。如需跨地域汇总,请分别查询 ap-guangzhou / ap-shanghai / ap-beijing 等地域,再由您汇总比对。"
