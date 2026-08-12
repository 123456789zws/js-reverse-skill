# CHANGELOG

## 2.3.22 - 2026-08-12

### 修复
- **forensic_ruyipage.py 二进制 body 被 UTF-8 解码破坏（真实案例复盘 P0）**：`capture.json` 目标命中记录的 response/request body 一律 `.decode("utf-8","replace")`，`application/octet-stream` 等二进制响应被损坏（字节丢失），后续所有基于坏样本的 body 对比失真。修复：新增 `_body_to_text` 按 Content-Type 或 UTF-8 严格解码结果区分——文本落字符串，二进制（octet-stream / 解码失败）落 base64 并写 `response_body_binary` / `response_body_bytes` 字段保留原始字节信息。
- **trace 采集默认时长口径不一致（真实案例复盘 P2）**：`capture_ruyitrace_log.js` 默认 `--duration` 60 秒，而取证侧 `--wait` 已是 120 秒；需要手动触发的目标请求（登录/点击/验证码）在自动跑满时长后未触发即收工。修复：默认 60 → 120 秒（含 usage 示例同步）。

### 新增
- **目标信号检测（真实案例复盘 P1，GATE-2 盲区修复）**：`check_evidence.js` 的 Step 2 只验「可解析、非空、关联目标域」，页面加载日志天然满足——一份未触发目标接口的 NDJSON 也能过证据门禁。修复：`import_ruyitrace_log.js` 新增 `--target-signal <信号>`（可多次），导入时扫描 NDJSON 是否命中目标接口 URL / 关键词，未命中输出 ⚠️ 且退出码非 0（硬信号）；`capture_ruyitrace_log.js` 新增同名参数并透传给导入；`check_evidence.js` 新增 `--require-target-signal <信号>`，未命中按 Step 2 缺失处理（退出码 1）；SKILL.md 4.3 质量判定新增「目标信号未命中 = 质量不足（硬信号）」，TRACE_CAPTURE 命令模板带 `--target-signal`。
- **浏览器关闭失败显眼告警（真实案例复盘 P3）**：`killOk=false` 时除报告字段外，stderr 与 markdown 报告同时输出 ⚠️ 浏览器未能自动关闭提示（含 profile 路径）。

### 优化
- **SKILL.md 4.3 手动触发协调环节（真实案例复盘 P1）**：目标请求需登录/点击/验证码/权限确认时，启动 trace（或取证）后必须提示用户在 trace 浏览器操作，**用户确认「已触发」前不得结束采集**；自动 trace 默认 120 秒兜底，不足转手动 trace。此前的提示逻辑散落在 references（browser-acquisition.md / trace-flow.md），自动 trace 主路径未覆盖。
- **逃生舱边界（真实案例复盘 P2）**：ruyi-tooling.md 新增第 0 条——共享脚本缺陷/能力缺口不得用 case 内手写脚本绕过，先修共享脚本或请用户提供材料；手写仅限「复杂多步交互」一种理由。
- **SKILL.md 4.5 状态记录强制输出（真实案例复盘 P3）**：状态转换必须输出一行「当前状态 + 证据状态 + 门禁结论」状态行（示例：`TRACE_RETRY：目标路径未覆盖（--target-signal 未命中，退出码 1），阻断分析`）；新增 IMPLEMENT 前置条件硬约束（trace 达标或用户确认轻量路径，两条均不满足停在 TRACE_ANALYZE）。

---

## 2.3.21 - 2026-08-12

### 修复
- **forensic_ruyipage.py 取证窗口默认 30 秒过短（真实案例复盘 P1）**：99.com handshake 案例中目标握手请求需在登录页手动触发，默认 `--wait 30` 秒窗口在用户来得及操作前就超时关闭。修复：默认 `--wait` 30 → 120 秒；行为保持「窗口内命中 `--targets` 目标接口即提前关闭，未命中到点自动关闭」，浏览器打开期间供用户手动触发。

### 优化
- **取证脚本命令模板显式化 + 目标请求未命中硬规则（真实案例复盘）**：SKILL.md 4.3 新增硬规则——取证窗口结束仍未捕获目标接口且需用户交互时，重采必须在浏览器打开期间提示用户操作（窗口不够可调大 `--wait`）或请用户提供该接口 cURL / HAR / 原始请求文本，Step 1 缺失前不得进入 `IDENTIFY` / `TRACE_ANALYZE` / `IMPLEMENT`；取证命令模板补 `--targets` 示例与 `--wait` 说明；scripts/README.md 同步说明窗口行为。

---

## 2.3.20 - 2026-08-12

### 修复
- **install_all.js Python 自动探测死代码（外部审计 P1）**：`parseArgs` 的 `--python` 默认值与兜底值均为 `'python'`（恒真），`resolvePython` 的 `if (explicit)` 分支永远命中，`python3 → py -3` 探测循环永不执行，与 usage（第 49 行）及 2.3.19「未提供时按 python → python3 → py -3 自动探测」声明矛盾；在只有 python3/py -3 的机器上 GATE-1 硬门禁检测会失败。修复：默认值与兜底值改为 `''`，恢复自动探测。
- **install_all.js 镜像探测 `-o NUL` 跨平台问题（外部审计 P3）**：`curl -o NUL` 在 Linux/macOS 会在 cwd 留下名为 `NUL` 的文件。修复：改用 `os.devNull`（Windows=NUL、Linux/macOS=/dev/null）。
- **三个 Python 脚本工作树 CRLF 未归一（外部审计 P3）**：`analyze_tile_restore.py` / `generate_motion_track.py` / `map_coordinates.py` 磁盘为 CRLF（`i/lf w/crlf`），与 `.gitattributes eol=lf` 及 2.3.19 归一声明不符，`core.autocrlf=false` 下会把 CRLF 重新带进后续提交。修复：重新检出归一为 LF。
- **git upstream 失效（外部审计 P2）**：本地 `refs/remotes/origin/main` 缺失导致 `[origin/main: gone]`，推送会失败，且 `.git/config` 残留 `vscode-merge-base = origin/main`。修复：fetch 后手动补 ref、重置 upstream 为 `origin/main`、清除残留配置（远端 main 分支实际存在，非远端删除）。
- **README 案例数量与索引不符（外部审计 P3）**：`cases/` 17 条中 2 条为 `kind: template` 方法论骨架（universal-vmp-source-instrumentation、vm-sandbox-custom-algo），实证案例实为 15 个。修复：README 目录结构改为「15 个实证案例 + 2 个方法论模板」。
- **缺 LICENSE 文件（外部审计 P2）**：README 声明 MIT 但根目录无 LICENSE。修复：新增 MIT LICENSE 文件；README 来源表补充 4 个上游项目许可证标注（hello_js_reverse_skill / RuyiTrace 未声明、xbsReverseSkill MIT、ruyipage BSD-3-Clause）与合规提示。

