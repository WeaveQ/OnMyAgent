#!/usr/bin/env python3
"""
instance_resolver.py — tcop-api 的"strategy_type 枢轴"模块

封装 strategy_type 相关的所有公共能力：产品识别、配置加载、实例发现、维度生成。
被 monitor_query.py（GetMonitorData 工作流）以及未来的 alarm/tmp 等模块复用。

子命令:
  find_strategy <用户产品描述> [--intent list_instances|gen_dimensions|describe]
      模糊匹配 strategy_type 候选，含 L1/L2/L3 路由：
        L1 (1 命中)             → next_action: auto_continue
        L2 (多命中但 root_api 同) → 按意图：list_instances → auto_continue
                                        gen_dimensions/describe → ask_user
        L3 (多命中且 root_api 异) → next_action: ask_user

  load_config <strategy_type> [--region <r>]
      实时调 DescribeAllNamespaces 拿 Config，解析后输出关键字段子集。
      同进程内会缓存（避免重复调用）。

  list_instances <strategy_type> --region <r> [--limit N] [--max-pages M]
      按 instanceLoader 配置：调实例 API + 分页 + 树形递归 + fieldsMapping 字段提取。
      返回标准化的实例列表，含原始字段 + 映射后字段（供后续 gen_dimensions 用）。

  gen_dimensions <strategy_type> --region <r> (--instance-ids <ids> | --instances <json>)
      给定一组实例（用户已知 ID 列表 / list_instances 输出 / 用户指定），按场景输出维度：
        scenes.alarm_policy   告警策略 API（CreateAlarmPolicy 等）的 Dimensions
        scenes.id_key         实例唯一标识（含 Region）
        scenes.api_query      GetMonitorData 维度——候选清单（按可信度排序）
                              每个实例输出 primary + candidates 数组，
                              consumer 按 rank 顺序试，遇 InvalidParameterValue
                              时换下一个候选。

      两种入参模式（互斥）:
        --instance-ids "id1,id2"    简化模式：脚本自动从 Config 推断 lookup
                                    keys 并合成 mapped。覆盖单维度产品（CVM/CDB/
                                    MongoDB 等）"用户已给 ID"高频场景。多维度
                                    产品（Redis Proxy 等）会输出 [multi_dim_warn]。
        --instances <JSON>          完整模式：接 list_instances.instances 输出。
                                    多维度产品必须用此模式。

设计原则：
  - 配置驱动：所有产品差异由 DescribeAllNamespaces.Config 描述，脚本不硬编码任何产品
  - 调用通道：使用腾讯云 Python SDK 的 CommonClient（不走 tccli），版本号从
              instanceLoader.reqParams.Version 自动提取，能调任何后端接受的
              (service, version, action) 组合，包括控制台内部 API
              （如 mongodb:DescribeDBInstanceSummaries）
  - 模板引擎降级：复杂模板（三元、typeof）标记为 [template_warn]，不阻塞流程
  - 父链合并：树形产品按"根→叶"合并字段，子层覆盖父层同名字段
  - 退出码：0 成功 / 1 参数错 / 2 数据未命中 / 3 SDK/凭证/网络异常

Exit codes:
  0  成功
  1  参数错误
  2  数据未命中（如 strategy_type 不存在）
  3  外部 API 调用失败 / 数据文件缺失或损坏 / 凭证或 SDK 异常
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# ---- 腾讯云 Python SDK（运行时兜底） ----

try:
    from tencentcloud.common import credential as _tc_credential
    from tencentcloud.common.common_client import CommonClient
    from tencentcloud.common.exception.tencent_cloud_sdk_exception import (
        TencentCloudSDKException,
    )
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
except ImportError:
    sys.stderr.write(
        "[FATAL] tencentcloud-sdk-python not installed. Run: "
        "pip3 install tencentcloud-sdk-python\n"
    )
    sys.exit(3)

# ---- 数据文件定位 ----

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


# ============================================================
# Region 工具：short ↔ long 互转
# ============================================================

# AvailableRegions 用 short 形式（"gz"），tccli 用 long 形式（"ap-guangzhou"）
SHORT_TO_LONG = {
    "bj": "ap-beijing", "sh": "ap-shanghai", "gz": "ap-guangzhou",
    "cd": "ap-chengdu", "cq": "ap-chongqing", "nj": "ap-nanjing",
    "hk": "ap-hongkong", "tpe": "ap-taipei",
    "sg": "ap-singapore", "jkt": "ap-jakarta", "th": "ap-bangkok",
    "tsn": "ap-tianjin",
    "kr": "ap-seoul", "jp": "ap-tokyo", "osa": "ap-osaka",
    "in": "ap-mumbai",
    "use": "na-ashburn", "usw": "na-siliconvalley", "tor": "na-toronto",
    "de": "eu-frankfurt", "ru": "eu-moscow",
    "sao": "sa-saopaulo",
}
LONG_TO_SHORT = {v: k for k, v in SHORT_TO_LONG.items()}


def short_region(r: str) -> str:
    """ap-guangzhou → gz；gz → gz"""
    return LONG_TO_SHORT.get(r, r)


def long_region(r: str) -> str:
    """gz → ap-guangzhou；ap-guangzhou → ap-guangzhou"""
    return SHORT_TO_LONG.get(r, r)


# ============================================================
# 模板引擎（受限子集）
# ============================================================

# 支持：
#   ${obj.foo}, ${foo}                   → 直接字段取值
#   ${parent.data.foo}, ${parent.X.foo}  → 父链取值
#   ${[lit, "arr"]}                       → JSON 字面量数组
#   <%= obj.foo %>, <%= foo.bar %>        → 嵌套路径
#   <%= obj.X != 1 %>                     → 简单比较（!=, ==, ===, !==, <, >）
#
# 降级（不报错，标记 [template_warn]）：
#   ${typeof X !== 'undefined' ? Y : Z}   → 三元
#   ${complex JS}                          → 任何复杂表达式
#   <%- ... %>                              → unescape 风格
#   <%= 三元 / 或 / 算术 %>                  → 复杂

DOLLAR_PAT = re.compile(r'\$\{([^}]+)\}')
EJS_PAT = re.compile(r'<%[=\-]\s*([^%]+?)\s*%>')

_SIMPLE_PATH = re.compile(r'^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$')
_LIT_ARRAY = re.compile(r'^\[.*\]$', re.DOTALL)
_SIMPLE_CMP = re.compile(
    r'^([A-Za-z_$][\w.$]*)\s*(===|!==|==|!=|<=|>=|<|>)\s*'
    r"('[^']*'|\"[^\"]*\"|-?\d+(?:\.\d+)?|true|false|null)\s*$"
)


def _lookup_path(obj: Any, path: str) -> Any:
    """按点号路径取值。obj 可以是 dict 或 list（path 含数字索引）。
    取不到返回 _MISSING_ 哨兵。"""
    cur = obj
    for seg in path.split("."):
        if isinstance(cur, dict):
            if seg not in cur:
                return _MISSING
            cur = cur[seg]
        elif isinstance(cur, list):
            try:
                cur = cur[int(seg)]
            except (ValueError, IndexError):
                return _MISSING
        else:
            return _MISSING
    return cur


_MISSING = object()


def _eval_simple_expr(expr: str, ctx: dict) -> tuple[Any, bool]:
    """评估单个简单表达式。返回 (value, ok)。

    ctx 包含：obj (当前实例字段), parent (父链 list, 由近到远) 等。
    """
    expr = expr.strip()

    # 字面量数组
    if _LIT_ARRAY.match(expr):
        try:
            # JSON 数组
            return json.loads(expr), True
        except json.JSONDecodeError:
            return None, False

    # 字符串字面量
    if (expr.startswith("'") and expr.endswith("'")) or \
       (expr.startswith('"') and expr.endswith('"')):
        return expr[1:-1], True

    # 数字 / 布尔
    if expr in ("true", "false", "null"):
        return {"true": True, "false": False, "null": None}[expr], True
    try:
        if "." in expr:
            return float(expr), True
        return int(expr), True
    except ValueError:
        pass

    # 简单比较
    cmp_m = _SIMPLE_CMP.match(expr)
    if cmp_m:
        lhs_path, op, rhs_raw = cmp_m.groups()
        lhs, ok_l = _eval_path_in_ctx(lhs_path, ctx)
        if not ok_l:
            return None, False
        rhs, ok_r = _eval_simple_expr(rhs_raw, ctx)
        if not ok_r:
            return None, False
        try:
            if op in ("==", "==="):
                return lhs == rhs, True
            if op in ("!=", "!=="):
                return lhs != rhs, True
            if op == "<":
                return lhs < rhs, True
            if op == ">":
                return lhs > rhs, True
            if op == "<=":
                return lhs <= rhs, True
            if op == ">=":
                return lhs >= rhs, True
        except TypeError:
            return None, False

    # 简单路径
    if _SIMPLE_PATH.match(expr):
        return _eval_path_in_ctx(expr, ctx)

    # 不支持的复杂表达式
    return None, False


def _eval_path_in_ctx(path: str, ctx: dict) -> tuple[Any, bool]:
    """按路径在 ctx 中找值。obj.X / parent.data.X / X 三种风格。
    失败时返回 (None, False)。"""
    if path.startswith("obj."):
        v = _lookup_path(ctx.get("obj") or {}, path[4:])
    elif path.startswith("parent."):
        # parent.data.X / parent.X (历史变体)
        rest = path[7:]
        # parents 是 list[dict] 由近到远
        parents = ctx.get("parents") or []
        if not parents:
            return None, False
        # 兼容 parent.data.X 和 parent.X 两种写法
        if rest.startswith("data."):
            v = _lookup_path(parents[0], rest[5:])
        else:
            v = _lookup_path(parents[0], rest)
    else:
        # 裸路径：先查 obj.X，再查 ctx 顶层（如 ctx 里有 instanceName 等附加变量）
        v = _lookup_path(ctx.get("obj") or {}, path)
        if v is _MISSING:
            v = _lookup_path(ctx, path)
    if v is _MISSING:
        return None, False
    return v, True


def render_template(s: Any, ctx: dict, warns: list | None = None) -> Any:
    """对字符串中的 ${} / <%= %> 占位符做替换。

    - 整串就是单个占位符且求值是非字符串 → 返回原类型（数组、布尔、数字等）
    - 部分替换 → 转成字符串拼接
    - 复杂表达式失败 → 标记 warn，返回原占位符字符串（让上游决定丢弃 or 保留）
    """
    if not isinstance(s, str):
        return s
    if warns is None:
        warns = []

    # 整串是单个 ${...}
    full_dollar = re.fullmatch(r'\$\{([^}]+)\}', s.strip())
    if full_dollar:
        v, ok = _eval_simple_expr(full_dollar.group(1), ctx)
        if ok:
            return v
        warns.append(f"[template_warn] cannot evaluate: {s}")
        return None

    # 整串是单个 <%= ... %>
    full_ejs = re.fullmatch(r'<%[=\-]\s*(.+?)\s*%>', s.strip(), re.DOTALL)
    if full_ejs:
        v, ok = _eval_simple_expr(full_ejs.group(1), ctx)
        if ok:
            return v
        warns.append(f"[template_warn] cannot evaluate: {s}")
        return None

    # 混合模板：按 token 替换为字符串
    def _sub_dollar(m):
        v, ok = _eval_simple_expr(m.group(1), ctx)
        if ok:
            return "" if v is None else str(v)
        warns.append(f"[template_warn] cannot evaluate: {m.group(0)}")
        return ""

    def _sub_ejs(m):
        v, ok = _eval_simple_expr(m.group(1), ctx)
        if ok:
            return "" if v is None else str(v)
        warns.append(f"[template_warn] cannot evaluate: {m.group(0)}")
        return ""

    out = DOLLAR_PAT.sub(_sub_dollar, s)
    out = EJS_PAT.sub(_sub_ejs, out)
    return out


# ============================================================
# 腾讯云 Python SDK 调用封装
# ============================================================

# DescribeAllNamespaces 归属云监控旧版告警 API（v2018-07-24）。
# 实例 API 的 version 由 instanceLoader.reqParams.Version 给出（见 _load_config）。
_MONITOR_VERSION = "2018-07-24"
_DEFAULT_REGION = "ap-guangzhou"  # 公开 API 网关默认入口；--region 仍由 caller 传

_credential_cache: Any = None  # 进程内缓存凭证


def _get_credential() -> Any:
    """读取凭证。优先级：~/.tccli/default.credential（OAuth）> 环境变量。

    与 tccli 共享同一份凭证文件，避免用户重复登录。
    """
    global _credential_cache
    if _credential_cache is not None:
        return _credential_cache
    tccli_path = os.path.expanduser("~/.tccli/default.credential")
    if os.path.isfile(tccli_path):
        try:
            with open(tccli_path, encoding="utf-8") as f:
                cred_data = json.load(f)
            sid = cred_data.get("secretId", "")
            skey = cred_data.get("secretKey", "")
            token = cred_data.get("token", "")
            if sid and skey:
                _credential_cache = _tc_credential.Credential(
                    sid, skey, token=token if token else None
                )
                return _credential_cache
        except (OSError, json.JSONDecodeError):
            pass
    sid = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    skey = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")
    token = os.environ.get("TENCENTCLOUD_SECURITY_TOKEN", "")
    if sid and skey:
        _credential_cache = _tc_credential.Credential(
            sid, skey, token=token if token else None
        )
        return _credential_cache
    sys.stderr.write(
        "[FATAL] no credential found. Run `tccli auth login` or set "
        "TENCENTCLOUD_SECRET_ID/TENCENTCLOUD_SECRET_KEY env vars.\n"
    )
    sys.exit(3)


# 客户端按 (service, version, region) 缓存，同一进程多次调用复用
_client_cache: dict[tuple[str, str, str], CommonClient] = {}


def _get_client(service: str, version: str, region: str) -> CommonClient:
    key = (service, version, region)
    if key in _client_cache:
        return _client_cache[key]
    cred = _get_credential()
    hp = HttpProfile()
    hp.endpoint = f"{service}.tencentcloudapi.com"
    hp.reqMethod = "POST"
    hp.reqTimeout = 30
    cp = ClientProfile(httpProfile=hp, signMethod="TC3-HMAC-SHA256", language="zh-CN")
    client = CommonClient(service, version, cred, region, profile=cp)
    _client_cache[key] = client
    return client


def _call_api(service: str, version: str, action: str, params: dict,
              region: str | None = None) -> dict:
    """调用任意腾讯云 API（基于 CommonClient）。

    替代旧 _tccli。优势：
      - 不依赖 tccli SDK Action 白名单（控制台内部 API 名也能调，前提是后端网关接受）
      - 不再有 "Unknown options: --XXX" 之类 CLI 层校验问题
      - dict 入参直接打包 JSON，腾讯云后端忽略未知字段
      - 错误以 TencentCloudSDKException 抛出，含 code + message + requestId

    返回：tccli 同款的 'Response 内层' dict（已剥外层）。
    """
    region = region or _DEFAULT_REGION
    client = _get_client(service, version, region)
    try:
        resp = client.call_json(action, params)
    except TencentCloudSDKException as e:
        raise RuntimeError(
            f"sdk call failed: service={service} action={action} "
            f"code={e.code} message={e.message} requestId={e.requestId}"
        ) from e
    if isinstance(resp, str):
        resp = json.loads(resp)
    if isinstance(resp, dict) and "Response" in resp:
        return resp["Response"]
    return resp


# ============================================================
# load_config — 实时拉 DescribeAllNamespaces
# ============================================================

_CONFIG_CACHE: dict[str, dict] = {}


def _load_config(strategy_type: str) -> dict:
    """同进程内缓存。返回解析后的 Config dict + 几个 namespace 元字段。"""
    if strategy_type in _CONFIG_CACHE:
        return _CONFIG_CACHE[strategy_type]
    resp = _call_api(
        service="monitor",
        version=_MONITOR_VERSION,
        action="DescribeAllNamespaces",
        params={
            "SceneType": "ST_ALARM",
            "Module": "monitor",
            "MonitorTypes": ["MT_QCE"],
            "Ids": [strategy_type],
        },
        region=_DEFAULT_REGION,
    )
    items = resp.get("QceNamespacesNew") or []
    if not items:
        raise RuntimeError(f"DescribeAllNamespaces returns no item for {strategy_type}")
    item = items[0]
    cfg_raw = item.get("Config")
    if not cfg_raw:
        raise RuntimeError(f"DescribeAllNamespaces returns empty Config for {strategy_type}")
    try:
        cfg = json.loads(cfg_raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Config JSON parse failed for {strategy_type}: {e}")
    bundle = {
        "strategy_type": strategy_type,
        "namespace": item.get("Value"),  # 形如 QCE/CDB
        "dashboard_id": item.get("DashboardId"),
        "available_regions_short": item.get("AvailableRegions") or [],
        "config": cfg,
    }
    _CONFIG_CACHE[strategy_type] = bundle
    return bundle


# ============================================================
# 模糊匹配工具（与 monitor_query.py 共享思路，但规则微调）
# ============================================================

def _norm(s: Any) -> str:
    if s is None:
        return ""
    return str(s).strip().lower()


def _score_match(query: str, fields: list[tuple[str, int]]) -> int:
    q = _norm(query)
    if not q:
        return 0
    q_tokens = [t for t in re.split(r'[\s,/_\-]+', q) if t]
    best = 0
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
        if score > best:
            best = score
    return best


# ============================================================
# 子命令: find_strategy
# ============================================================


def cmd_find_strategy(args):
    rows = _load_jsonl("alarm_strategy.jsonl")
    candidates = []
    for r in rows:
        score = _score_match(args.query, [
            (r.get("strategy_type"), 12),
            (r.get("strategy_show_name_zh"), 8),
            (r.get("strategy_show_name_en"), 6),
            (r.get("cloud_product_show_name_zh"), 10),
            (r.get("cloud_product_show_name_en"), 6),
            (r.get("cloud_product_id"), 5),
            (r.get("console_menu_zh"), 4),
        ])
        if score > 0:
            candidates.append((score, r))
    candidates.sort(key=lambda x: -x[0])
    top = candidates[: args.limit]
    if not top:
        sys.stderr.write(f"no strategy_type matched: {args.query!r}\n")
        sys.exit(2)

    out_candidates = [{
        "strategy_type": r["strategy_type"],
        "score": s,
        "cloud_product_id": r.get("cloud_product_id"),
        "strategy_show_name_zh": r.get("strategy_show_name_zh"),
        "cloud_product_show_name_zh": r.get("cloud_product_show_name_zh"),
        "instance_binding_type": r.get("instance_binding_type"),
        "cloud_apis": r.get("cloud_apis"),
        "console_menu_zh": r.get("console_menu_zh"),
    } for s, r in top]

    # L1/L2/L3 路由
    if len(out_candidates) == 1:
        next_action = "auto_continue"
        reason = "single hit"
    else:
        # 取所有 score 等于最高分的为"高分组"
        top_score = out_candidates[0]["score"]
        high = [c for c in out_candidates if c["score"] == top_score]
        if len(high) == 1:
            next_action = "auto_continue"
            reason = "single highest-score hit"
        else:
            # 检查 root_api 是否全同（取第一段 cloud_apis 的第一项）。
            # 空串视为"无法验证"——cloud_apis 缺失时不能假设候选指向同一底层 API。
            root_apis = set()
            has_missing = False
            for c in high:
                ca = c.get("cloud_apis") or ""
                root = ca.split(",")[0].split("@")[0].strip()
                if not root:
                    has_missing = True
                else:
                    root_apis.add(root)
            if has_missing or len(root_apis) != 1:
                # L3: root_api 不一致 / 至少一个候选 cloud_apis 缺失
                next_action = "ask_user_l3"
                reason = (
                    f"L3: {len(high)} candidates "
                    + ("with missing cloud_apis (cannot verify consistency)"
                       if has_missing else
                       f"with different root_apis={sorted(root_apis)}")
                )
            else:
                # L2: root_api 全同且非空
                if args.intent == "list_instances":
                    next_action = "auto_continue"
                    reason = (f"L2: {len(high)} candidates with same root_api={list(root_apis)[0]}, "
                              f"safe to auto-continue for instance listing")
                else:
                    next_action = "ask_user_l2"
                    reason = (f"L2: {len(high)} candidates with same root_api but "
                              f"intent={args.intent} requires disambiguation")

    print(json.dumps({
        "candidates": out_candidates,
        "next_action": next_action,
        "reason": reason,
        "intent": args.intent,
    }, ensure_ascii=False, indent=2))


# ============================================================
# 子命令: load_config
# ============================================================


def cmd_load_config(args):
    try:
        b = _load_config(args.strategy_type)
    except RuntimeError as e:
        sys.stderr.write(f"{e}\n")
        sys.exit(3)
    cfg = b["config"]
    il = cfg.get("instanceLoader") or {}
    out = {
        "strategy_type": b["strategy_type"],
        "namespace": b["namespace"],
        "dashboard_id": b["dashboard_id"],
        "available_regions_short": b["available_regions_short"],
        "available_regions_long": [long_region(r) for r in b["available_regions_short"]],
        "instance_loader_summary": {
            "service_type": il.get("serviceType"),
            "cmd": il.get("cmd"),
            "req_params_keys": list((il.get("reqParams") or {}).keys()),
            "list_path": (il.get("resFields") or {}).get("list"),
            "total_path": (il.get("resFields") or {}).get("total"),
            "field_mapping_keys": list((il.get("fieldsMapping") or {}).keys()),
            "has_children": bool(il.get("children")),
        },
        "alarms_dimensions": (cfg.get("alarms") or [{}])[0].get("dimensions"),
        "event_dimensions": (cfg.get("alarms") or [{}])[0].get("eventDimensions"),
        "id_key": cfg.get("idKey"),
        "metrics_dimensions_sample": [(m.get("metricName"), m.get("dimensions"))
                                       for m in (cfg.get("metrics") or [])[:3]],
        "next_action": "auto_continue",
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


# ============================================================
# 子命令: list_instances（含分页 + 树形递归）
# ============================================================


def _apply_field_mapping(api_obj: dict, mapping: dict, parents: list[dict],
                         warns: list) -> dict:
    """对一条原始 API 响应对象应用 fieldsMapping。

    mapping 形如：
      {
        "uInstanceId": "<%= obj.InstanceId %>",
        "alarm_disabled": "<%= obj.Status != 1 %>",
        "projectId": "ProjectId",  # 直接字段名
      }
    """
    out = {}
    ctx = {"obj": api_obj, "parents": parents}
    for target_key, expr in mapping.items():
        if not isinstance(expr, str):
            out[target_key] = expr
            continue
        # 是模板？
        if "${" in expr or "<%" in expr:
            v = render_template(expr, ctx, warns)
            out[target_key] = v
        else:
            # 视为直接字段名
            v = _lookup_path(api_obj, expr)
            out[target_key] = v if v is not _MISSING else None
    return out


def _resolve_req_params(req_params_template: dict, page_obj: dict,
                        parents: list[dict], warns: list) -> tuple[dict, str | None]:
    """渲染 reqParams 模板，过滤 None / 空值（这些是"用户未指定"的可选参数）。
    特别地：Version 字段单独抽出返回（不当 API 入参，而是当 client 配置）。

    返回: (api_params_without_version, version_or_None)
    """
    out = {}
    version: str | None = None
    ctx = {"obj": page_obj, "parents": parents}
    for k, v in (req_params_template or {}).items():
        if k == "Version":
            # Version 字段：直接拿值（通常是字面量字符串如 "2017-03-12"），不参与模板渲染
            if isinstance(v, str) and "$" not in v and "<%" not in v:
                version = v
            else:
                # 极少见：Version 是模板，渲染后再用
                rendered = render_template(v, ctx, warns)
                if isinstance(rendered, str) and rendered:
                    version = rendered
            continue
        rendered = render_template(v, ctx, warns)
        # 取不到值 → 不传该参数（可选参数语义）
        if rendered is None or rendered == "":
            continue
        out[k] = rendered
    return out, version


def _lookup_with_response_fallback(d: dict, path: str) -> Any:
    """按路径取值，自动处理 'data.Response.X' / 'Response.X' / 'data.X' 等
    控制台前端假设的多层包装。tccli 实际响应通常是裸的（无 Response 外层）。

    尝试顺序：
      1. 原始路径
      2. 剥离 "data." 前缀
      3. 剥离 "Response." 前缀
      4. 剥离 "data.Response." 前缀
    """
    candidates = [path]
    if path.startswith("data.Response."):
        candidates.append(path[len("data.Response."):])
    if path.startswith("Response."):
        candidates.append(path[len("Response."):])
    if path.startswith("data."):
        candidates.append(path[len("data."):])
    for p in candidates:
        v = _lookup_path(d, p)
        if v is not _MISSING:
            return v
    return _MISSING


def _fetch_one_layer(loader: dict, parents: list[dict], region_short: str,
                     limit_per_page: int, max_pages: int, warns: list) -> list[dict]:
    """拉某层的所有实例（含分页）。如有 children，递归填充到每个实例的 _children 字段。

    单层返回：
      [{
         "_raw": <原始 API 字段>,
         "_mapped": <fieldsMapping 后字段>,
         "_children": [<子层实例>, ...]  (如有 children)
      }, ...]
    """
    instances: list[dict] = []

    # getter 模式（layer 不调 API，从父层提取数组）
    getter = loader.get("getter")
    if getter and not loader.get("cmd"):
        ctx = {"parents": parents}
        arr = render_template(getter, ctx, warns)
        if not isinstance(arr, list):
            warns.append(f"[getter_warn] getter did not yield list: {getter} → {type(arr).__name__}")
            return []
        for raw in arr:
            mapped = _apply_field_mapping(raw, loader.get("fieldsMapping") or {},
                                          parents, warns)
            instances.append({"_raw": raw, "_mapped": mapped, "_children": []})
        # getter 模式不递归 children（按 fetch_instances.py 经验，getter 是叶子）
        return instances

    # cmd 模式
    cmd = loader.get("cmd")
    service_type = loader.get("serviceType")
    req_params_t = loader.get("reqParams") or {}
    res_fields = loader.get("resFields") or {}
    list_path = res_fields.get("list")
    total_path = res_fields.get("total")
    fm = loader.get("fieldsMapping") or {}

    if not cmd or not service_type:
        warns.append("[loader_warn] missing cmd/serviceType, skip layer")
        return instances

    # 分页：检查 reqParams 是否使用 ${obj.offset}
    has_offset_template = any(
        isinstance(v, str) and "${obj.offset}" in v
        for v in req_params_t.values()
    )

    offset = 0
    pages = 0
    long_region_str = long_region(region_short)
    while True:
        page_obj = {"offset": offset, "limit": limit_per_page, "projectId": None}
        params, version = _resolve_req_params(req_params_t, page_obj, parents, warns)
        if not version:
            warns.append(
                f"[version_missing] reqParams.Version not present for {service_type}:{cmd}; "
                f"cannot determine API version, skipping layer"
            )
            break
        # 调腾讯云 SDK
        try:
            d = _call_api(
                service=service_type,
                version=version,
                action=cmd,
                params=params,
                region=long_region_str,
            )
        except RuntimeError as e:
            warns.append(f"[sdk_error] {service_type} {cmd} v{version}: {e}")
            break
        # 取 list（自动尝试 data.Response 前缀剥离；此时 d 已经是 Response 内层）
        list_arr = _lookup_with_response_fallback(d, list_path) if list_path else d
        if list_arr is _MISSING or list_arr is None:
            list_arr = []
        if not isinstance(list_arr, list):
            warns.append(f"[res_field_warn] list_path={list_path} did not yield array")
            list_arr = []
        # 取 total
        total = None
        if total_path:
            t = _lookup_with_response_fallback(d, total_path)
            if isinstance(t, int):
                total = t
        # 累加
        for raw in list_arr:
            mapped = _apply_field_mapping(raw, fm, parents, warns)
            inst = {"_raw": raw, "_mapped": mapped, "_children": []}
            instances.append(inst)
        pages += 1
        # 终止条件
        if not has_offset_template:
            break  # 非分页 API
        if total is None:
            # 无 total 字段 → 用本页元素数判断
            if len(list_arr) < limit_per_page:
                break
        else:
            if len(instances) >= total:
                break
        if pages >= max_pages:
            warns.append(f"[pagination_warn] max_pages={max_pages} reached, "
                         f"loaded {len(instances)} of {total}")
            break
        offset += limit_per_page

    # 递归 children
    children_loader = loader.get("children")
    if children_loader:
        for inst in instances:
            child_parents = [inst["_raw"]] + parents
            child_instances = _fetch_one_layer(
                children_loader, child_parents, region_short,
                limit_per_page, max_pages, warns)
            inst["_children"] = child_instances

    return instances


def cmd_list_instances(args):
    try:
        bundle = _load_config(args.strategy_type)
    except RuntimeError as e:
        sys.stderr.write(f"{e}\n")
        sys.exit(3)
    cfg = bundle["config"]
    il = cfg.get("instanceLoader") or {}
    if not il:
        sys.stderr.write(f"strategy_type {args.strategy_type!r} has no instanceLoader\n")
        sys.exit(2)
    region_short = short_region(args.region)
    if region_short not in bundle["available_regions_short"]:
        sys.stderr.write(
            f"[WARN] region {args.region} (short={region_short}) "
            f"not in available_regions={bundle['available_regions_short']}\n"
        )
    warns: list = []
    instances = _fetch_one_layer(
        il, parents=[], region_short=region_short,
        limit_per_page=args.limit, max_pages=args.max_pages, warns=warns,
    )
    # 把树形展平到一个层级（可选 leaves only）
    out_instances = _flatten_for_output(instances)
    # next_action 决策：sdk_error / version_missing 必须停下；
    # 0 实例区分"列表 API 调用失败" vs "确实无实例"
    fatal_warns = [w for w in warns
                   if w.startswith("[sdk_error]") or w.startswith("[version_missing]")]
    if fatal_warns:
        next_action = "error_stop"
        reason = f"upstream API error,don't auto-continue: {fatal_warns[0]}"
    elif len(out_instances) == 0:
        next_action = "no_instances_found"
        reason = (f"strategy_type={args.strategy_type} returned 0 instances in "
                  f"region={long_region(region_short)}; check region or product activation")
    elif len(out_instances) > 1:
        next_action = "ask_user_select_instances"
        reason = f"{len(out_instances)} instances found,let user select"
    else:
        next_action = "auto_continue"
        reason = "single instance,safe to continue"
    print(json.dumps({
        "strategy_type": args.strategy_type,
        "namespace": bundle["namespace"],
        "region": long_region(region_short),
        "instance_count": len(out_instances),
        "instances": out_instances,
        "warnings": warns,
        "next_action": next_action,
        "reason": reason,
    }, ensure_ascii=False, indent=2))


def _flatten_for_output(tree: list[dict]) -> list[dict]:
    """把 fetch 出来的树形实例展平：每个叶子节点包含完整父链 mapped 字段合并。
    无 children 时即等价于 _raw + _mapped。
    """
    out: list[dict] = []

    def walk(nodes: list[dict], parents: list[dict]):
        for n in nodes:
            children = n.get("_children") or []
            if not children:
                # 叶子节点
                merged_mapped: dict = {}
                # 父链合并：根 → ... → 叶（叶子覆盖父）
                for p in reversed(parents):
                    merged_mapped.update(p.get("_mapped") or {})
                merged_mapped.update(n.get("_mapped") or {})
                out.append({
                    "raw": n.get("_raw"),
                    "mapped": merged_mapped,
                    "depth": len(parents) + 1,
                })
            else:
                walk(children, parents + [n])

    walk(tree, [])
    return out


# ============================================================
# 子命令: gen_dimensions
# ============================================================


def _normalize_dim_keys(dim_def: Any) -> list[str]:
    """alarms[0].dimensions / metrics[].dimensions 可能是:
      list:  ['unInstanceId']
      dict:  {'instance_id': 'instanceId', 'topicid': 'topicId', ...}
    统一返回外层 key list（dict 时取 keys）。"""
    if isinstance(dim_def, list):
        return [k for k in dim_def if isinstance(k, str)]
    if isinstance(dim_def, dict):
        return [k for k in dim_def.keys() if isinstance(k, str)]
    return []


def _is_unset(v: Any) -> bool:
    """字段值"取不到"判定。None / 不存在 → True；"" / 0 / False → False（保留原值）。"""
    return v is None


def _pascal_case(s: str) -> str:
    """把 Barad 内部命名转 GetMonitorData 接受的 PascalCase API name 启发式：

      unInstanceId → InstanceId   （去掉 'un' 前缀）
      uInstanceId  → InstanceId   （去掉 'u' 前缀，且后续是大写开头）
      instanceid   → Instanceid   （首字母大写；不再拆驼峰）
      Appid        → Appid        （已 PascalCase 不动）
      target       → Target       （首字母大写）

    实测腾讯云监控大小写敏感，CVM/CDB 接受 InstanceId。这是启发式，
    不保证 100% 命中——所以只作为 candidates 列表里的中低优先项。

    适用范围：仅 'un' + 大写字母（CVM 风格）/ 'u' + 大写字母（CDB 风格）两类
    已知模式。其他形态（如 'userId' = 'u' + 小写）不会触发剥离，安全。
    """
    if not s:
        return s
    # 'un' 前缀（CVM 风格 unInstanceId）
    if len(s) > 2 and s[:2] == "un" and s[2].isupper():
        return s[2:]
    # 'u' 前缀（CDB 风格 uInstanceId）
    if len(s) > 1 and s[0] == "u" and s[1].isupper():
        return s[1:]
    # 首字母大写
    return s[0].upper() + s[1:]


def _take_value(mapped: dict, raw: Any, *keys: str) -> Any:
    """按 keys 顺序从 mapped 取，取不到再从 raw 取（raw 是 dict 时）。
    返回 None 表示真的取不到。"""
    for k in keys:
        if not k:
            continue
        v = mapped.get(k) if isinstance(mapped, dict) else None
        if not _is_unset(v):
            return v
    if isinstance(raw, dict):
        for k in keys:
            v = raw.get(k)
            if not _is_unset(v):
                return v
    return None


def _build_api_query_candidates(cfg: dict, mapped: dict, raw: Any) -> list[dict]:
    """生成 GetMonitorData 接受的 Dimensions 候选清单（按可信度排序）。

    背景：腾讯云监控 API 的维度命名分散在 4 套字段里，没有单一权威源：
      - alarm2dashboardMapping: {alarm_key: api_name}  ← 最权威（如 MongoDB cluster→target）
      - alarms[0].eventDimensions (dict): {api_name: alarm_key}  ← 高（CDB 用）
      - metrics[0].dimensions: [api_name]  ← 中（MongoDB 直接给 target；CVM/CDB 给 Barad 内部名）
      - alarms[0].dimensions: [alarm_key] + PascalCase 化  ← 低（启发式）

    每个候选格式：
      {
        "rank": int,                     # 优先级（小=高）
        "source": str,                   # 来源说明
        "Dimensions": [{Name, Value}],  # GetMonitorData --Instances[].Dimensions 格式
        "name_keys": [str],              # 仅 Name 列表（用于 build_request --dimension-keys）
      }
    """
    alarms = (cfg.get("alarms") or [{}])[0]
    alarm_dim_def = alarms.get("dimensions")           # list 或 dict
    event_dim_def = alarms.get("eventDimensions")      # dict（CDB）/ list（MongoDB）/ None
    a2d = cfg.get("alarm2dashboardMapping")            # {alarm_key: api_name}
    metrics = cfg.get("metrics") or []
    metric_dim_def = metrics[0].get("dimensions") if metrics else None

    alarm_keys = _normalize_dim_keys(alarm_dim_def)
    metric_keys = _normalize_dim_keys(metric_dim_def)

    candidates: list[dict] = []
    seen_signatures: set[tuple] = set()  # 去重（同 Name 集 + 同 Value 集 算重复）

    def _emit(rank: int, source: str, name_to_alarm_key: list[tuple[str, str]]):
        """name_to_alarm_key: [(api_name, mapped_lookup_key), ...]"""
        dims = []
        names = []
        for api_name, lookup_key in name_to_alarm_key:
            v = _take_value(mapped, raw, lookup_key, api_name)
            if _is_unset(v):
                return  # 缺值则放弃这个候选
            dims.append({"Name": api_name, "Value": str(v)})
            names.append(api_name)
        sig = tuple((d["Name"], d["Value"]) for d in dims)
        if sig in seen_signatures:
            return
        seen_signatures.add(sig)
        candidates.append({
            "rank": rank,
            "source": source,
            "Dimensions": dims,
            "name_keys": names,
        })

    # 优先级 1: alarm2dashboardMapping （告警→监控映射，最权威）
    if isinstance(a2d, dict) and a2d:
        # a2d = {alarm_key: api_name}，名空间是 dashboard 维度
        pairs = [(api_name, alarm_key) for alarm_key, api_name in a2d.items()]
        _emit(1, "alarm2dashboardMapping", pairs)

    # 优先级 2: eventDimensions dict 形式（CDB 的 {InstanceId: uInstanceId}）
    if isinstance(event_dim_def, dict) and event_dim_def:
        pairs = [(api_name, alarm_key) for api_name, alarm_key in event_dim_def.items()]
        _emit(2, "eventDimensions(dict).keys", pairs)

    # 优先级 3: alarms[0].dimensions PascalCase 化（CVM/CDB 启发式命中）
    # 故意排在 metrics 之前：腾讯云 GetMonitorData 实测 CVM/CDB 接受 PascalCase
    # 而不是 Barad 内部的 unInstanceId/uInstanceId（metrics[0].dimensions 给的）。
    if alarm_keys:
        pairs = [(_pascal_case(k), k) for k in alarm_keys]
        if any(p != l for p, l in pairs):  # PascalCase 化产生了新名字才加
            _emit(3, "alarms[0].dimensions+pascal_case", pairs)

    # 优先级 4: metrics[0].dimensions 直接当 Name（MongoDB 该字段=target 是对的；
    # CVM/CDB 该字段=Barad 内部名通常错——所以排在 PascalCase 之后）
    if metric_keys:
        pairs = [(k, k) for k in metric_keys]
        _emit(4, "metrics[0].dimensions", pairs)

    # 优先级 5: alarms[0].dimensions 原样当 Name（兜底）
    if alarm_keys:
        pairs = [(k, k) for k in alarm_keys]
        _emit(5, "alarms[0].dimensions(raw)", pairs)

    return candidates


def cmd_gen_dimensions(args):
    try:
        bundle = _load_config(args.strategy_type)
    except RuntimeError as e:
        sys.stderr.write(f"{e}\n")
        sys.exit(3)
    cfg = bundle["config"]
    namespace = bundle["namespace"]
    region_long = args.region

    alarms_dim_def = (cfg.get("alarms") or [{}])[0].get("dimensions")
    event_dim_def = (cfg.get("alarms") or [{}])[0].get("eventDimensions")
    a2d = cfg.get("alarm2dashboardMapping")
    id_key = cfg.get("idKey") or []
    metrics = cfg.get("metrics") or []
    metric_dim_def = metrics[0].get("dimensions") if metrics else None
    alarm_keys = _normalize_dim_keys(alarms_dim_def)
    metric_keys = _normalize_dim_keys(metric_dim_def)

    synth_warnings: list[str] = []  # --instance-ids 模式下的合成相关警告

    # 入参解析：两种模式（--instance-ids 简化 / --instances 完整）
    if args.instance_ids and args.instances:
        sys.stderr.write("--instance-ids 与 --instances 互斥，二选一\n")
        sys.exit(1)
    if not args.instance_ids and not args.instances:
        sys.stderr.write("--instance-ids 或 --instances 必须传一个\n")
        sys.exit(1)

    if args.instance_ids:
        # 简化模式：用户只给 instance ID 列表，脚本自动从 config 推断 lookup keys
        # 集合并合成 mapped。覆盖单维度产品（CVM/CDB/MongoDB 等）的高频场景。
        ids = [s.strip() for s in args.instance_ids.split(",") if s.strip()]
        if not ids:
            sys.stderr.write("--instance-ids is empty after split\n")
            sys.exit(1)

        # 收集"所有可能的 lookup key 名"——任何 _build_api_query_candidates 里
        # _take_value 会查的 key 都塞 instance_id 进去
        lookup_keys: set[str] = set()
        lookup_keys.update(alarm_keys)                  # alarms[0].dimensions
        lookup_keys.update(metric_keys)                 # metrics[0].dimensions
        lookup_keys.update(id_key)                      # config.idKey
        if isinstance(a2d, dict):
            lookup_keys.update(a2d.keys())              # alarm side
            lookup_keys.update(a2d.values())            # api side
        if isinstance(event_dim_def, dict):
            lookup_keys.update(event_dim_def.keys())    # api side
            lookup_keys.update(event_dim_def.values())  # alarm side
        elif isinstance(event_dim_def, list):
            lookup_keys.update(event_dim_def)
        # PascalCase 化的目标 key（让 rank=3 候选也能从 mapped 取到值）
        for k in list(alarm_keys):
            lookup_keys.add(_pascal_case(k))

        # 多维度产品检测：同时有 ≥2 个 distinct alarm 维度（如 Redis Proxy
        # 的 appid+pnodeid+instanceid）→ 单 ID 无法填全多维度的不同字段，警告
        distinct_alarm = [k for k in alarm_keys if k]
        if len(distinct_alarm) >= 2:
            synth_warnings.append(
                f"[multi_dim_warn] strategy_type={args.strategy_type} 是多维度产品 "
                f"(alarm dimensions={distinct_alarm})。--instance-ids 模式只能把同一个 ID "
                f"填到所有维度上，仅适用于'实例 ID'就是唯一区分键的产品。"
                f"如果出现 InvalidParameterValue 或返回空数据，改用 list_instances "
                f"+ --instances 完整 mapped 走 fieldsMapping 渲染流程。"
            )

        # 也提示 LLM：lookup_keys 是怎么推断出来的（可观测）
        synth_warnings.append(
            f"[synthesized_mapped] --instance-ids 模式合成了 mapped 字段：每个 ID 填到 "
            f"{sorted(lookup_keys)} 共 {len(lookup_keys)} 个 lookup keys 上。"
        )

        instances_in = []
        for iid in ids:
            synthetic_mapped = {k: iid for k in lookup_keys}
            synthetic_raw = {"InstanceId": iid}  # 通用兜底字段名
            instances_in.append({"raw": synthetic_raw, "mapped": synthetic_mapped})
    else:
        # 完整模式：用户提供 list_instances 输出（或自己构造）的 mapped 字段
        try:
            instances_in = json.loads(args.instances)
        except json.JSONDecodeError as e:
            sys.stderr.write(f"--instances JSON parse error: {e}\n")
            sys.exit(1)
        if not isinstance(instances_in, list):
            sys.stderr.write("--instances must be JSON array\n")
            sys.exit(1)

    # 三个场景的输出
    alarm_policy_dims: list[dict] = []   # scene: 告警策略 API
    id_key_dims: list[dict] = []         # scene: 实例唯一标识
    api_query_per_instance: list[dict] = []  # scene: GetMonitorData 候选清单

    for inst in instances_in:
        mapped = inst.get("mapped") if isinstance(inst, dict) and "mapped" in inst else inst
        raw = inst.get("raw") if isinstance(inst, dict) and "raw" in inst else inst
        if not isinstance(mapped, dict):
            sys.stderr.write(f"instance entry not dict: {inst}\n")
            sys.exit(1)

        # scene 1: alarm_policy（告警策略维度，值透传不强转）
        ad = {}
        for k in alarm_keys:
            v = _take_value(mapped, raw, k)
            ad[k] = "" if _is_unset(v) else v
        alarm_policy_dims.append(ad)

        # scene 2: id_key（含 Region，值 String() 强转）
        # 注：region_long 来自 --region 参数，是该 scene 的权威来源；
        # 即使 cfg.idKey 配置异常包含 "Region"，或 mapped 在 --instance-ids
        # 简化模式下被合成成 instance_id，都不能让它覆盖预填的 region_long。
        ikd = {"Region": region_long}
        for k in id_key:
            if k == "Region":
                continue  # 防御：保留 region_long，不被 mapped/raw 覆盖
            v = _take_value(mapped, raw, k)
            ikd[k] = "" if _is_unset(v) else str(v)
        id_key_dims.append(ikd)

        # scene 3: api_query（候选清单）
        cands = _build_api_query_candidates(cfg, mapped, raw)
        api_query_per_instance.append({
            "primary": cands[0] if cands else None,
            "candidates": cands,
        })

    # 选 next_action：所有实例都至少有 1 个候选 → auto_continue；否则给出明确恢复指引
    has_candidates = all(x["primary"] is not None for x in api_query_per_instance)
    api_warnings: list[str] = list(synth_warnings)  # 合并 --instance-ids 模式的合成警告
    api_next_action = (
        "try_primary_first_then_other_candidates_on_InvalidParameterValue"
        if has_candidates else "no_candidates_use_instance_ids_or_list_instances"
    )
    if not has_candidates:
        # 区分两种空候选场景，给针对性恢复指引
        is_multi_dim = len(alarm_keys) >= 2
        used_synth = bool(args.instance_ids)
        if is_multi_dim and used_synth:
            api_warnings.append(
                f"[no_api_candidates] strategy_type={args.strategy_type} 是多维度产品 "
                f"(alarm dimensions={alarm_keys})，--instance-ids 模式无法填全多维度。"
                f"请改用: instance_resolver list_instances --region <r> 拿完整 mapped，"
                f"再用 --instances JSON 模式调 gen_dimensions。"
            )
        elif used_synth:
            api_warnings.append(
                "[no_api_candidates] --instance-ids 合成 mapped 后仍无候选。可能 Config 里 "
                "alarm2dashboardMapping / eventDimensions / metrics[0].dimensions / "
                "alarms[0].dimensions 都为空。检查 config_dim_fields 字段。"
            )
        else:
            # 完整模式（用户自己传 --instances）但 mapped 字段名错了 / 不全
            api_warnings.append(
                "[no_api_candidates] --instances 模式提供的 mapped 字段中没有任何 lookup key "
                "命中。常见原因: 手工构造 mapped 时 key 名错了（比如 MongoDB 的 alarm key 是 "
                "'cluster' 不是 'instanceId'）。建议改用 --instance-ids 简化模式自动合成，"
                "或先 list_instances 拿到 fieldsMapping 渲染过的标准 mapped。"
                "config_dim_fields 字段给出了真实的 key 名供参考。"
            )

    out = {
        "strategy_type": args.strategy_type,
        "namespace": namespace,
        "region": region_long,
        "instance_count": len(instances_in),
        "scenes": {
            "alarm_policy": {
                "usage": "CreateAlarmPolicy / DescribeAlarmPolicies 等告警 API 的 Dimensions 字段",
                "schema_keys": alarm_keys,
                "source": "alarms[0].dimensions",
                "dimensions": alarm_policy_dims,
            },
            "id_key": {
                "usage": "实例唯一标识比对（含 Region）",
                "schema_keys": ["Region"] + list(id_key),
                "source": "config.idKey + region",
                "dimensions": id_key_dims,
            },
            "api_query": {
                "usage": "GetMonitorData --Instances[].Dimensions",
                "candidate_sources": [
                    "1. alarm2dashboardMapping (highest, MongoDB-style)",
                    "2. eventDimensions(dict).keys (CDB-style)",
                    "3. alarms[0].dimensions + PascalCase heuristic (CVM/CDB-style)",
                    "4. metrics[0].dimensions (MongoDB direct hit; CVM/CDB Barad-internal)",
                    "5. alarms[0].dimensions (raw, fallback)",
                ],
                "instances": api_query_per_instance,
                "next_action": api_next_action,
            },
        },
        # 用于辅助调试 / 让模型理解 schema
        "config_dim_fields": {
            "alarms[0].dimensions": alarms_dim_def,
            "alarms[0].eventDimensions": event_dim_def,
            "alarm2dashboardMapping": a2d,
            "metrics[0].dimensions": metric_dim_def,
            "idKey": id_key,
        },
        "warnings": api_warnings,
        "next_action": "auto_continue",
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


# ============================================================
# argparse
# ============================================================


def main():
    p = argparse.ArgumentParser(
        prog="instance_resolver.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("find_strategy", help="模糊匹配产品 → strategy_type 候选 + L 路由")
    p1.add_argument("query")
    p1.add_argument("--limit", type=int, default=10)
    p1.add_argument("--intent", choices=["list_instances", "gen_dimensions",
                                          "describe", "match_metrics"],
                    default="describe",
                    help="调用方意图，影响 L2 路由（list_instances 多命中同 root_api 时免反问）")
    p1.set_defaults(func=cmd_find_strategy)

    p2 = sub.add_parser("load_config", help="实时拉 DescribeAllNamespaces，输出关键摘要")
    p2.add_argument("strategy_type")
    p2.set_defaults(func=cmd_load_config)

    p3 = sub.add_parser("list_instances",
                        help="按 instanceLoader 配置列实例（含分页+树形递归+字段映射）")
    p3.add_argument("strategy_type")
    p3.add_argument("--region", required=True, help="long form e.g. ap-guangzhou")
    p3.add_argument("--limit", type=int, default=50,
                    help="单页 limit（也是单请求实例上限），默认 50")
    p3.add_argument("--max-pages", type=int, default=10,
                    help="单层最大分页数，默认 10（即最多拉 limit*max_pages 个实例）")
    p3.set_defaults(func=cmd_list_instances)

    p4 = sub.add_parser("gen_dimensions",
                        help="按场景生成维度（scenes.alarm_policy / scenes.id_key / scenes.api_query 候选清单）")
    p4.add_argument("strategy_type")
    p4.add_argument("--region", required=True, help="long form e.g. ap-guangzhou")
    p4.add_argument("--instance-ids", default=None,
                    help="(简化模式，推荐) 实例 ID 列表，逗号分隔（如 'cmgo-aaa,cmgo-bbb'）。"
                         "脚本自动从 Config 推断 lookup keys 并合成 mapped。"
                         "适用于单维度产品（CVM/CDB/MongoDB/Redis 等）的高频场景。"
                         "多维度产品（如 Redis Proxy 需 Appid+pnodeid+instanceid）会输出 "
                         "[multi_dim_warn] 提示改用 --instances 完整模式。")
    p4.add_argument("--instances", default=None,
                    help="(完整模式) JSON 数组：list_instances 的 instances 字段（含 raw + mapped），"
                         "或简化的 mapped 字段数组。多维度产品必须用此模式。"
                         "与 --instance-ids 互斥。")
    p4.set_defaults(func=cmd_gen_dimensions)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
