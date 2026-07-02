#!/usr/bin/env python3
"""
monitor_query.py — tcop-api/monitor-query 模块的机械逻辑封装

封装 GetMonitorData 调用前的所有"确定性计算"，让 LLM 只负责意图理解与多候选反问。

子命令:
  list_metrics <strategy_type> [--scope dash|namespace] [--external-only]
      strategy_type → dash_id → 一组 metrics（主集），并附带同 namespace 下
      其他 dash_id 的扩展候选（避免颗粒度切割导致漏指标）。
      默认 scope=both（主集 + 扩展），external-only=False（含 is_external=0）。

  match_metric <strategy_type> <用户指标描述> [--scope ...] [--external-only]
      在 strategy_type 对应的 metrics 列表里做语义模糊匹配。
      默认先在 dash_id 主集上匹配；0 命中时自动扩展到 namespace 全集再匹配；
      仍 0 命中则提示模型按通识降级（next_action=model_select_by_semantics）。
      匹配字段: api_metric_name_zh / meaning_zh / api_metric_name / meaning_en。

  pick_period --duration <sec> --instance-count <N> --stat-types <json>
      根据时间范围 + 实例数 + 候选 Period × StatType，推算合适的统计粒度。
      约束: 单请求数据点 ≤ 7200，实例 ≤ 50。

  build_request --namespace --metric --dimension-keys --instances
                --period --start-time --end-time [--out PATH]
      生成 GetMonitorData 的 --cli-input-json 文件 + 校验时间格式。

  execute_query --request-file <PATH> --region <ap-xxx>
      执行 GetMonitorData + 解析响应（兼容 'Response' 外层包装与裸响应）+ 输出
      标准化摘要（每实例 min/avg/max/last/n）。

注：find_strategy 已迁移到 instance_resolver.py（含 L2 路由优化）。

数据来源（权威）:
  api_metric_union.jsonl 是 API 查询视角的指标全集。
  DescribeAllNamespaces 返回的指标是告警视角，不能用于驱动 GetMonitorData 选指标。

Exit codes:
  0  成功
  1  参数错误
  2  数据未命中（如 strategy_type 不存在）
  3  数据文件缺失或损坏

约定:
  所有结果默认输出 JSON 到 stdout，错误信息到 stderr。
  数据文件路径默认为脚本同级 ../references/data/。
"""
from __future__ import annotations
import argparse
import json
import os
import re
import statistics
import sys
import subprocess as _sp
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# -------- 数据文件定位 --------

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / "references" / "data"


def _data_path(name: str) -> Path:
    p = DATA_DIR / name
    if not p.exists():
        sys.stderr.write(f"[FATAL] data file missing: {p}\n")
        sys.exit(3)
    return p


