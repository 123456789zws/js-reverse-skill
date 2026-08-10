# Case：浏览器提取 + 修改版 MD5（猿人学第5题）

> 难度：★★★
> 还原方案：浏览器提取（降级自纯算）
> 实现语言：Node.js + puppeteer-core
> 最后验证日期：2026-07-11
> 平台类型：猿人学练习平台（yuanrenxue.cn）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

### JS 特征
- [x] obfuscator.io 风格混淆（字符串数组 + 旋转 + 索引偏移函数）
- [x] 控制流平坦化（CFF，`while(0x1) { switch(...) }` dispatcher）
- [x] charCode 位移编码反 hook（`-76` 正常分支 vs `-2331-h.slice(0,1)*2` 反 hook 分支）
- [x] `Function.prototype.toString` 反检测（检测原生函数 toString）
- [x] `window.$_zw` 指纹数组（27 项，含 Date/String/eval/window/document/global 等，**在页面 HTML 脚本中构建，非混淆 JS 内**）
- [x] `window.$$$` 编码字符串（charCode - 76 解码后即真实 JS 代码）
- [x] **内嵌修改版 MD5**（4 个轮函数 F/G/H/I 标准，但 T 常量被替换）
- [x] CryptoJS UMD 模块加载（页面引入 cryptoJS.min.js，但 m cookie 生成不使用 CryptoJS，使用内嵌修改版）

### 参数特征
- [x] URL 参数 `m` = `window._$is` = `new Date().valueOf().toString()`（时间戳字符串）
- [x] URL 参数 `f` = `window.$_zw[23]` = `Date.parse(new Date())`（毫秒时间戳，末三位为 000）
- [x] cookie `m` = 修改版 MD5 哈希值（32 位 hex，但**非标准 MD5**）
- [x] cookie `RM4hZBv0dDon443M` = WAF/反爬 cookie（Base64 变种，约 200 字符，浏览器生成）
- [x] 第 5 页请求 UA 必须为 `yuanrenxue`（题目硬性要求）

### 请求特征
- [x] 缺/错 cookie `m` 返回 `{"error":"token failed"}`
- [x] 缺 cookie `RM4hZBv0dDon443M` 同样返回 `{"error":"token failed"}`（WAF cookie 必须携带）
- [x] 需携带 `sessionid` cookie（每用户不同，题目登录态）
- [x] 无 412 挑战循环（区别于瑞数签名型）

### 反调试特征
- [x] `Function.prototype.toString` 检测（toString 返回值校验）
- [x] charCode 位移编码反 hook（hook fromCharCode 会触发错误分支）
- [x] 控制流平坦化（增加静态分析难度）

---

## 加密方案

- **路径**：浏览器提取动态值 + Node.js 原生 https 请求（非标准路径，纯算失败后的降级）
- **框架**：puppeteer-core（使用已安装的 Chrome，非 jsdom/vm）
- **TLS 客户端**：Node.js 原生 https
- **核心思路**：puppeteer 启动 Chrome 访问题目页面 → 提取 `window._$is`（m 参数）、`window.$_zw[23]`（f 参数）、`document.cookie`（完整 cookie 含 RM4hZBv0dDon443M）→ Node.js https 请求 5 页数据

### 为什么降级到浏览器提取

**纯算失败的根因**：内嵌的 MD5 是修改版，4 个轮函数（F/G/H/I）与标准 MD5 完全一致，但 **T 常量表被替换**：

| T 常量位置 | 标准值 | 修改后值 | 说明 |
|-----------|--------|---------|------|
| T[1] | `0xd76aa478` | `0x7d60c` | 静态修改 |
| T[2] | `0xe8c7b756` | `_$6_`（动态值） | 运行时计算 |
| T[22] | `0xc33707d6` | `_$tT = Date.valueOf() - Date.parse()` | **动态时间差** |
| T[26] | `0xa9e3e905` | `_$Jy = new Date().valueOf()` | **动态时间戳** |
| T[37] | `0xfcefa3f8` | `-0x5b4115bc * b64pad` | b64pad=1 |

T[22] 和 T[26] 含动态时间戳，**纯算法无法还原 cookie `m`**。

---

## 踩坑记录

