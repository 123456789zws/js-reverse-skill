# Phase 0-5 详细流程

> **触发条件**：执行某个 Phase 不确定具体怎么做时读
>
> 本文档是 SKILL.md Phase 0-5 顶层骨架的展开。所有 case 统一走 ruyipage 网络取证（Step 1）+ RuyiTrace 日志采集（Step 2）两步。

## Phase 0：任务确认 + 环境搭建

### 0.1 任务理解
- 用户提供 cURL/HAR/JS 文件 → 先运行 `node scripts/check_evidence.js --case-dir <case> --url <目标URL> --inputs <材料路径> --markdown` 验证材料真实性，门禁通过后从包中提取信息，跳过 Phase 1 ruyipage 抓包，直接进入参数识别（**仍必须完成 Phase 2 RuyiTrace 日志采集，除非用户提供了 NDJSON**）
- 用户只提供 URL + 参数名（无任何取证文件）→ 走完整 Phase 1 ruyipage 抓包 + Phase 2 RuyiTrace 日志采集；**URL 不是证据，禁止以"用户提供了证据"跳过 trace**
- 两种情况下都需下载目标 JS 文件用于识别反爬类型

### 0.2 信息完整性门禁
- **必填**：目标 URL、目标参数名（可为空，自动识别）
- **必填**：取证证据门禁结果（`check_evidence.js` 输出：Step 1 / Step 2 证据是否具备、可跳过哪些步骤）
- **用户提供时**：目标 API、请求方法、参数位置、成功请求样本、响应特征
- **自动获取时**（Phase 1 ruyipage 抓包填充）：上述字段
- **可选确认**：TLS 客户端、登录态

强制阻断项：
- 未确认授权 / 登录状态：不得尝试绕过登录、验证码、MFA
- 未确认目标参数：skill 列出可疑参数后用户未确认，不得只盯单一参数进入补环境
- 抓包遇到登录/交互/验证码：暂停要求用户补充请求包
- **证据门禁不通过**（仅 URL / 声称材料不存在）：不得跳过取证，必须走完整两步取证

### 0.3 环境检测（自动安装模式）
```
node scripts/check_external_tools.js --markdown
 输出五项检测结果 + nextRequiredInput
 未通过 → node scripts/install_all.js --markdown（输出安装计划）
 用户确认 → node scripts/install_all.js --yes --markdown（自动安装到 <项目根>/tools/）
 安装后重新检测确认五项全部通过
node scripts/precheck_runtime.js（六项纯计算预检）
```
默认安装目录：
- ruyiPage 定制 Firefox runtime：`<项目根>/tools/ruyipage-browsers/`
- RuyiTrace 定制 trace 内核：`<项目根>/tools/RuyiTrace/`

install_all.js 内部流程：检测缺失组件 → pip install ruyiPage requests → python -m ruyipage install → 下载 RuyiTrace.zip 并自动解压 → 重新检测验证。

### 0.4 项目目录创建

case 根目录只允许两个子目录：
```
<case 根>/
├── case/          # 取证材料（原始 JS、请求样本、fixtures、notes、tmp）
└── result/        # 交付物（final.js + 最终项目总结.md + src/）
```

## Phase 1：ruyipage 网络取证（Step 1）

> 用户提供 cURL/HAR/JS 文件（经 `check_evidence.js` 门禁确认）时，跳过 1.1 抓包，从 1.2 开始。仅提供 URL → 必须从 1.1 开始完整抓包。

### 1.1 ruyipage 抓包（一次抓完，不复抓）
1. 运行通用脚本 `python scripts/forensic_ruyipage.py --url <目标页> --targets "<接口关键词>" --browser-path <定制Firefox>`（内部已用 `targets=True` 抓全部包并落盘 JS 到 `case/js/original/`，不必手写 `page.capture.start`）
2. 收集：网络包（HAR）、Cookie、JS 文件 URL、响应状态码
3. 下载目标 JS 文件到 `case/js/original/`
4. 写入指纹基线 `case/notes/fingerprint-baseline.json`
5. 抓包结果复用到 Phase 2 RuyiTrace 采集 + Phase 3 日志分析，**不重抓**

