# 来源与重构说明

本技能根据本机 WorkBuddy `document-skills` 1.0.1 插件重构而来。

迁移内容包括原 `document-processing-expert` 的 Word、Excel、PowerPoint、PDF
能力范围，以及用途判断、模板保留、批量处理、中文文档、编码、大文件和敏感
内容复核等工作要求。

本项目已经为 DOCX、表格、PPTX 和 PDF 提供独立且可验证的文档运行能力，因此
没有复制原插件内三套重复的 Office XML schema、打包脚本、头像和 Agent 配置。
新技能改为统一入口，按格式调用现有 `documents`、`spreadsheets`、`pptx`、
`pdf` 技能，以减少包体、重复依赖和维护分叉。

原插件安装副本声明为 CodeBuddy Teams proprietary software，但未附带其
`SKILL.md` 所引用的 `LICENSE.txt`。本目录只保留重新编写的工作流说明，不包含
原插件的运行代码、schema 或模板资源。
