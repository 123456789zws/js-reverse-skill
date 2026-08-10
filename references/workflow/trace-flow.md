# trace 流程：ruyipage 网络取证（Step 1）+ RuyiTrace 日志采集（Step 2）

> **触发条件**：执行 FORENSIC_CAPTURE → TRACE_CAPTURE 取证/采集时读。本文档是两步取证流程的展开，所有 case 一律走此路径。

## 总览

```
Step 1: ruyipage 网络取证（FORENSIC_CAPTURE）
  → 抓网络包（HAR）+ 下载 JS 文件 + Cookie + 指纹基线
  → 建立网站轮廓，识别反爬类型，定位加密参数

Step 2: RuyiTrace 日志采集（TRACE_CAPTURE）
  → 采集 NDJSON 运行时 DOM/JS API 调用日志
  → 环境指纹采集，调用链追踪，补环境证据
```

这两步是 ruyiTrace 官方提示词模板的标准流程，两者互补：
- ruyipage 提供网络包和 JS 文件（"网站轮廓"）
- RuyiTrace 提供运行时日志（"DOM/JS API 调用细节"）

## ruyipage 取证流程

### 启动硬约束

| 约束 | 要求 |
|---|---|
| 定制内核 | 必须显式使用已验证的 ruyiPage 定制 Firefox runtime；不得使用系统 Firefox fallback |
| 有头模式 | 必须 `headless(False)` 或等价有头模式；不要用 headless 做高风控取证 |
| 独立 Profile | 使用本 case 专用临时 `user_dir` / profile，不复用脏 profile |
| 智能指纹 | 默认调用 `opts.smart_fingerprint(require_country=None, base_dir=..., userdir=...)`；如果地理探测失败，要求安装 `requests` 或提供 `manual_geo`，不要静默跳过 |
| 仿真注入 | 如果 `smart_fingerprint()` 返回 `ctx`，创建页面后必须执行 `ctx.apply_emulation(page)` |
| 指纹一致性 | 第一次成功取证后写入 `case/notes/fingerprint-baseline.json` 和 `baselineId`；后续复用同一 `base_dir` / `userdir`，不要每次随机新指纹 |
| 拟人动作 | 设置 `set_human_algorithm("windmouse")` 或 `"bezier"`，优先使用拟人滚动 / 点击触发业务动作 |
| 取证时机 | `page.capture.start(...)` 必须在 `page.get(...)` 之前执行 |
| 自检 | 导航后检查 `navigator.webdriver`，期望为 `false`；若为 `true`，判定当前取证不合格 |
| 验收 | 目标接口必须捕获到非失败响应；对跨域接口不要把单独的 `OPTIONS` preflight 当作业务取证成功 |
| isTrusted | 点击、拖拽、鼠标、键盘、滚动优先使用原生 BiDi / human actions；确需 JS 构造事件时必须带 `ruyi: true` |

### 取证步骤

1. 检查 ruyiPage 包、`requests` 依赖和 Firefox runtime，并确认 runtime 是 ruyiPage 定制 Firefox。
   - 如果只检测到系统 Firefox fallback，立即暂停，不启动浏览器。
   - 如果已找到定制 Firefox 但不是默认解析路径，启动时必须显式指定 `browser_path` / `set_browser_path`。
   - 如果缺少 `requests`，必须安装依赖或让用户提供 `manual_geo`；不要静默跳过智能指纹。
2. 按启动硬约束启动 ruyipage；任一硬约束失败时，停止并报告，不要继续取证。
3. 确认是否需要登录；需要登录时让用户手动完成。
4. 使用有头模式打开页面。
5. 触发最少量必要业务动作。
6. 收集：
   - Network / cURL / HAR。
   - JS bundle / chunk / sourcemap URL。
   - Cookie、本地存储键名、请求头、响应状态。
   - source / entry / builder / writer 链路证据。
7. 单个取证动作完成并沉淀必要结论后，立即清理临时截图、失败下载、临时日志和无登录态 profile；登录态 profile 单独询问用户是否保留。

### 取证：首选通用脚本（不要手写）

直接运行 skill 通用脚本 `scripts/forensic_ruyipage.py`，它会自动满足下方所有硬约束，并用 `targets=True` 抓全部包（事后从 `steps` 过滤，避免漏掉 JS 文件）：

```bash
python scripts/forensic_ruyipage.py --url <目标页> --targets "pc_home_feed" --browser-path <定制Firefox> --markdown
```