---

## 2.3.19 - 2026-08-12

### 修复
- **install_all.js 安装失败退出码可被后验 Python 回退绕过（复核 P1）**：安装阶段严格用 `--python` 指定解释器，但后验 `verify()` 调 `check_external_tools.js` 在显式 Python 不可用时回退 `python`/`python3`/`py -3`，本机任一解释器装有 ruyiPage 即判环境完整，而 `computeAllOk` 只看最终环境不看本次安装步骤 → 安装动作失败仍退 0，AI/CI 误判成功。修复：退出码改为 `stepsOk && computeAllOk`（本次安装步骤任一失败即退非零）；新增 `resolvePython`——显式 `--python` 严格使用不回退，未提供时按 `python → python3 → py -3` 自动探测，安装与后验全程同一解释器；`check_external_tools.js` 新增 `--python-args`（如 `--python py --python-args -3`）支持显式解释器带前缀严格探测，不传时行为不变（向后兼容）。端到端验证：显式不存在 Python + 安装步骤全失败 + 后验回退成功，现在正确退 1。

### 优化
- **新参数同步到主流程文档**：`install_all.js --project-dir`（SKILL.md GATE-1 / phase-flow / ruyi-tooling / scripts-README）、`check_external_tools.js --offline`（SKILL.md GATE-1 检测命令）补齐。安装不再依赖"先 cd"软约束，GATE-1 检测默认离线保证确定性（需版本对比提示时去掉 `--offline`）。

---

## 2.3.18 - 2026-08-12

### 修复
- **tooling 两文档「取证模式选择」旧模型残留（2.3.5/2.3.17 同类漏网）**：2.3.5 清 validation.md、2.3.17 清 cases/_template 与 stage-reports 的「取证模式选择/已确认」字段时，漏掉 tooling 子域两份文档。`browser-acquisition.md` 第 3/5/19/21-41 行整节（「取证模式选择触发时机」「取证模式选择」要求任何取证动作前先让用户选模式、未选择前不能开浏览器）与 `ruyi-tooling.md` 第 38-53 行「取证工具选择权必须交给用户」4 选项模板（含「仅 ruyiPage」「AI 自行决定」）仍与 EVIDENCE_GATE 自动判定模型冲突（validation.md 测试 7「取证路径由 EVIDENCE_GATE 自动判定」），且「仅 ruyiPage」选项与 SKILL.md TRACE_CAPTURE 必做步骤矛盾。修复：两文档改为「取证来源由 EVIDENCE_GATE 自动判定」——ruyipage 网络取证 / RuyiTrace 日志采集 / 用户手动材料，用户提供真实材料跳过对应步骤；删除 4 选项选择模板；RuyiTrace 缺失时的安装/降级确认流程（ruyi-tooling 第 103-130 行）保留并改为「取证需要 RuyiTrace」表述；browser-acquisition 的登录处理 / Cookie 分类 / 指纹基线 / isTrusted / ruyiPage 启动硬约束等有效内容全部保留。
- **ruyi-tooling.md RuyiTrace 采集方式默认值矛盾（validation.md 测试 13）**：原文「采集方式由用户选择（手动/自动二选一）」与 validation.md 测试 13「RuyiTrace 采集默认自动、失败转手动」矛盾。改为默认自动 trace（capture_ruyitrace_log.js），自动失败 / 需登录验证 / 用户指定日志时转手动 trace。
- **scripts/README.md check_evidence 退出码旧表述（2.3.17 漏同步）**：2.3.17 把 check_evidence.js 退出码改为「缺失证据退 1」并同步脚本 usage，但 scripts/README.md 第 40 行仍写「四种证据路由都是正常诊断结果并退出 0」，与 SKILL.md 第 0 节「退出码是硬信号」及脚本实际行为矛盾。修复：同步为「缺失证据（missing 非空）或材料格式错误（errors 非空）退出 1，两步齐全退出 0」。
- **browser-acquisition.md 验证码/登录模板残留「取证模式」字段**：第 90 行「让用户选择取证方式」改为「让用户确认取证方式（AI 自动最小交互 / 用户自己在取证浏览器中触发）」，第 182 行登录提示模板字段「取证模式：ruyiPage + RuyiTrace / 用户手动取证」改为「取证来源：ruyipage 网络取证 / RuyiTrace 日志采集 / 用户手动材料」。
- **templates/README.md `src/signer.py` 引用不存在的文件**：模板中无 src/signer.py（python-request 只有 final.py/client.py/requirements.txt），原文「按需引用 client.py 和 src/signer.py」易被理解为模板自带。改为「按需引用模板的 client.py；signer 逻辑按站点实现，交付时自建 src/signer.py」。

---

## 2.3.17 - 2026-08-12

