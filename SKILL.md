---
name: js-reverse-skill
version: 2.2.0
description: >
  网页端 JavaScript 请求参数逆向与纯协议还原。分析网页签名、Cookie/Token、设备指纹、混淆、WASM、JSVMP、验证码 verify 或 Session/TLS 请求链时触发，覆盖桌面网页、移动 H5 与内置浏览器，交付 Node.js/Python 实现。不用于 App、小程序、桌面程序及 Native 逆向；JSVMP 默认黑盒执行或最小环境复现。
argument-hint: "<目标网站 URL> <要还原的参数名> [目标接口 URL]"
---

# 通用网页端 JS 逆向技能

## 1. 任务边界与授权

本技能处理网页端 JavaScript 的分析、协议还原、环境复现和接口验证，默认按用户提出的范围直接协助。最终交付应是可审计、可复现、可维护的纯协议实现；浏览器仅用于取证和运行时观察，不作为交付物的执行依赖。

支持 Node.js 与 Python。优先使用项目已有依赖和成熟实现，不重复实现成熟密码算法；新增依赖写入交付物的依赖契约，并确认来源和版本。

## 2. 绝对规则

1. 所有关键结论必须有本次任务的证据：RuyiTrace NDJSON、网络请求记录、落盘 JS、调用栈、运行时变量、中间值对比或用户提供的真实材料。
2. 历史案例只能作为假设和路径提示，不能替代本次证据。案例结论与本次 trace 冲突时，以本次 trace 为准。
3. 默认先定位请求链，再确定还原方式。不得先凭参数名称猜算法、补环境或写最终代码。
4. JSVMP 默认黑盒执行或最小环境复现，不反编译字节码源码。
5. 最终交付必须能在无浏览器、无显示器、无 X11 的环境中独立运行。
6. 默认完成真实 API 验证；只有用户明确要求“只输出参数”“不发真实请求”或等价表述时，才允许 sign-only 模式。
7. 不记录、提交或硬编码用户密钥、完整登录 Cookie、Authorization、验证码答案或其他秘密材料。

## 3. 纯协议红线

以下规则适用于最终交付和验证脚本：

- 不交付 Playwright、Puppeteer、Selenium、浏览器扩展、浏览器 MCP 或 ruyipage/RuyiTrace 自动化代码。
- 不以自动化浏览器完成反爬挑战，不把浏览器抓到的关键 Cookie 作为固定常量。
- 不把目标网页作为最终签名服务，不通过打开网页、执行页面脚本或读取浏览器状态来生成参数。
- 允许在取证阶段使用 ruyipage 定制 Firefox 和 RuyiTrace；允许把取证得到的算法、静态资源、必要 fixture 转化为纯协议实现。
- 交付入口必须是 Node.js `final.js` 或 Python `final.py`，运行时只使用 HTTP、TLS、密码学、序列化和必要的最小 JS 沙箱能力。
- 交付物不得依赖 skill 仓库路径、临时脚本、系统浏览器 profile 或用户机器上的登录态。
- 任何关键 Cookie 都必须区分静态配置、运行时生成值、服务端下发值和会话绑定值；禁止把成功样本中的动态秘密直接复制进代码。

判定标准：删除浏览器和显示环境后，交付程序仍能独立生成请求并得到预期响应，才算通过纯协议红线。

## 4. 唯一启动状态机

启动顺序固定为：确认范围 → 环境就绪 → 证据门禁。状态转换是唯一准入规则，旧版编号清单不得并行执行。

