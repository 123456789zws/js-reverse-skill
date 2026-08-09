"""
final.py — 验证码逆向交付物【单一入口】（load → solve → verify 三段链路，Python 版）。

与 captcha-verify/final.js（Node 版）的区别：
  - Node 版 solver.js 调 ddddocr 需跨语言桥接（child_process/HTTP）
  - Python 版 solver.py 直接 import ddddocr，答案层工具链（ddddocr/OpenCV/Whisper）原生可用
  - 两版 config.json 字段一致，可共用；answer JSON 契约一致

双重角色：
  - 自验：   python final.py            → 完整走 load→solve→verify→业务接口，交叉验证 5 次
  - 库调用： from final import solve_captcha, verify_chain  → 只取 API，不自动执行

含 __main__ 守卫。硬编码纪律（红线）：不含浏览器自动化代码；challenge 每次重新 load，不复用。

使用方式：
  python final.py                       # 默认：完整链路发真实请求，交叉验证 5 次
  python final.py --verify 5            # 指定验证次数
  python final.py --sign-only           # 仅输出 verify 参数（w 等），不发真实请求
  python final.py --cookie "name=value" # 注入用户 cookie（业务接口需要登录态时）

answer JSON 契约见 references/captcha/captcha-overview.md；
坐标来源判定见 references/captcha/gap-coordinate-source.md；
成功基线/失败复盘见 scripts/check_success_baseline.js + check_verification_attempts.js。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import random

# ============================================================
# 依赖（由用户从 templates 复制到 result/src/ 后填充）
# ============================================================
# 请求客户端：从 templates/python-request/client.py 复制到 result/src/request/client.py
try:
    from src.request.client import create_request_session
except ImportError:
    create_request_session = None

# verify 加密入口：用户自行实现（参考 cases/ + references/captcha/），需导出 encrypt_verify_param + build_verify_payload
try:
    from src.verifier import encrypt_verify_param, build_verify_payload
except ImportError:
    encrypt_verify_param = None
    build_verify_payload = None

# 答案求解器：ddddocr / OpenCV / 打码平台适配器，需导出 solve(image_bytes, captcha_type, options) → answer dict
try:
    from src.solver import solve
except ImportError:
    solve = None

# 轨迹生成：可包装 scripts/generate_motion_track.py 或用 Python 重写
try:
    from src.track import generate_motion_track
except ImportError:
    generate_motion_track = None


# ============================================================
# 配置（与 Node 版 config.json 字段一致，可共用）
# ============================================================
def load_config() -> dict:
    cfg = {}
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "config.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return cfg


# ============================================================
# 三段链路：load → solve → verify
# ============================================================

def load_challenge(session: object, config: dict) -> dict:
    """① load 阶段：拿 challenge 标识 + 素材地址。"""
    res = session.get(config["target"]["load_api"], params={
        "gt": config["captcha"].get("gt_or_captcha_id"),
    })
    data = res.json()
    if not data.get("challenge") and not data.get("lot_number"):
        raise ValueError(f"load 响应缺少 challenge/lot_number: {json.dumps(data, ensure_ascii=False)[:200]}")
    return data


def solve_captcha(session: object, config: dict, load_result: dict) -> dict:
    """② solve 阶段：下载素材 → 本地求解/打码 → answer JSON。"""
    if solve is None:
        raise RuntimeError("未配置 solver，请实现 result/src/solver.py")

    bg_url = load_result.get("bg") or load_result.get("fullbg")
    slice_url = load_result.get("slice")

    bg_bytes = session.get(bg_url).body
    slice_bytes = session.get(slice_url).body if slice_url else None

    answer = solve(bg_bytes, config["captcha"]["captcha_type"], {
        "slice": slice_bytes,
        "provider": config["captcha"]["provider"],
        "source_image_size": [load_result["bg_size"]["w"], load_result["bg_size"]["h"]]
            if load_result.get("bg_size") else None,
    })

    # 生成轨迹（slider/drag-drop/scratch/trace）
    if answer.get("offset", {}).get("x") is not None and not answer.get("track"):
        if generate_motion_track is None:
            raise RuntimeError("未配置 track，请实现 result/src/track.py")
        answer["track"] = generate_motion_track(
            mode="slider", distance=answer["offset"]["x"], duration_ms=1100,
        )

    # 填入 challenge 绑定
    answer["challenge_binding"] = {
        "gt": load_result.get("gt") or config["captcha"].get("gt_or_captcha_id", ""),
        "challenge": load_result.get("challenge", ""),
        "lot_number": load_result.get("lot_number", ""),
    }
    return answer


def verify_chain(session: object, config: dict, load_result: dict, answer: dict) -> dict:
    """③ verify 阶段：加密 answer+track → 提交 → 换取通过凭据。"""
    if encrypt_verify_param is None or build_verify_payload is None:
        raise RuntimeError("未配置 verifier，请实现 result/src/verifier.py")

    encrypted = encrypt_verify_param(answer, load_result)
    payload = build_verify_payload(encrypted, load_result)

    # ⚠ 提交方式按厂商不同，禁止无脑 POST：
    #   极验 v3：必须 GET + JSONP（callback=geetest_<ts>，w 等参数全拼 query string），POST 返回 error_31
    #   且 w 含自定义 base64 的 ()，quote 后须把 %28/%29 还原为字面括号，否则被 WAF 拦
    #   其他厂商多为 POST
    res = session.post(config["target"]["verify_api"], data=payload)
    cred = res.json()
    if not any(cred.get(k) for k in ("validate", "seccode", "ticket", "pass")):
        raise ValueError(f"verify 响应缺少通过凭据: {json.dumps(cred, ensure_ascii=False)[:200]}")
    return cred


def call_business_api(session: object, config: dict, credential: dict) -> dict:
    """④ 业务接口消费凭据。"""
    res = session.post(config["target"]["business_api"], json={"credential": credential})
    return res.json()


# ============================================================
# 主流程：完整链路 + 交叉验证
# ============================================================
def run_once(config: dict, cookie_str: str = "") -> dict:
    session = create_request_session(cookie_str)
    try:
        load_result = load_challenge(session, config)
        answer = solve_captcha(session, config, load_result)
        credential = verify_chain(session, config, load_result, answer)
        biz_result = call_business_api(session, config, credential)
        return {"answer": answer, "credential": credential, "biz_result": biz_result}
    finally:
        session.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="验证码逆向交付物自验入口（Python）")
    parser.add_argument("--verify", type=int, default=5, help="交叉验证次数（默认 5）")
    parser.add_argument("--sign-only", action="store_true", help="仅输出 verify 参数，不发真实请求")
    parser.add_argument("--cookie", default="", help="注入用户 cookie")
    args = parser.parse_args(argv)

    config = load_config()
    verify_count = args.verify or config.get("verify_count", 5)

    print(f"[captcha-verify-py] provider={config['captcha']['provider']} "
          f"type={config['captcha']['captcha_type']} verify={verify_count}")

    if args.sign_only:
        session = create_request_session()
        try:
            load_result = load_challenge(session, config)
            answer = solve_captcha(session, config, load_result)
            encrypted = encrypt_verify_param(answer, load_result)
            print(json.dumps({"load": load_result, "answer": answer, "encrypted": encrypted},
                             ensure_ascii=False, indent=2))
        finally:
            session.close()
        return 0

    success = 0
    for i in range(verify_count):
        try:
            result = run_once(config, args.cookie)
            success += 1
            biz_str = json.dumps(result["biz_result"], ensure_ascii=False)[:100]
            print(f"  [{i + 1}/{verify_count}] OK  biz={biz_str}")
        except Exception as e:
            print(f"  [{i + 1}/{verify_count}] FAIL  {e}")
        if i < verify_count - 1:
            time.sleep(1.0 + random.random() * 2.0)

    print(f"[captcha-verify-py] 完成 {success}/{verify_count}")
    return 0 if success > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
