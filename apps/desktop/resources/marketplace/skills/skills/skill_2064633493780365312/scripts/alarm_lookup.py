#!/usr/bin/env python3
"""
alarm_lookup.py — tcop-api 告警模块的 strategy_type 字典查询工具

封装 alarm_strategy.jsonl(全量产品 strategy_type 元数据,922 行)的查询逻辑。
被 monitor-alarm.md 引用,LLM 在用户提到非热门表内产品(Redis/CLB/PostgreSQL/ES/CDN 等)
或多 strategy_type 产品时,调用本脚本而非直接跑 jq——避免 jq 依赖、消除 cwd 假设。

数据源说明:
  原 monitor-alarm-data/alarm-products.jsonl 已合并进 data/alarm_strategy.jsonl,
  与 instance_resolver 共用同一份元数据,strategy_type == 旧 viewName。

子命令:
  search <pattern> [--field strategy_show_name_zh|strategy_show_name_en|strategy_type|cloud_product_show_name_zh|namespace] [--ignore-case]
      在指定字段上正则搜索,默认 strategy_show_name_zh 字段、不区分大小写。
      输出: 每行一条匹配结果,tab 分隔 "strategy_type\\tstrategy_show_name_zh\\tnamespace"
      场景: 用户说"Redis 的告警" → search Redis → 列出多个 Redis 相关 strategy_type

  get <strategy_type>
      按 strategy_type 精确查询单条记录,输出该记录完整 JSON(单行)。
      场景: 已拿到 strategy_type,反查它属于哪个产品/namespace 用于复核校对

  list_all [--limit N]
      列出全量记录(调试用),tab 分隔同 search。

设计原则:
  - 与 instance_resolver.py 风格一致(SCRIPT_DIR 自解析路径,与 cwd 无关)
  - 标准库实现(无 jq、无 tencentcloud-sdk 依赖,Python ≥ 3.7 即可)
  - 输出格式稳定: tab 分隔便于 LLM 二次解析,JSON 模式保留完整字段

Exit codes:
  0  成功(含搜索 0 命中)
  1  自定义错误(空 pattern、非法正则、get 子命令未命中——具体见各子命令)
  2  argparse 参数错误(子命令缺失/未知子命令/--field 非法值等),由 argparse 默认行为产生
  3  数据文件缺失或损坏
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# ---- 数据文件定位（与 cwd 无关） ----

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_FILE = SCRIPT_DIR.parent / "references" / "data" / "alarm_strategy.jsonl"

# 输出三列固定为 strategy_type / strategy_show_name_zh / namespace
# (namespace 来自原 alarm-products,合并后部分非 MT_QCE 行可能为 None)
OUTPUT_KEYS = ("strategy_type", "strategy_show_name_zh", "namespace")

SEARCH_FIELDS = (
    "strategy_show_name_zh",
    "strategy_show_name_en",
    "strategy_type",
    "cloud_product_show_name_zh",
    "namespace",
)


def _load_records() -> list[dict]:
    if not DATA_FILE.exists():
        sys.stderr.write(f"[FATAL] data file missing: {DATA_FILE}\n")
        sys.exit(3)
    out: list[dict] = []
    with open(DATA_FILE, encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                sys.stderr.write(f"[FATAL] {DATA_FILE.name}:{ln} invalid JSON: {e}\n")
                sys.exit(3)
    return out


def _format_row(rec: dict) -> str:
    # tab 分隔: strategy_type \t strategy_show_name_zh \t namespace
    # None 字段渲染为空串,保持列对齐
    return "\t".join(str(rec.get(k) or "") for k in OUTPUT_KEYS)


# ---- 子命令实现 ----

def cmd_search(args: argparse.Namespace) -> int:
    if not args.pattern:
        sys.stderr.write("[ERROR] empty pattern not allowed (would match all 922 records)\n")
        return 1
    flags = re.IGNORECASE if args.ignore_case else 0
    try:
        pattern = re.compile(args.pattern, flags)
    except re.error as e:
        sys.stderr.write(f"[ERROR] invalid regex: {e}\n")
        return 1
    records = _load_records()
    matched = [r for r in records if pattern.search(str(r.get(args.field) or ""))]
    for rec in matched:
        print(_format_row(rec))
    sys.stderr.write(f"[INFO] {len(matched)} match(es) for pattern={args.pattern!r} field={args.field}\n")
    return 0


def cmd_get(args: argparse.Namespace) -> int:
    records = _load_records()
    for rec in records:
        if rec.get("strategy_type") == args.strategy_type:
            print(json.dumps(rec, ensure_ascii=False))
            return 0
    sys.stderr.write(f"[NOT FOUND] strategy_type={args.strategy_type!r}\n")
    return 1


def cmd_list_all(args: argparse.Namespace) -> int:
    records = _load_records()
    rows = records[: args.limit] if args.limit > 0 else records
    for rec in rows:
        print(_format_row(rec))
    sys.stderr.write(f"[INFO] {len(rows)}/{len(records)} records output\n")
    return 0


# ---- 入口 ----

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="alarm_lookup.py",
        description="alarm_strategy.jsonl 查询工具(strategy_type 字典)",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    p_search = sub.add_parser("search", help="正则搜索(默认 strategy_show_name_zh 字段)")
    p_search.add_argument("pattern", help="正则表达式")
    p_search.add_argument(
        "--field",
        default="strategy_show_name_zh",
        choices=list(SEARCH_FIELDS),
        help="搜索字段(默认 strategy_show_name_zh)",
    )
    p_search.add_argument(
        "--ignore-case",
        action="store_true",
        default=True,
        help="大小写不敏感(默认开启)",
    )
    p_search.set_defaults(func=cmd_search)

    p_get = sub.add_parser("get", help="按 strategy_type 精确查询单条")
    p_get.add_argument("strategy_type", help="strategy_type 值(原 viewName)")
    p_get.set_defaults(func=cmd_get)

    p_list = sub.add_parser("list_all", help="列出全量(调试用)")
    p_list.add_argument("--limit", type=int, default=0, help="限制条数,0=全部")
    p_list.set_defaults(func=cmd_list_all)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