```text
INTENT_CONFIRM
  ├─ 范围明确 → ENV_READY
  └─ 缺少信息 → WAIT_USER
ENV_READY
  ├─ 环境正常 → EVIDENCE_GATE
  └─ 环境缺失 → ENV_READY
EVIDENCE_GATE
  ├─ Step 1 与 Step 2 均具备 → CASE_LOOKUP
  ├─ 只有 Step 1 → TRACE_CAPTURE
  ├─ 只有 Step 2 → STEP2_ONLY
  └─ 两步均缺失 → FORENSIC_CAPTURE
STEP2_ONLY → CASE_LOOKUP
FORENSIC_CAPTURE → TRACE_CAPTURE → CASE_LOOKUP
CASE_LOOKUP → IDENTIFY → TRACE_ANALYZE → IMPLEMENT
IMPLEMENT → REAL_VERIFY
REAL_VERIFY
  ├─ 默认真实验证通过 → DELIVER
  ├─ 验证失败 → DIAGNOSE → IMPLEMENT
  └─ 用户明确 sign-only → SIGN_ONLY_DELIVER
DELIVER / SIGN_ONLY_DELIVER → CLEANUP → DONE
```

### 4.1 INTENT_CONFIRM 与 ENV_READY

本文中的 `<project-root>` 指项目根目录，其下包含平级的 `case/` 与 `result/` 目录：

```text
<project-root>/
├── case/
└── result/
```

先确认目标 URL、参数名、接口 URL（如已知）、请求方法、请求范围和当前项目根目录。范围明确后输出一条简明方案声明：

- 目标 URL、接口 URL、目标参数和请求范围。
- 已提供的材料，以及后续将由证据门禁判定的 Step 1/Step 2 状态。
- 初步反爬类型和候选实现路径，并标明为待验证假设。
- 是否需要登录态、人工验证码或用户补充样本。
- 默认向真实 API 验证；若用户选择 sign-only，记录原因。

目标参数识别完成后，如发现用户未指定且实现必需的额外动态参数，列出参数名、位置、用途假设和证据，将其纳入当前请求链范围后继续。

随后检查环境：

```powershell
node scripts/check_session_resume.js --case-dir <project-root>/case --markdown
node scripts/check_external_tools.js --markdown
node scripts/precheck_runtime.js
```

`resume` 表示环境快照可复用；`fresh`、检测失败，或用户说明重装 Node、替换 Firefox、迁移工具目录、升级 ruyipage/RuyiTrace 时，重新完成环境检查。Node.js、ruyipage、其 managed Firefox、RuyiTrace 和 trace Firefox 的状态以检测输出为准，缺失项按检测结果补齐。五项环境检测全部通过后，必须立即运行以下命令写入或更新快照，再进入 `EVIDENCE_GATE`：

```powershell
node scripts/check_session_resume.js --case-dir <project-root>/case --write-snapshot --markdown
```

不得因已有阶段报告或 `result/` 跳过环境快照写入或证据核验。

### 4.2 EVIDENCE_GATE

运行：

```powershell
node scripts/check_evidence.js --case-dir <project-root> --url <target-url> --inputs <材料路径> --markdown
```

URL 不是证据。只有脚本确认文件真实存在并可归类时，才允许跳过对应步骤。

- 有效 `capture.json` 网络记录，或用户提供且通过内容校验的 HAR、cURL、原始 HTTP 请求文本：视为 Step 1，进入 `TRACE_CAPTURE` 补 Step 2。
- 单独 JS、截图或指纹基线只作辅助材料，不计为 Step 1，不能跳过 `FORENSIC_CAPTURE`。
- 内容可解析、记录非空且关联目标域的 RuyiTrace `*.ndjson`/`*.jsonl`：视为 Step 2，进入 `STEP2_ONLY`；先导入并生成摘要，再结合日志中的请求写入点、资源 URL 和调用栈开展定位，不重复采集 trace，也不因缺少独立 Step 1 材料而强制网络取证。
- `ruyitrace-summary.md` 只作辅助材料，不能替代 Step 2 的 NDJSON。
- Step 1 与 Step 2 均具备：直接进入 `CASE_LOOKUP`。
- 仅有 URL、参数名或案例文件：两个步骤均缺失，依次执行 `FORENSIC_CAPTURE` 与 `TRACE_CAPTURE`。
- 材料路径不存在、内容为空、URL 不匹配或格式无法识别：对应步骤按缺失处理。