### 修复
- **check_evidence.js 缺证据时退出码为 0，与「退出码是硬信号」承诺矛盾（约束流程）**：脚本 `errors` 只在材料格式错误时填充，缺失证据（missing）不进入 errors，导致无证据时退出码 0——SKILL.md 第 0 节/GATE-2 宣称"退出码非 0 必须停"，实际靠输出文本「缺失证据」兜底，退出码信号是假的。修复：退出码改为 `errors.length || missing.length ? 1 : 0`，缺任何一步证据即退 1；usage 说明同步更新为「退出码是硬信号」；自测新增空证据退 1 / 双证据退 0 断言（23 项）。
- **--case-dir 语义分裂：SKILL.md 4.1「所有脚本统一传 <project-root>」与 12+ 个质检脚本实际期望 case 子目录矛盾**：check_object_shape_audit / check_webapi_env_detection_matrix / check_xhr_fetch_semantics / check_xhr_fetch_session_bridge / check_dynamic_resources / check_change_memory / check_stage_reports / check_trace_runtime_conformance / analyze_trace_complexity / build_trace_runtime_contract / check_environment_closure / run_trace_runtime_audit / check_env_realism 默认 `'case'` 期望 case 子目录，AI 按 SKILL.md 传 project-root 会检查错目录（如检查范围变成 `<project-root>/../result`）。修复：`scripts/lib/paths.js` 新增共享 `resolveCaseDir`（兼容 project-root 与 case 子目录，统一返回 case 目录），13 个脚本接入替换本地 `path.resolve`；SKILL.md 4.1 更新为「所有脚本统一传 <project-root>（已全局归一化）」。实测双传参均正确。
- **references 中 6 处 `check_external_tools.js` 命令缺 `--project-dir`（GATE-1 铁律未全量同步）**：phase-flow.md / trace-flow.md / ruyi-tooling.md / browser-acquisition.md / validation.md 的检测命令模板未带 `--project-dir <project-root>`，AI 照抄会在安装模式下检测失败（2.3.14 修复点）。修复：6 处命令补全 `--project-dir`。
- **browser-acquisition.md 残留旧工具与错误命令**：`capture_ruyitrace_log.js --case-dir case` 相对路径传 case 子目录（A 类脚本期望 project-root，会错位），改为 `--case-dir <project-root>` 并去掉多余的 `--ruyitrace-home`（可由 --project-dir 推断）。
- **captcha 子域残留旧概念**：verification-workflow.md「ruyiPage/Camoufox/CloakBrowser 模式」→ 改为「ruyiPage + RuyiTrace / 用户手动取证」（Camoufox/CloakBrowser 是 2.2.0 已移除工具，违反绝对规则 8 取证白名单）；solver-platform-recipes.md「未确认授权、未选择平台」→ 去掉「未确认授权」（2.3.5 同类残留）。
- **common-pitfalls.md「红线四条」残留**：当前第 3 节纯协议红线无编号（实为 7 条），改为「第 3 节纯协议红线违反即失败」。
- **cases/_template.md 与 stage-reports.md 残留「取证模式选择/已确认」字段**：与 EVIDENCE_GATE 自动判定模型冲突（2.3.5 清 validation.md 时漏这两处），改为「取证来源：ruyipage / RuyiTrace / 用户手动材料」与「证据门禁已通过」。
- **debug-playbook.md `--case-dir <case>/case` 占位符错误**：改为 `--case-dir <project-root>`（无 `<case>` 占位符定义）。

---

## 2.3.16 - 2026-08-12

### 修复
- **AI 实战不传 --project-dir 导致 RuyiTrace 检测仍失败 + 提示不引导**：装版 skill 已是 2.3.15，但 AI 跑 GATE-2 不传 `--project-dir`（SKILL.md 模板写了，AI 没遵守），且 `check_external_tools.js` 的"未检测到 RuyiTrace"提示只写 `--ruyitrace-home` / `RUYI_TRACE_HOME`，没提 `--project-dir`，AI 跟着提示走没想到用它。修复：① `check_external_tools.js` 的 reason + nextRequiredInput 提示加 `--project-dir` 引导（AI 看到提示知道用）；② SKILL.md GATE-2 把 `--project-dir` 从"模板写法"升级为铁律（安装模式下必须传，否则检测必失败）。
- **AI 自建 fetch_page.js 抓页面（2.2.0 重构把全局硬约束降级为局部节内约束）**：用户实战反馈 AI 自建脚本抓取目标页面，重构前不会。"禁止手写抓取/禁止 requests/curl 下载目标 JS"约束在 2.2.0 重构前是红线3（全局最高优先级，覆盖所有阶段），重构后降到 4.3 FORENSIC_CAPTURE 节内，AI 在意图声明阶段（还没到 FORENSIC_CAPTURE）自建 `fetch_page.js` 认为不违反 4.3。修复：把该约束上移到第 2 节绝对规则第 8 条（全局，覆盖意图声明/取证/分析所有阶段），4.3 节保留指向。本质是"2.2.0 重构把全局硬约束降级成局部节内约束"的回归，与已记 MEMORY 的"2.2.0 重构回归点"同类但此前未发现。
- **GATE 编号顺序仍与状态机矛盾（2.3.11 修复未彻底）**：2.3.11 把续接单列成 GATE-0 放在意图之前，自称"编号顺序状态机三者统一"，但状态机没有续接节点（续接是 ENV_READY 内部判定），GATE-0 在 GATE-1 意图之前运行环境脚本 check_session_resume.js，AI 实际行为仍是"先测环境后看范围"。且第 0 节（GATE-0 续接在前）与 4.1 节（先意图后环境）顺序相反，AI 读哪边都困惑。修复：合并续接判定进 GATE-1 环境自检（作为第一步：先判模式，resume 跳过完整自检，fresh 全跑），GATE 编号重排为 GATE-0 意图 / GATE-1 环境(含续接) / GATE-2 证据，严格一一对应 INTENT_CONFIRM / ENV_READY / EVIDENCE_GATE。同步第 17 行 GATE-0~3→GATE-0~2、第 48 行澄清句、第 66 行绝对规则 3 的 GATE-3→GATE-2。2.3.12 的 resume 澄清迁移到 GATE-1 内部。

