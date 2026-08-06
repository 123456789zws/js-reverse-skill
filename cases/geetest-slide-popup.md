# Case：极验 slide-popup 验证码封装层逆向（AES-CBC + RSA + 自定义 base64 + 轨迹编码）

> 难度：★★★
> 还原方案：A 纯算还原（w 加密链）+ 答案层 ddddocr slide_match（滑块距离）
> 实现语言：Node.js
> 最后验证日期：2026-08-03
> 平台类型：极验 slide-popup（demos.geetest.com 演示页）

---

## 技术指纹（供 CHECK-2 自动匹配）

- JS 特征：双 SDK 分层 —— `fullpage.9.2.0.js`（fullpage 层，初始化会话）+ `slide.7.9.3.js`（slide 层，w 参数加密）；`ep.v="7.9.3"`；自定义 base64 字符表 `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789()`（含 `()` 而非标准 `+/`）
- 参数特征：`w` = custom_base64(AES_ciphertext) + rsa_hex(AES_key)，**尾部全 hex 字符**（0-9/a-f，256 字符 = 128 字节 RSA 密文）；`challenge` 32 字符 → 34 字符（末尾追加 2 字符）；`userresponse` 为数字字母混合；`rp` 为 32 位 hex（md5）
- 请求特征：请求链 `register-slide` → `ajax.php(pt=0, w=空)` → `get.php` → `ajax.php($_BCm=0, w)` → `validate-slide`；全部 JSONP via `<script src>` GET 提交（非 POST）；`$_BCm` 经 encodeURIComponent 编码为 `%24_BCm`
- 反调试特征：无明显反调试；演示页无 TLS 指纹校验

## 加密方案

- 路径：A 纯算还原（加密参数 w）+ 答案层 ddddocr slide_match（滑块距离，遵循 `references/captcha/captcha-solving-handoff.md` 硬约束）
- 框架：不使用
- TLS 客户端：Node.js 内置 https（演示页无 TLS 校验；生产站按 `references/network/tls-validation.md` 选 curl-cffi-node）
- 核心思路：
  - `w = customBase64(AES_CBC(payload, aesKey)) + rsaHex(aesKey)`
  - AES-128-CBC + PKCS7，IV=`"0000000000000000"`（16 个 ASCII `'0'`，**Latin1 解析为 16 字节**），密钥 = 16 字符 hex 字符串（Latin1 解析为 16 字节，非 hex decode）
  - RSA-PKCS#1 v1.5，公钥 modulus（256 hex 字节）+ exponent 65537；需手动构造 PKCS#1 DER（modulus 前补 `0x00` 防被解释为负数）
  - 自定义 base64：每 3 字节 → 4 字符，4 个比特掩码 `[7274496, 9483264, 19220, 235]` 分别提取 6 bit，扫描顺序从 mask 最高位到最低位、仅取 mask 为 1 的位；**不生成 `=` padding**
  - payload = `{lang, userresponse, passtime, imgload, aa, ep, h9s9, rp}`（gt/challenge/client_type/`$_BCm` 在 URL 参数中，不进 payload）
  - `userresponse = H(distance, challenge)`：取 challenge 末尾 2 字符 base-36 解码为偏移量，distance+offset 后按权重 `[1,2,5,10,50]` 用 challenge 去重字符桶编码
  - `rp = md5(gt + challenge[:32] + h9s9)`；`h9s9` = 10 位数字字符串
  - `aa` = 轨迹编码，字符表 `()*,-./0123456789:?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopq`（51 字符），相对前一点偏移 + 偏移量映射
  - 滑块距离由 ddddocr `slide_match(slice, bg)` 计算（见下方「答案层接入」段的 geetest 特有实现）

## 踩坑记录

1. **坑：w 拼接顺序两个 SDK 相反** → 正确做法：`slide.7.9.3.js` 的 w = `custom_base64 + rsa_hex`（base64 在前、hex 在后）；`fullpage.9.2.0.js` 的 w = `rsa_hex + custom_base64`。提交 ajax.php 用 slide 层顺序。判断依据：trace 中 ajax.php 请求 URL 尾部全为 hex 字符 → 尾部是 RSA hex。
2. **坑：ajax.php 必须用 GET（JSONP via script src），POST 返回 error_31** → 正确做法：参数全部拼在 URL query string，带 `callback=geetest_<ts>`；`Content-Type` 不发 form。证据：POST 提交返回 `{"status":"error","data":"not captcha_id"}`。
3. **坑：跳过 ajax.php(pt=0, 空 w) 初始化会话，直接 get.php / ajax.php(w) 会失败** → 正确做法：register-slide 后必须先调 `ajax.php?gt=&challenge=&lang=zh-cn&pt=0&client_type=web&w=&callback=`，服务器返回 `{"status":"success","data":{"result":"slide"}}` 初始化 session，否则后续接口 error_31。
4. **坑：客户端无需自己计算 challenge 追加** → 正确做法：`get.php` 响应直接返回 34 字符 challenge（已追加 2 字符，如 `...603l`/`...9134`），ajax.php 提交时用 get.php 返回的 34 字符 challenge 即可；`appendChallenge(s hex 前 2 对转字符)` 逻辑是 fullpage 层备用，slide 流程不需要客户端执行。
5. **坑：WAF 拦截 URL 编码后的括号 `%28`/`%29`** → 正确做法：`encodeURIComponent` 后把 `%28`/`%29` 还原为字面 `(`/`)`（自定义 base64 输出含 `()`，被编码会被 WAF 拦）。仅编码会破坏 URL 结构的字符（`& = # + 空格`）。
6. **坑：AES 密钥按 hex decode 成 8 字节当 AES key** → 正确做法：极验 AES key 是 16 字符 hex 字符串，但**直接按 Latin1 取 16 字节**作为 aes-128 key（即字符串本身当字节），不是 hex decode。IV 同理（`"0"*16` 的 Latin1 字节，非 `0x00*16`）。
7. **坑：RSA 公钥直接用 `crypto.createPublicKey({key: {modulus, exponent}})`** → 正确做法：Node.js 不支持裸 modulus/exponent 入参，需手动构造 PKCS#1 DER（`SEQUENCE { INTEGER modulus, INTEGER exponent }`），modulus/exponent 首字节最高位为 1 时前补 `0x00`，再 `createPublicKey({key: der, format:'der', type:'pkcs1'})`。

