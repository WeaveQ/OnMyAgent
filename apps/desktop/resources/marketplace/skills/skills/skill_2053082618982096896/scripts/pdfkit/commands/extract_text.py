#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""提取 PDF 文本内容。

- 有文字层的页面：直接提取文字层文本
- 纯扫描件页面（无文字层）：启用 --ocr_fallback 时自动 OCR 提取
- CID 乱码 / 字体损坏页面：启用 --ocr_fallback 时自动 OCR 提取（与扫描件等同处理）
- 混合型页面（文字层 + 嵌入图片）：仅提取文字层文本，不对图片做 OCR
- 加密 PDF：直接返回 error_type="encrypted"，引导用户先用 decrypt 命令解密
"""

import os
import re

COMMAND = "extract_text"
DESCRIPTION = (
    "提取 PDF 文本内容，支持按页输出。仅对纯扫描件（无文字层）或文字层 CID 乱码的页面"
    "支持 --ocr_fallback OCR 降级，混合型页面中嵌入图片上的文字不会被提取。"
    "加密 PDF 会直接返回 error_type=\"encrypted\"，请先用 decrypt 命令解密。"
)
CATEGORY = "read"

PARAMS = [
    {"name": "input",  "type": "str",  "required": True,  "help": "Input PDF path"},
    {"name": "pages",  "type": "json", "required": False, "help": "Page indices (0-based JSON array)"},
    {"name": "output", "type": "str",  "required": False, "help": "Output text file path (optional)"},
    {"name": "format", "type": "str",  "required": False, "default": "text",
     "choices": ["text", "dict", "blocks", "words", "html"], "help": "Output format"},
    {"name": "ocr_fallback", "type": "bool", "required": False, "default": False,
     "help": "当页面无文字层或文字层为 CID 乱码时自动使用 OCR 提取（混合型页面中的图片不会 OCR，需要 tesseract）"},
    {"name": "lang", "type": "str", "required": False, "default": "eng+chi_sim",
     "help": "OCR 语言（仅 ocr_fallback=true 时生效）"},
]

# 全 (cid:xxx) 模式（PDF 字体 ToUnicode 缺失时常见）
_CID_GARBAGE_PATTERN = re.compile(r"(\s*\(cid:\d+\)\s*)+")
# 可读字符占比阈值：低于此值视为乱码
_READABLE_RATIO_THRESHOLD = 0.1


def _looks_like_cid_garbage(text):
    """判断文字层是否为 CID 乱码 / 不可读字符。

    触发条件（任一）：
    1. 全文匹配 ``(cid:数字)`` 模式
    2. 可读字符（字母数字 / CJK 汉字）占比低于 10%

    Args:
        text: 待检测的文字层文本

    Returns:
        bool: True 表示文字层不可读，应触发 OCR 兜底
    """
    if not text:
        return False
    stripped = text.strip()
    if not stripped:
        return False

    # 全是 (cid:xxx) 模式
    if _CID_GARBAGE_PATTERN.fullmatch(stripped):
        return True

    # 可读字符占比检查
    readable = sum(
        1 for c in stripped
        if c.isalnum() or "\u4e00" <= c <= "\u9fff"
    )
    return readable / max(len(stripped), 1) < _READABLE_RATIO_THRESHOLD


def handler(params):
    import fitz
    import json

    input_path = params["input"]
    target_pages = params.get("pages")
    output_path = params.get("output")
    fmt = params.get("format", "text")
    ocr_fallback = params.get("ocr_fallback", False)
    ocr_lang = params.get("lang", "eng+chi_sim")

    if not os.path.exists(input_path):
        raise FileNotFoundError(f"文件不存在: {input_path}")

    doc = fitz.open(input_path)

    # 加密检测：放在最前面，避免下游逻辑空跑出误导性结果
    # 部分 PDF 仅"伪加密"（owner password 限制但允许空 user password 读取），
    # 先尝试空密码解锁；解锁失败才视为真加密。
    if doc.is_encrypted and not doc.authenticate(""):
        doc.close()
        return {
            "success": False,
            "error_type": "encrypted",
            "input": input_path,
            "hint": (
                "PDF 已加密，无法直接读取。请先使用 decrypt 命令解密后再操作："
                "pdfkit.py decrypt --input <file> --output <out> --password <密码>，"
                "然后对解密后的文件再调用 extract_text。"
            ),
        }

    total_pages = len(doc)
    page_indices = target_pages if target_pages else list(range(total_pages))

    results = []
    total_chars = 0
    empty_pages = []      # 无文字层 / 乱码的页面（视为不可读）
    ocr_pages = []        # 通过 OCR 成功提取的页面
    garbage_pages = []    # 文字层存在但是 CID 乱码的页面（用于诊断信息）

    for i in page_indices:
        if i < 0 or i >= total_pages:
            continue
        page = doc[i]

        if fmt == "text":
            content = page.get_text("text")
        elif fmt == "dict":
            content = page.get_text("dict")
        elif fmt == "blocks":
            content = page.get_text("blocks")
        elif fmt == "words":
            content = page.get_text("words")
        elif fmt == "html":
            content = page.get_text("html")
        else:
            content = page.get_text("text")

        plain = page.get_text("text")
        char_count = len(plain.strip())
        total_chars += char_count

        # 判定是否需要 OCR 兜底：
        # - char_count == 0：纯扫描件 / 图片型页面
        # - _looks_like_cid_garbage：文字层存在但是 CID 乱码 / 不可读
        is_empty_layer = (char_count == 0)
        is_cid_garbage = (not is_empty_layer) and _looks_like_cid_garbage(plain)
        needs_ocr = is_empty_layer or is_cid_garbage

        if needs_ocr:
            empty_pages.append(i)
            if is_cid_garbage:
                garbage_pages.append(i)

            # 自动 OCR 降级：仅对 text 格式生效（其它格式对结构敏感，不替换）
            if ocr_fallback and fmt == "text":
                ocr_text = _ocr_extract_page_text(page, ocr_lang)
                if ocr_text:
                    # OCR 成功：替换原 content；从 total_chars 中扣除原乱码字数
                    if is_cid_garbage:
                        total_chars -= char_count
                    content = ocr_text
                    char_count = len(ocr_text.strip())
                    total_chars += char_count
                    ocr_pages.append(i)
                # OCR 失败时 content 保持原样（很可能为空或乱码），由末尾 hint 提示

        results.append({
            "page": i,
            "chars": char_count,
            "content": content,
            "source": "ocr" if i in ocr_pages else "text_layer",
        })

    doc.close()

    # 可选写入文件
    if output_path:
        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            if fmt == "text":
                for r in results:
                    f.write(f"--- Page {r['page']} ---\n")
                    f.write(r["content"])
                    f.write("\n")
            else:
                json.dump(results, f, ensure_ascii=False, indent=2)

    # 构建返回结果
    result = {
        "success": True,
        "pages_extracted": len(results),
        "total_chars": total_chars,
        "format": fmt,
        "output": output_path,
        "pages": results if fmt == "text" else None,
    }

    # 当存在不可读页面时，给出分类型提示
    if empty_pages:
        # 过滤掉已通过 OCR 成功提取的页面
        still_empty = [p for p in empty_pages if p not in ocr_pages]
        result["empty_pages"] = empty_pages
        result["ocr_pages"] = ocr_pages
        if garbage_pages:
            result["garbage_pages"] = garbage_pages

        if still_empty and not ocr_fallback:
            # 未启用 OCR 降级
            cause_desc = "扫描件 / FlateDecode 字体损坏 / CID 乱码"
            if garbage_pages and not [p for p in still_empty if p not in garbage_pages]:
                cause_desc = "文字层 CID 乱码或字体编码损坏"
            elif not garbage_pages:
                cause_desc = "纯扫描件 / 图片型 PDF"
            result["hint"] = (
                f"页面 {still_empty} 文字层为空或不可读（{cause_desc}）。"
                "请添加 --ocr_fallback 启用 OCR 兜底；若 OCR 仍失败，请用 to_images 把该页"
                "渲染为图片后人工确认，或请用户直接粘贴该页关键内容。"
                "严禁在未成功读取页面的情况下编造内容回答。"
                "示例：pdfkit.py extract_text --input <file> --pages '[0]' --ocr_fallback"
            )
        elif still_empty:
            # 已启用 OCR 但仍有页面失败
            result["hint"] = (
                f"已启用 OCR 但页面 {still_empty} 仍无法提取（可能是空白页 / 图片质量过低 / "
                "字体不在 OCR 语言包内）。建议：1) 调整 --lang（如增加 chi_tra/jpn）；"
                "2) 用 to_images 渲染该页 dpi=300 后人工查看；3) 请用户粘贴该页关键内容。"
                "严禁编造未读取到的内容。"
            )

    return result


def _ocr_extract_page_text(page, lang="eng+chi_sim"):
    """对单个页面进行 OCR 提取纯文本。

    Args:
        page: fitz.Page 对象
        lang: OCR 语言

    Returns:
        提取的文本字符串，失败返回空字符串
    """
    try:
        import io
        import pytesseract
        from PIL import Image
        from pdfkit.commands.smart_edit import _check_tesseract_langs

        # 预检测 OCR 语言包
        _check_tesseract_langs(lang)

        # 渲染为 300 DPI 高清图片
        import fitz
        zoom = 300.0 / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        img_data = pix.tobytes("png")
        img = Image.open(io.BytesIO(img_data))

        # OCR 识别，直接提取纯文本
        text = pytesseract.image_to_string(img, lang=lang)
        return text.strip()
    except ImportError:
        return ""
    except Exception as e:
        # OCR 失败不应阻断整个提取流程，返回空并在结果中体现
        import sys
        print(f"[warn] OCR 提取第 {page.number} 页失败: {e}", file=sys.stderr)
        return ""


if __name__ == "__main__":
    from pdfkit.base import main
    main(handler, params_schema=PARAMS, description=DESCRIPTION)