仅在复杂多步交互超出脚本参数（`--click` / `--scroll` / `--manual-pause`）能力时才手写，且必须：用 `targets=True` 抓全部包、`page.capture.wait(count=1)` 取单包、`page.capture.steps` 读全部包、`CapturePacket.to_dict()` 取响应体。详见 `references/tooling/ruyi-tooling.md` 的“逃生舱”小节。

只有当 `node scripts/check_external_tools.js --markdown` 显示"默认解析路径是否为定制 Firefox：是"时，才可直接 `FirefoxPage()` 或 `launch(headless=False)`。否则必须显式指定已验证的定制 Firefox 路径。

### 取证验收标准

- JD `pc_home_feed` 类接口：至少捕获到 URL 包含 `pc_home_feed` 的 2xx 响应，并能看到请求 URL 中的加密 / 风控参数，例如 `h5st`。
- 美团外卖 `shopList` 类跨域接口：必须区分 `OPTIONS` preflight 与真实业务请求；只有捕获到非 `OPTIONS` 的 2xx `shopList` 响应，才算取证成功。若返回登录 / Yoda / 401 风控信息，应按"需要登录 / 风控验证"流程暂停，不要宣称已绕过。

## RuyiTrace 日志采集流程

用户选择 RuyiTrace 后，采集方式由用户选择（二选一，已选择后沿用；切换需再次确认）：手动 trace（用户用 RuyiTrace 采集后指定日志）或自动 trace（脚本自动启动 trace Firefox 捕获）。

### 方式一：自动 trace

检测到 `RuyiTrace.exe`、定制内核 `firefox(.exe)` 和 `RUYI_DOMTRACE.txt` 完整后（新版 2.5+ 位于 `resources/kernel/`，旧版 1.x 位于 `firefox/`），可使用随包脚本自动启动 RuyiTrace 的 trace Firefox，并通过 `MOZ_DOM_TRACE` 环境变量写出 NDJSON：

```bash
node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir case --ruyitrace-home <RuyiTrace-dir> --dry-run --markdown
node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir case --ruyitrace-home <RuyiTrace-dir> --duration 90 --import-after --markdown
```

执行要求：

1. 自动创建或使用 `case/ruyi-trace/logs/` 作为日志目录，使用 `case/tmp/ruyitrace-profile/` 或用户确认的临时 Profile。
2. 使用 RuyiTrace 随包 trace Firefox，而不是普通系统 Firefox、普通 Playwright 或 ruyiPage 的 Firefox runtime。
3. 设置 `MOZ_DOM_TRACE=1`、`MOZ_DOM_TRACE_FILE=<case trace file>`、`MOZ_DOM_TRACE_LIMIT=<limit>` 和 `MOZ_DISABLE_LAUNCHER_PROCESS=1`。
4. 打开目标页面后触发最少量必要业务动作；如果需要登录、验证码、MFA、设备验证或权限确认，暂停让用户在该 trace Firefox 中手动完成，再继续采集。
5. 自动 trace 结束后，立即运行 `import_ruyitrace_log.js` 导入日志、生成 `notes/ruyitrace-summary.md`，并检查长字段截断风险。
6. 如果自动 trace 没有生成 NDJSON，先记录失败原因和已执行命令，再转手动 trace（方式二）；不要把"没有日志"误写成目标没有环境访问。

自动 trace 成功后继续：

```bash
node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir case --truncation-threshold 3900 --markdown
```

### 方式二：手动 trace（用户指定日志）

适用场景：用户选择手动 trace；或自动 trace 启动失败 / trace Firefox 无法写日志 / 需登录验证等复杂交互 / 日志未覆盖目标参数生成路径时转手动。

手动流程：

1. 打开 `RuyiTrace.exe`。
2. 填写启动页面。
3. 选择日志目录，建议选择当前 case 的 `ruyi-trace/logs/` 或用户指定目录。
4. 点击"开始采集"。
5. 在浏览器中正常浏览并触发目标指纹 / 加密参数生成逻辑。
6. 点击"停止采集"。
7. 找到 `trace_<时间戳>_<PID>.ndjson`，将路径提供给 AI / 直接用脚本导入：

```bash
node scripts/capture_ruyitrace_log.js --input <trace.ndjson> --case-dir case --markdown
```

该命令内部调用 `import_ruyitrace_log.js`：把日志复制到 `case/ruyi-trace/logs/`、生成 `notes/ruyitrace-summary.md`、检查长字段截断风险。如需调整截断阈值，直接使用导入脚本：

