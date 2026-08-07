---
name: media-downloader
description: |
  智能媒体下载器。根据用户描述自动搜索和下载图片、视频片段，支持视频自动剪辑。
  Smart media downloader. Automatically search and download images/video clips based on user description, with auto-trimming support.
  触发方式 Triggers: "下载图片", "找视频", "download media", "download images", "find video", "/media"
version: 1.0.0
display_name: "智能媒体下载器"
display_name_en: "Smart Media Downloader"
description_zh: "根据用户描述自动搜索和下载图片、视频片段。支持 Pexels/Unsplash/Pixabay 三大图库、YouTube 视频下载与自动剪辑。"
description_en: "Smart media downloader. Automatically search and download images and video clips from Pexels, Unsplash, Pixabay. Supports YouTube video download and auto-trimming."
visibility: "public"
---

# Media Downloader / 智能媒体下载器

只需告诉我你想要什么，我就会帮你找到并下载相关的图片和视频！

## 功能概览

| 你说... | 我会... |
|---------|---------|
| "下载一些可爱的猫咪图片" | 搜索并下载 5 张猫咪图片 |
| "Download sunset photos" | Search and download sunset images |
| "找一段海浪的视频，15秒左右" | 下载一段 15 秒的海浪视频 |
| "Get me a 30-second cooking video" | Download a trimmed cooking clip |
| "下载这个 YouTube 视频的 1:30-2:00" | 下载并自动剪辑指定片段 |

## 功能特点

- 图片下载 - 从专业图库搜索高清图片（默认原图分辨率）
- 视频素材 - 获取免费商用视频片段
- YouTube 下载 - 支持下载和剪辑
- 智能剪辑 - 自动裁剪到你需要的长度
- 中英双语 - 支持中文和英文指令

## 执行逻辑

### API Key 按需配置

重要：不要在用户安装时就要求配置 API Key。按以下逻辑处理：

1. **用户下载 YouTube 视频时**：直接执行，不需要任何 API Key
2. **用户首次下载图片时**：
   - 运行 `python <skill_dir>/media_cli.py status` 检查所有 API Key 状态
   - 若三平台（Pexels / Unsplash / Pixabay）都未配置，列出三者对比引导用户选择：
     | 平台 | 免费 | 图片特点 |
     |------|------|---------|
     | Pexels | 是 | 高质量，更新快，搜索英文效果更好 |
     | Pixabay | 是 | 数量多，种类全，插图/矢量图丰富 |
     | Unsplash | 是 | 艺术感强，风光/人文类尤其出色 |
   - 若有任一已配置，直接用已有源下载；向用户提一句可补配其他源扩大覆盖范围
   - 获取方式均为免费注册后一键生成，流程类似 Pexels

### YouTube 下载优先

当用户说"下载视频"但没有指定来源时，优先推荐 YouTube：
- YouTube 不需要 API Key
- 内容更丰富
- 支持时间段裁剪

## 使用示例

### 下载图片

```
"帮我下载 5 张星空的图片"
"Download 10 coffee shop photos"
"找一些适合做壁纸的风景图"
```

### 下载视频素材

```
"下载一段城市夜景的视频，30秒以内"
"Find me a 15-second ocean wave video"
"找一些适合做背景的自然风光视频"
```

### YouTube 下载与剪辑

```
"下载这个视频：https://youtube.com/watch?v=xxx"
"下载这个 YouTube 视频的第 2 分钟到第 3 分钟"
"只下载这个视频的音频"
```

## 下载位置

所有文件默认保存在 `~/.workbuddy/skills/media-downloader/downloads/`

## CLI 命令参考

```bash
# 检查配置状态
python <skill_dir>/media_cli.py status

# 下载图片
python <skill_dir>/media_cli.py image "关键词" -n 数量 -o 输出目录

# 下载视频素材
python <skill_dir>/media_cli.py video "关键词" -d 最大时长 -n 数量

# 下载 YouTube 视频
python <skill_dir>/media_cli.py youtube "URL" --start 开始秒数 --end 结束秒数

# 搜索媒体（不下载）
python <skill_dir>/media_cli.py search "关键词" --type image/video/all

# 剪辑本地视频
python <skill_dir>/media_cli.py trim 输入文件 --start 开始 --end 结束
```

## 支持的素材来源

| 来源 | 类型 | 特点 |
|------|------|------|
| Pexels | 图片 + 视频 | 高质量，更新快 |
| Pixabay | 图片 + 视频 | 数量多，种类全 |
| Unsplash | 图片 | 艺术感强，适合壁纸 |
| YouTube | 视频 | 内容丰富，支持剪辑 |

## 依赖安装

使用前需要安装以下依赖：

```bash
# 安装 requests（图片/视频搜索下载必需）
pip install requests

# 安装 yt-dlp（YouTube 下载必需）
pip install yt-dlp

# 安装 ffmpeg（视频剪辑必需）
# Windows: winget install ffmpeg
# macOS: brew install ffmpeg
# Linux: sudo apt install ffmpeg
```