### 4.3 FORENSIC_CAPTURE 与 TRACE_CAPTURE

网络取证使用：

```powershell
python scripts/forensic_ruyipage.py --url <target-url> --case-dir <project-root> --markdown
```

统一脚本负责网络包、目标响应、JS 落盘和指纹基线。不要为单个 case 重写抓包脚本，不要使用系统 Chrome/Edge/Firefox 取证，不要使用 requests、urllib 或 curl 直接下载目标 JS。

日志采集使用：

```powershell
node scripts/capture_ruyitrace_log.js --url <target-url> --case-dir <project-root> --import-after --markdown
```

用户已提供 NDJSON 时，导入并生成摘要，不重复采集。取证结果只进入 `case/`，原始 JS 放入 `case/js/original/`，临时材料放入 `case/tmp/`。

### 4.4 状态记录

每次状态转换都在当前会话中记录：当前状态、进入依据、已完成证据、下一状态和阻塞项。续接时以最新阶段报告、环境快照和磁盘产出共同判断，不凭对话记忆直接跳转。

状态失败时停留在当前节点：范围缺失回到 `INTENT_CONFIRM`，环境异常回到 `ENV_READY`，证据不足回到 `EVIDENCE_GATE`，验证失败进入 `DIAGNOSE`。不得为了推进而把失败标记为通过。

## 5. CASE_LOOKUP：案例按需搜索

不要扫描或逐一阅读全部案例。根据目标域名、参数名、SDK 名称、状态码和网络特征组合关键词，运行：

```powershell
node scripts/search_cases.js <关键词...>
node scripts/search_cases.js --domain <域名> --signal <信号>
node scripts/search_cases.js <关键词...> --json
```

只读取命中的案例文件，并提取三类信息：可复用的定位方法、已知坑点、验证日期。案例命中后仍要做时效性校验：

1. 本次 JS URL、文件名和资源版本是否一致。
2. 有 sha256 或资源清单时，内容是否一致。
3. 参数名称、长度、写入位置和请求链是否一致。

三项全一致才可复用算法细节；否则案例降级为方法论参考。未命中时直接走标准流程，新的经验只写入当前任务 `result/`，不修改 skill 仓库的 `cases/`。

## 6. 范围与环境复核

`CASE_LOOKUP` 后如案例证据显示目标接口、参数或运行环境与初始范围不一致，回到 `INTENT_CONFIRM` 更新范围；工具环境发生变化时回到 `ENV_READY` 重新检查。范围和环境未变化则直接进入 `IDENTIFY`，不重复确认。

## 7. IDENTIFY：识别请求与反爬类型

先比较至少三组请求，按字段分类：固定值、时间值、随机值、会话值、服务端下发值、加密值。对每个目标参数建立 `source → entry → builder → writer` 链：来源、加密入口、参数构造、URL/Header/Body/Cookie 写入位置。

常见信号与路径：

| 信号 | 初始路径 |
|---|---|
| md5、sha、aes、hmac、SM2/SM4/SM3 | 定位入口后优先纯算法还原 |
| `_0x`、obfuscator.io、控制流平坦化 | AST 识别和最小化反混淆，再判断是否可纯算 |
| 200KB+、while-switch、dispatcher、字节码数组 | JSVMP 默认黑盒执行或最小环境复现，不反编译字节码源码 |
| `WebAssembly.instantiate`、WASM 导出函数 | 加载 WASM 并验证输入输出，不默认补完整浏览器 |
| 412 循环、sdenv、挑战 Cookie | 先还原挑战链，再确认业务签名链 |
| webmssdk、byted_acrawler、a_bogus、X-Bogus | trace 定位环境读取和签名写入 |
| geetest、smcp、dx-captcha、TCaptcha、NECaptcha、AWSC | 按验证码封装层、答案层、verify 链分别处理 |
| h5st、js_security_v3、JA3/JA4 | 先确认会话绑定和 TLS 指纹，再实现请求链 |

