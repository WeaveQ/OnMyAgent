#!/usr/bin/env python3
"""Generate three-copy HTML previews and gated PDF/XLSX logistics-waybill artifacts."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape as xml_escape


SKILL_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TEMPLATE = SKILL_ROOT / "assets" / "logistics-waybill-template.html"
PROCESS_DIR_NAME = ".process"
FINGERPRINT_NAME = "export-fingerprint"
COPY_VARIANTS = (
    {
        "key": "white",
        "label": "一联存根（白）",
        "tabTitle": "存根联",
        "tabMeta": "一联 · 白",
        "fileLabel": "一联-白色存根",
        "color": "FFF8F7FB",
    },
    {
        "key": "red",
        "label": "二联收货单位（红）",
        "tabTitle": "收货联",
        "tabMeta": "二联 · 红",
        "fileLabel": "二联-红色收货单位",
        "color": "FFF8E5E9",
    },
    {
        "key": "yellow",
        "label": "三联发货单位（黄）",
        "tabTitle": "发货联",
        "tabMeta": "三联 · 黄",
        "fileLabel": "三联-黄色发货单位",
        "color": "FFFFF4BF",
    },
)
CUSTOMER_REQUIRED = (
    "document.number", "document.date", "route.origin", "route.destination",
    "shipper.name", "shipper.contact", "shipper.phone", "shipper.address",
    "consignee.name", "consignee.contact", "consignee.phone", "consignee.address",
    "timeline.pickup", "timeline.delivery", "payment.method", "handover",
)
DISPATCH_REQUIRED = (
    "vehicle.plate", "vehicle.licenseNumber", "vehicle.driverName", "vehicle.driverPhone",
)
FIELD_LABELS = {
    "document.number": "单号", "document.date": "发货日期",
    "route.origin": "起运地点", "route.destination": "目的地点",
    "shipper.name": "托运单位", "shipper.contact": "托运联系人",
    "shipper.phone": "托运电话", "shipper.address": "装货地址",
    "consignee.name": "收货单位", "consignee.contact": "收货联系人",
    "consignee.phone": "收货电话", "consignee.address": "卸货地址",
    "timeline.pickup": "计划提货时间", "timeline.delivery": "要求到达时间",
    "vehicleRequirement": "车型要求", "vehicle.plate": "车牌号",
    "vehicle.licenseNumber": "驾驶证号", "vehicle.driverName": "司机姓名",
    "vehicle.driverPhone": "司机电话", "vehicle.driverAddress": "司机家庭住址",
    "carrier.name": "承运方", "carrier.address": "承运方地址",
    "carrier.phone": "承运方电话", "payment.method": "结算方式",
    "payment.amount": "金额", "payment.amountUppercase": "金额大写",
    "handover": "提货方式", "remarks": "备注",
}
EDITABLE_FIELDS = (
    "document.number", "document.date", "route.origin", "route.destination",
    "shipper.name", "shipper.contact", "shipper.phone",
    "consignee.name", "consignee.contact", "consignee.phone",
    "cargo.name", "cargo.quantity", "cargo.packaging", "cargo.weightOrVolume",
    "cargo.declaredValue", "cargo.insuranceFee", "cargo.codAmount",
    "vehicle.plate", "vehicle.driverAddress", "vehicle.licenseNumber",
    "vehicle.driverName", "vehicle.driverPhone",
    "payment.amountUppercase", "payment.amount", "carrier.address", "carrier.phone",
    "remarks",
)
PRINT_FIT_CSS = """
@media print {
  @page { size: A4 landscape; margin: 0 !important; }
  html, body {
    width: 297mm !important;
    height: 210mm !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: #fff !important;
  }
  .sheet {
    width: 297mm !important;
    height: 210mm !important;
    max-width: 297mm !important;
    max-height: 210mm !important;
    margin: 0 !important;
    padding: 6mm 8mm !important;
    border: 0 !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
    page-break-after: avoid !important;
    page-break-inside: avoid !important;
    break-after: avoid !important;
    break-inside: avoid !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .sheet * { page-break-inside: avoid !important; break-inside: avoid !important; }
  header { min-height: auto !important; }
  h1 { font-size: 26px !important; }
  th, td { height: auto !important; min-height: 0 !important; padding: 3px 5px !important; font-size: 12px !important; }
  .goods-row td { height: auto !important; }
  .signatures td { height: 64px !important; }
  .sign-date { margin-top: 28px !important; }
  .copies { top: 140px !important; }
  footer { margin-top: 2px !important; font-size: 11px !important; }
}
"""
FIELD_PATTERN = re.compile(
    r'<(?P<tag>span|strong|td|div)\b(?P<attrs>[^>]*\bdata-field="(?P<field>[^"]+)"[^>]*)>(?P<body>.*?)</(?P=tag)>',
    re.DOTALL,
)
MAIN_PATTERN = re.compile(r"(<main\b[\s\S]*?</main>)", re.IGNORECASE)
STYLE_PATTERN = re.compile(r"<style>([\s\S]*?)</style>", re.IGNORECASE)
PRINT_MEDIA_PATTERN = re.compile(r"@media\s+print\s*\{(?:[^{}]|\{[^{}]*\})*\}", re.IGNORECASE)
MISSING_TOKEN_PATTERN = re.compile(r"\s*\bmissing\b")
CLASS_TRIM_PATTERN = re.compile(r'class="\s+')
EMPTY_CLASS_PATTERN = re.compile(r'\s+class=""')
_TEMPLATE_CACHE: dict[str, tuple[float, str]] = {}


class WaybillError(Exception):
    pass


def read_template(path: Path) -> str:
    key = str(path.resolve())
    try:
        mtime = path.stat().st_mtime
    except OSError as error:
        raise WaybillError(f"无法读取模板：{path}") from error
    cached = _TEMPLATE_CACHE.get(key)
    if cached and cached[0] == mtime:
        return cached[1]
    content = path.read_text(encoding="utf-8")
    _TEMPLATE_CACHE[key] = (mtime, content)
    return content


def get_value(data: dict[str, Any], path: str) -> Any:
    value: Any = data
    for part in path.split("."):
        if not isinstance(value, dict):
            return ""
        value = value.get(part, "")
    return value


def set_value(data: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cursor: Any = data
    for part in parts[:-1]:
        nested = cursor.get(part)
        if not isinstance(nested, dict):
            nested = {}
            cursor[part] = nested
        cursor = nested
    cursor[parts[-1]] = value


def text_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    return str(value).strip()


def cargo_rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows = data.get("cargo", [])
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def missing_fields(data: dict[str, Any]) -> list[str]:
    missing = [path for path in CUSTOMER_REQUIRED if not text_value(get_value(data, path))]
    rows = cargo_rows(data)
    if not rows:
        return [*missing, "cargo"]
    for index, row in enumerate(rows, start=1):
        for key in ("name", "quantity", "packaging"):
            if not text_value(row.get(key)):
                missing.append(f"cargo[{index}].{key}")
        if not text_value(row.get("weight")) and not text_value(row.get("volume")):
            missing.append(f"cargo[{index}].weightOrVolume")
    return missing


def document_state(data: dict[str, Any]) -> tuple[str, list[str]]:
    missing = missing_fields(data)
    conflicts = data.get("conflicts", [])
    low_confidence = data.get("lowConfidenceFields", [])
    if not isinstance(conflicts, list) or not isinstance(low_confidence, list):
        raise WaybillError("conflicts 和 lowConfidenceFields 必须是数组")
    if missing or conflicts or low_confidence:
        return "collecting", missing
    if data.get("userConfirmed") is not True:
        return "awaiting_confirmation", []
    dispatch_missing = [path for path in DISPATCH_REQUIRED if not text_value(get_value(data, path))]
    if dispatch_missing:
        return "pending_dispatch", dispatch_missing
    return "final", []


def status_label(state: str) -> str:
    return {
        "collecting": "草稿·待补充",
        "awaiting_confirmation": "草稿·待确认",
        "pending_dispatch": "待派车确认稿",
        "final": "最终版",
    }[state]


def cargo_summary(data: dict[str, Any], key: str) -> str:
    parts: list[str] = []
    for row in cargo_rows(data):
        if key == "weightOrVolume":
            combined = " / ".join(filter(None, (text_value(row.get("weight")), text_value(row.get("volume")))))
            parts.append(combined)
        else:
            parts.append(text_value(row.get(key)))
    return "；".join(part for part in parts if part)


def apply_patch(data: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    for path, value in patch.items():
        path_text = text_value(path)
        if not path_text or path_text in {"document.status", "copy.label"}:
            continue
        if path_text.startswith("cargo[") and "]." in path_text:
            match = re.fullmatch(r"cargo\[(\d+)\]\.([A-Za-z]+)", path_text)
            if not match:
                continue
            index = int(match.group(1)) - 1
            key = match.group(2)
            rows = cargo_rows(data)
            while len(rows) <= index:
                rows.append({})
            rows[index][key] = text_value(value)
            data["cargo"] = rows
            continue
        if path_text.startswith("cargo."):
            key = path_text.split(".", 1)[1]
            rows = cargo_rows(data) or [{}]
            if key == "weightOrVolume":
                rendered = text_value(value)
                if "/" in rendered:
                    weight, volume = [part.strip() for part in rendered.split("/", 1)]
                    rows[0]["weight"] = weight
                    rows[0]["volume"] = volume
                else:
                    rows[0]["weight"] = rendered
                    rows[0]["volume"] = ""
            else:
                rows[0][key] = text_value(value)
            data["cargo"] = rows
            continue
        if path_text in FIELD_LABELS or path_text in {"vehicleRequirement", "handover", "remarks"}:
            set_value(data, path_text, text_value(value))
    data["userConfirmed"] = False
    return data


def business_fingerprint(data: dict[str, Any]) -> str:
    payload = {
        key: value
        for key, value in data.items()
        if key not in {"fieldMeta", "exportMeta"}
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compact_schedule_token(label: str, value: str) -> str:
    """Short display tokens for the remarks cell (template has no dedicated timeline cells)."""
    text = text_value(value)
    if not text:
        return ""
    # Prefer compact Chinese labels so the remarks cell stays readable.
    short_label = {
        "计划提货": "提货",
        "要求到达": "到达",
        "车型要求": "车型",
    }.get(label, label)
    compact = (
        text.replace("计划提货", "")
        .replace("要求到达", "")
        .replace("车型要求", "")
        .replace("（带尾板车辆）", "")
        .replace("带尾板车辆", "")
        .strip(" ：:")
    )
    return f"{short_label}{compact}" if compact else ""


def compose_remarks_display(data: dict[str, Any]) -> str:
    """
    Build the printable remarks cell:
    - agent `remarks` first (expected already short)
    - then compact timeline / vehicle from dedicated fields (never re-dump long prose)
    """
    core = text_value(data.get("remarks"))
    # Soft cap: keep operational notes dominant; do not re-expand long agent prose here.
    if len(core) > 60:
        core = core[:57].rstrip("；;，, ") + "…"
    parts: list[str] = [core] if core else []
    joined = core
    for label, raw in (
        ("计划提货", get_value(data, "timeline.pickup")),
        ("要求到达", get_value(data, "timeline.delivery")),
        ("车型要求", data.get("vehicleRequirement", "")),
    ):
        token = compact_schedule_token(label, text_value(raw))
        if not token:
            continue
        # Skip if agent already mentioned the same facet.
        if any(key in joined for key in (label, token[:2], token)):
            continue
        parts.append(token)
        joined = "；".join(parts)
    return "；".join(part for part in parts if part)


def template_values(data: dict[str, Any], state: str) -> dict[str, str]:
    values = {path: text_value(get_value(data, path)) for path in FIELD_LABELS}
    values.update({
        "document.status": status_label(state),
        "cargo.name": cargo_summary(data, "name"),
        "cargo.quantity": cargo_summary(data, "quantity"),
        "cargo.packaging": cargo_summary(data, "packaging"),
        "cargo.weightOrVolume": cargo_summary(data, "weightOrVolume"),
        "cargo.declaredValue": cargo_summary(data, "declaredValue"),
        "cargo.insuranceFee": cargo_summary(data, "insuranceFee"),
        "cargo.codAmount": cargo_summary(data, "codAmount"),
        "remarks": compose_remarks_display(data),
    })
    return values


def fill_html(
    template: str,
    values: dict[str, str],
    state: str,
    data: dict[str, Any],
    *,
    inject_print_css: bool = False,
) -> str:
    """Fill business values into the HTML template.

    Preview only needs on-screen HTML. Print/PDF CSS is injected only when
    exporting PDF so process-preview stays small and cheap.
    """
    rendered = template.replace('data-status="草稿·待确认"', f'data-status="{html.escape(status_label(state))}"')

    def replace_field(match: re.Match[str]) -> str:
        field = match.group("field")
        if field not in values and field != "copy.label":
            return match.group(0)
        if field == "copy.label":
            return match.group(0)
        value = values.get(field, "")
        attrs = match.group("attrs")
        shown = value or ("待补充" if "missing" in attrs or field in CUSTOMER_REQUIRED else "—")
        if value:
            attrs = MISSING_TOKEN_PATTERN.sub("", attrs)
            attrs = CLASS_TRIM_PATTERN.sub('class="', attrs)
            attrs = EMPTY_CLASS_PATTERN.sub("", attrs)
        elif "missing" not in attrs and field in CUSTOMER_REQUIRED:
            attrs = f'{attrs} class="missing"' if "class=" not in attrs else attrs.replace('class="', 'class="missing ')
        return f'<{match.group("tag")}{attrs}>{html.escape(shown)}</{match.group("tag")}>'

    rendered = FIELD_PATTERN.sub(replace_field, rendered)
    payment_method = text_value(get_value(data, "payment.method"))
    handover = text_value(data.get("handover"))
    selected_checks = {
        "payment.collect": payment_method == "到付",
        "payment.prepaid": payment_method in ("已付", "现付"),
        "payment.receipt": payment_method in ("回付", "回单付"),
        "payment.unpaid": payment_method == "欠付",
        "handover.pickup": handover == "自提",
        "handover.delivery": handover in ("送货", "送货上门"),
    }
    for check, selected in selected_checks.items():
        if selected:
            rendered = rendered.replace(
                f'class="box" data-check="{check}"',
                f'class="box" data-check="{check}" style="background:#28242f"',
            )
    if inject_print_css and "</style>" in rendered and PRINT_FIT_CSS not in rendered:
        rendered = rendered.replace("</style>", f"{PRINT_FIT_CSS}</style>", 1)
    return rendered


def apply_copy_variant(rendered_html: str, variant: dict[str, str]) -> str:
    rendered = rendered_html.replace(
        '<main class="sheet"',
        f'<main class="sheet" data-copy="{variant["key"]}"',
        1,
    )
    rendered = re.sub(
        r'(<div class="copy-name" data-field="copy.label">).*?(</div>)',
        rf'\g<1>{variant["label"]}\g<2>',
        rendered,
        count=1,
    )
    return rendered.replace("物流运输协议（草稿）", f'物流运输协议 · {variant["label"]}')


def copy_label_map() -> dict[str, str]:
    return {variant["key"]: variant["label"] for variant in COPY_VARIANTS}


def inline_widget_fragment(preview_html: str) -> str:
    """
    Single-sheet preview: one filled HTML, tabs only flip data-copy + label/background.
    ~3x smaller payload than embedding three full sheets (faster stream + render).
    """
    style = STYLE_PATTERN.search(preview_html)
    if not style:
        raise WaybillError("模板无法提取会话内预览样式")
    main = MAIN_PATTERN.search(preview_html)
    if not main:
        raise WaybillError("模板无法提取预览主单据片段")
    # Screen preview does not need @media print rules; strip them to shrink widget payload.
    screen_css = PRINT_MEDIA_PATTERN.sub("", style.group(1))
    tabs: list[str] = []
    for index, variant in enumerate(COPY_VARIANTS):
        selected = "true" if index == 0 else "false"
        tabs.append(
            f'<button type="button" role="tab" aria-selected="{selected}" data-copy-tab="{variant["key"]}" '
            f'aria-label="{variant["label"]}">'
            f'<span class="swatch" aria-hidden="true"></span>'
            f'<span class="tab-copy">'
            f'<span class="tab-title">{variant["tabTitle"]}</span>'
            f'<span class="tab-meta">{variant["tabMeta"]}</span>'
            f"</span></button>"
        )
    labels_json = json.dumps(copy_label_map(), ensure_ascii=False)
    widget_style = """
.waybill-copy-preview{width:100%;overflow:hidden;color:#0f172a;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.waybill-copy-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:0 0 14px;padding:4px;border-radius:10px;background:#f4f4f5;border:1px solid #e5e7eb}
.waybill-copy-tabs button{appearance:none;display:flex;align-items:center;justify-content:center;gap:8px;min-width:0;border:0;border-radius:8px;background:transparent;color:#64748b;padding:8px 10px;cursor:pointer;transition:background .15s ease,color .15s ease,box-shadow .15s ease}
.waybill-copy-tabs button:hover{color:#0f172a;background:rgba(255,255,255,.65)}
.waybill-copy-tabs button:focus-visible{outline:2px solid #005dff;outline-offset:1px}
.waybill-copy-tabs button[aria-selected="true"]{color:#0f172a;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.06),0 0 0 1px rgba(15,23,42,.04)}
.waybill-copy-tabs .swatch{flex:0 0 auto;width:14px;height:18px;border-radius:3px;border:1px solid rgba(15,23,42,.12);box-shadow:inset 0 -1px 0 rgba(15,23,42,.06)}
.waybill-copy-tabs button[data-copy-tab="white"] .swatch{background:linear-gradient(180deg,#fbfafc 0%,#f1eef4 100%)}
.waybill-copy-tabs button[data-copy-tab="red"] .swatch{background:linear-gradient(180deg,#fdf0f2 0%,#f5d0d6 100%);border-color:rgba(180,80,100,.22)}
.waybill-copy-tabs button[data-copy-tab="yellow"] .swatch{background:linear-gradient(180deg,#fff8d9 0%,#f5e4a0 100%);border-color:rgba(180,140,20,.22)}
.waybill-copy-tabs .tab-copy{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;text-align:left}
.waybill-copy-tabs .tab-title{font:600 13px/1.2 system-ui,sans-serif;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.waybill-copy-tabs .tab-meta{font:500 11px/1.2 system-ui,sans-serif;color:#94a3b8;white-space:nowrap}
.waybill-copy-tabs button[aria-selected="true"] .tab-meta{color:#64748b}
.waybill-copy-preview .sheet{width:1040px;max-width:100%;transform-origin:top left;color:#28242f;opacity:1!important;filter:none!important}
.waybill-edit-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}
.waybill-edit-bar button{appearance:none;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#0f172a;padding:6px 12px;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer}
.waybill-edit-bar button:hover{background:#f4f4f5;border-color:#cbd5e1}
.waybill-edit-bar button[data-active="true"]{border-color:#005dff;background:#eaf2ff;color:#004ed6}
.waybill-edit-bar .hint{font:12px/1.4 system-ui,sans-serif;color:#64748b}
.waybill-copy-preview[data-editing="true"] [data-field]{outline:1px dashed #d19a2a;cursor:text;min-width:1.5em}
.waybill-copy-preview[data-editing="true"] [data-field="document.status"],
.waybill-copy-preview[data-editing="true"] [data-field="copy.label"]{outline:none;cursor:default}
.waybill-patch-box{display:none;margin:0 0 10px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;color:#334155}
.waybill-copy-preview[data-show-patch="true"] .waybill-patch-box{display:block}
"""
    script = f"""<script>(()=>{{
const root=document.currentScript.closest('[data-waybill-copy-preview]');
if(!root)return;
const labels={labels_json};
const editable=new Set({json.dumps(list(EDITABLE_FIELDS), ensure_ascii=False)});
const tabs=[...root.querySelectorAll('[data-copy-tab]')];
const sheet=root.querySelector('.sheet');
const editBtn=root.querySelector('[data-edit-toggle]');
const saveBtn=root.querySelector('[data-edit-save]');
const hint=root.querySelector('[data-edit-hint]');
const patchBox=root.querySelector('[data-patch-box]');
const select=key=>{{
  if(!sheet||!labels[key])return;
  tabs.forEach(item=>item.setAttribute('aria-selected',String(item.getAttribute('data-copy-tab')===key)));
  sheet.setAttribute('data-copy',key);
  const copyLabel=sheet.querySelector('[data-field="copy.label"]');
  if(copyLabel)copyLabel.textContent=labels[key];
  parent.postMessage({{type:'onmyagent:waybill-copy',key}},'*');
}};
tabs.forEach(tab=>tab.addEventListener('click',()=>select(tab.getAttribute('data-copy-tab'))));
const setEditing=on=>{{
  root.dataset.editing=on?'true':'false';
  if(editBtn)editBtn.dataset.active=on?'true':'false';
  if(saveBtn)saveBtn.hidden=!on;
  if(hint)hint.textContent=on?'点击字段直接修改，改完点保存':'可点“编辑字段”手动改值';
  root.querySelectorAll('[data-field]').forEach(node=>{{
    const field=node.getAttribute('data-field')||'';
    const canEdit=on&&editable.has(field);
    node.contentEditable=canEdit?'true':'false';
    if(canEdit)node.spellcheck=false;
  }});
}};
const collect=()=>{{
  const patch={{}};
  root.querySelectorAll('[data-field]').forEach(node=>{{
    const field=node.getAttribute('data-field')||'';
    if(!editable.has(field))return;
    let value=(node.innerText||'').trim();
    if(value==='待补充'||value==='—')value='';
    patch[field]=value;
  }});
  return patch;
}};
const applyPatchToAll=patch=>{{
  root.querySelectorAll('[data-field]').forEach(node=>{{
    const field=node.getAttribute('data-field')||'';
    if(!(field in patch))return;
    const value=String(patch[field]??'').trim();
    const shown=value||(node.classList.contains('missing')?'待补充':'—');
    node.textContent=shown;
    if(value)node.classList.remove('missing');
  }});
}};
editBtn&&editBtn.addEventListener('click',()=>setEditing(root.dataset.editing!=='true'));
saveBtn&&saveBtn.addEventListener('click',()=>{{
  const patch=collect();
  applyPatchToAll(patch);
  setEditing(false);
  root.dataset.showPatch='true';
  // Build markdown fences at runtime (fromCharCode) so this HTML never contains
  // literal ``` sequences that would early-close an outer ```show_widget fence.
  const ticks=String.fromCharCode(96).repeat(3);
  const body=ticks+'waybill-patch\\n'+JSON.stringify(patch,null,2)+'\\n'+ticks;
  if(patchBox)patchBox.textContent='已保存到预览。请把下面这段发给专家以写入数据并刷新预览：\\n'+body;
  parent.postMessage({{type:'onmyagent:waybill-fields',patch}},'*');
  try{{navigator.clipboard&&navigator.clipboard.writeText(body)}}catch(_){{}}
}});
setEditing(false);
select('white');
}})()</script>"""
    return (
        f"<style>{screen_css}{widget_style}</style>"
        '<section class="waybill-copy-preview" data-waybill-copy-preview data-editing="false">'
        '<div class="waybill-edit-bar">'
        '<button type="button" data-edit-toggle>编辑字段</button>'
        '<button type="button" data-edit-save hidden>保存修改</button>'
        '<span class="hint" data-edit-hint>可点“编辑字段”手动改值</span>'
        "</div>"
        '<div class="waybill-patch-box" data-patch-box></div>'
        f'<div class="waybill-copy-tabs" role="tablist" aria-label="联次切换">{"".join(tabs)}</div>'
        f'<div role="tabpanel" data-copy-panel="live">{main.group(1)}</div>'
        f"{script}"
        "</section>"
    )


def cleanup_legacy_multi_preview_html(preview_dir: Path, number: str) -> None:
    """Remove older per-copy preview files after switching to single-HTML preview."""
    for variant in COPY_VARIANTS:
        legacy = preview_dir / f'物流单_{number}_{variant["fileLabel"]}_当前预览.html'
        if legacy.is_file():
            try:
                legacy.unlink()
            except OSError:
                pass


def safe_name(value: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\s]+', "-", value).strip("-.")
    return name[:80] or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def xml_cell(ref: str, value: Any, style: int = 0, numeric: bool = False) -> str:
    style_attr = f' s="{style}"' if style else ""
    if numeric and text_value(value):
        try:
            number = float(text_value(value).replace(",", ""))
            return f'<c r="{ref}"{style_attr}><v>{number}</v></c>'
        except ValueError:
            pass
    text = xml_escape(text_value(value))
    preserve = ' xml:space="preserve"' if text.startswith(" ") or text.endswith(" ") else ""
    return f'<c r="{ref}" t="inlineStr"{style_attr}><is><t{preserve}>{text}</t></is></c>'


def xml_row(index: int, cells: list[str], height: int | None = None) -> str:
    height_attr = f' ht="{height}" customHeight="1"' if height else ""
    return f'<row r="{index}"{height_attr}>{"".join(cells)}</row>'


def display_identifier(value: Any) -> str:
    rendered = text_value(value)
    if re.fullmatch(r"\d{18}", rendered):
        return f"{rendered[:6]} {rendered[6:14]} {rendered[14:]}"
    return rendered


def print_sheet_xml(data: dict[str, Any], state: str, copy_label: str) -> str:
    values = template_values(data, state)
    rows: list[str] = []
    rows.append(xml_row(1, [xml_cell("A1", "物流运输协议", 2), xml_cell("J1", f'NO. {values["document.number"] or "待补充"}', 3)], 30))
    rows.append(xml_row(2, [xml_cell("A2", "承揽全国各地整车零担业务 · 代收货款", 4), xml_cell("J2", f"{copy_label} · {status_label(state)}", 5)], 22))
    rows.append(xml_row(3, [xml_cell("A3", f'起运地点：{values["route.origin"] or "待补充"} 至 {values["route.destination"] or "待补充"}', 6), xml_cell("J3", f'发货日期：{values["document.date"] or "待补充"}', 6)], 24))
    party_rows = [
        ("托运单位", values["shipper.name"], "收货单位", values["consignee.name"]),
        ("姓名", values["shipper.contact"], "姓名", values["consignee.contact"]),
        ("电话", values["shipper.phone"], "电话", values["consignee.phone"]),
    ]
    for row_index, item in enumerate(party_rows, start=4):
        rows.append(xml_row(row_index, [xml_cell(f"A{row_index}", item[0], 7), xml_cell(f"C{row_index}", item[1] or "待补充", 8), xml_cell(f"G{row_index}", item[2], 7), xml_cell(f"I{row_index}", item[3] or "待补充", 8)], 26))
    headers = ("货物名称", "件数", "包装", "重量/体积", "保险金额", "保险费", "代收货款", "备注")
    header_refs = ("A7", "C7", "D7", "E7", "G7", "H7", "I7", "J7")
    rows.append(xml_row(7, [xml_cell(ref, label, 7) for ref, label in zip(header_refs, headers)], 28))
    cargo_values = (values["cargo.name"], values["cargo.quantity"], values["cargo.packaging"], values["cargo.weightOrVolume"], values["cargo.declaredValue"] or "—", values["cargo.insuranceFee"] or "—", values["cargo.codAmount"] or "—", values["remarks"] or "—")
    rows.append(xml_row(8, [xml_cell(ref.replace("7", "8"), value or "待补充", 8) for ref, value in zip(header_refs, cargo_values)], 48))
    rows.append(xml_row(9, [xml_cell("A9", "车牌号", 7), xml_cell("C9", values["vehicle.plate"] or "—", 8), xml_cell("G9", "家庭住址", 7), xml_cell("I9", values["vehicle.driverAddress"] or "—", 8)], 26))
    rows.append(xml_row(10, [xml_cell("A10", "驾驶证号", 7), xml_cell("C10", display_identifier(values["vehicle.licenseNumber"]) or "—", 13), xml_cell("G10", "司机姓名/电话", 7), xml_cell("I10", f'{values["vehicle.driverName"] or "—"} / {values["vehicle.driverPhone"] or "—"}', 13)], 26))
    rows.append(xml_row(11, [xml_cell("A11", f'运输结算方式：{values["payment.method"] or "待补充"}    提货方式：{values["handover"] or "待补充"}', 8)], 28))
    rows.append(xml_row(12, [xml_cell("A12", f'金额合计（大写）：{values["payment.amountUppercase"] or "待补充"}    ￥：{values["payment.amount"] or "待补充"}', 8)], 28))
    rows.append(xml_row(13, [xml_cell("A13", "发货单位\n\n年  月  日", 9), xml_cell("D13", "承运司机\n\n年  月  日", 9), xml_cell("G13", "本部经手人\n\n年  月  日", 9), xml_cell("J13", "收货单位\n\n年  月  日", 9)], 64))
    rows.append(xml_row(14, [xml_cell("A14", f'承运方地址：{values["carrier.address"] or "待补充"}    电话：{values["carrier.phone"] or "待补充"}', 10)], 24))
    rows.append(xml_row(15, [xml_cell("A15", "托运方在本公司托运货物时请仔细阅读客户联背面，本运单一经签署即生法律效用。", 10)], 24))
    merges = ("A1:I1", "J1:L1", "A2:I2", "J2:L2", "A3:I3", "J3:L3", "A4:B4", "C4:F4", "G4:H4", "I4:L4", "A5:B5", "C5:F5", "G5:H5", "I5:L5", "A6:B6", "C6:F6", "G6:H6", "I6:L6", "A7:B7", "E7:F7", "J7:L7", "A8:B8", "E8:F8", "J8:L8", "A9:B9", "C9:F9", "G9:H9", "I9:L9", "A10:B10", "C10:F10", "G10:H10", "I10:L10", "A11:L11", "A12:L12", "A13:C13", "D13:F13", "G13:I13", "J13:L13", "A14:L14", "A15:L15")
    merge_xml = "".join(f'<mergeCell ref="{item}"/>' for item in merges)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<cols><col min="1" max="12" width="10.5" customWidth="1"/></cols>
<sheetData>{"".join(rows)}</sheetData><mergeCells count="{len(merges)}">{merge_xml}</mergeCells>
<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0" footer="0"/>
<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="1"/>
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><printOptions horizontalCentered="1" verticalCentered="1"/>
</worksheet>'''


def flatten_fields(data: dict[str, Any], state: str) -> list[tuple[str, str, str, str, str, str]]:
    meta = data.get("fieldMeta", {}) if isinstance(data.get("fieldMeta", {}), dict) else {}
    result: list[tuple[str, str, str, str, str, str]] = []
    paths = list(FIELD_LABELS)
    for path in paths:
        value = text_value(get_value(data, path))
        info = meta.get(path, {}) if isinstance(meta.get(path, {}), dict) else {}
        result.append((path, FIELD_LABELS[path], value, "已填写" if value else "待补充", text_value(info.get("source")), text_value(info.get("confidence"))))
    for index, cargo in enumerate(cargo_rows(data), start=1):
        for key, label in (("name", "货物名称"), ("quantity", "数量/件数"), ("packaging", "包装"), ("weight", "重量"), ("volume", "体积"), ("declaredValue", "声明价值"), ("insuranceFee", "保险费"), ("codAmount", "代收货款")):
            path = f"cargo[{index}].{key}"
            value = text_value(cargo.get(key))
            info = meta.get(path, {}) if isinstance(meta.get(path, {}), dict) else {}
            result.append((path, f"货物{index}-{label}", value, "已填写" if value else "待补充", text_value(info.get("source")), text_value(info.get("confidence"))))
    result.insert(0, ("document.status", "单据状态", status_label(state), "已确定", "系统门禁", "high"))
    result = [
        (path, label, display_identifier(value) if path == "vehicle.licenseNumber" else value, status, source, confidence)
        for path, label, value, status, source, confidence in result
    ]
    return result


def data_sheet_xml(data: dict[str, Any], state: str) -> str:
    headers = ("字段键", "字段名称", "字段值", "状态", "来源", "置信度")
    rows = [xml_row(1, [xml_cell(f"{column}1", value, 11) for column, value in zip("ABCDEF", headers)], 26)]
    for index, values in enumerate(flatten_fields(data, state), start=2):
        rows.append(xml_row(index, [xml_cell(f"{column}{index}", value, 13 if column == "C" else 12) for column, value in zip("ABCDEF", values)], 24))
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="42" customWidth="1"/><col min="4" max="6" width="16" customWidth="1"/></cols>
<sheetData>{"".join(rows)}</sheetData><autoFilter ref="A1:F{len(rows)}"/>
</worksheet>'''


def apply_xlsx_copy_fill(styles: str, color: str) -> str:
    styles = styles.replace('<fills count="4">', '<fills count="5">').replace(
        "</fills>",
        f'<fill><patternFill patternType="solid"><fgColor rgb="{color}"/><bgColor indexed="64"/></patternFill></fill></fills>',
        1,
    )
    section_start = styles.index("<cellXfs")
    section_end = styles.index("</cellXfs>")
    section = styles[section_start:section_end]
    style_index = -1

    def recolor(match: re.Match[str]) -> str:
        nonlocal style_index
        style_index += 1
        tag = match.group(0)
        if style_index not in {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13}:
            return tag
        tag = re.sub(r'fillId="\d+"', 'fillId="4"', tag)
        if "applyFill=" not in tag:
            tag = tag[:-2] + ' applyFill="1"/>' if tag.endswith("/>") else tag[:-1] + ' applyFill="1">'
        return tag

    recolored = re.sub(r"<xf\b[^>]*>", recolor, section)
    return styles[:section_start] + recolored + styles[section_end:]


def write_xlsx(path: Path, data: dict[str, Any], state: str, variant: dict[str, str]) -> None:
    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="20"/><name val="SimSun"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font><font><color rgb="FF9C405B"/><sz val="12"/><name val="Microsoft YaHei"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1EAF0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5B4050"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border/><border><left style="thin"><color rgb="FF5F5966"/></left><right style="thin"><color rgb="FF5F5966"/></right><top style="thin"><color rgb="FF5F5966"/></top><bottom style="thin"><color rgb="FF5F5966"/></bottom></border><border><bottom style="thin"><color rgb="FF5F5966"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" quotePrefix="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
    styles = apply_xlsx_copy_fill(styles, variant["color"])
    files = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>''',
        "xl/workbook.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="物流单" sheetId="1" r:id="rId1"/><sheet name="字段数据" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>''',
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''',
        "xl/worksheets/sheet1.xml": print_sheet_xml(data, state, variant["label"]),
        "xl/worksheets/sheet2.xml": data_sheet_xml(data, state),
        "xl/styles.xml": styles,
        "docProps/app.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OnMyAgent 物流单专家</Application></Properties>''',
        "docProps/core.xml": f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>物流单 {xml_escape(text_value(get_value(data, "document.number")))}</dc:title><dc:creator>OnMyAgent 物流单专家</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">{datetime.now(timezone.utc).isoformat()}</dcterms:created></cp:coreProperties>''',
    }
    if path.exists():
        path.unlink()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)


def find_chrome() -> str | None:
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for command in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
        located = shutil.which(command)
        if located:
            candidates.append(located)
    return next((candidate for candidate in candidates if Path(candidate).is_file()), None)


def write_pdfs(jobs: list[tuple[Path, Path]]) -> None:
    if not jobs:
        return
    chrome = find_chrome()
    if not chrome:
        raise WaybillError("未找到 Chrome/Chromium/Edge，无法从 HTML 同源导出 PDF")
    with tempfile.TemporaryDirectory(prefix="waybill-chrome-") as profile:
        for html_path, pdf_path in jobs:
            if pdf_path.exists():
                pdf_path.unlink()
            command = [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                "--hide-scrollbars",
                "--run-all-compositor-stages-before-draw",
                "--virtual-time-budget=5000",
                f"--user-data-dir={profile}",
                f"--print-to-pdf={pdf_path}",
                html_path.resolve().as_uri(),
            ]
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                command.insert(1, "--no-sandbox")
            process = subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=os.name != "nt",
            )
            deadline = time.monotonic() + 45
            previous_size = -1
            stable_checks = 0
            try:
                while time.monotonic() < deadline:
                    if pdf_path.is_file():
                        current_size = pdf_path.stat().st_size
                        stable_checks = stable_checks + 1 if current_size > 0 and current_size == previous_size else 0
                        previous_size = current_size
                        if stable_checks >= 2:
                            break
                    if process.poll() is not None and not pdf_path.is_file():
                        raise WaybillError(f"PDF 导出失败：浏览器退出码 {process.returncode}")
                    time.sleep(0.1)
                else:
                    raise WaybillError("PDF 导出超时：浏览器未在 45 秒内生成稳定文件")
            finally:
                if process.poll() is None:
                    if os.name == "nt":
                        process.terminate()
                    else:
                        os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        if os.name == "nt":
                            process.kill()
                        else:
                            os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=2)
            if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
                raise WaybillError("PDF 导出失败：浏览器未生成文件")


def write_text_if_changed(path: Path, content: str) -> bool:
    if path.is_file():
        try:
            if path.read_text(encoding="utf-8") == content:
                return False
        except OSError:
            pass
    path.write_text(content, encoding="utf-8")
    return True


def parse_formats(raw: str) -> set[str]:
    tokens = {token.strip().lower() for token in raw.replace("，", ",").split(",") if token.strip()}
    if not tokens or tokens == {"none"} or tokens == {"skip"}:
        return set()
    if "all" in tokens:
        return {"pdf", "xlsx"}
    allowed = {"pdf", "xlsx"}
    unknown = tokens - allowed
    if unknown:
        raise WaybillError(f"不支持的导出格式：{', '.join(sorted(unknown))}；可选 pdf / xlsx / all / none")
    return tokens


def process_dir(output_dir: Path) -> Path:
    path = output_dir / PROCESS_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def cleanup_result_exports(output_dir: Path, number: str) -> list[str]:
    removed: list[str] = []
    for path in output_dir.glob(f"物流单_{number}_*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".pdf", ".xlsx"}:
            continue
        path.unlink()
        removed.append(str(path))
    fingerprint = process_dir(output_dir) / FINGERPRINT_NAME
    if fingerprint.exists():
        fingerprint.unlink()
        removed.append(str(fingerprint))
    return removed


def read_fingerprint(output_dir: Path) -> str:
    path = process_dir(output_dir) / FINGERPRINT_NAME
    if not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def write_fingerprint(output_dir: Path, fingerprint: str) -> None:
    (process_dir(output_dir) / FINGERPRINT_NAME).write_text(fingerprint, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate logistics waybill preview and gated final artifacts")
    parser.add_argument("--input", required=True, type=Path, help="waybill-data.json")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    parser.add_argument(
        "--formats",
        default="pdf,xlsx",
        help="export only: pdf / xlsx / pdf,xlsx / all / none",
    )
    parser.add_argument("--patch", type=Path, help="JSON object of field path -> value to merge before generate")
    parser.add_argument("--write-input", action="store_true", help="Write merged/patched data back to --input")
    parser.add_argument(
        "--invalidate-exports",
        action="store_true",
        help="Delete existing result PDF/XLSX for this document number before preview",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise WaybillError("输入 JSON 顶层必须是对象")
        if args.patch:
            patch_raw = json.loads(args.patch.read_text(encoding="utf-8"))
            if not isinstance(patch_raw, dict):
                raise WaybillError("--patch 必须是 JSON 对象")
            data = apply_patch(data, patch_raw)
        if args.write_input or args.patch:
            args.input.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        template = read_template(args.template)
        state, blockers = document_state(data)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        preview_dir = process_dir(args.output_dir)
        number = safe_name(text_value(get_value(data, "document.number")))
        fingerprint = business_fingerprint(data)
        removed: list[str] = []
        previous = read_fingerprint(args.output_dir)
        # Preview never generates PDF/XLSX. It only invalidates stale result files when data changed.
        if args.invalidate_exports or (previous and previous != fingerprint):
            removed = cleanup_result_exports(args.output_dir, number)

        formats = parse_formats(args.formats) if args.mode == "export" else set()
        # Preview path: HTML process artifacts only (no browser, no PDF, no Excel).
        need_print_css = args.mode == "export" and "pdf" in formats
        base_html = fill_html(
            template,
            template_values(data, state),
            state,
            data,
            inject_print_css=need_print_css,
        )
        # Single live preview HTML (tabs switch paper color client-side).
        preview_html = apply_copy_variant(base_html, COPY_VARIANTS[0])
        preview_path = preview_dir / f"物流单_{number}_当前预览.html"
        write_text_if_changed(preview_path, preview_html)
        cleanup_legacy_multi_preview_html(preview_dir, number)
        generated: list[str] = [str(preview_path)]
        artifact_copies: list[dict[str, str]] = []

        if args.mode == "export":
            if state not in ("pending_dispatch", "final"):
                raise WaybillError(
                    f"当前状态 {state} 不允许导出，请先补齐并确认信息；阻塞项：{', '.join(blockers) or 'userConfirmed'}"
                )
            if not formats:
                raise WaybillError("未选择导出格式。请使用 --formats pdf / xlsx / pdf,xlsx，或先不生成结果产物")
            # Always delete previous result artifacts for this number so stale PDFs cannot remain.
            removed.extend(cleanup_result_exports(args.output_dir, number))
            edition = "待派车确认稿" if state == "pending_dispatch" else "最终版"
            pdf_jobs: list[tuple[Path, Path]] = []
            # Export still materializes three colored copies for print/PDF/Excel.
            for variant in COPY_VARIANTS:
                rendered_html = apply_copy_variant(base_html, variant)
                export_html_path = preview_dir / f'物流单_{number}_{variant["fileLabel"]}_导出稿.html'
                write_text_if_changed(export_html_path, rendered_html)
                xlsx_path = args.output_dir / f'物流单_{number}_{variant["fileLabel"]}_{edition}.xlsx'
                pdf_path = args.output_dir / f'物流单_{number}_{variant["fileLabel"]}_{edition}.pdf'
                copy_info = {
                    "key": variant["key"],
                    "label": variant["label"],
                    "pdf": str(pdf_path) if "pdf" in formats else "",
                    "xlsx": str(xlsx_path) if "xlsx" in formats else "",
                }
                if "xlsx" in formats:
                    write_xlsx(xlsx_path, data, state, variant)
                    generated.append(str(xlsx_path))
                if "pdf" in formats:
                    pdf_jobs.append((export_html_path, pdf_path))
                    generated.append(str(pdf_path))
                if copy_info["pdf"] or copy_info["xlsx"]:
                    artifact_copies.append(copy_info)
            write_pdfs(pdf_jobs)
            for _, pdf_path in pdf_jobs:
                if not pdf_path.is_file():
                    raise WaybillError(f"PDF 未生成：{pdf_path}")
            write_fingerprint(args.output_dir, fingerprint)

        title = "物流单三联最终预览" if state == "final" and args.mode == "export" else "当前物流单三联预览"
        if args.mode == "export" and state == "pending_dispatch":
            title = "物流单三联待派车确认稿"
        print(json.dumps({
            "ok": True,
            "state": state,
            "label": status_label(state),
            "blockers": blockers,
            "formats": sorted(formats),
            "processDir": str(preview_dir),
            "removed": removed,
            "files": generated,
            "inlineWidget": {
                "title": title,
                "widget_code": inline_widget_fragment(preview_html),
                "artifactCopies": artifact_copies,
            },
        }, ensure_ascii=False))
        return 0
    except (OSError, json.JSONDecodeError, WaybillError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