---

## 2.3.15 - 2026-08-12

### 重构
- **抽共享路径模块 `scripts/lib/paths.js` 统一环境检测路径定位**：路径逻辑（findProjectRoot / normalizeTraceHome / getDefaultRuyiBrowsersDirs）原散落在 check_external_tools.js / capture_ruyitrace_log.js / check_session_resume.js 三脚本各自重复实现，且细节不一致（findProjectRoot 三份实现：capture/check_session_resume 直接 return cwd，check_external_tools 有 cwd 向上找10层段），改一处漏一处（2.3.8 漏 check_session_resume、2.3.14 漏 capture）。本次抽 `scripts/lib/paths.js` 共享模块，导出 `findProjectRoot / normalizeTraceHome / getDefaultRuyiBrowsersDirs / resolveProjectDirFromCaseDir`，自包含辅助函数（exists/isDir/whereCommand/compareVersion/uniquePaths）。三脚本 require 接入并删除重复实现：check_external_tools.js 删 findProjectRoot/getDefaultRuyiBrowsersDirs/whereCommand/normalizeTraceHome；capture_ruyitrace_log.js 删 whereCommand/normalizeTraceHome/compareVersion/findProjectRoot；check_session_resume.js 删 findProjectRoot。
- **capture_ruyitrace_log.js 补 --project-dir + 自动推断（修复 2.3.14 漏改）**：2.3.14 漏改 capture 的 normalizeTraceHome（还是老的 cwd+findProjectRoot 两候选，安装模式下撞车失效）。本次接入共享模块修复，新增 --project-dir 参数；未传时从 --case-dir 自动推断工程根（resolveProjectDirFromCaseDir），AI 传 --case-dir 即可定位 tools/，无需显式 --project-dir。
- **路径定位逻辑统一**：候选顺序全模块统一为 `显式参数 > 环境变量 > --project-dir/tools > cwd/tools > findProjectRoot/tools > where`；findProjectRoot 行为统一（__dirname 找 SKILL.md 5 层 + cwd 找 10 层 + return cwd）。
- 验证：临时目录模拟安装环境（假 SKILL.md + 无 tools/），check_external_tools 与 capture 不传 --project-dir 均检测失败（复现实战），传 --project-dir 均检出 RuyiTrace-2.5.5；三脚本开发仓库无回归。

---

## 2.3.14 - 2026-08-12

### 修复
- **安装模式下 `check_external_tools.js` 检测不到 RuyiTrace（2.3.8 修复盲区）**：实战 AI 按 GATE-2 命令模板 `cd skill安装目录 && node scripts/check_external_tools.js` 运行，`process.cwd()`=skill 安装目录（无 tools/，gitignore 不随分发）；`normalizeTraceHome` 两个候选 `cwd/tools` 与 `findProjectRoot()/tools` 撞车——skill 安装目录有 SKILL.md 导致 `findProjectRoot()` 第一段 `__dirname` 命中并 return，两个候选都指向 skill 安装目录下不存在的 `tools/`，RuyiTrace 无兜底直接失败（4/5）。2.3.8 的"cwd 优先"假设 cwd=用户工程目录（tools/ 所在），但 AI 实际 cd 到 skill 安装目录，假设不成立。修复：`check_external_tools.js` 新增 `--project-dir` 参数，`normalizeTraceHome` / `getDefaultRuyiBrowsersDirs` 候选最前插 `--project-dir/tools`；`check_session_resume.js` 把已算出的 `projectRootOfCase` 作为 `--project-dir` 透传给子进程（与 spawn cwd 双保险）；SKILL.md GATE-2 两处命令模板加 `--project-dir <project-root>`。候选顺序统一为 `--project-dir/tools → cwd/tools → findProjectRoot()/tools → 环境变量 → where`，符合"先用户工程目录 → 再 skill 安装路径"。
- **测试盲区复盘**：2.3.8 / 683cb83 测试通过是因为用"cwd=有 tools/ 的目录"或开发版脚本（`findProjectRoot()` 靠 `__dirname` 永远指向开发仓库，有 tools/），未覆盖"安装版脚本 + AI cd 到 skill 安装目录"这条实战路径。本次用临时目录模拟安装环境（假 SKILL.md + 无 tools/）验证：不传参 RuyiTrace 未检测到（复现实战），传 `--project-dir` 检出。后续环境检测类改动须用"安装版脚本 + AI 真实 cd"组合测试。

---

## 2.3.13 - 2026-08-12

### 修复
- **TRACE_CAPTURE 质量不足不会触发重试（状态机盲区）**：状态机 `TRACE_CAPTURE → CASE_LOOKUP` 原为无条件推进，AI 看到「生成了 NDJSON」就推进，没有质量门槛。实测案例只采到 1 条无栈事件（Step 2 偏弱），AI 直接转静态还原，未触发重试。根因：`import_ruyitrace_log.js` 已输出质量信号（如「未发现 stack.file」），但 SKILL.md 状态机和 references 没规则接住；trace-flow.md 现有 3 条质量规则散落且触发条件互不重叠，有盲区（「生成了但无栈/事件极少」无人覆盖）。修复：状态机 `TRACE_CAPTURE` 节点内补 `TRACE_RETRY` 分支（不新增编号，避免 GATE/TODO 编号回归）；SKILL.md 4.3 节补「质量判定标准」+「TRACE_RETRY 处理顺序」5 步降级；`references/workflow/trace-flow.md` 补「Trace 质量判定与重试」统一节，合并现有 3 条散落规则，消除盲区。阈值用建议值让 AI 自主判断（符合 EXTERNAL_LOOKUP 设计原则），但「无 stack.file」是硬性重度不足信号不得放宽。

