---
name: summarize
version: 1.0.0
description: 智能内容摘要工具，支持长文本、文档、网页内容自动摘要，提取核心要点、关键词，支持自定义摘要长度。
metadata:
  author: openclaw-community
  category: productivity
  capabilities:
    - 长文本智能摘要，保留核心信息
    - 支持TXT/MD/PDF等常见文档摘要
    - 网页内容自动抓取+摘要生成
    - 提取核心关键词、关键短语
    - 自定义摘要长度（短句/段落/详细）
    - 多语言支持（中文/英文）
---

# Summarize 智能内容摘要工具

自动对各类内容进行结构化摘要，提炼核心信息，节省阅读时间。

## 核心功能
### 1. 文本摘要
直接输入长文本，自动生成结构化摘要：
- 支持最多10万字长文本处理
- 自动提炼核心观点、关键结论
- 保留重要数据、时间、人物等关键信息
- 支持自定义摘要长度（简洁/标准/详细）

### 2. 文档摘要
支持本地常见文档直接摘要：
- 支持格式：.txt/.md/.docx/.pdf
- 自动提取内容，保留排版信息
- 生成文档大纲+核心内容摘要

### 3. 网页摘要
输入URL自动抓取网页内容并生成摘要：
- 自动过滤广告、导航栏等无效内容
- 提取正文核心信息
- 保留来源链接、发布时间等元信息

### 4. 关键词提取
自动提取内容核心关键词、关键短语：
- 关键词按重要程度排序
- 支持自定义关键词数量
- 自动识别专有名词、行业术语

## 使用方法
### 基础使用
```powershell
# 直接摘要文本
summarize "这里是需要摘要的长文本内容..."

# 从文件读取内容摘要
summarize --file ./report.md

# 网页内容摘要
summarize --url https://example.com/article

# 提取关键词
summarize --keywords "文本内容"
```

### 高级参数
| 参数 | 说明 | 默认值 |
|------|------|--------|
| --length | 摘要长度：short/medium/long | medium |
| --output | 输出格式：text/markdown/json | text |
| --keywords-count | 提取关键词数量 | 5 |
| --include-meta | 是否包含元信息（字数、统计等） | false |

## 示例
### 文本摘要
```powershell
summarize --length long "2026年AI行业发展报告全文..."
```
输出：
> 【摘要】2026年AI行业核心进展包括...主要趋势包括...面临的挑战包括...
> 【关键词】AI大模型, 多模态, 推理成本, 智能体

### 网页摘要
```powershell
summarize --url https://zhuanlan.zhihu.com/p/xxxxxxxxxx --output markdown
```
