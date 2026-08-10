# CHANGELOG

## 2.2.1 - 2026-08-10

### 修复
- **`--case-dir` 语义分裂根治**：A 组脚本（`check_session_resume`/`check_fingerprint_fixture`/`check_trace_api_coverage`）入口加 `resolveCaseDir` 归一化，兼容"项目根"与"case 目录"两种输入，统一返回 case 目录；内部路径逻辑不变，向后兼容旧调用。
- **`check_fingerprint_fixture.js` defaultEnvFiles 路径**：`caseDir/result` 在 case 目录语义下指向 `case/result`（不存在），改为 `caseDir/../result` 指向项目根 `result/`，避免 env 代码检查被静默跳过。
- **`check_code_quality.js` 默认值**：`--case-dir` 无参回退由 `'case'` 改为 `'.'`，与"项目根"约定和 `check_final_artifact.js` 一致（原默认会算成 `case/result` 找不到文件）。
- **`trace-flow.md` 错误命令**：`import_ruyitrace_log.js`（122/154 行）、`check_evidence.js`（212 行）属 B 组脚本，`--case-dir` 应指项目根，原文误填 `case`/`<case>` 会被解析成 `case/case/...`，已改为 `<project-root>`。
- **`scripts/README.md` import 示例**：`import_ruyitrace_log.js` 典型用法由 `--case-dir case` 改为 `--case-dir <project-root>`（B 组脚本）。

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