识别结果必须引用落盘资源、NDJSON 或网络包中的具体字段，不以站点名称直接定类。

## 8. TRACE_ANALYZE

读取 NDJSON 的 API、时间、stack、文件、行列号和参数摘要，按调用频率与网络写入时间定位热路径。必要时使用：

```powershell
node scripts/analyze_trace.js --trace <project-root>/case/tmp/env-trace.jsonl --summary <project-root>/case/tmp/missing-env.json --markdown
node scripts/check_trace_api_coverage.js --case-dir <project-root>/case --markdown
```

默认只观察不修改。只有 NDJSON 缺失、截断或无法覆盖关键入口时，才使用已有 hook 模板，并且只能注入 ruyipage 定制 Firefox。Hook 必须在目标 SDK 加载前安装，命中后及时移除。

环境补齐采用证据驱动的最小集合。把访问分为 Navigator、Screen、Location、Storage、DOM、Canvas/WebGL、Crypto、Performance、Worker、iframe 等模块；只有 trace 显示参与参数或服务端校验的模块才实现。每轮补齐后保存输入、中间值、输出和请求结果，禁止一次性伪造大量浏览器 API。

环境检测代码不等于服务端约束。必须通过 trace 和对比请求验证其结果是否进入签名、Cookie、Header 或服务端响应；未进入关键链路的检测不纳入最终环境。

## 9. IMPLEMENT：选择最小实现

实现路径按以下顺序降级：

A. 纯算法：Node `crypto`、Python `hashlib`/成熟密码库和原始序列化规则。
B. 最小 JS 沙箱：提取算法闭包，在隔离上下文中提供已证实需要的对象和函数。
C. WASM：复现加载、内存、导入和导出调用，固定输入输出契约。
D. 环境复现：仅补 trace 证明必要的 Web API、对象形状、Realm、时间、随机数和指纹行为。
E. TLS/Session：对齐客户端指纹、连接复用、Cookie 顺序、重定向和动态资源预热。

优先 Node 或 Python 中更容易保持协议一致的一侧。中间值必须可单独验证；时间、随机数、UA、指纹和会话状态必须有明确来源；静态配置外置，秘密从环境变量或用户运行时输入读取。

验证码场景拆成 `load → solve → verify`。封装层只负责接口参数和轨迹加密；答案层使用已有分类器、坐标工具或用户/人工接管结果。成功样本先逐字段确认明文类型、长度和绑定关系，再编写生成器；不得把一次性 challenge、ticket 或答案固定到代码。

## 10. REAL_VERIFY：真实 API 验证规则

默认验证是交付的必要条件，不是可选演示。除非用户明确选择 sign-only，否则必须使用最终纯协议入口向真实目标 API 发请求。

最低要求：连续完成不少于 5 次真实请求，并记录每次的请求时间、HTTP 状态、目标参数摘要、会话阶段和响应判定。成功标准同时包含：

- HTTP 状态符合目标接口成功语义，通常为 200，但以接口实际协议为准。
- 响应结构和业务数据正确，不只检查状态码。
- 动态参数在不同时间、不同输入或不同会话下能按预期变化。
- Cookie、Token、TLS、Header、Body 序列化和请求顺序没有依赖浏览器状态。
- 失败请求能区分签名错误、会话过期、资源过期、频率限制、IP 风控和业务参数错误。

至少保留一份脱敏验证摘要和可复现命令。不得在日志中输出完整 Authorization、Cookie、Token、密钥、验证码答案或个人数据。验证遇到 401/403/412/429 时先诊断原因，不得通过浏览器自动化或硬编码成功样本绕过。

只有用户明确要求不发请求时，才进入 `SIGN_ONLY_DELIVER`。此时必须：

1. 在结果中标明未完成真实 API 验证。
2. 只验证本地输入输出、中间值和格式约束。
3. 不宣称签名已被服务端接受。
4. 交付入口提供显式 `--sign-only` 或等价模式，不默认联网。