## 可验证事实清单（经验资产）

1. `w` 长度区间 1174–1238（随 payload 中 aa/ep 长度浮动），结构 = custom_base64 段 + 256 hex 字符 RSA 段
2. AES 密钥 = 16 字符 hex 字符串（如 `46e66e6085878544`），按 Latin1 取字节
3. AES-128-CBC，IV = `"0000000000000000"` 的 Latin1 字节（即 `0x30` × 16，非 `0x00`），PKCS7 填充
4. RSA 密文 = 128 字节 = 256 hex 字符，PKCS#1 v1.5 padding，公钥 exponent = 65537
5. 自定义 base64 字符表 = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789()`（64 字符，`()` 替代标准 `+/`），无 `=` padding
6. 比特位置换掩码固定 = `[7274496, 9483264, 19220, 235]`，每 3 字节输入 → 4 字符输出
7. `challenge`：register-slide 返回 32 字符 → get.php 响应变为 34 字符（末尾追加 2 字符，字符来自 s hex 的前 2 对）
8. 演示页 `gt = 019924a82c70bb123aae90d483087f94`（固定）；`ep.v = "7.9.3"`（slide SDK 版本）
9. `rp = md5(gt + challenge[:32] + h9s9)`，32 位 hex；`h9s9` = 10 位数字字符串
10. `get.php` 响应含 `bg`/`slice`/`fullbg`/`ypos` 字段：`bg`=带缺口背景图、`slice`=滑块图、`fullbg`=完整背景、`ypos`=缺口 y 坐标；图片路径形如 `pictures/gt/<hash>/bg/<hash>.jpg`
11. ajax.php 提交必须 GET + JSONP callback，参数 `$_BCm=0` 编码为 `%24_BCm=0`；POST 返回 error_31
12. payload 字段固定 8 个：`lang, userresponse, passtime, imgload, aa, ep, h9s9, rp`（gt/challenge 在 URL，不进 payload）
13. `userresponse = H(distance, challenge)`，权重数组 `[1, 2, 5, 10, 50]`，challenge 字符按去重顺序分到 5 桶
14. 轨迹字符表 = `()*,-./0123456789:?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopq`（51 字符）

## 答案层接入（geetest 特有实现）

> 通用约束见 `references/captcha/captcha-solving-handoff.md` 的「硬约束」段。以下为 geetest slide-popup 的站点特有实现细节。

```python
import ddddocr

det = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
bg_bytes = download(bg_url)        # get.php 响应的 bg 字段，用与业务一致的 session 下载
slice_bytes = download(slice_url)  # get.php 响应的 slice 字段
res = det.slide_match(slice_bytes, bg_bytes)  # {'target_x': ..., 'target': [...]}
distance = res['target'][0]  # 缺口 x 像素，按显示比例换算后填入 userresponse 的 distance
```

- 素材 URL 从 `get.php` 响应 JSON 的 `bg`/`slice` 字段提取，路径形如 `pictures/gt/<hash>/bg/<hash>.jpg`（相对路径，需拼接 `static.geetest.com/` 或 `static.geevisit.com/` 前缀）
- `get.php` 还返回 `fullbg`（完整背景，可用于本地对照）和 `ypos`（缺口 y 坐标，验证 x 时参考）
- 素材下载用与业务请求一致的 TLS 客户端 + 相同 Session cookie（极验素材 URL 绑 Session）
- 闭环：`ddddocr slide_match → target_x → map_coordinates 换算 → generate_motion_track --distance <x> → track → 填 answer JSON → 加密进 w`

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/captcha/captcha-overview.md` | 四层分工 + answer JSON schema + 红线适配 |
| `references/captcha/captcha-request-chain.md` | load→solve→verify 三段链 + 极验 v3/v4 骨架 |
| `references/captcha/captcha-solving-handoff.md` | ddddocr slide_match 三能力 + 滑块闭环 |
| `references/captcha/gap-coordinate-source.md` | 坐标来源判定 A/B/C（本案为 C 路线；v4 注意 bg 隐写 B 路线） |
| `references/captcha/captcha-motion-encryption.md` | 轨迹加密 + 风控校验点清单 |
| `references/captcha/open-source-recipes.md` | slider 题型 ddddocr recipe |
| `references/workflow/experience-rules.md` | 命中案例后先做时效性校验 |
