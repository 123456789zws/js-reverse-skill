# 验证码逆向总览（边界 / 分工 / 接口契约）

> **交叉引用**：题型识别与图像求解见 `captcha-types.md` + `provider-products.md`（移植自 xbsReverseSkill）；请求链细节见 `captcha-request-chain.md`；厂商矩阵见 `captcha-providers.md`；轨迹加密见 `captcha-motion-encryption.md`；答案层接入见 `captcha-solving-handoff.md`。Session 绑定见 `network/session-chain.md`，指纹一致性见 `fingerprint/` 子域。

本 skill 在验证码场景的核心能力：**封装层逆向**（verify 接口加密参数 w / cb / sig / token / 轨迹加密 / challenge 绑定）+ **答案层资产**（ddddocr/坐标/轨迹脚本均已集成，见 `captcha-solving-handoff.md`）。完整厂商信号表与题型分类器见 `provider-products.md` / `captcha-types.md` / `scripts/classify_verify.py`（移植自 xbsReverseSkill）。

## 四层分工模型

| 层 | 内容 | 归属 |
|---|---|---|
| 识别层 | 题型 / 厂商分类（26 题型标签 + 厂商信号表） | 本 skill（`scripts/classify_verify.py`） |
| 答案层 | 图像求解：ddddocr / OpenCV / 自训模型 / 打码平台 | 本 skill（`open-source-recipes.md` + scripts） |
| 轨迹层 | 坐标换算、轨迹生成 | 两 skill 共用脚本（本 skill `scripts/` 已移植） |
| 封装层 | verify 接口参数加密、轨迹加密、token 绑定还原 | **本 skill** |

**核心认知**：验证码请求 = 答案（该点哪/滑多远）+ 封装（怎么把答案加密发回去）。打码平台只给答案，给不了封装；封装只能逆向。滑块/拼图类答案可图像计算（ddddocr slide_match），点选类答案需识别（OCR/检测/打码），但两类的封装层都必须逆向。

## 红线在验证码场景的适配

- 红线 3 依然成立：最终交付必须是纯协议脚本。答案来自 ddddocr 本地模型或打码平台 API，**不是浏览器操作**；禁止用自动化拖滑块完成交付。
- 用户手动通过验证码的成功样本**只允许用于 Phase 1-3 取证**（建立成功链路 trace 基线），不得硬编码进 `result/`。
- 打码平台 API key 等凭据走 `config.json` 外置，脱敏后交付，禁止硬编码。

## 答案 JSON 接口契约

答案层（本 skill solver 或自建）产出、封装层（本 skill 交付物）消费的统一结构：

```json
{
  "captcha_type": "slider",
  "provider": "geetest",
  "solver": "ddddocr-slide_match",
  "confidence": 0.95,
  "coordinate_space": "image-pixel",
  "source_image_size": [260, 160],
  "display_size": [260, 160],
  "offset": { "x": 87, "y": null, "angle": null },
  "points": [],
  "track": [{ "x": 0, "y": 0, "t": 0 }],
  "challenge_binding": { "gt": "", "challenge": "", "lot_number": "" }
}
```

字段规则：

- `slider` / `rotate`：填 `offset`（滑块 x 偏移或旋转角度），`points` 为空。
- `click-select` / `grid` / `area-select` / `difference-click`：填 `points`（含 `x`、`y`、`order`、`label`），多点必须保留顺序；`offset` 为空。
- `track`：由封装层用 `scripts/generate_motion_track.py` 按 offset 生成后再填充，答案层可以不产出轨迹。
- `challenge_binding`：load 阶段响应中提取的绑定字段，随厂商不同（极验 v3 是 gt/challenge，v4 是 captcha_id/lot_number）。
- 校验：交付前跑 `node scripts/check_captcha_answer.js --file answer.json`，schema 不通过不进 Phase 4 参数化。

## 验证标准（Phase 5 特化）

- 主标准：verify 接口返回通过凭据（极验 `validate` / `seccode`，腾讯 `ticket`+`randstr`，数美 `pass`+`rid` 等）且业务接口消费该凭据返回 200 + 正确数据。
- ≥5 次真实请求交叉验证不变；每次必须**完整走 load → solve → verify 新链路**（challenge 一次性，禁止复用旧 challenge 刷验证）。
- 视觉答案正确 ≠ 验证通过。失败时按 `captcha-motion-encryption.md` 的风控校验点清单排查（轨迹、环境、challenge 新鲜度、答案精度），不要盲目重试。
- **验证码验证执行流程（成功样本基线 ≥5 次手动成功、attempts 失败复盘、动作分级确认表）见 `verification-workflow.md`**——Phase 5 进入真实网页验证或连续失败复盘时必读。
