#!/usr/bin/env python3
"""Build three-option freight quote HTML preview, Excel and comparison artifacts."""

from __future__ import annotations

import argparse
import io
import json
import math
import re
import zipfile
from html import escape
from pathlib import Path
from typing import Any


OPTION_LABELS = {
    "fastest": "最快",
    "balanced": "平衡",
    "cheapest": "最便宜",
}
COST_FIELDS = (
    "linehaul", "pickup", "delivery", "handling", "pod", "insurance", "tax", "other",
)
REQUIRED_INQUIRY = (
    "origin", "destination", "cargoName", "weightKg", "volumeM3", "requiredHours",
)

DEFAULT_PROS_CONS = {
    "fastest": {"pros": ["时效最快", "优先直发"], "cons": ["价格最高"]},
    "balanced": {"pros": ["价格与时效兼顾", "标准班次"], "cons": ["非单项最优"]},
    "cheapest": {"pros": ["价格最低"], "cons": ["时效最慢", "可拼载候车"]},
}
DEFAULT_RECOMMENDATION = "balanced"


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    raw = text(value).replace(",", "")
    if not raw:
        return None
    try:
        parsed = float(raw)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:64] or "quote"


def load_request(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("quote-request.json must be an object")
    return data


def mapping(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    return value if isinstance(value, dict) else {}


def request_gaps(data: dict[str, Any]) -> list[str]:
    inquiry = mapping(data, "inquiry")
    gaps = [f"inquiry.{key}" for key in REQUIRED_INQUIRY if not text(inquiry.get(key))]
    costs = mapping(data, "costBase")
    gaps.extend(f"costBase.{key}" for key in COST_FIELDS if number(costs.get(key)) is None)
    return gaps


def bounded_rate(value: Any, fallback: float) -> float:
    parsed = number(value)
    if parsed is None or parsed < 0 or parsed >= 0.8:
        return fallback
    return parsed


def money(value: float | None) -> str:
    return "待确认" if value is None else f"¥{value:,.2f}"


def calculate_options(data: dict[str, Any], gaps: list[str]) -> list[dict[str, Any]]:
    if any(gap.startswith("costBase.") for gap in gaps):
        return [
            {
                "key": key, "label": label, "cost": None, "floor": None, "price": None,
                "marginRate": None, "hours": None, "service": "待补成本后计算", "floorClamped": False,
            }
            for key, label in OPTION_LABELS.items()
        ]
    costs = mapping(data, "costBase")
    base_cost = sum(number(costs.get(key)) or 0 for key in COST_FIELDS)
    policy = mapping(data, "pricingPolicy")
    adjustments = mapping(data, "optionAdjustments")
    floor_margin = bounded_rate(policy.get("floorMarginRate"), 0.08)
    target_margin = bounded_rate(policy.get("targetMarginRate"), 0.15)
    fastest_markup = bounded_rate(policy.get("fastestMarkupRate"), 0.12)
    cheapest_discount = bounded_rate(policy.get("cheapestDiscountRate"), 0.06)
    options: list[dict[str, Any]] = []
    for key, label in OPTION_LABELS.items():
        adjustment = adjustments.get(key)
        detail = adjustment if isinstance(adjustment, dict) else {}
        cost = max(0, base_cost + (number(detail.get("cost")) or 0))
        floor = cost / (1 - floor_margin)
        target = cost / (1 - target_margin)
        proposed = target
        if key == "fastest":
            proposed = target * (1 + fastest_markup)
        elif key == "cheapest":
            proposed = target * (1 - cheapest_discount)
        price = max(floor, proposed)
        options.append({
            "key": key, "label": label, "cost": round(cost, 2), "floor": round(floor, 2),
            "price": round(price, 2), "marginRate": round((price - cost) / price, 4) if price else 0,
            "hours": number(detail.get("hours")), "service": text(detail.get("service")) or "待确认",
            "floorClamped": proposed < floor,
        })
    return options


def option_pros_cons(data: dict[str, Any], key: str) -> tuple[list[str], list[str]]:
    default = DEFAULT_PROS_CONS[key]
    adj = mapping(data, "optionAdjustments").get(key)
    detail = adj if isinstance(adj, dict) else {}
    pros = detail.get("pros") if isinstance(detail.get("pros"), list) else default["pros"]
    cons = detail.get("cons") if isinstance(detail.get("cons"), list) else default["cons"]
    return [text(p) for p in pros if text(p)], [text(c) for c in cons if text(c)]


def resolve_recommendation(data: dict[str, Any], options: list[dict[str, Any]]) -> tuple[str, str]:
    rec = data.get("recommendation")
    if isinstance(rec, dict):
        key = text(rec.get("key")) or DEFAULT_RECOMMENDATION
        reason = text(rec.get("reason")) or "兼顾价格与时效"
        if key in OPTION_LABELS:
            return key, reason
    balanced = next((o for o in options if o["key"] == DEFAULT_RECOMMENDATION), None)
    if balanced and balanced["price"] is not None:
        return DEFAULT_RECOMMENDATION, "兼顾价格与时效，毛利率健康"
    for option in options:
        if option["price"] is not None:
            return option["key"], "当前可计算的优选档位"
    return DEFAULT_RECOMMENDATION, "待补成本后给出推荐"


PREVIEW_STYLE = """
.quote-preview{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;max-width:1040px;margin:0 auto;background:#fff}
.quote-preview *{box-sizing:border-box}
.quote-preview .qp-top{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;border-radius:12px 12px 0 0}
.quote-preview .qp-top .route{font-size:17px;font-weight:600}
.quote-preview .qp-top .sub{font-size:12px;color:#cbd5e1;margin-top:4px}
.quote-preview .qp-top .qid{font-size:11px;color:#94a3b8;text-align:right;line-height:1.6}
.quote-preview .qp-body{padding:16px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px}
.quote-preview .conclusion{background:#ecfdf5;border:1px solid #34d399;border-radius:10px;padding:14px 16px;margin-bottom:18px}
.quote-preview .conclusion .label{font-size:11px;color:#059669;font-weight:600;letter-spacing:.5px}
.quote-preview .conclusion .pick{font-size:22px;font-weight:700;color:#065f46;margin:4px 0}
.quote-preview .conclusion .reason{font-size:13px;color:#047857;line-height:1.6}
.quote-preview .conclusion .delta{font-size:12px;color:#475569;margin-top:8px}
.quote-preview .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}
.quote-preview .card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;position:relative}
.quote-preview .card.rec{border-color:#10b981;box-shadow:0 4px 12px rgba(16,185,129,.18)}
.quote-preview .card .ch{padding:12px 14px;border-bottom:1px solid #f1f5f9}
.quote-preview .card.rec .ch{background:#f0fdf4}
.quote-preview .rec-tag{display:inline-block;background:#10b981;color:#fff;font-size:11px;padding:1px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}
.quote-preview .card .title{font-size:14px;font-weight:600;color:#475569}
.quote-preview .card .price{font-size:26px;font-weight:700;color:#0f172a;margin:8px 0 2px}
.quote-preview .card .metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;padding:0;background:#e2e8f0}
.quote-preview .card .metric{background:#f8fafc;padding:8px 14px}
.quote-preview .card .metric .k{color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.3px}
.quote-preview .card .metric .v{color:#1e293b;font-weight:600;margin-top:2px;font-size:13px}
.quote-preview .card .pc{padding:10px 14px;font-size:12px;line-height:1.7}
.quote-preview .card .pc .grp{margin-bottom:6px}
.quote-preview .card .pc .gl{font-size:11px;font-weight:600;margin-bottom:2px}
.quote-preview .card .pc .gl.pro{color:#059669}
.quote-preview .card .pc .gl.con{color:#dc2626}
.quote-preview .card .pc ul{margin:0;padding-left:14px}
.quote-preview .card .pc .pro li{color:#047857}
.quote-preview .card .pc .con li{color:#b91c1c}
.quote-preview .clamp{font-size:10px;color:#d97706;margin:0 14px 10px}
.quote-preview .bar-wrap{margin:4px 0 10px}
.quote-preview .bar-title{font-size:12px;font-weight:600;color:#475569;margin-bottom:10px}
.quote-preview .bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:12px}
.quote-preview .bar-name{width:56px;color:#475569;font-weight:600}
.quote-preview .bar-track{flex:1;height:18px;background:#f1f5f9;border-radius:9px;overflow:hidden}
.quote-preview .bar-fill{height:100%;border-radius:9px}
.quote-preview .bar-fill.fastest{background:#f59e0b}
.quote-preview .bar-fill.balanced{background:#10b981}
.quote-preview .bar-fill.cheapest{background:#3b82f6}
.quote-preview .bar-amt{width:96px;text-align:right;color:#1e293b;font-weight:600}
.quote-preview .qp-foot{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.6}
@media (max-width:760px){.quote-preview .cards{grid-template-columns:1fr}.quote-preview .qp-top{flex-direction:column}}
"""


def _card_html(opt: dict[str, Any], pros: list[str], cons: list[str], is_rec: bool) -> str:
    price = money(opt["price"]) if opt["price"] is not None else "待补成本"
    hours = f"{opt['hours']:g}h" if opt["hours"] is not None else "待确认"
    margin = "待确认" if opt["marginRate"] is None else f"{opt['marginRate']*100:.1f}%"
    pros_li = "".join(f"<li>{escape(p)}</li>" for p in pros)
    cons_li = "".join(f"<li>{escape(c)}</li>" for c in cons)
    tag = '<span class="rec-tag">推荐</span>' if is_rec else ""
    clamp = '<div class="clamp">⚠ 建议价已钳至底价</div>' if opt.get("floorClamped") else ""
    cls = " rec" if is_rec else ""
    return (
        f'<div class="card{cls}"><div class="ch"><div class="title">{escape(opt["label"])}{tag}</div>'
        f'<div class="price">{escape(price)}</div></div>'
        f'<div class="metrics">'
        f'<div class="metric"><div class="k">时效</div><div class="v">{escape(hours)}</div></div>'
        f'<div class="metric"><div class="k">毛利率</div><div class="v">{escape(margin)}</div></div>'
        f'</div>'
        f'<div class="pc"><div class="grp"><div class="gl pro">✓ 优势</div><ul>{pros_li}</ul></div>'
        f'<div class="grp"><div class="gl con">✗ 劣势</div><ul>{cons_li}</ul></div></div>'
        f'{clamp}</div>'
    )


def _conclusion_card(options, rec_key, rec_reason, gaps) -> str:
    if any(gap.startswith("costBase.") for gap in gaps):
        return (
            '<div class="conclusion"><div class="label">待补成本</div>'
            '<div class="reason">补全成本后自动给出推荐档位与比价结论。</div></div>'
        )
    rec = next((o for o in options if o["key"] == rec_key), None)
    if not rec or rec["price"] is None:
        return ""
    deltas: list[str] = []
    for o in options:
        if o["key"] == rec_key or o["price"] is None:
            continue
        diff = rec["price"] - o["price"]
        hrs = (o["hours"] or 0) - (rec["hours"] or 0)
        bits: list[str] = []
        if diff > 0:
            bits.append(f"比{o['label']}便宜 ¥{diff:,.0f}")
        elif diff < 0:
            bits.append(f"比{o['label']}贵 ¥{-diff:,.0f}")
        if hrs > 0:
            bits.append(f"快 {hrs:g}h")
        elif hrs < 0:
            bits.append(f"慢 {-hrs:g}h")
        if bits:
            deltas.append("、".join(bits))
    delta_html = f'<div class="delta">{"  ｜  ".join(deltas)}</div>' if deltas else ""
    rec_label = OPTION_LABELS.get(rec_key, rec_key)
    return (
        '<div class="conclusion"><div class="label">推荐方案</div>'
        f'<div class="pick">{escape(rec_label)} · {escape(money(rec["price"]))}</div>'
        f'<div class="reason">{escape(rec_reason)}</div>{delta_html}</div>'
    )


def _price_bar(options) -> str:
    prices = [o["price"] for o in options if o["price"] is not None]
    if not prices:
        return ""
    mx = max(prices)
    rows = ""
    for o in options:
        if o["price"] is None:
            continue
        pct = int(o["price"] / mx * 100) if mx else 0
        rows += (
            f'<div class="bar-row"><div class="bar-name">{escape(o["label"])}</div>'
            f'<div class="bar-track"><div class="bar-fill {o["key"]}" style="width:{pct}%"></div></div>'
            f'<div class="bar-amt">{escape(money(o["price"]))}</div></div>'
        )
    return f'<div class="bar-wrap"><div class="bar-title">报价对比</div>{rows}</div>'


def quote_preview_html(data, gaps, options, pros_cons_map, rec_key, rec_reason) -> str:
    inquiry = mapping(data, "inquiry")
    policy = mapping(data, "pricingPolicy")
    route = f"{text(inquiry.get('origin')) or '起点'} -> {text(inquiry.get('destination')) or '终点'}"
    cargo = (
        f"{text(inquiry.get('cargoName')) or '待确认'} · "
        f"{text(inquiry.get('weightKg')) or '?'}kg / {text(inquiry.get('volumeM3')) or '?'}m³"
    )
    vehicle = text(inquiry.get("vehicleType")) or "待确认"
    valid = f"{text(policy.get('validHours')) or '?'}h 有效"
    qid = text(data.get("quoteId")) or "未编号"
    asof = text(data.get("asOfDate")) or ""
    cards = "".join(
        _card_html(o, *pros_cons_map[o["key"]], o["key"] == rec_key) for o in options
    )
    conclusion = _conclusion_card(options, rec_key, rec_reason, gaps)
    bar = _price_bar(options)
    return (
        f'<style>{PREVIEW_STYLE}</style>'
        '<section class="quote-preview">'
        f'<div class="qp-top"><div><div class="route">{escape(route)}</div>'
        f'<div class="sub">{escape(cargo)} · {escape(vehicle)}</div></div>'
        f'<div class="qid">{escape(qid)}<br>{escape(asof)} · {escape(valid)}</div></div>'
        f'<div class="qp-body">{conclusion}<div class="cards">{cards}</div>{bar}'
        '<div class="qp-foot">内部底价不对外转发；最终成交价、服务范围与有效期须业务负责人确认。'
        '本预览为过程产物，确认后导出 Excel / Word 正式交付物。</div></div></section>'
    )


def _docx_para(content: str, bold: bool = False, size: int | None = None, heading: bool = False) -> str:
    rpr = ""
    if bold:
        rpr += "<w:b/>"
    if size:
        rpr += f'<w:sz w:val="{size * 2}"/><w:szCs w:val="{size * 2}"/>'
    ppr = '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>' if heading else ""
    return f'<w:p>{ppr}<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{escape(content)}</w:t></w:r></w:p>'


def _docx_table(headers: list[str], rows: list[list[Any]]) -> str:
    def cell(content: Any) -> str:
        return (
            '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'
            f'<w:p><w:r><w:t xml:space="preserve">{escape(str(content))}</w:t></w:r></w:p></w:tc>'
        )
    head = "<w:tr>" + "".join(cell(h) for h in headers) + "</w:tr>"
    body = "".join("<w:tr>" + "".join(cell(c) for c in row) + "</w:tr>" for row in rows)
    borders = (
        '<w:tblBorders>'
        '<w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:left w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:right w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '</w:tblBorders>'
    )
    return (
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>'
        f'<w:tblW w:w="5000" w:type="pct"/>{borders}</w:tblPr>{head}{body}</w:tbl>'
    )


def write_docx(path: Path, data: dict[str, Any], gaps, options, pros_cons_map, rec_key, rec_reason) -> None:
    """Minimal .docx (stdlib only): 报价方案对比文档（含推荐结论/三档表/优劣势/话术）."""
    inquiry = mapping(data, "inquiry")
    policy = mapping(data, "pricingPolicy")
    qid = text(data.get("quoteId")) or "未编号"
    has_cost = not any(gap.startswith("costBase.") for gap in gaps)
    rec_label = OPTION_LABELS.get(rec_key, rec_key)
    paras: list[str] = []
    paras.append(_docx_para(f"报价方案对比 · {qid}", heading=True))
    paras.append(_docx_para(f"线路：{text(inquiry.get('origin')) or '待确认'} -> {text(inquiry.get('destination')) or '待确认'}"))
    paras.append(_docx_para(
        f"货物：{text(inquiry.get('cargoName')) or '待确认'} · "
        f"{text(inquiry.get('weightKg')) or '?'}kg / {text(inquiry.get('volumeM3')) or '?'}m³ · "
        f"{text(inquiry.get('vehicleType')) or '待确认'}"
    ))
    paras.append(_docx_para(f"有效期：{text(policy.get('validHours')) or '待确认'} 小时    日期：{text(data.get('asOfDate')) or ''}"))
    paras.append(_docx_para(""))
    paras.append(_docx_para("推荐结论", bold=True, size=13))
    if has_cost:
        rec = next((o for o in options if o["key"] == rec_key), None)
        rec_price = money(rec["price"]) if rec and rec["price"] is not None else "待确认"
        paras.append(_docx_para(f"推荐方案：{rec_label}，建议报价 {rec_price}"))
        paras.append(_docx_para(f"推荐理由：{rec_reason}"))
    else:
        paras.append(_docx_para("成本字段不完整，待补全后给出推荐。"))
    paras.append(_docx_para(""))
    paras.append(_docx_para("三档对比", bold=True, size=13))
    headers = ["档位", "服务", "时效", "建议报价", "毛利率", "推荐"]
    rows: list[list[Any]] = []
    for o in options:
        margin = "待确认" if o["marginRate"] is None else f"{o['marginRate']*100:.1f}%"
        hours = "待确认" if o["hours"] is None else f"{o['hours']:g}h"
        price = money(o["price"]) if has_cost else "待补成本"
        rows.append([o["label"], o["service"], hours, price, margin, "是" if o["key"] == rec_key else ""])
    paras.append(_docx_table(headers, rows))
    paras.append(_docx_para(""))
    paras.append(_docx_para("优劣势分析", bold=True, size=13))
    for o in options:
        pros, cons = pros_cons_map[o["key"]]
        paras.append(_docx_para(o["label"], bold=True))
        paras.append(_docx_para(f"  优势：{'；'.join(pros) if pros else '-'}"))
        paras.append(_docx_para(f"  劣势：{'；'.join(cons) if cons else '-'}"))
    paras.append(_docx_para(""))
    paras.append(_docx_para("报价与砍价话术", bold=True, size=13))
    balanced = next((o for o in options if o["key"] == "balanced"), None)
    if balanced and balanced["price"] is not None:
        route = f"{text(inquiry.get('origin')) or '起点'}->{text(inquiry.get('destination')) or '终点'}"
        paras.append(_docx_para(f"首次报价：{route} 建议先看平衡方案 {money(balanced['price'])}，时效与服务边界见报价表，报价有效期内请确认档位。"))
        paras.append(_docx_para("客户嫌贵：可优先放宽时效、改拼载或减少非必要服务项重新核价，但不能跌破内部底价。"))
        paras.append(_docx_para("客户要求死价：在装卸、等待、回单、税费和进仓条件确认后才能锁价；未确认项列为另计或排除项。"))
    else:
        paras.append(_docx_para("成本尚未补齐，暂不生成含金额的对客话术。"))
    paras.append(_docx_para(""))
    paras.append(_docx_para("注：话术为草稿，发送给客户前必须人工确认。内部底价不对外转发。"))
    body = "".join(paras)
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{body}'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
        '</w:sectPr></w:body></w:document>'
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:docDefaults><w:rPrDefault><w:rPr>'
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/><w:sz w:val="22"/>'
        '</w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="heading 1"/>'
        '<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>'
        '<w:tblPr><w:tblBorders>'
        '<w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:left w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:right w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '</w:tblBorders></w:tblPr></w:style></w:styles>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("word/document.xml", document)
        z.writestr("word/_rels/document.xml.rels", doc_rels)
        z.writestr("word/styles.xml", styles)


def _col_letter(n: int) -> str:
    letters = ""
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _sheet_xml(headers: list[str], rows: list[list[Any]]) -> str:
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<sheetData>',
    ]
    head_cells = "".join(
        f'<c r="{_col_letter(c)}1" t="inlineStr" s="1"><is><t>{escape(str(h))}</t></is></c>'
        for c, h in enumerate(headers)
    )
    out.append(f'<row r="1">{head_cells}</row>')
    for r_idx, row in enumerate(rows, start=2):
        cells = "".join(
            f'<c r="{_col_letter(c)}{r_idx}" t="inlineStr" s="0"><is><t>{escape(str(v))}</t></is></c>'
            for c, v in enumerate(row)
        )
        out.append(f'<row r="{r_idx}">{cells}</row>')
    out.append('</sheetData></worksheet>')
    return "".join(out)


def write_xlsx(path: Path, data: dict[str, Any], options, gaps, pros_cons_map, rec_key) -> None:
    """Minimal .xlsx (stdlib only). Sheet 1: 三档对比; Sheet 2: 成本明细."""
    costs = mapping(data, "costBase")
    s1_headers = ["档位", "服务", "时效(h)", "内部成本", "内部底价", "建议报价", "毛利率", "优势", "劣势", "推荐"]
    s1_rows: list[list[Any]] = []
    for opt in options:
        pros, cons = pros_cons_map[opt["key"]]
        s1_rows.append([
            opt["label"], opt["service"], opt["hours"] if opt["hours"] is not None else "",
            opt["cost"] if opt["cost"] is not None else "",
            opt["floor"] if opt["floor"] is not None else "",
            opt["price"] if opt["price"] is not None else "",
            f"{opt['marginRate']*100:.2f}%" if opt["marginRate"] is not None else "",
            "；".join(pros), "；".join(cons), "是" if opt["key"] == rec_key else "",
        ])
    s2_headers = ["成本项", "金额"]
    s2_rows = [[f, number(costs.get(f)) or ""] for f in COST_FIELDS]
    s1 = _sheet_xml(s1_headers, s1_rows)
    s2 = _sheet_xml(s2_headers, s2_rows)
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border/></borders>'
        '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="2">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        '</cellXfs></styleSheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets>'
        '<sheet name="三档对比" sheetId="1" r:id="rId1"/>'
        '<sheet name="成本明细" sheetId="2" r:id="rId2"/>'
        '</sheets></workbook>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/worksheets/sheet1.xml", s1)
        z.writestr("xl/worksheets/sheet2.xml", s2)
        z.writestr("xl/styles.xml", styles)


def floor_guard_markdown(options: list[dict[str, Any]], gaps: list[str]) -> str:
    lines = ["# 底价保护检查", ""]
    if any(gap.startswith("costBase.") for gap in gaps):
        lines.append("- BLOCKED：成本字段不完整，只能输出结构，禁止给出真实报价数字。")
    else:
        for option in options:
            status = "已钳制到底价" if option["floorClamped"] else "通过"
            lines.append(
                f"- {option['label']}：建议 {money(option['price'])} / 底价 {money(option['floor'])} / {status}"
            )
    lines.extend(["", "- 禁止自动对外发送报价；禁止绕过人工拍板。", ""])
    return "\n".join(lines)


def scripts_markdown(data: dict[str, Any], options: list[dict[str, Any]]) -> str:
    inquiry = mapping(data, "inquiry")
    balanced = next(option for option in options if option["key"] == "balanced")
    route = f"{text(inquiry.get('origin')) or '起点'}->{text(inquiry.get('destination')) or '终点'}"
    lines = [f"# 报价与砍价话术 · {text(data.get('quoteId')) or '未编号'}", ""]
    if balanced["price"] is None:
        lines.append("成本尚未补齐，暂不生成含金额的对客话术。请先补全底价依据。")
    else:
        lines.extend([
            "## 首次报价",
            f"{route} 这票建议先看平衡方案：{money(balanced['price'])}，时效与服务边界见报价表；报价有效期内请确认档位。",
            "", "## 客户嫌贵",
            "可以优先放宽时效、改拼载或减少非必要服务项重新核价，但不能直接跌破内部底价。",
            "", "## 客户要求死价",
            "在装卸、等待、回单、税费和进仓条件确认后才能锁价；未确认项应列为另计或排除项。",
        ])
    lines.extend(["", "> 话术为草稿，发送给客户前必须人工确认。", ""])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build freight quote preview/export artifacts")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()

    data = load_request(args.input)
    gaps = request_gaps(data)
    options = calculate_options(data, gaps)
    pros_cons_map = {key: option_pros_cons(data, key) for key in OPTION_LABELS}
    rec_key, rec_reason = resolve_recommendation(data, options)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    process = args.output_dir / ".process"
    process.mkdir(parents=True, exist_ok=True)

    preview_html = quote_preview_html(data, gaps, options, pros_cons_map, rec_key, rec_reason)
    preview_path = process / "quote-preview.html"
    preview_path.write_text(preview_html, encoding="utf-8")
    guard_path = process / "quote-floor-guard.md"
    guard_path.write_text(floor_guard_markdown(options, gaps), encoding="utf-8")
    files = [str(preview_path), str(guard_path)]

    payload: dict[str, Any] = {
        "ok": True,
        "mode": args.mode,
        "quoteId": text(data.get("quoteId")),
        "gaps": gaps,
        "options": options,
        "recommendation": {"key": rec_key, "label": OPTION_LABELS[rec_key], "reason": rec_reason},
        "files": files,
        "inlineWidget": {
            "title": "三档报价方案预览",
            "widget_code": preview_html,
        },
    }

    if args.mode == "export":
        quote_id = safe_name(text(data.get("quoteId")))
        xlsx_path = args.output_dir / f"报价方案_{quote_id}.xlsx"
        docx_path = args.output_dir / f"报价方案对比_{quote_id}.docx"
        write_xlsx(xlsx_path, data, options, gaps, pros_cons_map, rec_key)
        write_docx(docx_path, data, gaps, options, pros_cons_map, rec_key, rec_reason)
        files.extend([str(xlsx_path), str(docx_path)])
        payload["files"] = files

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
