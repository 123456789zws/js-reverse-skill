# 题型决策树

> **触发条件**：不确定走哪个路径、哪个还原模式时读

## 6 题型决策表

| 题型 | 特征 | 还原路径 | 工具栈 |
|---|---|---|---|
| 1. 纯算法 | 算法可纯算提取（不管几个参数，不管有无混淆） | A 纯算还原 | ruyipage 取证 + RuyiTrace 定位 + Node.js crypto 实现 |
| 2. 混淆 JS | OB/CFF/eval，无 JSVMP | AST 反混淆 + 纯算/vm沙箱 | ruyipage 取证 + RuyiTrace 定位 + AST 反混淆后按算法可提取性判断 |
| 3. 自定义算法 | 算法不可直接提取（自定义MD5/混淆无法静态还原） | B vm 沙箱执行原 JS | ruyipage 取证 + RuyiTrace 定位 + vm 沙箱 |
| 4. WASM 加密 | 加密逻辑在 WebAssembly | C WASM 加载 | ruyipage 取证 + RuyiTrace 定位 + WASM 加载（不需补环境） |
| 5. JSVMP 行为型 | webmssdk / byted_acrawler，200 正常，JS 需完整浏览器环境 | D 环境伪装 | ruyipage 取证 + RuyiTrace 采集 + 补环境 |
| 6. JSVMP 签名型 | 瑞数 / Akamai，412 循环，JS 需完整浏览器环境 | D 补环境（sdenv） | ruyipage 取证 + RuyiTrace 采集 + sdenv 补环境 |

## 6 阻塞点

遇到以下情况必须暂停，不能继续（**仅 阻塞点 #5 有例外，见下**）：

| 阻塞点 | 原因 | 解除方式 |
|---|---|---|
| 1. 未确认取证模式 | 用户未选择 ruyipage+RuyiTrace 或手动取证 | 让用户选择（Phase 0.2） |
| 2. 未确认 TLS 客户端 | 需要发真实请求但未选客户端 | 让用户选择（Phase 0.2） |
| 3. 未确认目标参数 | 只盯用户给的参数，没列全候选 | Phase 1.3 列全候选让用户确认 |
| 4. 未确认登录/授权 | 试图绕过登录/验证码 | 暂停让用户手动登录 |
| 5. 工具不可用 | ruyipage/RuyiTrace 未安装，且**用户未提供任何材料** | 暂停让用户安装；但若用户已提供 JS/cURL/HAR（白名单③），转「用户手动取证」模式继续，不暂停 |
| 6. 最终方案违反红线 | 滑向浏览器自动化作为最终交付 | 回到降级梯度逐级尝试 |

> **阻塞点 #5 例外（合规降级）**：取证工具链（ruyipage/RuyiTrace）整体不可用时，**不强制暂停**——只要用户手动提供了 JS 文件 / cURL / HAR（白名单③合法来源），即可跳过 Phase 1 ruyipage 抓包，直接进入参数识别 + 静态分析，并以「Node 直连真实接口、服务端 `code:0` 反证」作为正确性证据（坑#8）。此路径合规，但**必须在 `result/经验沉淀-<站点>.md` 写明取证偏差**（未走 ruyipage/RuyiTrace、证据来源为手动材料 + 黑盒反证）。注意：该降级路径的前提是目标接口无登录态要求，可直接用真实响应校验还原结果。

## JSVMP 路径选择决策树

> **核心原则**：路径选择基于反爬类型直接决定，不基于"快速测试 30 分钟"。

```
识别到 JSVMP（200KB+ / while-switch / 字节码数组）
  │
  ├─ 反爬类型判断（Phase 1 ruyipage 抓包后识别）
  │   ├─ 412 循环 → 签名型（瑞数/Akamai）
  │   │   → 直接路径 D 补环境（sdenv 纯 Node.js）
  │   │   → 只能走源码级插桩（AST mode）
  │   │   → 前三板斧禁用（会破坏签名）
  │   │
  │   └─ 200 正常 → 行为型（抖音/TikTok）
  │       → 直接路径 D 环境伪装（搬运 SDK + 补环境）
  │       → 四板斧全开
  │       → 路径 D 是标准打法，不存在"先 A 后 D"
  │
  ├─ JSVMP 仅生成签名参数（不劫持请求链路）？
  │   ├─ Hook 确认使用标准算法 → 路径 A 纯算还原
  │   ├─ 算法完全自定义 + 环境依赖重 → 路径 D（补环境）
  │   └─ 路径 B/D 已跑通，且参数为 env-free 确定性函数（同输入同输出、不依赖时间戳/随机数/环境指纹）
  │       → 用已跑通的 vm 输出当 oracle，反向测 md5 / hmac / 标准哈希 + 固定常量假设（**严禁反编译字节码**，只做黑盒 oracle 反测）
  │       → 命中「跨多组 body 输出一致」的假设 → 升级为路径 A 纯算还原（如 QQ音乐 sign：env-free 确定函数，纯算替换 28KB VM，同时去掉环境伪装）
  │
  └─ 算法可从源码完整提取（无 JSVMP）→ 路径 A 纯算还原
```

