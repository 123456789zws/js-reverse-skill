# 脚本索引

本目录包含 36 个脚本，按功能分为 9 类。SKILL.md 和 references/ 通过文件名引用，无需记忆路径。

## 环境检测（5 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `check_external_tools.js` | 检测 ruyiPage / RuyiTrace 安装状态 | `node check_external_tools.js --markdown` |
| `check_node_leakage.js` | 检查 Node 宿主常见泄露变量（含 undici），给出阻断清单 | `node check_node_leakage.js --markdown` |
| `check_tls_clients.js` | 检测 TLS 指纹兼容客户端（CycleTLS / impers / curl-cffi-node / curl_cffi / cyCronet） | `node check_tls_clients.js --markdown` |
| `check_web_verify_patcher.js` | 检测可选参考资源 web-verify-patcher 是否可用（非必需，验证码答案层已内化） | `node check_web_verify_patcher.js --markdown` |
| `precheck_runtime.js` | 六项纯计算预检（Node.js 侧） | `node precheck_runtime.js --markdown` |

## 质量检查 / 交付门禁（9 个）

| 脚本 | 功能 | 触发阶段 | 典型用法 |
|------|------|---------|---------|
| `check_intake.js` | 校验 task.md 目标字段完整性（URL / API / 参数名 / 样本等） | Phase 0 | `node check_intake.js --input task.md --markdown` |
| `check_code_quality.js` | 检查代码简洁性 / 模块化 / 中文注释 UTF-8 编码 | Phase 5 | |
| `check_final_artifact.js` | 检查交付目录规范 / 单一入口 / 无浏览器自动化 / Session 客户端 | Phase 5 | |
| `check_fingerprint_fixture.js` | 检查指纹 fixture 覆盖 Canvas / WebGL / Audio / DOM 几何等 | Phase 5 | |
| `check_trace_api_coverage.js` | 检查 Trace API inventory 和 env coverage matrix | Phase 5 | |
| `check_dynamic_resources.js` | 检查动态资源仅作快照，运行时刷新模块已设计 | Phase 5 | |
| `check_change_memory.js` | 检查代码变更记忆.md 是否维护修改原因 / 禁止回退等 | Phase 5 | |
| `check_stage_reports.js` | 检查阶段报告中文文件名 / UTF-8 / 必要阶段存在 | Phase 5 | `node check_stage_reports.js --case-dir case --markdown` |
| `compare_fixture.js` | 对比 fixture 样本与实际输出，定位首个偏差点 | Phase 5 | `node compare_fixture.js --fixture sample.fixture.json --actual node-output.json --field sign --markdown` |

## 分析工具（2 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `analyze_trace.js` | 解析 trace JSONL，按模块归类环境访问，标注 P1-P5 优先级 | `node analyze_trace.js --trace case/tmp/env-trace.jsonl --summary case/tmp/missing-env.json --markdown` |
| `analyze_trace_complexity.js` | 评估补环境复杂度 / 风险点 / 优先级 | `node analyze_trace_complexity.js --trace case/ruyi-trace/logs/trace.ndjson --markdown` |

## 生成工具（1 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `generate_fingerprint_hook.js` | 生成浏览器侧指纹终端 API 采样 Hook（仅取证） | `node generate_fingerprint_hook.js --types canvas,webgl,dom-geometry --out case/hooks/fingerprint-hook.js` |

## 运行工具（3 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `run_with_trace.js` | 探测模式运行：vm 上下文内定义浏览器桩，阻断宿主泄露 | `node run_with_trace.js --target case/js/original/app.js --entry window.makeSign --fixture case/fixtures/sample.fixture.json` |
| `capture_ruyitrace_log.js` | 自动捕获 RuyiTrace NDJSON 日志（trace Firefox + MOZ_DOM_TRACE） | `node capture_ruyitrace_log.js --url <url> --case-dir case --ruyitrace-home <RuyiTrace-dir> --markdown` |
| `forensic_ruyipage.py` | ruyiPage 通用取证：抓全部包（targets=True）+ JS 落盘 + 指纹基线，严格有头/定制内核/独立 profile | `python forensic_ruyipage.py --url <url> --targets "feed/hot" --browser-path <定制Firefox> --markdown` |

## 安装工具（3 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `install_all.js` | 一键检测并安装缺失组件到 `<项目根>/tools/` | `node install_all.js --yes --markdown` |
| `install_ruyipage_runtime.js` | ruyiPage runtime 安装（dry-run + `--install` 双阶段，自定义目录） | `node install_ruyipage_runtime.js --python python --install-dir <dir> --install` |
| `download_ruyi_tool.js` | 下载 RuyiTrace / ruyipage-firefox（`--extract` 自动解压 zip） | `node download_ruyi_tool.js --tool ruyitrace --dest <dir> --extract` |

## 工具脚本（5 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `init_env_case.js` | 初始化 case 目录结构并写入模板（`--force` 覆盖） | `node init_env_case.js [--force]` |
| `clean_case.js` | 清理 case 内测试 / 临时 / 缓存文件和空目录 | `node clean_case.js --case-dir case --dry-run --markdown` |
| `import_ruyitrace_log.js` | 导入 RuyiTrace NDJSON，生成摘要，标记截断字段 | `node import_ruyitrace_log.js --input <trace.ndjson> --case-dir case --markdown` |
| `write_markdown_utf8.js` | UTF-8 写入 Markdown（避免 Windows 编码问题） | `node write_markdown_utf8.js --input 草稿.md --out 最终项目总结.md --markdown` |
| `write_stage_report.js` | UTF-8 写入中文命名阶段报告 | `node write_stage_report.js --case-dir case --stage <阶段名> --markdown` |

## 验证码工具（8 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `classify_verify.py` | 验证码题型/厂商离线分类器（26 题型 + 40+ 厂商）；移植自 web-verify-patcher；内置 `--self-test` 冒烟自检 | `python classify_verify.py --html page.html --url "https://example.test" --text "拖动滑块" --pretty` |
| `map_coordinates.py` | 验证码坐标换算（图片像素 → CSS/页面坐标，含 DPR/元素偏移/滚动）；移植自 web-verify-patcher | `python map_coordinates.py --image-size 300x150 --display-size 300x150 --point 120,75 --pretty` |
| `generate_motion_track.py` | 生成滑块/拖放/刮刮卡/连线轨迹 JSON；移植自 web-verify-patcher | `python generate_motion_track.py --mode slider --distance 128 --duration-ms 1100 --pretty` |
| `analyze_tile_restore.py` | 切片乱序图片还原分析（tile-scramble）；移植自 web-verify-patcher | `python analyze_tile_restore.py --image scrambled.png --rows 3 --cols 3 --pretty` |
| `solver_request_template.py` | 打码平台请求模板（云码/超级鹰/2Captcha/CapSolver）；移植自 web-verify-patcher | `python solver_request_template.py --platform yundama --type slide --image bg.png --pretty` |
| `check_captcha_answer.js` | 校验答案层 answer JSON 是否符合 references/captcha/captcha-overview.md 接口契约 | `node check_captcha_answer.js --file answer.json --markdown` |
| `check_success_baseline.js` | 验证码成功样本基线评估（Phase 5，≥5 次成功 + 新类型≥2 次） | `node check_success_baseline.js --file success_samples.json --markdown` |
| `check_verification_attempts.js` | 验证码验证失败复盘（Phase 5，连续 5 次失败+诊断全 ok → 建议切打码平台） | `node check_verification_attempts.js --file attempts.json --markdown` |