```bash
node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir case --truncation-threshold 3900 --markdown
```

高级手动启动方式仅在用户理解环境变量时使用：

```cmd
set MOZ_DOM_TRACE=1
set MOZ_DOM_TRACE_FILE=<trace-output.ndjson>
set MOZ_DOM_TRACE_LIMIT=<max-lines>
set MOZ_DISABLE_LAUNCHER_PROCESS=1
<ruyitrace-firefox.exe> -no-remote -new-instance <target-page-url>
```

可选环境变量：

| 变量 | 用途 |
|---|---|
| `MOZ_DOM_TRACE=1` | 开启 trace |
| `MOZ_DOM_TRACE_FILE=<path>` | 输出路径，PID 自动追加 |
| `MOZ_DOM_TRACE_LIMIT=<n>` | 单进程行数上限 |
| `MOZ_DOM_TRACE_PTYPE=<list>` | 启用 trace 的进程类型 |
| `MOZ_DISABLE_LAUNCHER_PROCESS=1` | Windows 下避免 launcher 提前退出 |

## RuyiTrace 长字段截断保护

RuyiTrace NDJSON 适合作为高保真环境访问日志，但长字符串字段可能因工具显示或记录限制被截断。典型风险是某个加密参数、长 token、长 Cookie、请求 body、dataURL 或大型对象序列化值真实长度为数万字符，但日志中只保留约 4000 字符。

硬性规则：

- 导入 NDJSON 时必须运行带截断检测的脚本，默认阈值为 3900：

```bash
node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir case --truncation-threshold 3900 --markdown
```

- 任何字符串字段长度达到或接近阈值时，统一标记：
  - `truncationSuspected: true`
  - `visibleLength: <日志中可见长度>`
  - `minLength: <日志中可见长度>`
  - `actualLength: unknown`
- 不得写"该加密参数长度为 4000"。只能写"RuyiTrace 可见长度为 4000，疑似被截断，真实长度未知，至少 4000"。
- 不得把 RuyiTrace 中的长字段可见值直接作为 fixture 期望值或最终参数值。
- 如果该字段影响签名、指纹回放或最终请求验证，必须从以下来源补采完整值：
  1. HAR / cURL / Network 完整请求。
  2. ruyiPage `collect_bodies=True` 网络抓包。
  3. 专用 Hook 对 writer 或加密入口做分片落盘，并记录完整长度、SHA256、前后片段。
  4. 最终 Node.js signer 输出，并与浏览器样本的完整长度或 hash 对比。
- 写入 `notes/missing-env-priority.md`、阶段报告或最终总结时，必须区分"RuyiTrace 未截断可用值""RuyiTrace 可见但疑似截断值"和"其他来源补采完整值"。
- 对 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何、`navigator`、`screen`、`window`、`document` 等具体值：RuyiTrace 未截断值是优先来源；只要日志缺失、未覆盖或疑似截断，就改用已确认的 ruyiPage / 手动浏览器采样，并记录 `baselineId`、`capturedBy`、完整长度和 hash。不得把 AI 猜值、静态推断或 Node.js 模拟库结果写入最终 fixture。

摘要中出现 `## 长字段截断风险` 时，后续分析要先处理完整值补采问题，再判断参数长度、结构、hash、编码或是否可复现。

## 根据 RuyiTrace 日志逆向分析（TRACE_ANALYZE）

日志导入后按以下顺序分析。所有 case 必须先完成 Step 1（ruyipage 网络包）+ Step 2（RuyiTrace NDJSON），再进入 Node.js 缺失环境追踪：

1. 统计 `api` 调用频率，优先处理高频或和目标参数生成邻近的 API。
2. 按 `stack.file / line / col` 聚合，定位具体 JS 文件和函数。
3. 分类到环境模块：
   - Navigator / Screen / Location / Storage。
   - Canvas / WebGL / Audio / WebRTC。
   - Crypto / Performance / Date / Random。
   - DOM / Element / CSS / Layout。
   - Worker / Service Worker / iframe。
4. 将日志结论写入：
   - `notes/ruyitrace-summary.md`
   - `notes/missing-env-priority.md`：必须包含命中的 `api`、`stack.file`、`line`、`col`、环境模块分类、补齐优先级，以及"RuyiTrace 证据 / Node trace 补充 / 推断"标记。
   - `notes/entry-chain.md`
