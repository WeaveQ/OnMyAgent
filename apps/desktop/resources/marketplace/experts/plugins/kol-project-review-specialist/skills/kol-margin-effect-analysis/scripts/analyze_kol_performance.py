#!/usr/bin/env python3
"""Create a traceable KOL margin and performance workbook."""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path


ALIASES = {
    "record_id": ("record_id", "记录ID", "笔记ID", "发布链接"),
    "creator": ("creator", "达人", "达人名称", "博主"),
    "rebate_band": ("rebate_band", "返点档", "返点档位"),
    "margin_rate": ("margin_rate", "毛利率"),
    "creator_tier": ("creator_tier", "达人量级", "达人等级"),
    "note_type": ("note_type", "笔记类型", "内容类型"),
    "k_amount": ("k_amount", "K金额", "k金额", "K 金额"),
    "ad_amount": ("ad_amount", "广告金额", "投流金额"),
    "natural_reads": ("natural_reads", "自然阅读量", "自然阅读"),
    "natural_impressions": ("natural_impressions", "自然曝光量", "自然曝光"),
    "likes": ("likes", "点赞量", "点赞"),
    "comments": ("comments", "评论量", "评论"),
    "favorites": ("favorites", "收藏量", "收藏"),
    "search_uv": ("search_uv", "搜索进店UV", "搜索进店 UV"),
}
FORMULAS = (
    ("总金额", "K 金额 + 广告金额"),
    ("自然 CTR", "自然阅读量 / 自然曝光量"),
    ("纯 K CPC", "K 金额 / 自然阅读量"),
    ("互动量", "点赞量 + 评论量 + 收藏量"),
    ("广告占比", "广告金额 / 总金额"),
    ("搜索进店成本", "总金额 / 搜索进店 UV"),
)


