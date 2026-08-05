#!/usr/bin/env python3
import os
import sys
import json
import argparse
import requests
from bs4 import BeautifulSoup
import re
from collections import Counter

# 设置输出编码
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def extract_keywords(text, count=5):
    """提取关键词"""
    # 去除标点和特殊字符
    text = re.sub(r'[^\w\s]', '', text)
    # 分词（简单按空格和中文分词）
    words = re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+', text)
    # 过滤停用词
    stopwords = {'的', '了', '和', '是', '在', '我', '有', '也', '都', '就', '要', '会', '可以', '这个', '这样', '非常', '因为', '所以', '但是', '而且', 'the', 'and', 'of', 'to', 'a', 'is', 'in', 'for', 'on', 'with'}
    words = [w for w in words if len(w)>=2 and w not in stopwords]
    # 统计频率
    counter = Counter(words)
    return [w for w, _ in counter.most_common(count)]

def generate_summary(text, length='medium'):
    """生成摘要"""
    # 按句子分割
    sentences = re.split(r'([。！？.!?])', text)
    # 合并句子和标点
    sentences = [''.join(i) for i in zip(sentences[0::2], sentences[1::2])]
    sentences = [s.strip() for s in sentences if s.strip()]
    
    if not sentences:
        return "无有效内容"
    
    # 根据长度选择句子数量
    length_map = {
        'short': max(2, min(3, len(sentences))),
        'medium': max(3, min(6, len(sentences))),
        'long': max(6, min(12, len(sentences)))
    }
    take_count = length_map.get(length, 3)
    
    # 优先选择包含数字、关键词的句子
    priority_sentences = []
    normal_sentences = []
    for s in sentences:
        if re.search(r'\d+', s) or any(k in s for k in ['核心', '主要', '关键', '重要', '结论', '结果', '显示', '表明', '摘要', 'Abstract', '目的', '方法', '结论']):
            priority_sentences.append(s)
        else:
            normal_sentences.append(s)
    
    summary_sentences = priority_sentences[:take_count] + normal_sentences[:max(0, take_count - len(priority_sentences))]
    summary = ''.join(summary_sentences[:take_count])
    
    # 过长则截断
    max_len_map = {'short': 300, 'medium': 600, 'long': 1500}
    max_len = max_len_map.get(length, 600)
    if len(summary) > max_len:
        summary = summary[:max_len] + "..."
    
    return summary

def get_url_content(url):
    """抓取网页正文内容"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        response = requests.get(url, headers=headers, timeout=30)
        response.encoding = response.apparent_encoding
        soup = BeautifulSoup(response.text, 'html.parser')
        # 移除无用标签
        for tag in soup(['script', 'style', 'nav', 'footer', 'aside', 'header', 'advertisement', 'ad']):
            tag.decompose()
        # 提取正文
        text = soup.get_text(separator='\n', strip=True)
        # 去除多余空行
        text = re.sub(r'\n+', '\n', text)
        return text
    except Exception as e:
        print(f"[错误] 抓取网页失败: {str(e)}")
        sys.exit(1)

def get_file_content(file_path):
    """读取文件内容"""
    if not os.path.exists(file_path):
        print(f"[错误] 文件不存在: {file_path}")
        sys.exit(1)
    try:
        ext = os.path.splitext(file_path)[1].lower()
        if ext in ['.txt', '.md', '.py', '.js', '.java', '.cpp', '.c', '.html', '.css']:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read()
        elif ext == '.docx':
            # 简单docx读取
            try:
                import docx
                doc = docx.Document(file_path)
                return '\n'.join([p.text for p in doc.paragraphs])
            except ImportError:
                print("[提示] 读取docx需要安装python-docx: pip install python-docx")
                sys.exit(1)
        elif ext == '.pdf':
            # 读取PDF
            from PyPDF2 import PdfReader
            reader = PdfReader(file_path)
            text = ''
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + '\n'
            return text
        else:
            print(f"[错误] 不支持的文件格式: {ext}")
            sys.exit(1)
    except Exception as e:
        print(f"[错误] 读取文件失败: {str(e)}")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="智能内容摘要工具")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('text', nargs='?', help="需要摘要的文本内容")
    group.add_argument('--file', help="本地文件路径")
    group.add_argument('--url', help="网页URL地址")
    group.add_argument('--keywords', help="提取关键词的文本内容")
    
    parser.add_argument('--length', choices=['short', 'medium', 'long'], default='medium', help="摘要长度")
    parser.add_argument('--output', choices=['text', 'markdown', 'json'], default='text', help="输出格式")
    parser.add_argument('--keywords-count', type=int, default=8, help="提取关键词数量")
    parser.add_argument('--include-meta', action='store_true', help="是否包含元信息")
    
    args = parser.parse_args()
    
    # 处理关键词提取
    if args.keywords:
        text = args.keywords
        keywords = extract_keywords(text, args.keywords_count)
        if args.output == 'json':
            print(json.dumps({"keywords": keywords}, ensure_ascii=False, indent=2))
        elif args.output == 'markdown':
            print("### 关键词\n" + '\n'.join([f"- {k}" for k in keywords]))
        else:
            print(f"关键词: {', '.join(keywords)}")
        return
    
    # 获取内容
    if args.text:
        text = args.text
        source = "输入文本"
    elif args.file:
        text = get_file_content(args.file)
        source = args.file
    elif args.url:
        text = get_url_content(args.url)
        source = args.url
    
    # 生成结果
    summary = generate_summary(text, args.length)
    keywords = extract_keywords(text, args.keywords_count)
    word_count = len(text)
    
    # 输出
    if args.output == 'json':
        result = {
            "summary": summary,
            "keywords": keywords,
            "source": source,
            "word_count": word_count,
            "length": args.length
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.output == 'markdown':
        print("## 📄 文件内容摘要")
        print(f"\n{summary}\n")
        print("### 🔑 核心关键词")
        print('\n'.join([f"- {k}" for k in keywords]))
        if args.include_meta:
            print("\n### ℹ️ 元信息")
            print(f"- 来源文件: {os.path.basename(source)}")
            print(f"- 原文字数: {word_count} 字")
            print(f"- 摘要长度: {'简短' if args.length=='short' else '标准' if args.length=='medium' else '详细'}")
    else:
        print(f"【摘要】{summary}\n")
        print(f"【关键词】{', '.join(keywords)}")
        if args.include_meta:
            print(f"\n【来源】{os.path.basename(source)}")
            print(f"【原文字数】{word_count}")

if __name__ == "__main__":
    main()
