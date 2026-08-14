#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ruyiPage 通用取证脚本

目标：消除"每个 case 手写 ruyiPage 取证脚本"的重复劳动与 API 踩坑。
任何 ruyiPage 取证都应优先运行本脚本，而不是从示例片段重新拼装。

严格遵循 references/tooling/ruyi-tooling.md 的"ruyiPage 启动硬约束"：
  - 必须显式使用已验证的 ruyiPage 定制 Firefox（禁止系统 Firefox 回退）
  - 有头模式（无 --headless 选项，本身就是硬约束）
  - 独立 case 专用 profile
  - smart_fingerprint + apply_emulation
  - page.capture.start(...) 必须在 page.get(...) 之前执行
  - 导航后自检 navigator.webdriver === false
  - 抓所有包（targets=True），事后从 steps 过滤，避免漏掉 JS 文件

正确 API（基于 ruyipage >=1.2.45 内省确认，151/155 runtime 均适用，含 v1.2.57+）：
  - page.capture.start(targets=True, collect_bodies=True)  # True=抓全部
  - page.capture.wait(timeout=, count=1)  -> 单个 CapturePacket 或 None
  - page.capture.steps                     -> list[CapturePacket]（全部包）
  - CapturePacket.to_dict(include_bodies=True) -> url/method/headers/status/bodies
  - opts.smart_fingerprint(...) -> FingerprintContext；ctx.apply_emulation(page)

Firefox 155+ 兼容（共享脚本补齐，ruyipage 1.2.45~1.2.61 均未处理）：
  - 启动参数补 --remote-allow-system-access：管理员/提权 Windows 会话下
    Firefox 默认拒绝浏览器外的远程调试连接，缺参表现为"启动后连不上 BiDi"；
  - capture 订阅降级：1.2.61 的 capture.start 在 session.subscribe 无条件传
    contexts，privileged scope（Firefox 155+）下不支持，运行时包一层重试兜底。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import inspect
import json
import logging
import os
import re
import subprocess
import sys
import uuid
from typing import Any, Dict, List, Optional, Tuple

