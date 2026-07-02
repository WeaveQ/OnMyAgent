# 头像生成规范

## 基本要求

| 项目 | 要求 |
|------|------|
| 格式 | PNG（推荐）或 JPG |
| 尺寸 | 512×512 px（正方形） |
| 大小 | 单张不超过 500KB |
| 风格 | 统一漫画/插画风格，专业自然 |
| 内容 | 符合角色定位，不含违规内容 |

> 头像必须自动生成。优先使用高质量生图能力；如果 `ImageGen` 不可用，必须继续尝试其他可用生图模型/端点或脚本化绘制兜底，不得直接宣告失败。

## 生成通道优先级

按以下顺序尝试，直到生成合格头像文件：

1. **原生高质量生图工具**：优先使用当前 agent 环境提供的 `ImageGen` / `imagegen` 等图像生成工具，推荐生成 1024×1024 后压缩/缩放到 512×512。
2. **其他可用生图模型或端点**：如果原生工具不可用，检查当前环境是否暴露了其他图像生成能力，例如：
   - OnMyAgent OpenAI Image Gen 扩展的 `image_generate` 工具
   - MCP/插件 action 中的图像生成接口
   - 支持 `/images/generations` 的模型端点（例如 agent-ai 的 agnes-image 系列模型）
   - 其他明确能输出 PNG/JPG/WebP 的生图工具
3. **脚本化绘制兜底**：如果所有模型/扩展生图能力都不可用，使用本地脚本生成可交付头像。优先调用 `scripts/generate_avatar_fallback.py` 生成无外部依赖的 PNG；也可按需使用 Python + Pillow、Canvas、SVG/HTML 渲染后转 PNG。脚本兜底仍必须体现角色行业、能力关键词、配色和统一风格，不允许只做空白占位图。

**选择规则：**
- 多个生图通道同时可用时，优先选择视觉质量更好的真实生图模型。
- Team 型必须对所有成员使用同一种生成通道或同一套脚本风格，避免画风割裂。
- 脚本兜底生成的头像也必须符合尺寸、大小和文件名要求。
- 生成后必须检查文件真实存在，必要时压缩到 500KB 内。

**内置兜底脚本示例：**

```bash
python3 scripts/generate_avatar_fallback.py avatars/expert.png \
  --category 12-IndustryConsultant \
  --label "strategy consultant"
```

Team 型可为 `avatars/team.png`、`avatars/{team}-team-lead.png` 和每个成员头像分别运行一次，并通过相同 `categoryId` 保持统一配色。

**失败判定：**
- 只有在原生生图工具、其他生图模型/端点、脚本化绘制兜底全部不可用或全部失败后，才允许标记头像生成失败。
- 失败说明必须列出尝试过的通道、失败原因、每个头像的推荐 prompt，并在 README.md 中标注可手动替换。

## 生成策略

**Agent 型**：1 张头像
- `avatars/expert.png`

**Team 型**：N+1 张头像
- `avatars/team.png` — 团队整体头像
- `avatars/{team}-team-lead.png` — 主理人头像
- `avatars/{member-name}.png` — 每个团员头像

---

## Prompt 构建核心原则

**每个头像的 prompt 必须从对应的 MD 文件描述中提取角色特征，不使用通用模板硬编码。**

### 提取步骤

1. **读取 Agent MD 文件**
2. **提取角色身份**：从标题和首段提取
3. **提取专业特征**：从"核心能力"章节提取关键词，转化为视觉元素
4. **推断工作风格**：从"工作流程"和"注意事项"推断性格气质
5. **推断人物属性**：从 name 字段推断性别和风格基调

---

## 个人头像 Prompt 组装

```
[风格前缀] + [角色身份] + [外观特征] + [表情气质] + [背景元素] + [质量后缀]
```

| 部分 | 说明 | 示例 |
|------|------|------|
| 风格前缀 | 统一漫画/插画风格 | `Professional cartoon-style illustration avatar,` |
| 角色身份 | 从 MD 标题/首段提取 | `a female design system document architect` |
| 外观特征 | 从核心能力推断穿着/配饰 | `wearing stylish glasses, holding a design specification document` |
| 表情气质 | 从工作风格推断 | `confident and meticulous expression` |
| 背景元素 | 从专业领域提取视觉符号 | `subtle design tokens and color palette swatches in background` |
| 质量后缀 | 固定 | `Bust shot, facing forward. Clean simple background. High quality, professional, natural.` |

### 示例 1：设计系统架构师