| # | 坑 | 现象 | 解决方法 |
|---|---|------|---------|
| 1 | **标准 MD5 假设** | 用 Node.js crypto MD5(m) 计算的 cookie 与浏览器实际值不匹配 | 4 个轮函数标准但 T 常量被替换为动态时间戳，识别后降级到浏览器提取 |
| 2 | **缺 RM4hZBv0dDon443M cookie** | Node.js 请求只带 sessionid + m cookie，返回 `{"error":"token failed"}` | 浏览器生成 WAF cookie 必须携带，提取 `document.cookie` 完整字符串传递 |
| 3 | **$_zw 在页面 HTML 构建** | 在混淆 JS 中找不到 $_zw 数组定义 | $_zw 指纹数组（27 项）在页面 HTML 的 `<script>` 中构建，需先加载页面 |
| 4 | **charCode 位移反 hook** | hook fromCharCode 后解码出错 | `-76` 是正常分支，`-2331-h.slice(0,1)*2` 是反 hook 分支，不能 hook fromCharCode |
| 5 | **m 参数 vs m cookie 混淆** | URL 参数 m 和 cookie m 是不同的值 | URL 参数 m = 时间戳字符串，cookie m = 修改版 MD5 哈希值，两者不同 |
| 6 | **轻信检测脚本误判** | check_external_tools.js 报"trace 取证工具未安装"，实际已安装 0.4.11 | 检测脚本的版本检查有 bug（module 对象不是字符串，`json.dumps` 报 `Object of type module is not JSON serializable`），检测脚本误报"未检测到"；应手动验证，不轻信脚本结果就降级到 puppeteer |

---

## 可验证事实清单（经验资产）

1. URL 参数 `m` = `new Date().valueOf().toString()`（13 位时间戳字符串）
2. URL 参数 `f` = `Date.parse(new Date())`（毫秒时间戳，末三位为 000）
3. cookie `m` = 32 位 hex，但是**修改版 MD5** 输出（非标准 MD5）
4. cookie `RM4hZBv0dDon443M` = WAF cookie，约 200 字符 Base64 变种，浏览器生成
5. 第 5 页 UA 必须为 `yuanrenxue`（题目硬性要求）
6. 修改版 MD5 的 4 个轮函数（F/G/H/I）与标准一致，但 T[1]/T[2]/T[22]/T[26]/T[37] 被替换
7. T[22] = `Date.valueOf() - Date.parse()`（动态时间差），T[26] = `Date.valueOf()`（动态时间戳）
8. `$_zw` 指纹数组 27 项，在页面 HTML `<script>` 中构建（非混淆 JS 内）
9. charCode 位移：`-76` 正常分支，`-2331-h.slice(0,1)*2` 反 hook 分支
10. 缺 m cookie 或 RM4hZBv0dDon443M cookie 均返回 `{"error":"token failed"}`
11. 3 次运行签名值不同但加和一致（27616481），签名机制稳定
12. MD5 IV 标准：`0x67452301, -0x10325477, -0x67452302, 0x10325476`
13. 变量绑定：`_0x4e96b4=window, _0x35bb1d=Date, _0x3d0f3f=document, _0x30bc70=String`

---

## 降级信号识别（核心经验）

**当标准哈希算法（MD5/SHA1/SHA256）的常量被篡改时，是纯算→浏览器提取降级的强信号。**

识别方法：
1. 提取哈希算法的轮函数和常量表
2. 对比标准算法的常量（MD5 的 T 表、IV；SHA1 的 H/K 表）
3. 若常量被替换为**动态值**（时间戳、随机数、服务端下发值），纯算法不可还原

本案例的降级决策：
- T[22]/T[26] 含动态时间戳 → 确认无法纯算法还原 → 立即降级到浏览器提取
- 浏览器方案稳定（3 次运行加和一致），无需继续硬啃算法

---

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 9（标准哈希常量被篡改仍坚持纯算） |
| `references/workflow/experience-rules.md` | 规则 10（签名不一致逐环节对比） |
| `cases/vm-sandbox-custom-algo.md` | 自定义算法骨架（本案例为其具体填充，降级到浏览器） |
| `cases/vm-sandbox-chameleon-iwencai.md` | 同为混淆案例，对比 vm 沙箱 vs 浏览器提取的边界 |