def _load_jsonl(name: str) -> list[dict]:
    out = []
    with open(_data_path(name), encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                sys.stderr.write(f"[FATAL] {name}:{ln} invalid JSON: {e}\n")
                sys.exit(3)
    return out


# -------- 模糊匹配工具 --------


def _norm(s: Any) -> str:
    if s is None:
        return ""
    return str(s).strip().lower()


def _score_match(query: str, fields: list[tuple[str, int]]) -> tuple[int, list[str]]:
    """Multi-field weighted match.

    fields: [(value, weight), ...]
    Returns: (max_score, matched_field_descriptions)

    评分策略:
      100 * w  完全相等（忽略大小写）
       80 * w  字段值完全包含 query
       60 * w  query 完全包含字段值（query 比字段长，且字段是其子串）
       40 * w  按 token 切分后有 ≥1 个 token 与字段子串匹配
        0      其他
    weight=10 是单位权重。
    """
    q = _norm(query)
    if not q:
        return 0, []
    q_tokens = [t for t in re.split(r"[\s,/_\-]+", q) if t]
    best = 0
    matches: list[str] = []
    for value, weight in fields:
        v = _norm(value)
        if not v:
            continue
        score = 0
        if v == q:
            score = 100 * weight
        elif q in v:
            score = 80 * weight
        elif v in q:
            score = 60 * weight
        else:
            hits = sum(1 for t in q_tokens if len(t) >= 2 and t in v)
            if hits:
                score = min(40, 15 * hits) * weight
        if score > 0:
            matches.append(f"{value}({score})")
            if score > best:
                best = score
    return best, matches


# -------- find_strategy 已迁移到 instance_resolver.py（含 L2 路由优化）--------
# 模型应使用 `instance_resolver.py find_strategy <query> --intent ...`


# -------- list_metrics / match_metric 共用核心 --------


def _resolve_dash_id(strategy_type: str) -> str | None:
    rows = _load_jsonl("show_product_dash.jsonl")
    for r in rows:
        if r["strategy_type"] == strategy_type:
            return r.get("dash_id")
    return None


def _strategy_record(strategy_type: str) -> dict | None:
    for r in _load_jsonl("alarm_strategy.jsonl"):
        if r["strategy_type"] == strategy_type:
            return r
    return None


def _metrics_for_strategy(strategy_type: str, scope: str = "both",
                          external_only: bool = False) -> dict:
    """根据 strategy_type 取指标候选集，按 dash_id 主集 + namespace 扩展集分层组织。

    返回:
      {
        "dash_id": str,                 # strategy_type 直接对应的 dash_id
        "namespace": str | None,        # 主集所在 api_namespace（如 QCE/CDB）
        "primary": list[dict],          # dash_id == 当前 dash_id 的指标
        "extended": list[dict],         # 同 namespace 下其他 dash_id 的指标
        "extended_dash_ids": list[str], # 扩展集里出现的 dash_id 列表
      }

    设计动机：jsonl 里同一个 namespace（如 QCE/CDB）按 dash_id 切成多份
    （cdb / cdb_cluster / cdb_proxy / cdb_libradb_*）。strategy_type=cdb_detail
    只对应 dash_id=cdb 的 125 条主指标，但用户问"集群版" / "LibraDB" 时
    需要看到其他 dash_id 下的扩展候选（QCE/CDB 总计 287 条）。

    scope 取值:
      "dash"      只返回 primary（行为退化为旧版）
      "namespace" 主集 + 扩展集都返回
      "both"      同 "namespace"（默认，未来可能再细分）

    external_only=True 时同时过滤 primary 和 extended。
    """
    dash_id = _resolve_dash_id(strategy_type)
    if not dash_id:
        return {
            "dash_id": None,
            "namespace": None,
            "primary": [],
            "extended": [],
            "extended_dash_ids": [],
        }
    rows = _load_jsonl("api_metric_union.jsonl")
    primary = [r for r in rows if r.get("dashboard_config_id") == dash_id]
    namespace = primary[0].get("api_namespace") if primary else None
    extended: list[dict] = []
    extended_dash_ids: list[str] = []
    if scope != "dash" and namespace:
        seen_dash_ids = {dash_id}
        for r in rows:
            if r.get("api_namespace") != namespace:
                continue
            d = r.get("dashboard_config_id")
            if d == dash_id:
                continue
            extended.append(r)
            if d and d not in seen_dash_ids:
                extended_dash_ids.append(d)
                seen_dash_ids.add(d)
    if external_only:
        primary = [m for m in primary if m.get("is_external") == 1]
        extended = [m for m in extended if m.get("is_external") == 1]
    return {
        "dash_id": dash_id,
        "namespace": namespace,
        "primary": primary,
        "extended": extended,
        "extended_dash_ids": extended_dash_ids,
    }


def cmd_list_metrics(args):
    if not _strategy_record(args.strategy_type):
        sys.stderr.write(f"strategy_type not found: {args.strategy_type}\n")
        sys.exit(2)
    bundle = _metrics_for_strategy(args.strategy_type, scope=args.scope,
                                   external_only=args.external_only)
    if not bundle["dash_id"]:
        sys.stderr.write(
            f"strategy_type {args.strategy_type!r} has no dash_id mapping in "
            f"show_product_dash.jsonl; cannot list metrics offline\n"
        )
        sys.exit(2)
    primary = bundle["primary"]
    extended = bundle["extended"]
    summarize = (lambda m: m) if args.full else _metric_summary
    out = {
        "strategy_type": args.strategy_type,
        "dash_id": bundle["dash_id"],
        "namespace": bundle["namespace"],
        "scope": args.scope,
        "external_only": args.external_only,
        "primary_count": len(primary),
        "primary_metrics": [summarize(m) for m in primary],
        "extended_dash_ids": bundle["extended_dash_ids"],
        "extended_count": len(extended),
        "extended_metrics": [summarize(m) for m in extended],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


def _metric_summary(m: dict) -> dict:
    return {
        "api_namespace": m.get("api_namespace"),
        "api_metric_name": m.get("api_metric_name"),
        "api_metric_name_zh": m.get("api_metric_name_zh"),
        "meaning_zh": m.get("meaning_zh"),
        "unit": m.get("unit"),
        "seconds_stat_type": m.get("seconds_stat_type"),
        "dashboard_config_id": m.get("dashboard_config_id"),
        "is_external": m.get("is_external"),
    }


def _score_metric(query: str, m: dict) -> int:
    score, _ = _score_match(query, [
        (m.get("api_metric_name_zh"), 12),
        (m.get("api_metric_name"), 10),
        (m.get("meaning_zh"), 8),
        (m.get("meaning_en"), 4),
    ])
    return score


def cmd_match_metric(args):
    if not _strategy_record(args.strategy_type):
        sys.stderr.write(f"strategy_type not found: {args.strategy_type}\n")
        sys.exit(2)
    bundle = _metrics_for_strategy(args.strategy_type, scope=args.scope,
                                   external_only=args.external_only)
    if not bundle["dash_id"]:
        sys.stderr.write(
            f"strategy_type {args.strategy_type!r} has no dash_id mapping\n"
        )
        sys.exit(2)
    # 先在 primary 上匹配；0 命中时按 scope 决定是否回退到 extended
    primary_hits: list[tuple[int, dict]] = []
    for m in bundle["primary"]:
        score = _score_metric(args.query, m)
        if score > 0:
            primary_hits.append((score, m))
    primary_hits.sort(key=lambda x: -x[0])

    extended_hits: list[tuple[int, dict]] = []
    if not primary_hits and args.scope != "dash":
        for m in bundle["extended"]:
            score = _score_metric(args.query, m)
            if score > 0:
                extended_hits.append((score, m))
        extended_hits.sort(key=lambda x: -x[0])

    matched_pool = primary_hits or extended_hits
    matched_source = "primary" if primary_hits else (
        "extended" if extended_hits else "none"
    )
    top = matched_pool[: args.limit]

    if not top:
        # 0 命中：返回 namespace 全集（primary + extended）让模型按通识降级
        all_metrics = bundle["primary"] + bundle["extended"]
        out = {
            "matched": [],
            "match_count": 0,
            "matched_source": matched_source,
            "all_metrics_count": len(all_metrics),
            "all_metrics_scope": "namespace" if bundle["extended"] else "dash",
            "all_metrics": [_metric_summary(m) for m in all_metrics],
            "namespace": bundle["namespace"],
            "dash_id": bundle["dash_id"],
            "extended_dash_ids": bundle["extended_dash_ids"],
            "next_action": "model_select_by_semantics",
            "reason": (
                f"query={args.query!r} has 0 matched metrics under {args.strategy_type} "
                f"(namespace={bundle['namespace']}). Common 通识 query (e.g. '负载'/'压力'/'健康度') "
                f"often does not match any single metric name in the catalog. Model should pick "
                f"3-5 semantically relevant metrics from all_metrics by 通识 (e.g. for '负载': "
                f"pick CPU/Memory/IOPS/Connection use rates), then ask user to confirm."
            ),
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    matched = [{**_metric_summary(m), "score": score} for score, m in top]
    next_action = "auto_continue" if len(matched) == 1 else "ask_user_choose_metric"
    out = {
        "matched": matched,
        "match_count": len(matched),
        "matched_source": matched_source,
        "namespace": bundle["namespace"],
        "dash_id": bundle["dash_id"],
        "next_action": next_action,
    }
    if matched_source == "extended":
        out["note"] = (
            f"primary scope (dash_id={bundle['dash_id']}) had 0 matches; "
            f"results came from extended scope (other dash_ids under namespace="
            f"{bundle['namespace']}). If user actually wanted a different sub-product, "
            f"reconsider the strategy_type via instance_resolver.find_strategy."
        )
    print(json.dumps(out, ensure_ascii=False, indent=2))


# -------- pick_period --------


# GetMonitorData 硬约束
MAX_DATA_POINTS = 7200
MAX_INSTANCES = 50
COMMON_PERIODS = [10, 60, 300, 3600, 86400]


def cmd_pick_period(args):
    """根据时间范围 + 实例数 + 可选 Period 列表，挑出合适的 Period。

    seconds_stat_type 形如 {"60":"avg","300":"max","86400":"max"}。
    选择策略:
      1. 候选 = stat_types 的 keys
      2. 过滤掉 (duration / period * instance_count) > 7200 的
      3. 优先选 user_preferred_period（若指定且合规）
      4. 否则选"舒适粒度"——数据点数落在 [30, 200] 区间最优；
         不在则按"靠近 100 点"的距离选最接近的合规 Period
    """
    stat = json.loads(args.stat_types)
    if not isinstance(stat, dict) or not stat:
        sys.stderr.write("--stat-types must be non-empty JSON object\n")
        sys.exit(1)
    if args.instance_count > MAX_INSTANCES:
        sys.stderr.write(
            f"instance_count={args.instance_count} > {MAX_INSTANCES}; need to split request\n"
        )
        sys.exit(1)
    available = sorted(int(k) for k in stat.keys())
    feasible = []
    for p in available:
        points = (args.duration // p + 1) * max(1, args.instance_count)
        if points <= MAX_DATA_POINTS:
            feasible.append((p, points))
    if not feasible:
        sys.stderr.write(
            f"no feasible period for duration={args.duration}s × instance_count={args.instance_count}; "
            f"available periods={available}; please shorten the time range or split instances\n"
        )
        sys.exit(2)
    feasible_periods_for_pref = [p for p, _ in feasible]
    warnings: list[str] = []
    if args.preferred is not None and args.preferred not in feasible_periods_for_pref:
        # preferred 不可行时不能静默——LLM 以为生效了，绘图粒度对不上
        warnings.append(
            f"[preferred_infeasible] --preferred={args.preferred}s is not in "
            f"feasible periods {feasible_periods_for_pref}; falling back to default "
            f"comfortable-range selection"
        )
    if args.preferred and args.preferred in feasible_periods_for_pref:
        chosen = args.preferred
        chosen_reason = "user-preferred"
    else:
        # 舒适粒度: 优先选数据点 ∈ [30, 200] 的；否则选最接近 100 点的
        comfortable = [(p, pts) for p, pts in feasible if 30 <= pts <= 200]
        if comfortable:
            # 落在区间内时偏好"点数稍多"（更细的粒度），但不要过密
            comfortable.sort(key=lambda x: -x[1])
            chosen = comfortable[0][0]
            chosen_reason = "comfortable range [30,200] points"
        else:
            # 不在区间内 → 选最接近 100 点的
            scored = sorted(feasible, key=lambda x: abs(x[1] - 100))
            chosen = scored[0][0]
            chosen_reason = (
                f"closest-to-100 fallback (no period yields 30-200 points; "
                f"chosen has {scored[0][1]} points)"
            )
    points = (args.duration // chosen + 1) * max(1, args.instance_count)
    stat_type = stat[str(chosen)]
    out = {
        "period": chosen,
        "stat_type": stat_type,
        "estimated_data_points": points,
        "reason": chosen_reason,
        "feasible_periods": [{"period": p, "points": pts} for p, pts in feasible],
        "duration_seconds": args.duration,
        "instance_count": args.instance_count,
        "warnings": warnings,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


# -------- build_request --------


_TIME_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$")


def _validate_time(label: str, ts: str) -> str:
    if not _TIME_PATTERN.match(ts):
        sys.stderr.write(
            f"--{label} format invalid: {ts!r}; need ISO8601 with timezone "
            f"(e.g. 2024-01-01T10:00:00+08:00)\n"
        )
        sys.exit(1)
    return ts


def cmd_build_request(args):
    namespace = args.namespace.strip()
    if "/" not in namespace:
        sys.stderr.write(f"--namespace looks invalid (expect QCE/XXX): {namespace!r}\n")
        sys.exit(1)
    # GetMonitorData 接受大写 Namespace
    if namespace != namespace.upper():
        sys.stderr.write(
            f"[WARN] --namespace {namespace!r} is not uppercase; "
            f"GetMonitorData expects QCE/XXX (uppercase). Auto-uppercasing.\n"
        )
        namespace = namespace.upper()
    metric = args.metric.strip()
    if not metric:
        sys.stderr.write("--metric is empty\n")
        sys.exit(1)

    # 模式 A: --from-candidate 直接接受 instance_resolver.gen_dimensions 输出的
    #         api_query.candidates[i] 元素 / api_query.instances[i].primary
    if args.from_candidate:
        try:
            cand = json.loads(args.from_candidate)
        except json.JSONDecodeError as e:
            sys.stderr.write(f"--from-candidate is not valid JSON: {e}\n")
            sys.exit(1)
        # 候选格式: {"name_keys":[...], "Dimensions":[{Name,Value},...], ...}
        # 也允许 {"Dimensions":[...]}（兼容裸 Dimensions 数组）
        dims = cand.get("Dimensions") if isinstance(cand, dict) else None
        if not isinstance(dims, list) or not dims:
            sys.stderr.write(
                "--from-candidate must contain non-empty 'Dimensions' array "
                "(format: [{\"Name\":..,\"Value\":..}, ...])\n"
            )
            sys.exit(1)
        # 直接当作单实例的 Dimensions
        instances_out = [{"Dimensions": [
            {"Name": d["Name"], "Value": str(d["Value"])} for d in dims
        ]}]
        dim_keys = [d["Name"] for d in dims]
    else:
        # 模式 B: 传统 --dimension-keys + --instances
        if not args.dimension_keys:
            sys.stderr.write("either --from-candidate or --dimension-keys is required\n")
            sys.exit(1)
        if not args.instances:
            sys.stderr.write("--instances is required when not using --from-candidate\n")
            sys.exit(1)
        dim_keys = [k.strip() for k in args.dimension_keys.split(",") if k.strip()]
        if not dim_keys:
            sys.stderr.write("--dimension-keys is empty\n")
            sys.exit(1)
        # instances 解析: JSON 或 CSV
        raw_instances = args.instances.strip()
        instances_input: list
        if raw_instances.startswith("["):
            try:
                instances_input = json.loads(raw_instances)
            except json.JSONDecodeError as e:
                sys.stderr.write(f"--instances is not valid JSON: {e}\n")
                sys.exit(1)
        else:
            # CSV: ins-aaa,ins-bbb (only when single dimension key)
            if len(dim_keys) != 1:
                sys.stderr.write(
                    f"CSV form of --instances only supported when --dimension-keys has exactly 1 key; "
                    f"got {len(dim_keys)} keys; use JSON form instead\n"
                )
                sys.exit(1)
            ids = [s.strip() for s in raw_instances.split(",") if s.strip()]
            instances_input = [{dim_keys[0]: i} for i in ids]
        if len(instances_input) > MAX_INSTANCES:
            sys.stderr.write(
                f"instances count {len(instances_input)} > {MAX_INSTANCES}; need to split request\n"
            )
            sys.exit(1)
        # 把 dict 形式 [{InstanceId: ins-xxx}] 转换为 GetMonitorData 要求的
        # Instances 数组 [{Dimensions:[{Name:..,Value:..}]}]
        instances_out = []
        for idx, inst in enumerate(instances_input):
            if not isinstance(inst, dict):
                sys.stderr.write(f"instances[{idx}] must be object; got {type(inst).__name__}\n")
                sys.exit(1)
            dims = []
            for k in dim_keys:
                if k not in inst:
                    sys.stderr.write(
                        f"instances[{idx}] missing dimension key {k!r}; "
                        f"have keys: {list(inst.keys())}\n"
                    )
                    sys.exit(1)
                dims.append({"Name": k, "Value": str(inst[k])})
            instances_out.append({"Dimensions": dims})

    start = _validate_time("start-time", args.start_time)
    end = _validate_time("end-time", args.end_time)
    payload = {
        "Namespace": namespace,
        "MetricName": metric,
        "Period": args.period,
        "StartTime": start,
        "EndTime": end,
        "Instances": instances_out,
    }
    if args.specify_statistics:
        payload["SpecifyStatistics"] = args.specify_statistics
    out_path: Path
    if args.out:
        out_path = Path(args.out)
    else:
        # 跨平台临时目录: Unix → /tmp, Windows → %TEMP%
        tmp_dir = Path(tempfile.gettempdir())
        tmp_dir.mkdir(parents=True, exist_ok=True)
        # 简单文件名: 命名空间 + 指标 + pid
        safe_ns = namespace.replace("/", "_").lower()
        out_path = tmp_dir / f"getmonitordata_{safe_ns}_{metric}_{os.getpid()}.json"
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "request_file": str(out_path),
        "namespace": namespace,
        "metric": metric,
        "instance_count": len(instances_out),
        "period": args.period,
        "start_time": start,
        "end_time": end,
        "next_step_command": (
            f"tccli monitor GetMonitorData --cli-input-json file://{out_path} "
            f"--region <ap-xxx>"
        ),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


# -------- execute_query --------


def cmd_execute_query(args):
    """执行 GetMonitorData + 解析响应（兼容 'Response' 外层包装与裸响应）+ 输出标准化摘要。

    输入：build_request 生成的 JSON 文件 + region。
    输出：每个实例 1 行摘要（min/avg/max/last/count）。
    """
    req_path = Path(args.request_file)
    if not req_path.exists():
        sys.stderr.write(f"request file not found: {req_path}\n")
        sys.exit(1)
    cmd = [
        "tccli", "monitor", "GetMonitorData",
        "--cli-input-json", f"file://{req_path}",
        "--region", args.region,
    ]
    try:
        r = _sp.run(cmd, capture_output=True, text=True, timeout=60)
    except _sp.TimeoutExpired:
        sys.stderr.write("tccli GetMonitorData timed out\n")
        sys.exit(3)
    if r.returncode != 0:
        sys.stderr.write(f"tccli failed: {r.stderr.strip() or r.stdout.strip()}\n")
        sys.exit(3)
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"tccli output not JSON: {e}\n")
        sys.exit(3)
    # 兼容两种结构：{"Response": {...}} vs 直接 {Period, MetricName, ...}
    resp = d.get("Response", d)
    if "Error" in resp:
        sys.stderr.write(f"API error: {resp['Error']}\n")
        sys.exit(3)
    metric = resp.get("MetricName")
    period = resp.get("Period")
    start = resp.get("StartTime")
    end = resp.get("EndTime")
    summaries = []
    for dp in resp.get("DataPoints", []) or []:
        dims = dp.get("Dimensions", []) or []
        dim_str = ", ".join(f"{x['Name']}={x['Value']}" for x in dims)
        vals = dp.get("Values") or []
        timestamps = dp.get("Timestamps") or []
        if vals:
            summaries.append({
                "dimensions": dim_str,
                "n": len(vals),
                "min": round(min(vals), 4),
                "avg": round(statistics.mean(vals), 4),
                "max": round(max(vals), 4),
                "last": round(vals[-1], 4),
                "first_ts": timestamps[0] if timestamps else None,
                "last_ts": timestamps[-1] if timestamps else None,
            })
        else:
            summaries.append({
                "dimensions": dim_str,
                "n": 0,
                "note": "NO DATA (实例可能在指定时间窗内未上报，或 region/维度值不正确)",
            })
    out = {
        "metric": metric,
        "period": period,
        "start_time": start,
        "end_time": end,
        "instance_count": len(summaries),
        "summaries": summaries,
        "next_action": "auto_continue",
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


# -------- argparse --------


def main():
    p = argparse.ArgumentParser(prog="monitor_query.py", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    # find_strategy 已迁移到 instance_resolver.py
    # 模型应使用 `instance_resolver.py find_strategy <query> --intent ...`

    p2 = sub.add_parser("list_metrics", help="strategy_type → 该产品下的指标列表")
    p2.add_argument("strategy_type")
    p2.add_argument("--scope", choices=["dash", "namespace", "both"], default="both",
                    help="范围: dash=只看 dash_id 主集; namespace/both=主集 + 同 namespace "
                         "其他 dash_id 扩展集（默认 both，兼顾覆盖度）")
    p2.add_argument("--external-only", action="store_true",
                    help="只返回 is_external=1 的对外指标（默认包含全部）")
    p2.add_argument("--full", action="store_true", help="返回原始全字段而不是摘要")
    p2.set_defaults(func=cmd_list_metrics)

    p3 = sub.add_parser("match_metric", help="在 strategy_type 下模糊匹配指标")
    p3.add_argument("strategy_type")
    p3.add_argument("query", help="用户对指标的中文/英文描述（如 'CPU 利用率' / 'cpu_usage'）")
    p3.add_argument("--limit", type=int, default=8)
    p3.add_argument("--scope", choices=["dash", "namespace", "both"], default="both",
                    help="范围: dash=只在 dash_id 主集匹配; namespace/both=主集 0 命中时"
                         "回退到同 namespace 其他 dash_id（默认 both）")
    p3.add_argument("--external-only", action="store_true",
                    help="只在 is_external=1 的对外指标里匹配（默认包含全部）")
    p3.set_defaults(func=cmd_match_metric)

    p4 = sub.add_parser("pick_period",
                        help="根据时间范围+实例数+候选 Period 推算合适的统计粒度")
    p4.add_argument("--duration", type=int, required=True, help="时间范围（秒）")
    p4.add_argument("--instance-count", type=int, required=True)
    p4.add_argument("--stat-types", required=True,
                    help='JSON: {"60":"avg","300":"max"}（来自 metric.seconds_stat_type）')
    p4.add_argument("--preferred", type=int, default=None, help="用户偏好的 Period 秒数")
    p4.set_defaults(func=cmd_pick_period)

    p5 = sub.add_parser("build_request", help="生成 GetMonitorData 的 cli-input-json 文件")
    p5.add_argument("--namespace", required=True, help="如 QCE/CVM")
    p5.add_argument("--metric", required=True, help="如 CpuUsage")
    p5.add_argument("--from-candidate", default=None,
                    help="(推荐) 直接喂 instance_resolver.gen_dimensions 输出的 "
                         "scenes.api_query.instances[i].primary 或 candidates[j] 的 JSON 字符串"
                         "（含 Dimensions:[{Name,Value}] 字段）。")
    p5.add_argument("--dimension-keys", default=None,
                    help="(传统模式) 维度 key 列表，逗号分隔。如 InstanceId 或 InstanceId,InstanceType。"
                         "与 --from-candidate 二选一。")
    p5.add_argument("--instances", default=None,
                    help='(传统模式) 实例列表，两种格式：(1) JSON 数组 [{"InstanceId":"ins-xxx"}, ...]；'
                         '(2) 当 dimension-keys 只有 1 个时，可以用 CSV: ins-aaa,ins-bbb。'
                         '与 --from-candidate 二选一。')
    p5.add_argument("--period", type=int, required=True, help="秒")
    p5.add_argument("--start-time", required=True, help="ISO8601 含时区，如 2024-01-01T10:00:00+08:00")
    p5.add_argument("--end-time", required=True)
    p5.add_argument("--specify-statistics", type=int, default=None,
                    help="可选；avg/max/min 组合: 1=avg, 2=max, 4=min（位掩码）")
    p5.add_argument("--out", default=None, help="输出文件路径，默认系统临时目录下 getmonitordata_*.json（Unix /tmp、Windows %TEMP%）")
    p5.set_defaults(func=cmd_build_request)

    p6 = sub.add_parser("execute_query",
                        help="执行 GetMonitorData + 解析响应 + 输出标准化摘要")
    p6.add_argument("--request-file", required=True, help="build_request 生成的 JSON 文件路径")
    p6.add_argument("--region", required=True, help="如 ap-guangzhou")
    p6.set_defaults(func=cmd_execute_query)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