### 1.2 反爬类型识别
基于抓包结果判断：
- 响应码 412 循环 → 签名型 → 补环境
- JS 含 `webmssdk`/`byted_acrawler` → 行为型 → 补环境
- JS 200KB+ + while-switch → JSVMP → 补环境
- JS 含 WASM 加载 → WASM 加密
- JS 含 `_0x` 前缀/obfuscator.io → 纯混淆 → AST 反混淆后判断
- JS <50KB + 标准 md5/aes 特征 → 纯算还原

### 1.3 加密参数识别
对比多次请求，区分：
| 参数类型 | 特征 | 处理方式 |
|---|---|---|
| 固定值 | 每次请求相同 | 直接硬编码或从页面提取 |
| 动态值 | 有规律变化 | 判断变化因子（时间戳、页码、随机数、自增） |
| 加密值 | 看似随机 | 根据长度、字符集、格式判断算法类型 |

### 1.4 四层链路定位（source→entry→builder→writer）
| 层级 | 含义 | 常见证据 |
|---|---|---|
| source 数据源 | 参与签名的输入材料 | URL、Query、Body、Cookie、localStorage、时间、随机数、指纹 |
| entry 加密入口 | 直接返回 sign/token 的函数 | 调用栈、搜索参数名、断点命中、sourcemap |
| builder 请求构造 | 把入口结果拼到请求对象 | axios/fetch 封装、SDK request 方法、拦截器 |
| writer 请求写入 | 最终写入网络请求的位置 | fetch、XHR.send、setRequestHeader、URLSearchParams、cookie |

**只有记录到 `writer`，才能确认"找到的函数"确实影响目标请求。**

入口定位：ruyipage 网络包 → JS 文件定位 → 待 Phase 2 RuyiTrace NDJSON stack 定位签名函数

## Phase 2：RuyiTrace 日志采集 + 源码分析（Step 2）

> 基于 Phase 1 ruyipage 抓包结果（JS 文件 + 网络包），RuyiTrace 采集运行时日志。

### 2.1 RuyiTrace NDJSON 采集（核心证据源，采集方式先让用户选择）
- 手动 trace：用户用 RuyiTrace 采集后提供 NDJSON → `node scripts/capture_ruyitrace_log.js --input <日志> --case-dir case --markdown` 导入生成摘要（适合需登录/验证码/复杂交互）
- 自动 trace：`node scripts/capture_ruyitrace_log.js --url <目标页> --case-dir case --ruyitrace-home <RuyiTrace-dir> --import-after --markdown` 自动启动 trace Firefox 采集（需 RuyiTrace 完整安装）
- 导入摘要：`scripts/import_ruyitrace_log.js` 生成 `notes/ruyitrace-summary.md`
- 详见 `references/workflow/trace-flow.md`

### 2.2 关键词搜索 + 调用链追踪
```
在 JS 文件中 Grep:
  - 参数名 / encrypt / sign / md5 / aes
  - 按 NDJSON stack.file/line/col 聚合定位具体 JS 文件和函数
  - 按 api 调用频率和时间邻近度定位签名入口
```

常用搜索词：
```
sign / token / x-s / a_bogus / h5st
setRequestHeader / fetch( / XMLHttpRequest
JSON.stringify / localStorage.getItem / document.cookie
crypto / encrypt / decrypt
```

### 2.3 混淆识别与还原
| 混淆类型 | 特征 | 还原策略 |
|---|---|---|
| OB 混淆 | `_0x` 前缀变量、十六进制字符串数组 | 字符串解密 + 变量重命名 |
| 控制流平坦化 | `switch-case` 状态机、`while(true)` 循环 | 追踪状态转移还原执行顺序 |
| eval/Function 打包 | `eval(...)` 或 `new Function(...)` 包裹 | Hook eval/Function 拦截源码 |
| JSVMP | 200KB+ 文件、自定义解释器 | 不反编译，走路径 A 或路径 D |

需要 AST 反混淆时用 `assets/ast-patterns/`（14 流水线步骤：7 通用 + 7 站点专用）。

### 2.4 JSVMP 识别
**严禁反编译字节码**，走路径 A（算法追踪）或路径 D（环境伪装/补环境）。

识别标志：
- 超大 JS 文件（200KB+），函数/变量名完全无意义
- 包含自定义解释器循环：`while(true) { switch(opcode) { ... } }`
- 改写或劫持浏览器原生 API（XHR / fetch / Cookie）
- 超大数组（字节码）+ 指针变量 + 栈操作 + 跳转指令