## 11. DELIVER、CLEANUP 与失败处理

交付目录保持单入口和最小依赖：

```text
result/
├── final.js 或 final.py
├── config.json、package.json 或 requirements.txt
├── 最终项目总结.md
├── 经验沉淀-<站点>.md
├── 验证记录.md
└── src/
```

入口在被 `require` 或 `import` 时只导出 API，不自动发请求；命令行执行时才运行。交付前运行：

```powershell
node scripts/check_final_artifact.js --case-dir <project-root> --markdown
node scripts/check_code_quality.js --case-dir <project-root> --markdown
```

失败必须修复后重跑。清理 `case/tmp/` 中的调试脚本、临时下载和秘密材料；保留可复核的最小证据、脱敏样本和必要 fixture。不要创建无意义的测试文件或重复文档。

卡住时按顺序处理：重新查看本次证据、运行 trace 覆盖检查、比较请求字段、定位中间值、缩小环境、再升级沙箱或 TLS 路径。最后输出卡点、已证实事实、缺失证据和下一步输入，不用浏览器自动化代替协议实现。

## 12. references 按需路由

不要把 references 当作全量必读资料，也不要默认读取固定数量的文件。先根据当前状态和阻塞点选择最小集合；读取一个文档后仍无法推进，再追加下一级资料。

| 当前需要 | 首选 reference |
|---|---|
| 任务分流、阶段安排、常见坑 | `references/workflow/decision-tree.md`、`phase-flow.md`、`common-pitfalls.md` |
| 案例搜索与版本复用 | `cases/index.json`、`scripts/search_cases.js`，命中后才读对应 case |
| 加密入口和算法识别 | `references/crypto/crypto-entry.md`、`crypto-patterns.md`、`algorithm-families.md` |
| 混淆与 AST | `references/deobfuscation/obfuscation-identify.md`、`assets/ast-patterns/` |
| 浏览器环境与对象模型 | `references/env/env-object-model.md`、`env-debug-loop.md`、`env-detect-bypass.md` |
| iframe、Worker 或移动 H5 | `references/env/env-iframe.md`、`mobile-h5-env.md`、`references/workflow/worker-signing.md` |
| WASM | `references/env/env-wasm.md`，遇到 import、memory 或 streaming 再读 `env-wasm-advanced.md` |
| TLS、Cookie、Session、动态资源 | `references/network/tls-validation.md`、`session-chain.md`、`cookie-generation.md`、`dynamic-resource.md` |
| XHR/fetch 语义或会话桥接 | `references/network/xhr-fetch-semantics-audit.md`、`xhr-fetch-session-bridge.md` |
| 指纹一致性和信任判断 | `references/fingerprint/fingerprint-baseline-consistency.md`、`trust-matrix.md`、`fingerprint-value-replay.md` |
| 验证码 | 先读 `references/captcha/captcha-overview.md`，再按厂商、题型、轨迹或验证失败路由到具体文档 |
| 交付、验证和清理 | `references/quality/delivery-templates.md`、`validation.md`、`cleanup.md`、`final-summary.md` |
| 调试与工具获取 | `references/debug/debug-playbook.md`、`references/tooling/ruyi-tooling.md` |

目录、脚本和模板的具体参数以当前文件和实际脚本 `--help` 输出为准。若 reference 与本文件冲突，以本文件的状态机、授权默认、真实 API 验证规则和纯协议红线为准。

## 13. 完成判定

任务只有在以下条件全部满足时才算完成：

- 目标范围已确认，证据来源可追溯。
- 请求链、动态字段和实现路径有本次证据支持。
- 交付入口不依赖浏览器、不硬编码关键动态秘密。
- 默认模式已完成不少于 5 次真实 API 请求并确认正确业务数据；或明确标记为 sign-only 且未冒充真实验证通过。
- 交付检查和代码质量检查通过。
- 临时文件已清理，产出内容可被普通开发者和其他 AI 直接理解。