def number(value: object) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        cleaned = value.replace(",", "").replace("¥", "").replace("￥", "").strip()
        if cleaned.endswith("%"):
            try:
                return float(cleaned[:-1]) / 100
            except ValueError:
                return None
        value = cleaned
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def safe_div(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def metrics(row: dict[str, object]) -> dict[str, float | None]:
    k_amount = number(row.get("k_amount"))
    ad_amount = number(row.get("ad_amount"))
    natural_reads = number(row.get("natural_reads"))
    natural_impressions = number(row.get("natural_impressions"))
    likes = number(row.get("likes"))
    comments = number(row.get("comments"))
    favorites = number(row.get("favorites"))
    search_uv = number(row.get("search_uv"))
    total_amount = k_amount + ad_amount if k_amount is not None and ad_amount is not None else None
    interaction_count = likes + comments + favorites if None not in (likes, comments, favorites) else None
    return {
        "总金额": total_amount,
        "自然 CTR": safe_div(natural_reads, natural_impressions),
        "纯 K CPC": safe_div(k_amount, natural_reads),
        "互动量": interaction_count,
        "广告占比": safe_div(ad_amount, total_amount),
        "搜索进店成本": safe_div(total_amount, search_uv),
    }


def row_label(values: dict[str, float | None], thresholds: dict[str, object] | None) -> str:
    if not thresholds or any(value is None for value in values.values()):
        return "数据不足"
    min_ctr = number(thresholds.get("min_natural_ctr"))
    max_cpc = number(thresholds.get("max_pure_k_cpc"))
    max_search = number(thresholds.get("max_search_visit_cost"))
    if None in (min_ctr, max_cpc, max_search):
        return "数据不足"
    good = values["自然 CTR"] >= min_ctr and values["纯 K CPC"] <= max_cpc and values["搜索进店成本"] <= max_search
    poor = values["自然 CTR"] < min_ctr and values["纯 K CPC"] > max_cpc
    if good:
        return "优先保留"
    if poor:
        return "谨慎"
    return "可加测"


def load_json(value: str | None) -> dict[str, object]:
    if not value:
        return {}
    if value.lstrip().startswith("{"):
        content = value
    else:
        path = Path(value)
        content = path.read_text(encoding="utf-8") if path.exists() else value
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError("配置必须是 JSON 对象")
    return parsed


def map_headers(headers: list[str], custom: dict[str, object]) -> dict[str, list[int]]:
    mapping: dict[str, list[int]] = {}
    for canonical, defaults in ALIASES.items():
        configured = custom.get(canonical, [])
        candidates = list(defaults) + ([str(configured)] if isinstance(configured, str) else [str(item) for item in configured])
        indexes = list(dict.fromkeys(index for candidate in candidates for index, header in enumerate(headers) if header == candidate))
        if indexes:
            mapping[canonical] = indexes
    return mapping


def text_value(value: object) -> str:
    return "" if value is None else str(value).strip()


def excel_safe(value: object) -> object:
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def append_safe(sheet: object, values: list[object]) -> None:
    sheet.append([excel_safe(value) for value in values])


def analyze(args: argparse.Namespace) -> dict[str, int]:
    try:
        from openpyxl import Workbook, load_workbook
    except ImportError as error:
        raise RuntimeError("缺少 openpyxl，无法读写 Excel；请使用桌面应用打包运行时") from error

    input_path = Path(args.input)
    if not input_path.exists():
        raise ValueError("项目数据文件不存在")
    source = load_workbook(input_path, read_only=True, data_only=True)
    if args.sheet and args.sheet not in source.sheetnames:
        source.close()
        raise ValueError(f"输入工作表不存在：{args.sheet}")
    sheet = source[args.sheet] if args.sheet else source.active
    iterator = sheet.iter_rows(values_only=True)
    try:
        first_row = next(iterator)
    except StopIteration as error:
        source.close()
        raise ValueError("输入工作表为空") from error
    headers = [text_value(value) for value in first_row]
    mapping = map_headers(headers, load_json(args.column_map))
    thresholds = load_json(args.thresholds)
    records: list[dict[str, object]] = []
    duplicate_counts: defaultdict[str, int] = defaultdict(int)
    for source_row, values in enumerate(iterator, start=2):
        row: dict[str, object] = {}
        field_conflicts: list[str] = []
        for key, indexes in mapping.items():
            candidates = [values[index] for index in indexes if index < len(values) and values[index] not in (None, "")]
            unique = list(dict.fromkeys(str(value).strip() for value in candidates))
            row[key] = candidates[0] if candidates else None
            if len(unique) > 1:
                field_conflicts.append(key)
        record_id = text_value(row.get("record_id")) or f"源行{source_row}"
        duplicate_counts[record_id] += 1
        calculated = metrics(row)
        records.append({"源行": source_row, "记录ID": record_id, "字段冲突": field_conflicts, **row, **calculated})
    source.close()

    output = Workbook()
    detail = output.active
    detail.title = "指标明细"
    detail_headers = ["源行", "记录ID", "达人", "返点档", "毛利率", "达人量级", "笔记类型", *[name for name, _ in FORMULAS], "行级标签", "风险提示"]
    append_safe(detail, detail_headers)
    risk_rows: list[list[object]] = []
    for record in records:
        calculated = {name: record[name] for name, _ in FORMULAS}
        risks = []
        if duplicate_counts[str(record["记录ID"])] > 1:
            risks.append("重复记录，待确认")
        if record["字段冲突"]:
            risks.append("字段冲突：" + "、".join(record["字段冲突"]))
        missing_metrics = [name for name, value in calculated.items() if value is None]
        if missing_metrics:
            risks.append("数据不足：" + "、".join(missing_metrics))
        label = "数据不足" if risks else row_label(calculated, thresholds)
        record["行级标签"] = label
        append_safe(detail, [
            record["源行"], record["记录ID"], text_value(record.get("creator")), text_value(record.get("rebate_band")),
            number(record.get("margin_rate")), text_value(record.get("creator_tier")), text_value(record.get("note_type")),
            *[record[name] if record[name] is not None else "数据不足" for name, _ in FORMULAS], label, "；".join(risks),
        ])
        if risks:
            risk_rows.append([record["源行"], record["记录ID"], "；".join(risks), "人工复核"])

    definitions = output.create_sheet("口径表")
    append_safe(definitions, ["指标", "公式 / 口径", "说明"])
    for name, formula in FORMULAS:
        append_safe(definitions, [name, formula, "业务计划明确口径"])
    append_safe(definitions, ["其他成本指标", "待业务方提供公式", "不得自行定义"])

    grouping = output.create_sheet("分组分析")
    append_safe(grouping, ["分组维度", "分组值", "样本数", "平均自然 CTR", "平均纯 K CPC", "说明"])
    groupable_records = [
        record
        for record in records
        if duplicate_counts[str(record["记录ID"])] == 1
        and not record["字段冲突"]
        and all(record[name] is not None for name, _ in FORMULAS)
    ]
    for field, label in (("rebate_band", "返点档"), ("margin_rate", "毛利率"), ("creator_tier", "达人量级"), ("note_type", "笔记类型")):
        groups: defaultdict[str, list[dict[str, object]]] = defaultdict(list)
        for record in groupable_records:
            groups[text_value(record.get(field)) or "未提供"].append(record)
        for group_name, items in groups.items():
            ctrs = [item["自然 CTR"] for item in items if item["自然 CTR"] is not None]
            cpcs = [item["纯 K CPC"] for item in items if item["纯 K CPC"] is not None]
            append_safe(grouping, [label, group_name, len(items), sum(ctrs) / len(ctrs) if ctrs else "数据不足", sum(cpcs) / len(cpcs) if cpcs else "数据不足", "小样本仅供观察" if len(items) < 3 else ""])

    recommendations = output.create_sheet("可复投建议")
    append_safe(recommendations, ["源行", "记录ID", "达人", "行级标签", "建议", "证据摘要", "人工复核"])
    suggestion_by_label = {
        "优先保留": "优先纳入复投候选",
        "可加测": "小预算加测后再决定",
        "谨慎": "降低优先级并复核内容与成本",
        "数据不足": "补齐数据或业务阈值后再判断",
    }
    for record in records:
        evidence = "；".join(
            f"{name}={record[name]}" if record[name] is not None else f"{name}=数据不足"
            for name in ("自然 CTR", "纯 K CPC", "搜索进店成本")
        )
        label = str(record["行级标签"])
        append_safe(
            recommendations,
            [
                record["源行"],
                record["记录ID"],
                text_value(record.get("creator")),
                label,
                suggestion_by_label[label],
                evidence,
                "是",
            ],
        )

    risks_sheet = output.create_sheet("风险提示")
    append_safe(risks_sheet, ["源行", "记录ID", "风险", "处理"])
    for risk in risk_rows:
        append_safe(risks_sheet, risk)
    if not thresholds:
        append_safe(risks_sheet, ["", "", "未提供业务阈值，行级标签均为数据不足", "补充阈值后重新分析"])

    clean_log = output.create_sheet("清洗日志")
    append_safe(clean_log, ["项目", "结果"])
    append_safe(clean_log, ["源记录数", len(records)])
    append_safe(clean_log, ["重复记录数", sum(count - 1 for count in duplicate_counts.values() if count > 1)])
    append_safe(clean_log, ["字段冲突记录数", sum(1 for record in records if record["字段冲突"])])
    append_safe(clean_log, ["进入分组分析记录数", len(groupable_records)])
    append_safe(clean_log, ["源文件", input_path.name])
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)
    return {"records": len(records), "risks": len(risk_rows)}


def self_test() -> dict[str, object]:
    values = metrics({"k_amount": 1000, "ad_amount": 200, "natural_reads": 100, "natural_impressions": 1000, "likes": 10, "comments": 5, "favorites": 5, "search_uv": 0})
    return {
        "total_amount": values["总金额"],
        "natural_ctr": values["自然 CTR"],
        "pure_k_cpc": values["纯 K CPC"],
        "zero_denominator": "数据不足" if values["搜索进店成本"] is None else values["搜索进店成本"],
        "no_threshold_label": row_label(values, None),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="分析达人项目毛利与效果")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--sheet")
    parser.add_argument("--column-map")
    parser.add_argument("--thresholds")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), ensure_ascii=False))
        return 0
    if not args.input or not args.output:
        print("必须提供 --input 和 --output", file=sys.stderr)
        return 2
    try:
        result = analyze(args)
    except (OSError, ValueError, RuntimeError, StopIteration) as error:
        print(f"分析失败：{error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