5. 再进入 Node.js 缺失环境追踪和 fixtures 验证。

遇到环境错误时的处理顺序：

1. 先在 `notes/ruyitrace-summary.md` 中搜索缺失对象、方法或相关模块，例如 `navigator`、`document.cookie`、`localStorage`、`canvas`、`WebGL`、`performance`。
2. 摘要不足时，在原始 `case/ruyi-trace/logs/*.ndjson` 中按目标 JS 文件名、目标 API 关键词、调用栈行列号或时间窗口过滤。
3. 将命中的 `api`、`stack.file`、`line`、`col`、参数摘要写入 `notes/missing-env-priority.md`。
4. 再用 Node trace 复现缺失路径，确认哪些对象需要在 `env.js` 中固化；固化时要同时处理属性描述符、访问器、原型链、函数 / 访问器 / 实例对象 toString 保护。
5. 如果 RuyiTrace 没有相关证据，明确标记"RuyiTrace 未覆盖"，再使用 Proxy trace / Hook / 断点继续排查。
6. 交付前运行 `node scripts/check_fingerprint_fixture.js --case-dir case --require canvas,webgl,audio,dom --markdown`；并手动复核 NativeProtect 保护证据（涉及 `document.all` 时确认 HTMLDDA 近似处理）。

日志可能很大。大文件处理原则：

- 不把完整日志直接写入最终报告。
- 先导入并生成摘要。
- 必要时按行分块，优先分析和目标 API / 参数生成时间段相关的片段。
- 原始日志保存在 case 内，任务结束前询问是否保留。

## RuyiTrace 优先诊断原则

> RuyiTrace NDJSON 不是可选参考，而是逆向分析的优先证据源。必须先完成 Step 1（ruyipage 网络取证）拿到 JS 文件和网络包，再进行 Step 2（RuyiTrace 日志采集）。
>
> **Step 2 不可跳过的硬约束**：本 skill 以 RuyiTrace NDJSON 为主要证据进行分析。用户提供 cURL/HAR/JS 文件只能跳过 Step 1 网络取证，**Step 2 RuyiTrace 日志采集仍必须完成**（唯一例外：用户提供真实存在的 RuyiTrace NDJSON 日志）。仅提供 URL 时两步全做，禁止以"用户提供了证据"为由跳过 trace。任何"跳过取证 / 已具备证据"判定必须先运行 `node scripts/check_evidence.js --case-dir <case> --url <目标URL> --inputs <用户材料> --markdown`，以脚本输出为准。

1. 进入 Node.js 补环境前，必须先确认是否已经采集并导入 RuyiTrace NDJSON。
2. 如果已有 NDJSON，先运行 `import_ruyitrace_log.js` 生成 `notes/ruyitrace-summary.md`，再阅读摘要和必要的原始日志片段。
3. 遇到 ReferenceError、TypeError、输出不一致、缺失指纹对象、静默失败、toString / descriptor / accessor / 原型链 / `document.all` 异常等环境问题时，先回看 NDJSON，而不是直接盲补 `env.js`。
4. 优先按以下证据定位：
   - `api` 调用频率和类别。
   - 与目标参数生成、请求发起、writer 写入时间邻近的调用。
   - `stack.file / line / col` 指向的 JS 文件、模块和函数。
   - navigator / screen / document / storage / canvas / WebGL / audio / crypto / performance / worker / iframe 等环境模块分类。
5. 只有在 NDJSON 缺失、未覆盖当前路径、日志时间段不对应、或日志结论不足时，才使用 `run_with_trace.js`、Proxy trace、Hook 或断点作为补充。
6. 输出补环境计划时，必须标明哪些环境依赖来自 RuyiTrace 证据，哪些只是 Node trace / 推断，避免把推断写成事实。
7. RuyiTrace 长字符串字段可能被截断。导入日志后，如果任意字符串字段达到或接近 4000 字符，必须标记为疑似截断：真实长度写 `unknown`，最小长度写可见长度，不能把 4000 或可见长度解释为加密参数或指纹值真实长度。涉及 WebAPI / 指纹具体值时，未截断 RuyiTrace 值优先；RuyiTrace 未选择、缺失、未覆盖或疑似截断时，必须使用当前用户确认的取证工具在同一 fingerprint baseline 下补采完整值，不能由 AI 猜值。

## trace 覆盖矩阵（8 种 API 状态）

有 Trace 时硬性要求，详见 `references/quality/trace-api-coverage.md`：

