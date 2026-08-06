# captcha-verify-py 验证码逆向交付模板（Python 版）

验证码逆向专用模板（load → solve → verify 三段链路 + 业务接口消费凭据），Python 版。
与 `captcha-verify/`（Node 版）的区别：solver 直接 `import ddddocr`，答案层工具链原生可用，无需跨语言桥接。

## 何时选 Python 版

- 答案层用 ddddocr / OpenCV / Whisper（均为 Python 生态）→ **选 Python 版**
- 答案层走 A 参数解密 / B 像素提取，且封装层加密逻辑已用 Python 还原 → 选 Python 版
- 封装层加密逻辑只在 Node 侧还原（vm 沙箱/JS 执行）→ 选 Node 版

## 文件清单

| 文件 | 作用 |
|------|------|
| `final.py` | 唯一执行入口（带 `__main__` 守卫）：完整链路自验 + 可被 import 调用 |
| `config.json` | 外置配置（与 Node 版字段一致，可共用） |
| `requirements.txt` | 依赖契约（curl_cffi + ddddocr + opencv + pillow + numpy） |

## 使用方式

1. Phase 4 编码时复制到 `case/result/`：
   ```
   cp templates/captcha-verify-py/final.py result/
   cp templates/captcha-verify-py/config.json result/
   cp templates/captcha-verify-py/requirements.txt result/
   ```
2. 从 `templates/python-request/client.py` 复制 TLS 客户端到 `result/src/request/client.py`
3. 实现 `result/src/verifier.py`（加密入口：`encrypt_verify_param` + `build_verify_payload`，参考 `references/captcha/captcha-request-chain.md`）
4. 实现 `result/src/solver.py`（答案求解：`solve(image_bytes, captcha_type, options)` → answer dict，参考 `references/captcha/captcha-solving-handoff.md`）
5. 实现 `result/src/track.py`（轨迹生成：`generate_motion_track`，可包装 `scripts/generate_motion_track.py` 或用 Python 重写）

## 三段链路结构

```
final.py（唯一执行入口）
  ├── ① load_challenge()   → 拿 challenge + 素材地址（load/register 接口）
  │     └── result/src/request/client.py（TLS 客户端，复制自 python-request/）
  ├── ② solve_captcha()    → 下载素材 → 本地求解 → answer JSON（含 offset/points/track/challenge_binding）
  │     ├── result/src/solver.py（ddddocr / OpenCV / 打码平台适配器，直接 import ddddocr）
  │     └── result/src/track.py（轨迹生成，slider/drag-drop/scratch/trace）
  ├── ③ verify_chain()     → 加密 answer+track → 提交 → 换取通过凭据（validate/seccode/ticket/pass）
  │     └── result/src/verifier.py（encrypt_verify_param + build_verify_payload）
  └── ④ call_business_api() → 业务接口消费凭据
```

## solver.py 示例（ddddocr 直接调用）

```python
import ddddocr

_det = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)

def solve(image_bytes, captcha_type, options=None):
    options = options or {}
    slice_bytes = options.get("slice")
    if captcha_type == "slider" and slice_bytes:
        res = _det.slide_match(slice_bytes, image_bytes)
        x = res["target"][0]
        return {
            "captcha_type": "slider",
            "solver": "ddddocr-slide_match",
            "confidence": 0.9,
            "coordinate_space": "image-pixel",
            "offset": {"x": x, "y": None, "angle": None},
            "points": [],
        }
    raise ValueError(f"不支持的题型: {captcha_type}")
```

## answer JSON 契约

`solve_captcha()` 返回的 answer dict 必须符合 `references/captcha/captcha-overview.md` 的接口契约（`source_image_size` 必填，缺了会被 `check_captcha_answer.js` 判 FAIL）。
交付前跑 `node scripts/check_captcha_answer.js --file answer.json` 校验。

## 注意

- challenge 一次性：每次验证必须从 load 重新走，禁止复用旧 challenge
- 素材下载用与业务请求一致的 TLS 指纹客户端 + Session cookie（部分厂商素材 URL 绑 Session）
- 凭据形态按厂商不同（极验 validate/seccode、腾讯 ticket+randstr、数美 pass+rid），`call_business_api` 按实际组装
- config.json 与 Node 版完全一致，同一份配置可互换两版交付物