def configure_utf8_stdio() -> None:
    """Windows GBK 控制台下输出含 [警告]/[通过] 等非 GBK 字符会抛 UnicodeEncodeError 且退出 1。
    与仓库其他 Python 脚本一致：stdout/stderr 强制 UTF-8，errors=replace 兜底避免任何编码异常
    把整段输出吞掉。必须在 logging.basicConfig 之前调用，保证 handler 捕获到的就是 UTF-8 流。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


configure_utf8_stdio()

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("forensic_ruyipage")


# ============================================================
# 检测：ruyipage 包 + 定制 Firefox
# ============================================================
def detect_ruyipage() -> Tuple[bool, str, str]:
    try:
        import ruyipage  # noqa: F401
        version = getattr(ruyipage, "__version__", "?")
        return True, version, ""
    except Exception as e:  # pragma: no cover
        return False, "", str(e)


def is_ruyi_custom_firefox(path: str) -> bool:
    """判断 Firefox 路径是否来自 ruyiPage 定制 runtime（禁止系统 Firefox 回退）。

    兼容三代命名：151-ruyi（含 ruyi）/ 151-proxy、155-proxy（版本前缀）/
    v1.2.57 语义化 tag + firefox-155.0a1... 定制 asset（新版）。
    install.json 在 runtime 根目录（firefox.exe 的上级或更上），向上多级查找。
    """
    if not path:
        return False
    low = path.lower().replace("\\", "/")
    if "ruyi" in low:
        return True
    cur = os.path.dirname(os.path.abspath(path))
    for _ in range(8):
        marker = os.path.join(cur, "install.json")
        if os.path.isfile(marker):
            try:
                with open(marker, "r", encoding="utf-8") as f:
                    data = json.load(f)
                release = str(data.get("release", "") or data.get("tag", ""))
                asset = str(data.get("asset", ""))
                url = str(data.get("url", ""))
                text = " ".join([release, asset, url, os.path.basename(cur)]).lower()
                if "ruyi" in text:
                    return True
                if re.match(r"^1\d{2,}-", release):
                    return True
                if re.match(r"^v?\d+\.\d+(\.\d+)?$", release) and re.search(r"firefox-\d+\.0a1", asset, re.I):
                    return True
                if "github.com/losenine/ruyipage" in url.lower():
                    return True
            except Exception:
                pass
            return False
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return False


def resolve_browser(args: argparse.Namespace) -> Tuple[str, str]:
    """返回 (browser_path, error)。显式路径优先；否则强制 managed runtime（禁系统回退）。"""
    if args.browser_path:
        p = os.path.abspath(os.path.expanduser(args.browser_path))
        if not os.path.isfile(p):
            return "", f"--browser-path 不存在：{p}"
        if not is_ruyi_custom_firefox(p):
            return "", (
                f"提供的 Firefox 不是 ruyiPage 定制内核（路径/install.json 无 ruyi 标识）：{p}\n"
                "ruyiPage 取证禁止回退系统 Firefox；请提供定制 Firefox 路径，"
                "或先 `python -m ruyipage install`。"
            )
        return p, ""

    try:
        import ruyipage
        resolved = ruyipage.resolve_firefox_path(allow_system=False)
    except Exception as e:
        return "", f"resolve_firefox_path(allow_system=False) 失败：{e}"
    if not resolved:
        # 兜底：扫描工程 tools/ruyipage-browsers/ 下的 managed runtime（与 check_external_tools.js 同一来源），
        # 避免"检测已装好、取证脚本却不认"的不一致。安装模式下 skill 安装目录无 tools/，
        # 按 --project-dir / --case-dir 上级 / cwd 上级逐层查找真实工程目录。
        resolved = _find_managed_runtime(args.project_dir, args.case_dir)
    if not resolved:
        return "", "未能解析到 ruyiPage 定制 Firefox（已禁用系统回退）。请传 --browser-path 或先安装 runtime。"
    if not is_ruyi_custom_firefox(resolved):
        return "", f"解析到的 Firefox 非定制内核：{resolved}"
    return os.path.abspath(resolved), ""


def find_project_root() -> str:
    """向上查找项目根（含 SKILL.md 的目录）；找不到时回退当前工作目录。"""
    cur = os.path.dirname(os.path.abspath(__file__))
    for _ in range(5):
        if os.path.isfile(os.path.join(cur, "SKILL.md")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return os.getcwd()


def _resolve_exe_from_install_json(runtime_dir: str) -> Optional[str]:
    """读 managed runtime 根目录 install.json 的 executable 字段，解析出 Firefox 可执行文件路径。"""
    marker = os.path.join(runtime_dir, "install.json")
    if not os.path.isfile(marker):
        return None
    try:
        with open(marker, "r", encoding="utf-8") as f:
            data = json.load(f)
        exe_rel = str(data.get("executable") or "")
        if not exe_rel:
            return None
        p = os.path.abspath(os.path.join(runtime_dir, exe_rel))
        return p if os.path.isfile(p) else None
    except Exception:
        return None


def _tools_browsers_candidates_under(start: str, levels: int = 5) -> List[str]:
    """从 start 起（含自身）向上 levels 层，收集每层 <dir>/tools/ruyipage-browsers（去重）。
    多 case 项目布局 <project-root>/<case-name>/ 与 <project-root>/tools/ 平级，逐层向上查找。"""
    out: List[str] = []
    cur = os.path.abspath(start or os.getcwd())
    for _ in range(levels + 1):
        d = os.path.join(cur, "tools", "ruyipage-browsers")
        if d not in out:
            out.append(d)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return out


def _managed_runtime_candidates(project_dir: str = "", case_dir: str = "") -> List[str]:
    """managed runtime 候选目录列表，与 check_external_tools.js getDefaultRuyiBrowsersDirs 对齐：
    显式 --project-dir/tools → --case-dir 及其上级/tools → RUYIPAGE_BROWSERS_PATH →
    cwd 及其上级/tools → find_project_root()/tools → 平台缓存目录。"""
    candidates: List[str] = []
    for base in (project_dir, case_dir):
        if base:
            candidates.extend(_tools_browsers_candidates_under(base))
    env = os.environ.get("RUYIPAGE_BROWSERS_PATH", "")
    if env:
        candidates.append(os.path.abspath(os.path.expanduser(env)))
    candidates.extend(_tools_browsers_candidates_under(os.getcwd()))
    candidates.append(os.path.join(find_project_root(), "tools", "ruyipage-browsers"))
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
        candidates.append(os.path.join(base, "ruyipage", "browsers"))
    elif sys.platform == "darwin":
        candidates.append(os.path.join(os.path.expanduser("~"), "Library", "Caches", "ruyipage", "browsers"))
    else:
        base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
        candidates.append(os.path.join(base, "ruyipage", "browsers"))
    seen: set = set()
    return [d for d in candidates if not (d in seen or seen.add(d))]


def _find_managed_runtime(project_dir: str = "", case_dir: str = "") -> Optional[str]:
    """扫描候选 tools/ruyipage-browsers/ 下的 managed runtime，返回 Firefox 主版本号最高的定制内核路径。

    安装模式下 skill 安装目录无 tools/（gitignore 不随分发），find_project_root() 定位到的是
    skill 根而非用户工程；因此必须扫描 --project-dir / --case-dir 上级 / cwd 上级等真实工程目录。
    """
    for tools_dir in _managed_runtime_candidates(project_dir, case_dir):
        if not os.path.isdir(tools_dir):
            continue
        candidates = []
        for entry in os.listdir(tools_dir):
            d = os.path.join(tools_dir, entry)
            if not os.path.isdir(d):
                continue
            exe = _resolve_exe_from_install_json(d)
            if exe and is_ruyi_custom_firefox(exe):
                candidates.append((entry, exe))
        if not candidates:
            continue

        def rank(item) -> int:
            m = re.search(r"firefox[-_]?(\d+)(?:\.\d+)*", item[0], re.I)
            return int(m.group(1)) if m else 0
        return max(candidates, key=rank)[1]
    return None


# ============================================================
# 指纹
# ============================================================
def _parse_proxy(value: str, auth: str) -> Dict[str, Any]:
    """解析 --proxy host:port 与 --proxy-auth user:pass，返回 smart_fingerprint 的 proxy 关键字参数。

    国内站点默认直连（不传 --proxy）；仅当目标站需要固定出口 IP / 国家匹配时使用。
    代理账号密码只透传给 smart_fingerprint 写进 fpfile，不写入业务脚本或最终交付物。
    """
    kwargs: Dict[str, Any] = {}
    if not value:
        return kwargs
    host, _, port = value.rpartition(":")
    if not host or not port.isdigit():
        raise ValueError(f"--proxy 格式应为 host:port（如 1.2.3.4:8080），实际：{value}")
    kwargs["proxy_host"] = host
    kwargs["proxy_port"] = int(port)
    if auth:
        user, _, pwd = auth.partition(":")
        kwargs["proxy_user"] = user
        kwargs["proxy_pwd"] = pwd
    return kwargs


def apply_smart_fingerprint(opts, args: argparse.Namespace):
    """返回 FingerprintContext 或 None（--no-fp 时）。地理探测失败且无 manual_geo 时抛错。"""
    if args.no_fp:
        logger.info("已禁用 smart_fingerprint（--no-fp）。")
        return None

    kwargs: Dict[str, Any] = {
        "userdir": args.profile_dir,
        "base_dir": args.fp_dir,
        # 默认禁用国家强校验：1.2.6x 起 smart_fingerprint 默认 require_country="US"，
        # 代理/出口 IP 与 US 不一致（如 JP）会抛 CountryMismatchError，阻断取证。
        # 用户显式 --require-country 时用用户值；否则 None = 不校验出口国家。
        "require_country": args.require_country or None,
    }
    if args.manual_geo:
        kwargs["manual_geo"] = load_manual_geo(args.manual_geo)
    if args.proxy:
        kwargs.update(_parse_proxy(args.proxy, args.proxy_auth))

    try:
        return opts.smart_fingerprint(**kwargs)
    except Exception as e:
        msg = str(e)
        if ("geo" in msg.lower() or "country" in msg.lower()) and not args.manual_geo:
            raise RuntimeError(
                "smart_fingerprint 地理探测失败且未提供 manual_geo。\n"
                f"原始错误：{msg}\n"
                "解决：安装 requests（`python -m pip install requests`），"
                "或用 --manual-geo <json或文件路径> 提供地理信息，不要静默跳过智能指纹。"
            )
        raise


def load_manual_geo(value: str) -> Any:
    if os.path.isfile(value):
        with open(value, "r", encoding="utf-8") as f:
            return json.load(f)
    try:
        return json.loads(value)
    except Exception:
        return value


# ============================================================
# JS / target 过滤
# ============================================================
_JS_EXT_RE = re.compile(r"\.js(\?|#|$)", re.IGNORECASE)


def is_js_packet(pkt: Dict[str, Any]) -> bool:
    url = (pkt.get("url") or "").split("?")[0].split("#")[0]
    if _JS_EXT_RE.search(url):
        return True
    ct = (pkt.get("response_headers") or {}).get("content-type", "") or ""
    return "javascript" in ct.lower() or "ecmascript" in ct.lower()


def _match_text(pkt: Dict[str, Any]) -> str:
    # 仅对标识性元数据做匹配：URL / method / 请求头 / 响应头。
    # 不纳入 request_body / response_body —— 一来它们可能是 bytes（json.dumps 会崩），
    # 二来把响应体纳入会导致目标关键词只出现在正文时被误命中。
    parts: List[str] = [
        pkt.get("url", "") or "",
        pkt.get("method", "") or "",
    ]
    for hk in ("request_headers", "response_headers"):
        h = pkt.get(hk) or {}
        if isinstance(h, dict):
            for k, v in h.items():
                parts.append(f"{k}: {v}")
    return "\n".join(str(p) for p in parts)


def match_targets(pkt: Dict[str, Any], substrings: List[str], regexes: List[re.Pattern]) -> bool:
    if not substrings and not regexes:
        return True
    url = pkt.get("url", "") or ""
    text = _match_text(pkt)
    for s in substrings:
        if s and (s in url or s in text):
            return True
    for r in regexes:
        if r.search(url) or r.search(text):
            return True
    return False


def _safe_body(body: Any) -> bytes:
    if body is None:
        return b""
    if isinstance(body, bytes):
        return body
    if isinstance(body, str):
        return body.encode("utf-8", "replace")
    return json.dumps(body, ensure_ascii=False).encode("utf-8", "replace")


def _maybe_decompress(body: bytes, headers: Optional[dict]) -> bytes:
    """按 Content-Encoding / 魔数尝试解压 gzip / br / deflate 响应体；解压失败原样返回。

    背景：ruyipage 的 BiDi collector 对 gzip/br 响应经常拿不到 body，replay fetch 兜底
    拿到的又是已解码文本；但个别版本/场景 body 会以压缩字节原样到达这里，直接 UTF-8 解码
    会得到乱码或空，落盘 JS 不可用。这里对字节做幂等解压，失败不改变原值。
    """
    if not body:
        return body
    headers = headers or {}
    ce = ""
    for k, v in headers.items():
        if str(k).lower() == "content-encoding":
            ce = str(v or "").lower().strip()
            break
    try:
        if "gzip" in ce or body[:2] == b"\x1f\x8b":
            import gzip
            return gzip.decompress(body)
        if "br" in ce:
            try:
                import brotli
            except ImportError:
                return body
            return brotli.decompress(body)
        if "deflate" in ce or (body[:2] == b"\x78\x9c"):
            import zlib
            return zlib.decompress(body)
    except Exception:
        return body
    return body


def _body_to_text(body: bytes, headers: Optional[dict]) -> Tuple[str, bool, int]:
    """body 落盘为可读文本；二进制（octet-stream 或 UTF-8 严格解码失败）落 base64 并标记。

    返回 (text, is_binary, original_len)。is_binary=True 时 text 为 base64 编码，
    调用方应另存原始字节字段；is_binary=False 时 text 为 UTF-8 字符串。
    """
    if not body:
        return "", False, 0
    body = _maybe_decompress(body, headers)
    ct = ((headers or {}).get("content-type", "") or "").lower()
    if "application/octet-stream" in ct:
        return base64.b64encode(body).decode("ascii"), True, len(body)
    try:
        return body.decode("utf-8"), False, len(body)
    except UnicodeDecodeError:
        return base64.b64encode(body).decode("ascii"), True, len(body)


def sanitize_filename(url: str) -> str:
    base = url.split("?")[0].split("#")[0].rstrip("/").split("/")[-1]
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base) or "script"
    if not base.endswith(".js"):
        base += ".js"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{base}.{digest}"


def extract_sourcemap(body_bytes: bytes) -> Optional[str]:
    try:
        text = body_bytes.decode("utf-8", "replace")
    except Exception:
        return None
    m = re.search(r"//#\s*sourceMappingURL=([^\s]+)", text)
    return m.group(1) if m else None


def _eval_js(page, expr: str) -> Tuple[Any, Optional[str]]:
    try:
        r = page.run_js(expr)
    except Exception as e:
        return None, str(e)
    if isinstance(r, bool):
        return r, None
    if hasattr(r, "value"):
        return r.value, None
    if hasattr(r, "success"):
        return bool(r.success), None
    return r, None


def _trigger_actions(page, args: argparse.Namespace, human: str) -> None:
    if args.scroll:
        try:
            amt = int(args.scroll)
            # page.scroll 是 PageScroller 属性（非方法）；向下滚动 amt 像素
            page.scroll.down(amt)
            logger.info("已向下滚动 %s px", amt)
        except Exception as e:
            logger.warning("scroll 失败：%s", e)
    if args.click:
        try:
            ele = page.ele(args.click, timeout=10)
            act = page.actions
            if hasattr(act, "human_click"):
                act.human_click(ele, algorithm=human).perform()
            else:
                act.move_to(ele).click().perform()
            logger.info("已拟人点击 %s", args.click)
        except Exception as e:
            logger.warning("click %s 失败：%s", args.click, e)


# ============================================================
# 主流程
# ============================================================
def build_options(args: argparse.Namespace, browser_path: str):
    from ruyipage import FirefoxOptions

    opts = FirefoxOptions()
    opts.set_browser_path(browser_path)
    opts.set_user_dir(args.profile_dir)
    opts.headless(False)
    w, h = (args.window_size or "1366,900").split(",")[:2]
    opts.set_window_size(int(w), int(h))
    opts.set_human_algorithm(args.human_algorithm)
    # Firefox 155+（v1.2.57+ runtime）在管理员/提权 Windows 会话下，远程调试
    # 连接默认只允许浏览器自身，必须显式放行系统级连接，否则 BiDi 握手表现为
    # "浏览器启动了但连不上"。ruyipage 1.2.45~1.2.61 均未自动附加，由共享脚本补齐。
    try:
        opts.set_argument("--remote-allow-system-access")
    except Exception as e:
        logger.warning("set_argument(--remote-allow-system-access) 失败：%s", e)
    # 进程级兜底：Python 进程退出（含异常/被杀前未走 finally）时自动关闭浏览器并清理临时 profile
    try:
        opts.close_on_exit(True)
    except Exception as e:
        logger.warning("close_on_exit 设置失败（%s），依赖 finally 关闭", e)
    return opts


def _response_content_type(d: Dict[str, Any]) -> str:
    headers = d.get("response_headers") or {}
    for k, v in headers.items():
        if str(k).lower() == "content-type":
            return str(v or "").lower()
    return ""


def _is_entry_document(d: Dict[str, Any], args_url: str) -> bool:
    """识别入口页面 HTML：content-type 为 text/html，或 URL 与目标 URL 一致（覆盖 412/challenge 页）。

    acw_sc__v2 等 challenge cookie 的首次 412 响应是 text/html 内联脚本，必须保存，
    否则后续无法还原 challenge 链。"""
    if _response_content_type(d).startswith("text/html"):
        return True
    url = (d.get("url") or "").split("?")[0].split("#")[0].rstrip("/")
    target = (args_url or "").split("?")[0].split("#")[0].rstrip("/")
    return bool(url and target and url == target)


def _classify_packets(steps, args, substrings, regexes):
    """遍历抓包 steps，分离三类产物。

    - records_meta：每包 to_dict(include_bodies=False)，纯 metadata、零 BiDi RPC，用于 capture.json
    - js_records：识别为 JS 的包，response_body 落盘到 case/js/original/
    - target_hits：命中 --targets/--targets-regex 的包，body 转字符串并按阈值截断

    性能关键：metadata 全部用 include_bodies=False 读取（不触发 RPC）；
    只有 JS 文件 / 目标命中的包才 to_dict(include_bodies=True) 按需拉 body——
    避免对所有包逐包拉 body（每个都是 BiDi get_data RPC，京东几百包会拖到数百秒）。

    返回 (records_meta, js_records, target_hits, js_dir)。
    """
    js_records = []
    target_hits = []
    document = None
    js_dir = os.path.join(args.case_subdir, "js", "original")
    os.makedirs(js_dir, exist_ok=True)
    records_meta = []
    for p in steps:
        d = p.to_dict(include_bodies=False)
        records_meta.append(d)
        is_js = is_js_packet(d)
        is_target = match_targets(d, substrings, regexes)
        is_doc = document is None and _is_entry_document(d, args.url)
        if is_js or is_target or is_doc:
            d = p.to_dict(include_bodies=True)
        if is_js:
            body = _maybe_decompress(_safe_body(d.get("response_body")), d.get("response_headers"))
            fname = sanitize_filename(d.get("url", ""))
            fpath = os.path.join(js_dir, fname)
            if body:
                with open(fpath, "wb") as f:
                    f.write(body)
            js_records.append({
                "url": d.get("url"),
                "status": d.get("response_status"),
                "saved_to": os.path.relpath(fpath, args.out_dir),
                "size": len(body),
                "body_missing": not body,
                "source_mapping_url": extract_sourcemap(body) if body else None,
            })
        if is_target:
            body = _maybe_decompress(_safe_body(d.get("response_body")), d.get("response_headers"))
            total = len(body)
            truncated = total > args.max_body_bytes
            if truncated:
                body = body[: args.max_body_bytes]
            text, is_bin, _ = _body_to_text(body, d.get("response_headers"))
            d["response_body"] = text
            if is_bin:
                d["response_body_binary"] = True
                d["response_body_bytes"] = total
            if truncated:
                d["response_body_truncated"] = True
                d["response_body"] += f"\n...[truncated, total {total} bytes]"
            rb = _safe_body(d.get("request_body"))
            if rb:
                rtext, rbin, rlen = _body_to_text(rb, d.get("request_headers"))
                d["request_body"] = rtext
                if rbin:
                    d["request_body_binary"] = True
                    d["request_body_bytes"] = rlen
            else:
                d["request_body"] = ""
            target_hits.append(d)
        if is_doc:
            body = _maybe_decompress(_safe_body(d.get("response_body")), d.get("response_headers"))
            os.makedirs(args.out_dir, exist_ok=True)
            doc_path = os.path.join(args.out_dir, "document.html")
            if body:
                with open(doc_path, "wb") as f:
                    f.write(body)
            document = {
                "url": d.get("url"),
                "status": d.get("response_status"),
                "saved_to": os.path.relpath(doc_path, args.out_dir),
                "size": len(body),
                "body_missing": not body,
            }
    return records_meta, js_records, target_hits, js_dir, document


def _split_acceptance(target_hits):
    """按验收规则拆分命中包：非 OPTIONS 的 2xx 为 accepted；仅 OPTIONS 预检为 only_options。"""
    accepted = [
        h for h in target_hits
        if (h.get("response_status") or 0) // 100 == 2 and (h.get("method") or "").upper() != "OPTIONS"
    ]
    only_options = [
        h for h in target_hits
        if (h.get("method") or "").upper() == "OPTIONS" and not accepted
    ]
    return accepted, only_options


def _target_reached(steps, substrings, regexes) -> bool:
    """轮询判定：steps 中是否已出现命中 --targets/--targets-regex 的非失败 2xx 响应。"""
    hits = []
    for p in steps:
        try:
            d = p.to_dict(include_bodies=False)
        except Exception:
            continue
        if match_targets(d, substrings, regexes):
            hits.append(d)
    accepted, _ = _split_acceptance(hits)
    return bool(accepted)


def _js_quality(js_records) -> str:
    """JS 落盘质量判定：无 JS → N/A；全过 → PASS；部分缺失 → WARN；缺失比例 ≥50% → FAIL。

    背景：JS 落盘 0B（gzip/br 响应体未拿回）时 capture.json 仍可能正常、目标命中仍 PASS，
    导致"带病 PASS"——这里把 JS 完整性单独暴露为硬信号。
    """
    total = len(js_records)
    if total == 0:
        return "N/A"
    missing = sum(1 for j in js_records if j.get("body_missing"))
    if missing == 0:
        return "PASS"
    if missing / total >= 0.5:
        return "FAIL"
    return "WARN"


def _build_result(args, browser_path, baseline_id, fingerprint, cookies,
                  records_meta, js_records, target_hits, accepted, only_options,
                  webdriver_flag, wd_err, has_filter, document=None):
    """汇总取证结果为报告字典。has_filter 表示是否指定了 --targets/--targets-regex。"""
    return {
        "url": args.url,
        "browserPath": browser_path,
        "profileDir": args.profile_dir,
        "fpDir": args.fp_dir,
        "baselineId": baseline_id,
        "packetCount": len(records_meta),
        "jsFileCount": len(js_records),
        "targetHitCount": len(target_hits),
        "acceptedTargetCount": len(accepted),
        "webdriverTrue": bool(webdriver_flag) if webdriver_flag is not None else None,
        "webdriverCheckError": wd_err,
        "navigatorWebdriverSelfCheck": "FAIL" if webdriver_flag is True else ("PASS" if webdriver_flag is False else "UNKNOWN"),
        "acceptance": "PASS" if (not has_filter) or accepted else ("PARTIAL" if target_hits and not accepted else "NO_TARGET"),
        "jsMissingCount": sum(1 for j in js_records if j.get("body_missing")),
        "jsQuality": _js_quality(js_records),
        "fingerprint": fingerprint,
        "cookies": cookies,
        "jsFiles": js_records,
        "targetHitsSummary": [
            {"url": h.get("url"), "method": h.get("method"), "status": h.get("response_status"), "isFailed": h.get("is_failed")}
            for h in target_hits
        ],
        "onlyOptionsWarning": [h.get("url") for h in only_options],
        "entryDocument": document,
    }


def _write_outputs(args, browser_path, records_meta, target_hits, fingerprint, baseline_id, js_dir):
    """落盘 capture.json / target-hits.json / fingerprint-baseline.json，返回输出路径字典。"""
    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "capture.json"), "w", encoding="utf-8") as f:
        json.dump(records_meta, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out_dir, "target-hits.json"), "w", encoding="utf-8") as f:
        json.dump(target_hits, f, ensure_ascii=False, indent=2)

    notes_dir = os.path.join(args.case_subdir, "notes")
    os.makedirs(notes_dir, exist_ok=True)
    fp_path = None
    if fingerprint is not None:
        fp_path = os.path.join(notes_dir, "fingerprint-baseline.json")
        with open(fp_path, "w", encoding="utf-8") as f:
            json.dump({
                "baselineId": baseline_id,
                "browserPath": browser_path,
                "profileDir": args.profile_dir,
                "fpDir": args.fp_dir,
                "createdAt": _now(),
                "fingerprint": fingerprint,
            }, f, ensure_ascii=False, indent=2)
    return {
        "captureJson": os.path.join(args.out_dir, "capture.json"),
        "targetHitsJson": os.path.join(args.out_dir, "target-hits.json"),
        "jsDir": js_dir,
        "fingerprintBaseline": fp_path,
    }


def _resolve_browser_pid(page) -> Optional[int]:
    """尽力从 ruyipage 页面对象解析浏览器主进程 PID；解析不到返回 None。

    兼容两代对象模型：
    - 新版（>=1.2.5x）：pid 在 page.browser.process.pid（subprocess 对象）
    - 旧版：page / page.browser / page.driver 上的 pid/process_id/browser_pid 属性
    """
    if page is None:
        return None
    # 优先新版 subprocess 对象链：page.browser.process.pid
    try:
        proc = page.browser.process
        if proc is not None and getattr(proc, "pid", None):
            return int(proc.pid)
    except Exception:
        pass
    for holder in (page, getattr(page, "browser", None), getattr(page, "driver", None)):
        if holder is None:
            continue
        for attr in ("pid", "process_id", "browser_pid"):
            v = getattr(holder, attr, None)
            if isinstance(v, int) and v > 0:
                return v
            if isinstance(v, str) and v.isdigit():
                return int(v)
    return None


def _kill_process_tree(pid: int) -> bool:
    """强制结束进程树：Windows 用 taskkill /T /F，其他平台 kill 进程组。"""
    if not pid or pid <= 0:
        return False
    try:
        if os.name == "nt":
            cmd = ["taskkill", "/PID", str(pid), "/T", "/F"]
        else:
            cmd = ["kill", "-TERM", "-%d" % pid]
        ret = subprocess.run(cmd, capture_output=True, timeout=15)
        return ret.returncode == 0
    except Exception as e:
        logger.warning("进程树兜底结束异常：%s", e)
        return False


def _close_browser(page) -> str:
    """主动关闭取证浏览器。

    注意（ruyipage >= 1.2.5x 行为变化）：`page.close()` 只关闭当前标签页，
    不再关闭整个浏览器；关闭浏览器必须用 `page.quit()`。这里优先 quit 整个
    浏览器，quit 不可用或失败时回退 close，再失败做进程树兜底。

    返回状态：none（未启动）/ closed（优雅关闭）/ force-killed（优雅失败后进程树兜底）/
    failed（优雅与兜底均失败，可能残留进程）。
    """
    if page is None:
        return "none"
    # 优先整浏览器关闭：新版 quit(timeout, force)；旧版无 quit 时回退 close
    for method in ("quit", "close"):
        closer = getattr(page, method, None)
        if closer is None:
            continue
        try:
            if method == "quit":
                closer(timeout=8, force=False)
            else:
                closer()
            return "closed"
        except Exception as e:
            logger.warning("page.%s() 失败（%s），尝试下一关闭方式", method, e)
    logger.warning("优雅关闭全部失败，尝试进程树兜底结束")
    pid = _resolve_browser_pid(page)
    if pid is None:
        logger.warning("无法解析浏览器进程 PID，无法兜底结束，浏览器可能残留")
        return "failed"
    if _kill_process_tree(pid):
        logger.info("已强制结束浏览器进程树（PID %s）", pid)
        return "force-killed"
    logger.warning("进程树兜底结束失败（PID %s）", pid)
    return "failed"


def _apply_ruyipage_anti_hang_patch():
    """防挂补丁（依赖 ruyipage 内部实现，失败仅告警不阻断）：
    - CapturePacket._fallback_fetch_body 保留但仅对 JS 包放行：capture.stop() 逐包拉 body 时，
      拿不到 body 的 GET 会逐个在页面内 replay fetch（15s/个），京东等大页面 GET 多会拖到数百秒；
      本脚本收尾已不调 stop()，改为按需 to_dict(include_bodies=True)（仅 JS / 目标命中包拉 body），
      replay 成本有界。JS 是后续定位分析的关键证据，其 gzip/br 响应体 BiDi collector 常拿不到，
      必须保留 replay 兜底，否则 JS 落盘 0B 且取证质量不达标；非 JS 的 GET 跳过 replay，
      避免页面内多余的 fetch replay。
    - Settings.response_body_timeout 恢复到默认 10s：压到 1s 会让大 JS 在 collector 内超时返回空 body。
    """
    try:
        from ruyipage._units import capture as _cap
        orig = _cap.CapturePacket._fallback_fetch_body
        def _js_only_fallback(self):
            if self.method != "GET" or not self.url or not self._owner:
                return None
            if not is_js_packet({"url": self.url, "response_headers": dict(self.response_headers or {})}):
                return None
            return orig(self)
        _cap.CapturePacket._fallback_fetch_body = _js_only_fallback
    except Exception as e:
        logger.warning("防挂补丁 fallback 限流失败：%s", e)
    try:
        from ruyipage._functions import settings as _settings
        _settings.Settings.response_body_timeout = 10
    except Exception as e:
        logger.warning("防挂补丁 response_body_timeout 调整失败：%s", e)


def _apply_ruyipage_capture_compat_patch():
    """Firefox 155+（privileged scope）兼容补丁（依赖 ruyipage 内部实现，失败仅告警不阻断）。

    ruyipage 1.2.61 的 capture.start 在 session.subscribe 时无条件传 contexts，
    而 Firefox 155+ 的 privileged scope 下不支持该参数，subscribe 直接抛错导致
    抓包启动失败（1.2.45 自带降级，1.2.61 回退掉了）。这里给 subscribe 包一层：
    带 contexts 失败时自动降级为全局订阅（不限定 context），事件仍覆盖全部标签页。
    1.2.45 自带同类降级，包装后由本补丁统一处理：仍是一次失败 + 一次全局重试，
    不产生额外 RPC，行为等效。
    """
    try:
        import ruyipage._bidi.session as _sess
        orig = _sess.subscribe
        if getattr(orig, "_ruyipage_privileged_fallback", False):
            return
        # 1.2.45 的 subscribe(driver, events, contexts=None) 没有 user_contexts
        # 参数，1.2.61 新增了它；按签名条件传参，避免低版本 TypeError。
        try:
            _supports_user_contexts = "user_contexts" in inspect.signature(orig).parameters
        except Exception:
            _supports_user_contexts = True

        def subscribe(driver, events, contexts=None, user_contexts=None):
            kwargs = {"contexts": contexts}
            if _supports_user_contexts:
                kwargs["user_contexts"] = user_contexts
            try:
                return orig(driver, events, **kwargs)
            except Exception:
                if not kwargs.get("contexts") and not kwargs.get("user_contexts"):
                    raise
                logger.warning(
                    "session.subscribe 带 contexts/user_contexts 失败，降级为全局订阅重试"
                )
                return orig(driver, events)

        subscribe._ruyipage_privileged_fallback = True
        _sess.subscribe = subscribe
    except Exception as e:
        logger.warning("capture privileged-scope 兼容补丁安装失败：%s", e)


def run_forensic(args: argparse.Namespace, browser_path: str) -> Dict[str, Any]:
    """ruyiPage 取证主流程：启动浏览器 → 抓全部包 → 分类（元数据/JS/目标）→ JS 落盘 → 报告。

    浏览器生命周期：取证结束（成功或异常）一律在 finally 中主动关闭，
    优雅 close 失败时做进程树兜底强制结束，避免残留进程锁住 profile。
    """
    from ruyipage import FirefoxPage
    _apply_ruyipage_anti_hang_patch()
    _apply_ruyipage_capture_compat_patch()

    page = None
    result = None
    try:
        opts = build_options(args, browser_path)
        ctx = apply_smart_fingerprint(opts, args)

        logger.info("启动有头 ruyiPage 定制 Firefox 取证：%s", browser_path)
        page = FirefoxPage(opts)
        if ctx is not None:
            applied = ctx.apply_emulation(page)
            logger.info("智能指纹仿真已注入：%s", applied)

        regexes = []
        if args.targets_regex:
            for r in args.targets_regex.split(","):
                r = r.strip()
                if r:
                    regexes.append(re.compile(r))
        substrings = [s.strip() for s in (args.targets or "").split(",") if s.strip()]

        # 硬约束：capture.start 必须在 get 之前
        page.capture.start(targets=True, collect_bodies=True)
        logger.info("capture 已启动（targets=True 抓全部包）")

        get_timed_out = False
        try:
            # wait="interactive"（DOMContentLoaded 即返回）：京东等首页 load 事件因长轮询
            # 迟迟不触发，等 complete 无意义；interactive 让抓包更早开始，缩短 get 阻塞。
            # 注意：wait 是 BiDi 协议值（none/interactive/complete），不是 load_mode 的 "eager"。
            page.get(args.url, timeout=args.wait + 20, wait="interactive")
        except Exception as e:
            # 京东等首页常有长轮询/持续请求，load 事件迟迟不触发；
            # get 超时不能中断取证——已捕获的包必须照样 stop + 落盘。
            get_timed_out = True
            logger.warning("page.get 超时/异常（页面 load 未完成不影响已捕获流量），继续收尾：%s", e)

        if args.manual_pause:
            input("在浏览器中完成登录 / 业务操作后按回车继续取证...")

        _trigger_actions(page, args, args.human_algorithm)

        if substrings or regexes:
            # 目标命中即停：每轮先检查已捕获包（目标可能在 get 期间已返回，不能等新包），
            # 命中非失败 2xx 立即结束；未命中再等新包。总时长受 --wait 约束。
            import time
            deadline = time.time() + args.wait
            target_done = False
            while time.time() < deadline:
                try:
                    steps_now = page.capture.steps
                except Exception:
                    steps_now = []
                if _target_reached(steps_now, substrings, regexes):
                    target_done = True
                    logger.info("目标接口已命中，提前结束抓包")
                    break
                try:
                    pkt = page.capture.wait(timeout=2, count=1)
                except Exception as e:
                    logger.warning("capture.wait 异常：%s", e)
                    break
            if not target_done:
                logger.info("未在 %ss 内命中目标接口，按 --wait 超时收尾", args.wait)
        else:
            # 未指定目标：网络静默即停——包数不再增长且连续 settle 秒无新包视为抓包完成。
            # 比"首个包+固定 sleep"更早结束（早完成早停），避免页面加载完仍在空等。
            import time
            deadline = time.time() + args.wait
            prev_count = 0
            last_seen = time.time()
            done = False
            while time.time() < deadline:
                try:
                    steps_now = page.capture.steps
                except Exception:
                    steps_now = []
                count = len(steps_now)
                if count > prev_count:
                    prev_count = count
                    last_seen = time.time()
                elif count > 0 and time.time() - last_seen >= args.settle:
                    logger.info("包数保持 %s 个且连续 %ss 无新包，抓包完成", count, args.settle)
                    done = True
                    break
                try:
                    pkt = page.capture.wait(timeout=2, count=1)
                except Exception as e:
                    logger.warning("capture.wait 异常：%s", e)
                    break
            if not done:
                logger.info("未在 %ss 内达到静默，按 --wait 超时收尾（已捕获 %s 个包）", args.wait, prev_count)

        # 收尾：不调用 capture.stop()——它对每个包做 2 次 BiDi get_data RPC（共 2N 次），
        # 京东等大页面包多 + 浏览器繁忙时 RPC 慢，会拖到数百秒；浏览器关闭断连后才快速返回。
        # metadata 由 steps 快照直接读取（零 RPC），body 在 _classify_packets 里按需拉取。
        try:
            steps = page.capture.steps
        except Exception as e:
            logger.warning("读取 steps 失败：%s", e)
            steps = []

        records_meta, js_records, target_hits, js_dir, document = _classify_packets(
            steps, args, substrings, regexes
        )

        webdriver_flag, wd_err = _eval_js(page, "return navigator.webdriver === true")
        cookies = []
        try:
            cookies = page.get_cookies(all_info=True)
        except Exception as e:
            logger.warning("读取 Cookie 失败：%s", e)

        accepted, only_options = _split_acceptance(target_hits)

        baseline_id = args.baseline_id or uuid.uuid5(
            uuid.NAMESPACE_URL, os.path.abspath(args.case_dir)
        ).hex

        fingerprint = None
        if ctx is not None:
            try:
                fingerprint = ctx.to_dict()
            except Exception as e:
                logger.warning("指纹 to_dict 失败：%s", e)

        has_filter = bool(substrings) or bool(regexes)
        result = _build_result(
            args, browser_path, baseline_id, fingerprint, cookies,
            records_meta, js_records, target_hits, accepted, only_options,
            webdriver_flag, wd_err, has_filter, document,
        )
        result["getTimedOut"] = get_timed_out
        result["outputs"] = _write_outputs(
            args, browser_path, records_meta, target_hits, fingerprint, baseline_id, js_dir
        )
        logger.info("=== FORENSIC DONE === 抓包 %s 个，目标命中 %s，已写入 capture.json",
                    len(records_meta), len(target_hits))
        return result
    finally:
        # 取证结束（成功或异常）一律主动关闭浏览器，避免残留进程 / profile 锁
        closed = _close_browser(page)
        if result is not None and isinstance(result, dict):
            result["browserClosed"] = closed


def _now() -> str:
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")


# ============================================================
# CLI
# ============================================================
def parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="forensic_ruyipage.py",
        description="ruyiPage 通用取证：抓包 + JS 收集 + 指纹基线（严格有头/定制内核）。",
    )
    p.add_argument("--url", required=True, help="目标页面 URL")
    p.add_argument("--browser-path", default="", help="ruyiPage 定制 Firefox 可执行文件；缺省自动解析 managed runtime（禁系统回退）")
    p.add_argument("--case-dir", default=".", help="项目根目录（其下应有 case/ 和 result/ 两个平级子目录），默认当前目录")
    p.add_argument("--project-dir", default="", help="用户工程目录（tools/ 所在）。未传时从 --case-dir / 当前目录向上查找 tools/；安装模式下 skill 安装目录无 tools/，靠此定位定制 Firefox runtime")
    p.add_argument("--out-dir", default="", help="取证输出目录，默认 <case-dir>/case/forensic")
    p.add_argument("--profile-dir", default="", help="独立浏览器 profile，默认 <case-dir>/case/tmp/ruyipage-profile")
    p.add_argument("--fp-dir", default="", help="智能指纹 base_dir，默认 <case-dir>/case/tmp/fingerprint")
    p.add_argument("--targets", default="", help="目标接口子串过滤（逗号分隔）；指定后若未捕获到非 OPTIONS 2xx 目标响应则退出码非 0，作为 Step 1 缺失硬信号；抓包始终抓全部")
    p.add_argument("--targets-regex", default="", help="目标接口正则过滤（逗号分隔）；与 --targets 同样参与取证成功判定")
    p.add_argument("--human-algorithm", default="windmouse", help="拟人算法：windmouse / bezier，默认 windmouse")
    p.add_argument("--window-size", default="1366,900", help="窗口尺寸 wxh，默认 1366,900")
    p.add_argument("--require-country", default="", help="smart_fingerprint require_country（ISO-2）；缺省不校验出口国家（适配代理出口 IP 与目标国家不一致）")
    p.add_argument("--proxy", default="", help="出口代理 host:port（如 1.2.3.4:8080），透传 smart_fingerprint 的 proxy_host/proxy_port；缺省直连（国内站点通常不需要）")
    p.add_argument("--proxy-auth", default="", help="出口代理认证 user:pass（透传 proxy_user/proxy_pwd），可选；账号密码只写 fpfile，不写业务脚本/交付物")
    p.add_argument("--manual-geo", default="", help="地理探测失败时的 manual_geo（JSON 字符串或文件路径）")
    p.add_argument("--no-fp", action="store_true", help="跳过 smart_fingerprint（禁用智能指纹）")
    p.add_argument("--wait", type=int, default=120, help="完成判定的总超时秒：目标命中即提前结束 / 未命中到点自动关闭，默认 120")
    p.add_argument("--settle", type=int, default=5, help="未指定 --targets 时的静默窗口：包数不再增长且连续 N 秒无新包视为抓包完成，默认 5")
    p.add_argument("--max-body-bytes", type=int, default=1048576, help="target-hits 响应体截断阈值，默认 1MB")
    p.add_argument("--click", default="", help="导航后拟人点击的 CSS 选择器")
    p.add_argument("--scroll", type=int, default=0, help="导航后滚动像素数")
    p.add_argument("--manual-pause", action="store_true", help="导航后暂停，等待手动完成登录/业务再继续")
    p.add_argument("--baseline-id", default="", help="指定 baselineId（复用已有指纹基线）")
    p.add_argument("--dry-run", action="store_true", help="只检测环境并打印计划，不启动浏览器")
    p.add_argument("--json", action="store_true", help="输出 JSON")
    p.add_argument("--markdown", action="store_true", help="输出 Markdown（默认）")
    a = p.parse_args(argv)
    if not a.json and not a.markdown:
        a.markdown = True
    a.case_dir = os.path.abspath(a.case_dir)
    a.case_subdir = os.path.join(a.case_dir, "case")
    a.out_dir = os.path.abspath(a.out_dir) if a.out_dir else os.path.join(a.case_subdir, "forensic")
    a.profile_dir = os.path.abspath(a.profile_dir) if a.profile_dir else os.path.join(a.case_subdir, "tmp", "ruyipage-profile")
    a.fp_dir = os.path.abspath(a.fp_dir) if a.fp_dir else os.path.join(a.case_subdir, "tmp", "fingerprint")
    return a


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    ok, ver, err = detect_ruyipage()
    if not ok:
        msg = (
            "未检测到 ruyipage Python 包，无法执行取证。\n"
            f"错误：{err}\n"
            "请先安装：python -m pip install ruyiPage requests --upgrade"
        )
        if args.json:
            print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False, indent=2))
        else:
            print(msg)
        return 2

    browser_path, berr = resolve_browser(args)
    if berr:
        msg = f"ruyiPage 定制 Firefox 校验未通过：\n{berr}"
        if args.json:
            print(json.dumps({"ok": False, "error": msg, "ruyipageVersion": ver}, ensure_ascii=False, indent=2))
        else:
            print(msg)
        return 2

    plan = {
        "ruyipageVersion": ver,
        "browserPath": browser_path,
        "url": args.url,
        "outDir": args.out_dir,
        "profileDir": args.profile_dir,
        "fpDir": args.fp_dir,
        "headless": False,
        "humanAlgorithm": args.human_algorithm,
        "smartFingerprint": not args.no_fp,
        "targets": [s for s in args.targets.split(",") if s.strip()],
        "dryRun": args.dry_run,
    }

    if args.dry_run:
        out = {"ok": True, "plan": plan}
        if args.json:
            print(json.dumps(out, ensure_ascii=False, indent=2))
        else:
            print("# ruyiPage 取证计划（dry-run，不启动浏览器）")
            for k, v in plan.items():
                print(f"- {k}: {v}")
        return 0

    result = run_forensic(args, browser_path)
    target_substrings = [s.strip() for s in (args.targets or "").split(",") if s.strip()]
    target_regexes = [r.strip() for r in (args.targets_regex or "").split(",") if r.strip()]
    has_target_filter = bool(target_substrings or target_regexes)
    target_verified = bool(result.get("acceptedTargetCount"))
    result["ok"] = (not has_target_filter) or target_verified
    result["ruyipageVersion"] = ver

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(result))
    if not result["ok"]:
        print(
            "[未通过] 取证目标未达成：指定了 --targets/--targets-regex，但未捕获到目标接口的非 OPTIONS 2xx 响应，"
            "Step 1 缺失。请重采（--click/--scroll/--manual-pause）或由用户提供 cURL/HAR/原始请求文本，"
            "不得转源码搜索。",
            file=sys.stderr,
        )
        return 1
    return 0


def render_markdown(r: Dict[str, Any]) -> str:
    L = ["# ruyiPage 取证报告", ""]
    L.append(f"- 目标：{r.get('url')}")
    L.append(f"- ruyipage 版本：{r.get('ruyipageVersion')}")
    L.append(f"- 浏览器：{r.get('browserPath')}")
    L.append(f"- 浏览器关闭状态：{r.get('browserClosed', 'unknown')}")
    L.append(f"- baselineId：{r.get('baselineId')}")
    L.append(f"- 抓包总数：{r.get('packetCount')}")
    L.append(f"- JS 文件数：{r.get('jsFileCount')}")
    L.append(f"- 目标命中数：{r.get('targetHitCount')}（验收通过 {r.get('acceptedTargetCount')}）")
    doc = r.get("entryDocument")
    if doc:
        L.append(f"- 入口页面：{doc.get('saved_to')}（{doc.get('size')}B，状态 {doc.get('status')}）")
    else:
        L.append("- 入口页面：未捕获到 HTML 文档（纯 API 目标或无 text/html 响应属正常）")
    L.append(f"- JS 落盘质量：{r.get('jsQuality')}（{r.get('jsFileCount') - r.get('jsMissingCount', 0)}/{r.get('jsFileCount')} 完整）")
    L.append(f"- navigator.webdriver 自检：{r.get('navigatorWebdriverSelfCheck')}")
    if r.get("jsQuality") == "FAIL":
        L.append("- [警告] JS 落盘 0B 比例过高（≥50%），取证质量不达标：gzip/br 大 JS 响应体未拿回，无法用于定位分析，必须重采或补采 JS。")
    elif r.get("jsQuality") == "WARN":
        L.append("- [警告] 部分 JS 落盘缺失（0B）：以下 JS 未拿到响应体，定位关键资源时注意补采。")
    if r.get("getTimedOut"):
        L.append("- [警告] page.get 超时（页面 load 未完成），但已捕获流量并已落盘；验收以实际抓包为准，非取证失败")
    L.append(f"- 取证验收：{r.get('acceptance')}")
    if r.get("acceptance") in ("NO_TARGET", "PARTIAL"):
        L.append("")
        L.append("[未通过] 取证目标未达成：指定 --targets/--targets-regex 后未捕获到目标接口的非 OPTIONS 2xx 响应（Step 1 缺失）。")
        L.append("请重采（--click/--scroll/--manual-pause）或由用户提供 cURL/HAR/原始请求文本，不得转源码搜索。")
    if r.get("onlyOptionsWarning"):
        L.append(f"- [警告] 仅捕获到 OPTIONS 预检，未捕获真实业务响应：{r['onlyOptionsWarning']}")
    if r.get("webdriverCheckError"):
        L.append(f"- webdriver 检查错误：{r['webdriverCheckError']}")
    L.append("")
    L.append("## 目标接口命中")
    if r.get("targetHitsSummary"):
        for h in r["targetHitsSummary"]:
            L.append(f"- `{h.get('method')} {h.get('status')}` {h.get('url')}")
    else:
        L.append("- 无（未指定 --targets 或没有命中）")
    L.append("")
    L.append("## JS 文件")
    if r.get("jsFiles"):
        for j in r["jsFiles"]:
            extra = f"  sourceMappingURL={j['source_mapping_url']}" if j.get("source_mapping_url") else ""
            L.append(f"- {j.get('saved_to')} ({j.get('size')}B){extra}  {j.get('url')}")
    else:
        L.append("- 无")
    L.append("")
    L.append("## 输出")
    out = r.get("outputs", {})
    L.append(f"- 全部抓包：{out.get('captureJson')}")
    L.append(f"- 目标命中：{out.get('targetHitsJson')}")
    if doc:
        L.append(f"- 入口页面：{doc.get('saved_to')}")
    L.append(f"- JS 目录：{out.get('jsDir')}")
    if out.get("fingerprintBaseline"):
        L.append(f"- 指纹基线：{out.get('fingerprintBaseline')}")
    L.append("")
    if r.get("navigatorWebdriverSelfCheck") == "FAIL":
        L.append("[警告] navigator.webdriver 为 true，本次取证不合格（疑似被识别为自动化）。")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.exit(main())