**路径选择总结**：
- 签名型 JSVMP（412）→ 路径 D（sdenv 补环境）
- 行为型 JSVMP（200+webmssdk）→ 路径 D（补环境）
- 算法可纯算提取（无 JSVMP）→ 路径 A
- 算法不可提取但 JS 可 vm 执行（无 JSVMP）→ 路径 B（vm 沙箱）
- WASM 加密 → 路径 C（WASM 加载，不补环境）
- JSVMP 不确定时 → 路径 D（环境伪装成功率高，是 JSVMP 的标准打法）
- JSVMP 仅生成签名参数且 env-free 确定性 → 路径 B/D 跑通后，用 vm 输出当 oracle 反测、升级为路径 A（可选优化，严禁反编译字节码）

## 反爬类型识别

### 签名型反爬（环境即签名）
- **特征**：redirect_chain 反复 412/302 → 200；加载 `sdenv*.js` / `acmescripts*.js`；`FSSBBIl1UgzbN7N` / `NfBCSins2OywS`
- **典型**：瑞数 / Akamai / Shape Security
- **路径**：路径 D 补环境（sdenv 纯 Node.js）

### 行为型反爬（参数签名 + 拦截器）
- **特征**：HTTP 200 正常加载；加载 `webmssdk` / `byted_acrawler`；签名参数 X-Bogus / a_bogus
- **典型**：TikTok / 抖音 / 字节系
- **路径**：路径 D 环境伪装（补环境，JS 需完整浏览器环境）

### 纯混淆（无环境检测）
- **特征**：`_0x` 大量前缀 / obfuscator.io / 控制流平坦化
- **路径**：AST 反混淆 + 通用流程（按算法可提取性选择路径 A 或 B）

### WASM 加密
- **特征**：加密逻辑在 WebAssembly 中，JS 调用 WASM 导出函数
- **路径**：路径 C WASM 加载（不需补环境）

### 识别标准动作
```
第一步：ruyipage navigate(url) 不加任何 hook → 读 redirect_chain + final_status
第二步：按特征判断（412循环=签名型 / webmssdk=行为型 / _0x=纯混淆 / WebAssembly.instantiate=WASM）
第三步：JSVMP 类型不确定时，对照 RuyiTrace NDJSON 的 api 调用频率和 stack 分布
```

## 模式选择矩阵

| 模式 | 适用场景 | 模板 |
|---|---|---|
| A 纯算法还原 | 算法可完整提取（不管几个参数） | `templates/node-request/` 或 `templates/python-request/` |
| B vm 沙箱执行 | 算法不可直接提取，但 JS 可 vm 执行 | `templates/vm-sandbox/` |
| C WASM 加载 | 加密逻辑在 WebAssembly 中（不需补环境） | `templates/wasm-loader/` |
| D 环境伪装 | JS 需完整浏览器环境才能执行（JSVMP） | 见 `references/env/` |

## 语言选择策略

| 维度 | Node.js | Python |
|---|---|---|
| 加密逻辑复杂度 | 自定义逻辑可直接 `vm` 沙箱执行 | 标准算法直接用库还原 |
| JSVMP 场景 | vm 可直接加载 | 需 `execjs` 桥接 |
| TLS 指纹需求 | 需额外配置（curl-cffi-node） | `curl_cffi` 一行搞定 |

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | JSVMP 路径 A vs 路径 D 决策 |
| `cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md` | 双签名 = 双通道拦截决策 |
| `cases/jsvmp-ruishu6-cookie-412-sdenv.md` | RS6 签名型反爬 → 补环境 |
| `cases/universal-vmp-source-instrumentation.md` | VMP 题型判定 + 路径 A/D 决策 |