### 2.5 静态分析关键判断清单
- [ ] 参数是单独加密还是整条请求链被接管
- [ ] 页码、时间戳、随机数、Cookie、UA、环境变量是否参与运算
- [ ] 是否存在响应解密（接口返回加密字符串而非明文 JSON）
- [ ] 是否存在运行时代码生成（`eval` / `new Function`）
- [ ] 是否有前置请求（预热接口、Token 获取接口）
- [ ] 是否有请求链改写（拦截 XHR/fetch 添加签名头）

## Phase 3：日志逆向分析

### 3.1 环境指纹采集（核心突破点）
```
RuyiTrace NDJSON 狙击式采集:
  capture_ruyitrace_log.js 自动抓 NDJSON
  → import_ruyitrace_log.js 生成摘要
  → 按 api/stack.file/line/col 定位环境依赖
  → 只补 trace 证明 JSVMP 真的读了的 API（狙击式补环境）
```

### 3.2 环境模块分类
将 NDJSON 日志分类到：
- Navigator / Screen / Location / Storage
- Canvas / WebGL / Audio / WebRTC
- Crypto / Performance / Date / Random
- DOM / Element / CSS / Layout
- Worker / Service Worker / iframe

### 3.3 Hook 验证（13 Hook 模板见 `references/hooks/hook-templates.md`）
- 纪律：**只观察不篡改，命中后尽快移除**

### 3.4 多次请求对比
≥3 次请求，确认变化因子（时间戳/随机数/签名值）

## Phase 4：算法还原 / 补环境

### 4.1 编码原则
1. 先通后全：先成功请求第 1 条数据，再扩展
2. 优先纯算法：Node.js `crypto` / Python `hashlib` + `pycryptodome`
3. 中间值对比：打印关键中间值，与浏览器逐一比对
4. 配置外置：密钥/Headers/JS 代码写入 `case/notes/`
5. NativeProtect 保护：补环境初始化阶段默认启用
6. UA 自洽：环境补丁每项与 `navigator.userAgent` 声明一致
7. 环境伪装最小化：只补经 trace/hook 证明 JSVMP 真的读了的 API

### 4.2 解法模式（基于日志证据选择）

| 模式 | 适用场景 | 模板 |
|---|---|---|
| A 纯算法还原 | 日志显示算法可完整提取 | `templates/node-request/` 或 `templates/python-request/` |
| B vm 沙箱执行 | 日志显示服务端返回混淆 JS 生成 Cookie/Token | `templates/vm-sandbox/` |
| C WASM 加载 | 日志显示加密逻辑在 WebAssembly 中 | `templates/wasm-loader/` |
| D 环境伪装 | 日志显示 JSVMP 深度绑定环境指纹 | 见 `references/env/`（默认纯 vm，按需升级 sdenv） |

### 4.3 补环境子流程（路径 D）
基于 RuyiTrace NDJSON 证据补环境，详见 `references/env/` 目录下文档。

补环境工作量取决于日志显示的环境依赖复杂度：
- 算法可纯算提取 → 通常不需要补环境
- JS 可 vm 执行但需少量环境 stub → 最小 sandbox
- JSVMP 需完整浏览器环境 → 全量补环境 + NativeProtect

### 4.4 配置文件策略
| 产物类型 | 存放位置 |
|---|---|
| Cookie 字符串 | 命令行注入 `--cookie`，不写入文件 |
| 长参数样本 | `case/notes/params_sample.json` |
| 提取的 JS 代码 | `case/js/extracted/sign_logic.js` |
| Headers 模板 | `case/notes/headers.json` |
| 响应样本 | `case/notes/response_sample.json` |

## Phase 5：验证与交付

### 5.1 运行验证（默认向真实 API 发请求）
- 运行 final.js/final.py，**默认向真实 API 发请求**，确认返回正确数据（200 + 正确响应体）
- ≥5 次真实 API 请求交叉验证签名稳定性
- **仅当用户明确指定"只输出参数不验证"时**，才跳过真实请求（`--sign-only` / `--no-real-request`）

### 5.2 交付门禁（分级：解题必需 vs 交付加分）