---

## 2.3.12 - 2026-08-12

### 修复
- **GATE-0 措辞歧义（可能误导 AI 跳过 GATE-1 意图声明）**：GATE-0 resume 路径原写"直接进 GATE-3"，字面上易被理解为 GATE-0→GATE-3（跳过 GATE-1 意图声明）。虽然第47行澄清了"不跳过 GATE-1"，但 AI 可能只读 GATE-0 那行就行动。改为「跳过 GATE-2 完整环境自检，读最新阶段报告续接（GATE-1 意图声明仍需完成）」，消除"直接进 GATE-3"的误导。

---

## 2.3.11 - 2026-08-12

### 修复
- **门禁 GATE 编号顺序与状态机矛盾（2.3.7 设计 bug）**：2.3.7 恢复硬门禁时 GATE 编号顺序为 GATE-0 续接→GATE-1 环境→GATE-2 证据→GATE-3 意图，与第4节状态机 `INTENT_CONFIRM(意图)→ENV_READY(环境)→EVIDENCE_GATE(证据)` 顺序相反。AI 加载 skill 后两套顺序打架，建 TODO 时出现错位（如 `INTENT→EVIDENCE→取证→ENV_READY`），且 ENV_READY 被勾但前序项未勾。重排 GATE 编号与状态机统一：GATE-0 续接（前置判定）/GATE-1 意图/GATE-2 环境/GATE-3 证据。同步改第47行续接说明、第65行绝对规则3 的 GATE 引用。
- 全仓 grep 确认 GATE 编号仅出现在 SKILL.md（脚本/references/cases 均无引用），改动自包含，无外部影响。

### 背景
用户反馈 AI 建的待办清单顺序混乱（前面项没执行直接跳环境检测）。根因是门禁编号顺序与状态机流程顺序相反，AI 两套都读导致混乱。本次按「编号、顺序、状态机三者统一」原则重排，彻底消除矛盾。与 2.3.10 的 TODO 指令改具体可执行互补（2.3.10 改 TODO 呈现，2.3.11 改 GATE 编号顺序）。

---

## 2.3.10 - 2026-08-12

### 修复
- **check_session_resume.js 内 RuyiTrace 路径检测为空（安装模式回归）**：`runCheckExternalTools()` 在 spawn `check_external_tools.js` 时强制 `cwd: projectRoot`（即 skill 安装根）。而 `check_external_tools.js` 的 `normalizeTraceHome()` 优先扫 `process.cwd()/tools`——安装模式下 tools/ 在用户工程目录（gitignore 不随 skill 分发），skill 根没有 tools/，于是找不到 RuyiTrace；但你单独跑 `check_external_tools.js`（cwd=用户工程目录）能找到。这把 2.3.8 的 `cwd/tools` 优先修复给抵消了。修复：spawn 的 `cwd` 改为「--case-dir 解析出的用户工程根」（tools/ 实际所在处），并透传 `--ruyitrace-home/--ruyitrace-exe`。

### 优化
- **执行主线 TODO 指令改具体可执行**：原指令是弱 blockquote + 一整条箭头字符串（无离散可勾项、无明确建清单/勾选触发）。改为「激活即建 + 10 个离散项（1:1 对应状态机节点）+ 明确勾选规则（进入即勾、分支回退重置、续接跳过 ENV_READY 直接勾第 2 项）」，解决 AI 加载 skill 后不及时建清单、不逐步勾选的问题。内容更具体，不改变状态机/门禁/节号结构。

---

## 2.3.9 - 2026-08-12

### 修复
- **references 过时「红线 N」编号引用（2.2.0 重构遗留）**：2.2.0 把「五条红线」改为「第3节纯协议红线」（无编号 bullet）后，references 仍有两处引用旧编号，2.3.5 全量同步旧概念时漏网。修复：`references/tooling/browser-acquisition.md:32`「红线 3 取证禁用清单」→「第3节纯协议红线与第4.3节 FORENSIC_CAPTURE」；`references/captcha/captcha-overview.md:29`「红线 4」→「第3节纯协议红线」。`cases/` 历史资产按规则不改（且自带完整说明）。

### 背景
门禁与红线审计发现：门禁（GATE-0~3）与红线主体完整、无缺漏，约束力已恢复到重构前水平且更精确；唯一问题是 2.2.0 重构后「红线 N」编号引用未全量同步（属杂乱非缺漏）。本次按 working memory「重构后 references 同步原则」全仓 grep 修复，符合「不能只改触发问题的那一个」原则。

---

## 2.3.8 - 2026-08-12

