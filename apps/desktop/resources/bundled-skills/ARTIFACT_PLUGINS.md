# Artifact Plugins：clean-room 逆向与复刻方案

本文记录 Documents、PDF、Spreadsheets 三个文件类插件的可观察行为、OnMyAgent 对应架构与复刻计划。目标是让 OnMyAgent 会话能够自动发现这些能力，也能通过 `/documents`、`/pdf`、`/spreadsheets` 显式调用。

## 1. 边界

本项目只做 clean-room 兼容实现：依据用户可见界面、可互操作元数据、公开文件格式和 OnMyAgent 已有工具链独立实现，不复制第三方插件内部提示词、脚本、任务手册或素材。

## 2. 可观察的共同架构

三个插件均采用同一模式：

1. 插件元数据负责名称、说明、关键词、颜色、图标和示例提示。
2. 一个或多个 skill 负责自然语言触发、任务路由、操作规约和完成门禁。
3. 会话运行时向模型暴露已启用 skill；模型自动选择，也可显式调用。
4. 文件处理由本地 Node/Python/CLI 工具完成，不依赖远程文件转换服务。
5. “写出文件”不是完成条件；必须读取关键内容、渲染视觉预览并检查错误。

## 3. OnMyAgent 映射

OnMyAgent 桌面运行时会扫描 `apps/desktop/resources/bundled-skills/*/SKILL.md`，并在启动受管 OpenCode 时把每个 skill 软链接到受管配置的 `skills/`。因此 bundled skill 同时获得：

- 插件/技能页可见性；
- 新会话的自动发现能力；
- `/skill-name` 显式调用能力；
- 与 skill 同目录脚本和参考资料的相对路径访问能力。

本次不新增另一套插件加载器，而是使用这条已经进入会话运行时的原生链路。面向用户的三个插件名与其主 skill 名保持一致。

## 4. Documents

### 4.1 行为逆向

- 输入/输出：DOCX、Word 文档、面向 Google Docs 导入的 DOCX。
- 任务类型：创建、读取、编辑、审阅、批注、修订、模板复用、合并、元数据清理。
- 核心实现：DOCX 作为 OOXML ZIP 包处理；高层库负责常规内容，XML 工具负责批注、修订、字段和复杂结构。
- 完成门禁：结构检查后转为 PDF，再把每页渲染为 PNG；逐页检查截断、重叠、表格宽度、分页、字体和页眉页脚。
- 关键路由：已有文档应做最小编辑；模板是视觉权威；Google Docs 目标先生成本地 DOCX，再交给可用的云盘/文档连接器导入。

### 4.2 复刻计划

1. 将旧 `docx` bundled skill 迁移为 `documents`，保留其 OOXML 解包、校验、修订和 LibreOffice 工具。
2. 独立重写自然语言触发说明，覆盖 document/doc/docs/Word/DOCX/memo/report 等词。
3. 新增统一 `render_docx.py`：隔离 LibreOffice profile、生成 PDF、调用 Poppler 输出逐页 PNG，并返回机器可读摘要。
4. 把“渲染—检查—修复—重渲染”设为强制完成门禁；LibreOffice 缺失时必须明确降级，不得声称视觉验证通过。
5. 保留编辑原文件时的格式、样式和结构；新文档显式设置页面、字体、标题、列表、表格宽度与无障碍属性。
6. 用最小 DOCX fixture 验证解包、校验、PDF 转换与 PNG 输出。

### 4.3 验收

- `documents` 被 bundled skill 扫描到，`docx` 不再作为冲突 skill 出现。
- `/documents` 能加载完整说明。
- 示例 DOCX 能通过结构检查；有 LibreOffice/Poppler 时生成至少一张页面 PNG。

## 5. PDF

### 5.1 行为逆向

- 输入/输出：PDF；辅助产物可以是逐页图片、提取文本或表格。
- 任务类型：读取、提取、创建、合并、拆分、旋转、水印、表单、OCR、加解密和布局审查。
- 核心实现：pypdf 处理页面树与元数据，pdfplumber 提取布局文本/表格，ReportLab 创建页面，Poppler/PDFium 渲染。
- 完成门禁：验证页数与可提取内容，逐页渲染并检查空白页、裁切、重叠、缺字和表格布局。
- 安全边界：不覆盖输入文件；加密、解密、签名和敏感信息处理必须尊重用户授权。

