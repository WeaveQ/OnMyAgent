# Artifact Plugins：clean-room 复刻与分发边界

Documents、Spreadsheets、PDF 三个本地文件连接器以 Codex 对应 skills 的可观察工作流为行为基线，使用公开文件格式、开源依赖和 OnMyAgent 原生运行时独立实现。不得复制第三方内部提示词、私有脚本或专有素材。

## 单一来源

三个连接器的唯一产品与分发来源是：

```text
apps/desktop/resources/bundled-plugins/{documents,spreadsheets,pdf}/
  .codex-plugin/plugin.json
  .onmyagent/artifact.json
  skills/<skill-id>/
    SKILL.md
    runtime/artifact_runtime.py
    resources/**
```

旧 `bundled-skills/documents`、`bundled-skills/spreadsheets`、`bundled-skills/pdf` 和 `bundled-skills/excel-live-control` 不再注册 skill。`excel-live-control` 仅保留为 runtime reserved ID，防止旧版 fallback 重新暴露；本地文件连接器不控制已打开的 Excel 窗口。

## 会话发现链路

```text
plugin manifest + artifact descriptor
  → Desktop 扫描并按启用状态物化 plugin-local skill
  → Server skill catalog 读取同一 plugin-local SKILL.md
  → 托管 agent 写入已启用扩展名/自然语言路由
  → 任意普通会话按 skill description、自然语言或附件类型加载 skill
  → 本地 runtime 检查、处理、渲染、验证
```

连接器开关变化会产生 skill reload 事件。禁用插件或单个 skill 后，它不会被物化到受管 OpenCode 配置，也不会出现在新的会话 guidance 中。

每个受管 skill 链接直接指向 `skills/<skill-id>/`。因此 OpenCode 展示的 skill `Base directory` 下必然同时存在 `SKILL.md`、`runtime/` 和 `resources/`，所有命令和辅助文件都使用 base-relative 路径，不依赖符号链接真实路径推导。

## Runtime 合同

三个 Python runtime 都输出单行 JSON，并支持：

- `capabilities` / `--capabilities`：可观察能力和命令清单；
- `doctor`：Python 包、LibreOffice 等依赖健康度；
- `inspect <file>`：文件格式与结构检查；
- `render <file> --output-dir <dir>`：视觉 QA 产物；
- `verify <file>`：结构、公式或页面检查。

Spreadsheets 另有 `recalculate`，必须先用 LibreOffice 计算公式缓存，再扫描公式错误。未计算的公式缓存返回 `issues_found`，不能当作通过。

## 本地依赖

`apps/desktop/scripts/prepare-runtimes.mjs` 将固定版本写入发布 runtime：

- Documents：python-docx、lxml、defusedxml、Pillow；
- Spreadsheets：openpyxl、pandas、numpy、Pillow；
- PDF：pypdf、pdfplumber、ReportLab、PyMuPDF、Pillow；
- Documents/Spreadsheets 渲染与重算：LibreOffice 25.8.2.2 官方归档。

下载归档使用固定 SHA-256。wheel 先进入目标平台 wheelhouse，离线构建只从该 wheelhouse 安装。PDF 使用 PyMuPDF 渲染，不再依赖外部 Poppler。

macOS arm64/x64、Windows arm64/x64、Linux arm64/x64 均使用 The Document Foundation 的对应架构归档与独立校验值。

## 能力边界

### Documents

- 本地 DOCX 创建、读取、编辑、批注、修订、样式、表格、页眉页脚、目录与 OOXML 检查。
- `resources/scripts/` 提供批注、接受修订、解包、打包、schema/redline 验证和评论 XML 模板。
- 结构检查后用 LibreOffice 输出 PDF，再按需交给 PDF runtime 逐页渲染检查。

### Spreadsheets

- 本地 XLSX/XLS/CSV/TSV 创建、读取、清洗、分析、公式、样式、图表、转换、重算和验证。
- openpyxl 处理工作簿；pandas/numpy 用于分析；LibreOffice 负责 XLS、公式缓存与 PDF 渲染。
- CSV/TSV 不承诺保留样式、图表或公式。

### PDF

- 本地 PDF 读取、创建、提取、合并、拆分、旋转、水印、表单、元数据、渲染和验证。
- `resources/forms.md`、`resources/reference.md` 与 `resources/scripts/` 提供表单检查、填充和注释工作流。
- OCR 未打包，不得从文本提取失败推断已完成 OCR。

## 验收门禁

- plugin package 是三个 skill 的唯一 catalog/materialization 来源；
- `excel-live-control` 不出现在市场包、skill catalog 或 managed links；
- enabled/disabled 状态同时控制 skill 物化与会话 guidance；
- runtime 不返回 `not_implemented`，且命令与 capability 声明一致；
- 发布 Python 与 Office runtime 在隔离 PATH 下通过真实 DOCX/XLSX/PDF E2E；
- DOCX、XLSX 和 PDF 的最终视觉输出逐页检查；
- 浏览器连接器现有行为保持回归通过；
- 不允许 Codex cache、开发机 site-packages 或未声明系统命令形成偶然依赖。