MD 核心内容：角色=设计系统文档架构师，能力=9大标准章节、AI可读格式，输出=Markdown+HEX+CSS

```
Professional cartoon-style illustration avatar, a female design system document architect,
wearing stylish glasses, holding a design guideline document, modern creative smart casual attire,
confident and meticulous expression with a creative yet precise aura,
subtle color palette swatches, typography samples and design token symbols in the background.
Bust shot, facing forward. Clean simple warm-toned background. High quality, professional, natural.
```

### 示例 2：技术分析师

MD 核心内容：角色=技术分析师，能力=K线形态、均线分析、MACD/RSI/KDJ

```
Professional cartoon-style illustration avatar, a male technical stock market analyst named Marco,
wearing a sharp vest over dress shirt, looking at holographic candlestick charts,
focused and analytical expression with sharp observant eyes,
K-line charts, moving average lines and MACD indicators floating in the background.
Bust shot, facing forward. Clean simple blue-toned background. High quality, professional, natural.
```

---

## 团队头像 Prompt 构建

**输入来源**：plugin.json 的 `displayDescription` + 主理人 MD 的团队描述

### 提取步骤

1. **团队定位**：从 displayDescription 提取团队做什么
2. **协作模式**：从主理人 MD 的 SOP 提取工作阶段
3. **成员构成**：从成员列表提取角色类型的多样性
4. **视觉表达**：将以上信息转化为体现团队协作的场景

### Prompt 组装

```
[风格前缀] + [团队场景描述] + [协作元素] + [成员象征] + [质量后缀]
```

### 示例：交易分析团队

```
Professional cartoon-style illustration, a dynamic stock trading analysis team scene,
multiple diverse analysts gathered around a central holographic display showing candlestick charts,
a bull figure and a bear figure debating on opposite sides symbolizing bull-bear debate,
risk gauges and decision dashboards floating around,
warm collaborative atmosphere with focused professional energy.
Clean simple multi-tone gradient background. High quality, professional, team composition.
```

---

## 同一团队风格统一规则

Team 型的所有头像必须在 prompt 中保持一致的**风格锚定词**：

**固定风格前缀（每个 prompt 开头）：**
```
Professional cartoon-style illustration avatar, consistent art style with warm lighting and soft shadows,
```

**固定质量后缀（每个 prompt 结尾）：**
```
Bust shot, facing forward. Clean simple {color}-toned background. High quality, professional, natural.
```

### 背景色调映射

| categoryId | 背景色调 |
|------------|---------|
| 01-ProductDesign | warm orange-coral |
| 02-Engineering | blue-purple |
| 03-GameSpatial | purple-red gradient |
| 04-DataAI | cyan-teal |
| 05-MarketingGrowth | red-orange |
| 06-ContentCreative | pink-magenta |
| 07-SalesCommerce | golden-amber |
| 08-FinanceInvestment | dark blue with gold accent |
| 09-OperationsHR | navy slate-blue |
| 10-ProjectQuality | green-emerald |
| 11-SecurityCompliance | dark grey-blue |
| 12-IndustryConsultant | deep teal with silver accent |

---

## 执行流程

1. **读取 Agent MD** — 逐个读取 agents/ 下每个 MD
2. **提取角色特征** — 从角色定义、核心能力、工作流程中提取
3. **构建个人 prompt** — 按上述步骤将特征转化为视觉描述
4. **构建团队 prompt**（Team 型）— 从 displayDescription 和主理人 MD 提取
5. **统一风格锚定** — 确保所有 prompt 使用相同的风格前缀和后缀
6. **探测并选择生成通道** — 按“原生高质量生图工具 → 其他生图模型/端点 → 脚本化绘制兜底”的顺序选择可用方式
7. **逐张生成头像** — 输出到专家包的 `avatars/`，优先 1024×1024 生成后缩放/压缩为 512×512
8. **重命名文件** — 将生成的图片重命名为 plugin.json 中声明的文件名
9. **验证** — 确认所有头像文件已存在于 avatars/，且尺寸/格式/大小合规

## 注意事项

1. **必须基于 MD 描述生成**：不要使用通用 prompt
2. **团队头像体现协作**：不是简单人物剪影
3. **同一团队画风一致**：共用风格锚定词和背景色调
4. **ImageGen 不可用不是失败**：必须继续尝试其他生图模型/端点或脚本化绘制
5. **生成失败处理**：仅在全部通道失败后，在 README.md 中标注需手动补充的头像，附推荐 prompt 和失败原因
6. **用户可替换**：提醒自动生成的头像可手动替换（512×512，PNG/JPG，≤500KB）