| API 状态 | 含义 | 处理 |
|---|---|---|
| 0. 未命中 | Trace 未覆盖 | Node trace 补充 |
| 1. 命中无值 | Trace 命中但未采集值 | 补采 |
| 2. 命中截断 | 值疑似截断 | 补采完整值 |
| 3. 命中完整 | 值完整可用 | 直接用 |
| 4. 命中但 Node 缺失 | Trace 有但 Node 没有 | 补环境 |
| 5. 命中但值不一致 | Trace 值与 Node 不一致 | 修正 Node 值 |
| 6. 命中但 API 缺失 | Trace 命中但 API 不存在 | 实现 API |
| 7. 命中但 API 行为不一致 | API 存在但行为不同 | 修正 API 行为 |

## Replay Trace 对比方法论

在补环境完成后，用无浏览器 JS 引擎执行补环境脚本，生成 replay trace，与浏览器基准 trace 做**逐 API 调用顺序对比**。这是比指纹 fixture 值对比更底层的验证方式——不仅对比值，还对比调用时机和顺序。

### 对比流程

```
浏览器 trace（真环境）
  │
  ├─ 采集 replay 值 + 调用顺序
  │   → traceOut/replay/trace_replay_process_.jsonl
  │
JS 引擎 trace（补环境）
  │
  ├─ Node.js vm 沙箱执行补环境脚本
  │   → 记录 replayValue.api 和调用堆栈
  │
对拍
  │
  ├─ 按 api 名对齐两个 trace 的调用序列
  ├─ 对比每个 api 的返回值
  ├─ 标记差异：值不一致 / 调用顺序不同 / 缺失调用
  │
修复
  │
  ├─ 缺什么 → 从浏览器 trace 取真实值补到补环境
  ├─ 值不一致 → 修正补环境模拟逻辑
  ├─ 调用顺序不同 → 修正初始化时序
  │
复验 → 重新对拍直到一致
```

### 对比维度

| 维度 | 检查内容 | 一致性要求 |
|---|---|---|
| 值一致性 | 同一 api 在两端的返回值 | 严格相等（字符串/数字/布尔）或结构一致（对象/数组） |
| 调用顺序 | api 被调用的先后次序 | 顺序一致（工具链差异导致的无关调用可忽略） |
| 调用次数 | 同一 api 的总调用次数 | 次数一致（多环境预读导致的差异需分析和标注） |
| 缺失项 | 浏览器有但补环境没有的 api | 补全或确认不需要后标注"非关键" |
| 多余项 | 补环境有但浏览器没有的 api | 确认是补环境自身调用后标注"休泄漏" |

### 与本 skill 工具链的映射

- **浏览器 trace**：RuyiTrace NDJSON
- **JS 引擎 trace**：`scripts/run_with_trace.js`（vm 探测模式，输出 env-trace.jsonl）
- **对比脚本**：`scripts/compare_fixture.js`（值对比）+ 手动对比调用顺序
- **指纹 fixture**：`scripts/check_fingerprint_fixture.js`（指纹值对比的补充层）

### 注意事项

- standalone 引擎（SpiderMonkey 等）没有 DOM，canvas/navigator/crypto/WebGL 等需要补环境层模拟，真实值来源以浏览器 trace 为准
- Node.js vm 沙箱有宿主泄漏风险（Node 21+ navigator 等），见 `references/network/node-leakage.md`
- 不要追求 100% 调用顺序对齐——浏览器自身预读、优化、事件队列可能导致少量无关差异
- 聚焦于签名计算链路上的 api 调用，非关键路径的差异可标注后跳过

## 验证码场景的 RuyiTrace 覆盖

如果目标是验证码 / 风控验证 / challenge / WAF 接口，RuyiTrace 自动捕获或手动捕获都必须覆盖完整链路：触发验证码、验证码组件初始化、用户交互事件、加密参数生成、verify / validate / challenge 接口发起、结果回调。

- 用户提供完整流程时，自动捕获脚本应按该流程执行；若流程需要人工识别、登录、验证码答案或权限交互，暂停让用户完成。
- 用户选择自己完成流程时，先启动 RuyiTrace 记录，再让用户操作；只有用户回复"已经完成触发到验证流程"后，才停止记录并导入 NDJSON。
- 如果 `notes/ruyitrace-summary.md` 只覆盖页面加载、没有交互事件或 verify 接口附近调用栈，应要求重新采集，不得直接进入补环境。
