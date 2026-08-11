# CHANGELOG

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