**解题必需**（不通过不交付）：
- 一个执行入口 / 禁止任何浏览器自动化代码 / **≥5 次真实 API 请求验证通过** / `result/最终项目总结.md`
- case 根目录只有 `case/` 和 `result/` 两个子目录，无散落脚本
- **API 验证是默认行为**：`final.js` 默认发真实请求。仅用户明确说"只输出参数"时，才用 `--sign-only` 跳过请求

> `最终项目总结.md` 不生成 = 任务未完成。

### 5.3 默认交付门禁（解题必需，每次必跑）

- `node scripts/check_final_artifact.js --case-dir . --markdown` —— 检查 result 目录结构 / 唯一执行入口 / 无浏览器自动化代码 / 无硬编码或复用样本加密参数值 / **`result/最终项目总结.md` 存在且包含默认 8 章** / **`result/经验沉淀-<站点>.md` 存在** / result 无临时产物
- `--case-dir` 指项目根目录（其下应有 `case/` 和 `result/` 两个平级子目录），默认当前目录
- 失败必须修复后重跑，直到 clean=true 才算交付完成
- 仅当用户明确说"不生成最终总结"时，才传 `--no-require-final-summary` 并在输出中记录豁免原因
- 仅当用户明确说"不沉淀经验"时，才传 `--no-require-experience` 并在输出中记录豁免原因
- **TLS 指纹客户端检查支持文档证据豁免**：代码内既无 TLS 兼容客户端又无"不发真实请求"标记时，若最终总结 / 经验沉淀 / notes / 阶段报告中声明"不发真实请求""只输出本地参数"或"目标无 TLS 指纹检测"，则豁免该项门禁，不再要求代码内出现固定标记（符合"交付已验证即说明无 TLS 需求"的判定）
- 阶段报告检查也由本脚本承担：若 `case/阶段报告/` 存在则校验中文命名 + UTF-8 + 含 `01-需求信息确认.md`

### 5.4 交付加分（用户要求"生产级交付"时强制）

- `node scripts/check_final_artifact.js --case-dir . --production --markdown` —— 在默认门禁基础上追加校验最终总结的 9 个生产级附加章节
- Session 模式 / 代码风格检查 / `check_code_quality.js` / `check_fingerprint_fixture.js` / `check_trace_api_coverage.js`
- 完整 23 章总结 / trace 覆盖矩阵 / 选用 sdenv 路径时额外执行 runtime 自检

> 默认只执行 5.2 解题必需 + 5.3 默认交付门禁。用户明确要求"生产级交付"时才执行 5.4 加分项。

### 5.5 最终项目总结
- 默认：精简总结（8 章，模板见 `references/quality/final-summary.md`）
- 用户要求"生产级交付"：追加 14 章附加章节
- 阶段报告：默认不生成，仅多轮复杂补环境 case 或用户明确要求时按需生成

### 5.6 清理（交付前必做）
- 清理 `case/tmp/` 下的调试/抓包/提取脚本
- 确保 case 根目录只有 `case/` 和 `result/` 两个子目录
- 临时 hook/trace/日志/缓存立即清理，不等项目结束

### 5.7 经验沉淀

> **写入位置 = `result/`，不是 skill 内的 `cases/`**：skill 目录在运行期通常只读（部署后不可写），**agent 不得尝试写入 skill 内的 `cases/`**。把内化后的案例经验作为本次交付物写到 `result/`。经验沉淀文档与最终项目总结、final.js 同处 `result/` 目录，是交付物的一部分。

- **默认产出**：任务完成后默认生成 `result/经验沉淀-<站点>.md`（**按 `cases/_template.md` 的 Part 2 格式**），不询问、不跳过；仅当用户明确说"不沉淀经验"时才跳过，并传 `--no-require-experience` 给检查脚本，在最终总结里记录跳过原因
- 内容：题型 / 反爬类型 / 关键踩坑 / 已内化为的编码约束 / 验证结论
- **5.3 默认交付门禁会检查经验沉淀文档**：result/ 下必须存在 `经验沉淀-*.md`，缺失则门禁失败
- **开发者周期回写**：skill 维护者定期把 `result/` 中质量高的经验按 `_template.md` 合并进 skill 的 `cases/` 库；agent 运行期只产出、不回写 skill 目录