### 修复
- **安装模式下工具检测失效（findProjectRoot fallback 死代码）**：`findProjectRoot()` 第一段用 `__dirname` 向上找 SKILL.md，skill 安装目录里必然有 SKILL.md → 第一段必然 return，第二段 cwd fallback 永远走不到。后果：用户在独立文件夹（非 skill 项目根）建 `tools/` 装工具，跑安装版 skill 的脚本检测不到——项目根永远是 skill 安装目录，不是 cwd。安装版 skill 目录又没有 `tools/`（gitignore 不随安装分发），所以 `scannedInstallDirs` 指向不存在的路径。
- **工具定位优先 cwd/tools/**：`check_external_tools.js` 的 `getDefaultRuyiBrowsersDirs()` 和 `normalizeTraceHome()`、`capture_ruyitrace_log.js` 的 `normalizeTraceHome()`，候选路径列表在 `findProjectRoot()/tools/` 之前插入 `cwd/tools/`。开发模式下 cwd = skill 项目根，两者相同（`unique()` 去重）；安装模式下 cwd = 用户工作目录，优先扫到。
- **install_all.js 默认安装目录改 cwd**：`PROJECT_ROOT` 从 `findProjectRoot()` 改为 `process.cwd()`，默认装到 `cwd/tools/`。删除不再使用的 `findProjectRoot()` 函数。安装模式下不再污染 skill 安装目录。

### 优化
- **新增执行主线 TODO 指令（SKILL.md 第4节状态机图后）**：激活 skill 后把状态机主干建成可勾选 TODO 暴露给用户，每完成一项勾一项；明确分支判定以状态机为准、分支跳出=重做对应项不新建子项。解决 AI 加载 skill 后不主动建可见清单、用户看着没章法的问题。仅 +1 段引用，不碰状态机/门禁/节结构。
- **补 bump SKILL.md version 2.3.7→2.3.8**：d1110bf 提交了 2.3.8 的 CHANGELOG 与脚本改动，但漏 bump front-matter version 字段，本次一并补齐。

### 背景
用户反馈"在独立文件夹的 tools 路径安装了工具，在那个文件夹跑检测不到"。根因是 `findProjectRoot()` 的设计假设「脚本和 tools/ 在同一个项目根下」，安装模式下这个假设破了——skill 安装目录有 SKILL.md 但无 tools/，用户工作目录有 tools/ 但无 SKILL.md。本次改动把"找 tools/"和"找 SKILL.md"解耦：工具定位优先 cwd，`findProjectRoot()` 语义不变（继续用于读模板/references/case 结构）。

---

## 2.3.7 - 2026-08-11

### 修复
- **恢复分析前硬门禁锚点（约束流程回归）**：2.2.0 重构把强约束锚点（硬约束 Checklist / 五条红线 / 会话续接判定 / CHECK-0~3 / 不可跳过 / 任一违反即失败）从 38 处清零到 0 处，SKILL.md 从 758 行精简到 293 行。门禁脚本本身有 `process.exit(1)` 拦截力，但 SKILL.md 文本没接住这个信号，导致 AI 加载 skill 后没有任何结构阻止它直接拿参数名开猜（如 aq99 项目"凭空分析"）。新增 `## 0. ⚠️ 分析前硬门禁（不可跳过）` 作为最高优先级锚点，GATE-0~GATE-3 四步全部复用现有脚本（check_session_resume / check_external_tools / precheck_runtime / check_evidence），写明"未过门禁就分析参数/猜算法/写代码 = 违反绝对规则 3，视为任务失败"。
- **绝对规则 3 补 hard-stop 后果**：把"不得先凭参数名称猜算法"与门禁失败直接挂钩，补"未过 GATE-2 就分析 = 违反本条，视为任务失败"。
- **4.2 EVIDENCE_GATE 补阻断指令**：补一句"check_evidence.js 退出码非 0 或输出含「缺失证据」「不可跳过」时必须停在 EVIDENCE_GATE，禁止进入 IDENTIFY/TRACE_ANALYZE/IMPLEMENT"，接住脚本的 exit(1) 信号。

### 背景
用户反馈"现在的 skill 约束流程非常弱，重构之前基本都能按流程一步一步推进，现在完全不按 skill 走"。复核 git 历史确认 2.2.0 重构是分水岭，之后 2.3.0→2.3.6 全是"恢复/补齐重构误删的约束"。本次按"最小改动、复用现有脚本"原则恢复阻断力，不恢复 758 行旧结构。

---

## 2.3.6 - 2026-08-11

### 优化
- **术语统一**：路径 D 名称「环境复现」（SKILL.md:240、common-pitfalls.md:155）改为「环境伪装」，与 cases/index.json 机器检索字段及 references 全仓 40+ 处一致。保留「最小环境复现」固定搭配（泛指复现环境的动作，非路径 D 名称）。
- **路径矩阵去冗余**：phase-flow.md 4.2 解法模式表与 decision-tree.md 模式选择矩阵近乎逐字重复，改为交叉引用 decision-tree.md，减少维护负担。
- **反爬识别加交叉引用**：phase-flow.md 1.2、intake-template.md 反爬类型识别简表末尾补「详细识别标准见 decision-tree.md」，避免三处简表各自演进漂移。
- **截断保护加同步提示**：trace-flow.md 与 ruyi-tooling.md 的「RuyiTrace 长字段截断保护」段近乎逐字重复，仿 native-protect.js 双副本模式各加同步提示，提醒修改任一处需同步另一处。

---

## 2.3.5 - 2026-08-11

### 修复
- **B 组脚本 --case-dir 参数错误（8 处）**：2.2.1 统一 A/B 组脚本语义时只改了触发问题的 trace-flow.md，同类错误在 7 个文件 8 处遗留。check_evidence.js（5 处）和 import_ruyitrace_log.js（3 处）的 `--case-dir` 应传 `<project-root>`，原文误填 `<case>`/`case` 会被解析成 `case/case/...` 路径错误。涉及 phase-flow.md、decision-tree.md、intake-template.md、browser-acquisition.md、env-debug-loop.md、ruyi-tooling.md。
- **旧授权阻断项残留（2 处）**：2.2.3 清理"未确认授权"阻断项时只清了 phase-flow.md，intake-template.md:113 和 decision-tree.md:25 两处残留，与第 1 节「默认已授权」冲突。改为「需要登录态：暂停要求用户手动登录或补充请求包」，去掉"授权"措辞。
- **validation.md 取证模式必填（3 处）**：测试 1/2/4 把"取证模式"列为用户必填字段，与状态机 EVIDENCE_GATE 自动判定冲突（且与同文件测试 7 矛盾）。去掉"取证模式"必填要求。
- **decision-tree 阻塞点 #1 旧模型残留**：阻塞点 #1「未确认取证模式」与状态机不符（INTENT_CONFIRM 不含取证模式选择，由 EVIDENCE_GATE 自动判定）。改为「未确认目标范围」。
- **phase-flow 状态机链不全**：2.3.4 只改了版本号写死，未补全跳过的 6 个分支状态（FORENSIC_CAPTURE、TRACE_CAPTURE、STEP2_ONLY、EXTERNAL_LOOKUP、DIAGNOSE、SIGN_ONLY_DELIVER）。改为提"含分支状态"的表述，不重复 SKILL.md 完整状态机图。

### 待后续处理（P2）
- 术语「环境伪装」vs「环境复现」分裂：涉及 cases/index.json 机器检索字段，全量替换风险高，需单独评估。
- 3 处内容冗余重复（截断保护/反爬识别/路径矩阵）：需合并大段内容，可能丢失细节，需谨慎设计。

---

## 2.3.4 - 2026-08-11

### 修复
- **phase-flow.md 版本号写死漏网**：2.3.3 修复 experience-rules.md 两处写死「SKILL.md 2.2.2」时，漏掉 `references/workflow/phase-flow.md:5` 的「SKILL.md 4.0」。改为「SKILL.md 状态机」与 experience-rules.md 一致，落实「references 文件不写死版本号」原则。
- **第12节路由表漏指向**：2.3.2 修 experience-rules.md 漏指向时确立「references/ 下文件必须在第12节路由表有对应指向」原则，但仍有 19 个有实质内容且有明确触发条件的文件未指向（env/5、quality/8、network/4、hooks/2、workflow/3、tooling/1）。补齐后路由表覆盖全部 66 个 references 文件，AI 不再因「文件在但路由表没指」而漏读。captcha/ 下 12 个细分文件维持间接覆盖（"再按厂商、题型、轨迹或验证失败路由到具体文档"）。

---

## 2.3.3 - 2026-08-11

### 修复
- **经验法则版本号过时**：`references/workflow/experience-rules.md` 两处写死「SKILL.md 2.2.2 状态机」，版本已升至 2.3.x。改为不写死版本号，引用「SKILL.md 状态机」，避免后续版本升级时再次过时。生产级门禁模板（`final-summary.md`）与检查脚本口径一致，无需优化。

---

## 2.3.2 - 2026-08-11

### 修复
- **经验法则路由丢失**：`references/workflow/experience-rules.md` 文件一直在，但 2.2.0 重构后第 12 节路由表未指向它，AI 不知道有此文件可读。第 12 节「任务分流、阶段安排、常见坑」行追加 `experience-rules.md`。
- **生产级交付门禁说明丢失**：`check_final_artifact.js --production` 模式一直在（校验 9 个生产级附加章节），但 2.2.0 重构后第 11 节未说明此模式。第 11 节恢复 `--production` 说明及命令。

---

## 2.3.1 - 2026-08-11

### 修复
- **交付文档硬约束回归**：2.2.0 重构误删了「最终项目总结.md」与「经验沉淀-<站点>.md」的必选标注和「不生成=任务未完成」硬约束。底层 `check_final_artifact.js` 仍强制检查这两个文档，但 SKILL.md 第 11 节丢了说明，导致 AI 读 skill 时不明确这是必选要求。第 11 节恢复：必选标注、模板指向（`references/quality/final-summary.md`、`cases/_template.md` Part 2）、豁免机制（`--no-require-final-summary` / `--no-require-experience`）；第 13 节完成判定补一条「两个文档已生成（或用户明确豁免）」。

---

## 2.3.0 - 2026-08-11

### 新增
- **EXTERNAL_LOOKUP 状态**：`CASE_LOOKUP` 本地未命中时，新增网络方案搜索分支。搜到可读算法作为假设进入 `IMPLEMENT`，搜不到或算法黑盒进入 `FORENSIC_CAPTURE` 完整取证。补齐了"搜索网络已有成果"这一信息收集层，简单参数（如公开签名）可走轻量路径：搜方案 → 实现 → 真实验证 → 交付。
- **REAL_VERIFY 失败回退分支**：验证失败时区分已有 trace（→ DIAGNOSE 修复）与无 trace 轻量路径（→ FORENSIC_CAPTURE 强制升级取证），不回 EXTERNAL_LOOKUP 继续试方案。
- **轻量交付来源标注**：经 EXTERNAL_LOOKUP 未做 trace 即通过验证的交付物，必须在 `最终项目总结.md` 标注算法来源 URL、验证日期、未做 trace 声明。

### 修复
- **description 触发词回归**：2.2.0 重构误删了"逆向还原...加密参数...生成逻辑"等通用触发词，导致常规参数逆向提示词模板（如"请逆向还原JS加密生成逻辑"）无法触发本 skill。恢复通用触发词，保留纯协议还原定位和边界声明，不加具体参数名和算法名。

---

## 2.2.3 - 2026-08-11

### 文档
- **第1节「任务边界与授权」优化**：新增「默认已授权」小节，明确用户发起请求即视为合法授权范围内操作（自有系统、已授权目标、合法安全研究与互操作分析），AI 默认按范围直接协助，不再要求授权证明、不得质疑或拒绝执行、不进入拦截或反复确认逻辑。
- **phase-flow.md 阻断项收紧**：删除「未确认授权 / 登录状态：不得尝试绕过登录、验证码、MFA」一条；第1节已声明默认已授权，不再以授权为由阻断，登录态/验证码交互仍按「暂停要求用户补充请求包」处理。
- **第12节冲突判定条款**：去掉授权项，保留「以本文件的状态机、真实 API 验证规则和纯协议红线为准」，授权声明统一收敛到第1节。

---

## 2.2.2 - 2026-08-11

### 修复
- **Node 请求客户端 POST 请求体丢失（P0）**：`session.request` 只认 `opts.body`，`session.post(url, payload)` 会把 payload 当 opts 导致请求体为空。`client.js` 新增 `json`/`data` 选项，自动序列化并设置 `Content-Type`，与 Python 版 `json_body=`/`data=` 语义对齐。
- **验证码模板与客户端契约**：`captcha-verify/final.js` 的 verify/business 调用改为 `{ data: payload }`/`{ json: { credential } }`；`captcha-verify-py/final.py` 修正 `create_request_session(headers=...)` 参数、`session.post(json_body=...)` 调用，统一验证通过条件为全部成功（`success === verifyCount`）。
- **`capture_ruyitrace_log.js` logger 未定义（P0）**：浏览器提前关闭路径调用未定义的 `logger.info` 且 `%ss` 为 printf 格式，触发 `ReferenceError`。改为 `console.log` + 模板字符串。
- **Node 验证码模板 session 泄漏**：`captcha-verify/final.js` 的 `runOnce` 与 `sign-only` 模式补 `try/finally session.close()`，与 Python 版对齐。
- **`captcha-verify-py/final.py` `load_config` 默认值合并**：config.json 缺失时 `main()` 访问 `config['captcha']['provider']` 抛 `KeyError`，新增 defaults 深层合并，与 Node 版 `Object.assign` 对齐。
- **AST 流水线/安装脚本退出码**：`assets/ast-patterns/scripts/run-pipeline.js` 步骤失败、`scripts/install_ruyipage_runtime.js` 安装失败时设置 `process.exitCode = 1`，不再静默成功。
- **Windows 采集进程清理边界**：`capture_ruyitrace_log.js` 的 `killProcessTree` 中 taskkill/PowerShell 调用加 15s 超时包装，防止子进程挂起；CLI 参数补齐 `help: false` 默认值。

### 验证
- `node --check` 全部脚本通过。
- `check_evidence.js --self-test` 22 项断言通过。

---

## 2.2.1 - 2026-08-10

### 修复
- **`--case-dir` 语义分裂根治**：A 组脚本（`check_session_resume`/`check_fingerprint_fixture`/`check_trace_api_coverage`）入口加 `resolveCaseDir` 归一化，兼容"项目根"与"case 目录"两种输入，统一返回 case 目录；内部路径逻辑不变，向后兼容旧调用。
- **`check_fingerprint_fixture.js` defaultEnvFiles 路径**：`caseDir/result` 在 case 目录语义下指向 `case/result`（不存在），改为 `caseDir/../result` 指向项目根 `result/`，避免 env 代码检查被静默跳过。
- **`check_code_quality.js` 默认值**：`--case-dir` 无参回退由 `'.'` 改为 `'.'`，与"项目根"约定和 `check_final_artifact.js` 一致（原默认会算成 `case/result` 找不到文件）。
- **`trace-flow.md` 错误命令**：`import_ruyitrace_log.js`（122/154 行）、`check_evidence.js`（212 行）属 B 组脚本，`--case-dir` 应指项目根，原文误填 `case`/`<case>` 会被解析成 `case/case/...`，已改为 `<project-root>`。
- **`scripts/README.md` import 示例**：`import_ruyitrace_log.js` 典型用法由 `--case-dir case` 改为 `--case-dir <project-root>`（B 组脚本）。
- **A 组脚本 result 路径 bug**（审计发现）：`run_trace_runtime_audit`/`check_env_realism`/`check_environment_closure`/`check_object_shape_audit`/`check_dynamic_resources`/`check_xhr_fetch_session_bridge` 在 case 目录语义下用 `caseDir/result`（case 目录下无 result），改为 `caseDir/../result` 指向项目根 `result/`，避免最终代码检查被静默跳过。其中 4 个默认值 `'.'` 改为 `'case'`（与 `check_dynamic_resources`/`check_stage_reports`/`check_change_memory` 一致，A 组期望 case 目录）。
- **A 组脚本剩余 5 个默认值统一**：`check_xhr_fetch_semantics`/`build_trace_runtime_contract`/`check_trace_runtime_conformance`/`check_webapi_env_detection_matrix` 无参回退由 `'.'`/`process.cwd()` 改为 `'case'`；`analyze_trace_complexity` 的 `root` 与 `discoverTraceFiles` 入口一并默认 `'case'`（去掉 `if (args.caseDir)` 守卫，无参也能从 `case/` 自动发现 Trace）。与 A 组约定一致，无参运行不再找不到 `notes`/`fixtures`/`tmp`。

### 文档
- 统一所有 A 组 3 脚本调用点为 `--case-dir <project-root>`（SKILL.md、phase-flow、trace-flow、ruyi-tooling、trace-api-coverage、delivery-templates、code-style、cleanup、fingerprint-value-replay、env-native-protection、scripts/README、README）。
- SKILL.md 4.1 段补 `--case-dir` 约定说明；scripts/README 说明 3 脚本已归一化。
- `cases/index.json` 为方法论骨架模板（`universal-vmp-source-instrumentation`、`vm-sandbox-custom-algo`）加 `"kind": "template"` 标记，`cases/README` 补标记要求说明。
- `search_cases.js` 默认从结果排除 `kind:template` 模板，新增 `--include-templates` 开关显式包含；`cases/README` 同步说明。
- `native-protect.js` 双副本（`assets/env-patch-snippets/` 与 `templates/vm-sandbox/`）文件头加同步提示注释，提醒修改任一处需同步另一处。

### 验证
- `node --check` 全部脚本通过。
- 归一化功能性验证：传项目根与传 case 目录两种输入归一化到同一 case 目录（PASS）。

---

更早版本历史见 `git log`。
