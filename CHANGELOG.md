# CHANGELOG

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