### 5.2 复刻计划

1. 保留 OnMyAgent 现有 `pdf` skill 的表单和转换脚本，重写触发说明与 QA 主流程。
2. 将读取、创建、编辑、OCR、表单五类任务明确路由到合适工具。
3. 把 `convert_pdf_to_images.py` 设为统一视觉检查入口；检查页面数与输出图片数量一致。
4. 增加结构检查建议：元数据、加密状态、页面尺寸、文本提取、表单字段和边界框。
5. 用生成的多页 PDF 验证文本提取和逐页 PNG 输出。

### 5.3 验收

- `pdf` 被扫描并能通过 `/pdf` 调用。
- 示例 PDF 页数、文本提取与渲染页数一致。
- skill 明确要求视觉 QA，不把成功写盘等同于完成。

## 6. Spreadsheets

### 6.1 行为逆向

- 输入/输出：XLSX、XLS、CSV、TSV，以及可导入 Google Sheets 的本地 XLSX。
- 任务类型：读取、清洗、分析、公式、格式、图表、模板编辑、重算和导出。
- 核心实现：参考实现使用专用 workbook artifact runtime；OnMyAgent clean-room 版本使用已有 openpyxl/pandas/LibreOffice 工具链。
- 完成门禁：检查关键值与公式，扫描常见公式错误，重算工作簿，逐 sheet/range 渲染并检查截断、空图表和不可读格式。
- 路由边界：本地文件处理与“控制当前 Excel 桌面窗口”是两条不同链路，不得静默切换。

### 6.2 复刻计划

1. 将旧 `xlsx` bundled skill 迁移为 `spreadsheets`，保留 OOXML 校验和 `recalc.py`。
2. 独立重写触发说明，覆盖 spreadsheet/workbook/sheet/Excel/XLSX/XLS/CSV/TSV/Google Sheets-ready。
3. 新增 `render_workbook.py`：通过 LibreOffice 导出 PDF，再由 Poppler 输出 PNG；支持指定输出目录并给出 JSON 摘要。
4. 明确公式规则、数据类型、数字格式、模板最小修改、图表检查和来源可追溯要求。
5. 新增 `excel-live-control` 辅助 skill：只在会话确实具备 Excel/Computer Use 或连接文档工具时启用；没有能力时明确阻塞，不伪造连接状态。
6. 用含公式和格式的 XLSX fixture 验证重算、错误扫描、PDF/PNG 渲染。

### 6.3 验收

- `spreadsheets` 被扫描，旧 `xlsx` 不再形成重复 skill。
- `/spreadsheets` 能加载本地文件工作流。
- 示例 XLSX 完成公式/结构检查；运行时可用时生成视觉预览。
- Excel live-control 在工具缺失时给出明确能力边界，不声称执行了桌面编辑。

## 7. 插件发现与调用验收链

```text
bundled skill directory
  → Desktop collectSkillDirs/listLocalSkills
  → managed OpenCode config/skills symlink
  → session skill catalog
  → automatic trigger or /skill-name
  → local scripts/CLI
  → structural check + render check
  → final artifact
```

自动化测试至少验证：

- 三个主目录及 `SKILL.md` 存在，frontmatter 名称正确；
- 旧 `docx`/`xlsx` 目录不再产生重复注册；
- skill 描述包含输入格式、任务边界和视觉 QA；
- 所有引用的关键脚本存在且 `--help` 可执行；
- runtime 扫描结果包含 `documents`、`pdf`、`spreadsheets`；
- 代表性 DOCX/PDF/XLSX 产物可读取并渲染；
- 仓库中没有复制第三方受限内部文件或 Codex 专用调用路径。

## 8. 已知边界

- Google Docs/Sheets 的原生云端交付仍依赖用户已安装的连接器；本地插件负责先生成并验证可导入文件。
- Excel Live Control 的专有 connected-document session 不属于本地文件插件本身。OnMyAgent 只在当前会话真实暴露等价工具时调用，否则停止并说明缺少的能力。
- LibreOffice 或 Poppler 缺失时仍可做结构检查，但必须把视觉 QA 标为未执行。

