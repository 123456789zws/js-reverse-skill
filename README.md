# js-reverse-skill

通用网页端 JS 逆向工程技能：统一通过 ruyipage + RuyiTrace 采集运行时日志，基于日志证据逆向还原加密参数。融合黑盒补环境（JS 层 NativeProtect）、纯算还原、验证码逆向（verify 接口 w/cb/sig 加密参数、轨迹加密、challenge 绑定；答案层资产 ddddocr/坐标/轨迹脚本 + 题型分类器已内化）等多路径，支持 Node.js / Python 双语言纯协议交付。已在抖音 / 小红书 / 快手 / 同花顺 / 猿人学 / 国密（就业在线）等真实案例场景中得到实践（见「真实案例平台与参数」）。

## 来源

本 Skill 综合融合并重构了以下来源的流程骨架、工具链与案例经验：

| 来源 | 贡献 |
|------|------|
| [hello_js_reverse_skill](https://github.com/WhiteNightShadow/hello_js_reverse_skill) | 流程骨架 + 案例库 |
| [xbsReverseSkill](https://github.com/lwjjike/xbsReverseSkill) | 补环境流程 + 工具链 + web-verify-patcher 验证码识别/求解模块（ddddocr/坐标/轨迹脚本 + 题型分类器） |
| [ruyipage](https://github.com/LoseNine/ruyipage) | Firefox WebDriver BiDi 取证 |
| [RuyiTrace](https://github.com/LoseNine/Firefox-FingerPrint-Analyzer) | NDJSON trace 内核 |

## 能力边界

**适用**：
- 签名 / token / 指纹 / 设备参数生成
- JSVMP 黑盒补环境、WASM 加载、混淆还原、TLS 指纹模拟
- 验证码封装层逆向（verify 接口加密参数/轨迹加密/challenge 绑定）

**不适用**：App / Android / iOS / 小程序 / Windows / EXE / DLL / Native / Frida / IDA

**默认不主动分析 JSVMP 字节码源码**：遇到 JSVMP 只做黑盒补环境

## 实测平台

| 平台 | 目标参数 / 技术栈 | 难度 |
|------|------|------|
| 智通财经 (m.zhitongcaijing.com) | `sign`(SHA1 排序签名，标准算法示例) | ★ |
| 就业在线 (jobonline.cn) | `businessData`(SM4) / `E-CONTENT-PATH`(SM2) / `E-SIGN`(SM3) | ★★ |
| 猿人学 (yuanrenxue.cn) | `m`(修改版 MD5) / `f` / `RM4hZBv0dDon443M` | ★★★ |
| 同花顺问财 (iwencai.com) | `hexin-v`(chameleon + vm 沙箱) | ★★★ |
| 抖音 (douyin.com) | `a_bogus`(bundle + bdms) | ★★★ |
| 小红书 (xiaohongshu.com) | `X-s` / `X-s-common`(JSVMP) | ★★★ |
| 快手 (kuaishou.com) | `__NS_hxfalcon` / `kww`(Jose + kwpsec JSVMP) | ★★★ |
| QQ 音乐 (y.qq.com / u6.y.qq.com) | `sign`(zzc 前缀, 双 JSVMP) / `encoding=ag-1`(musics.fcg 加解密) + location.host 白名单静默降级 | ★★★ |
| 政府监管类 (nmpa.gov.cn) | `FSSBBIl1UgzbN7N` / `sdenv`(魔改 jsdom + C++ Addon) | ★★★★ |
| Gitee (gitee.com) | 百度 WAF 三件套 `nox_jst_v1` / `tox_token`(JSVMP + vm 沙箱补环境) | ★★★★ |
| 网易易盾 (dun.163.com) | 无感(type=5) `data{d,m,p,ext}` + 滑块(type=2) `data{d,m,p,f,ext}`（vm 沙箱跑 core-optimi SDK + 自定义 AES/XOR） | ★★★★ |

## 目录结构

```
js-reverse-skill/
├── SKILL.md              流程骨架 + 规则 + 索引（AI 加载的主文档；版本号见 front-matter `version`）
├── README.md             本文件
├── assets/               可复用资产（AST 反混淆 + 补环境片段 + fixture 模板）
├── templates/            交付入口模板（6 类：final.js / Node客户端 / Python客户端 / vm沙箱 / WASM / 验证码）
├── references/           知识参考（11 子域，按需读取；含 captcha/ 验证码：封装层+答案层资产）
├── cases/                经验案例（已验证案例 + 模板）
└── scripts/              工具脚本（ruyipage+RuyiTrace 采集/导入/检查 + 验证码题型分类/坐标/轨迹/答案校验）
```

## 如何使用

把下面提示词喂给 AI 编程助手（如 TRAE / Cursor / Copilot），让它加载本 Skill 后按流程执行。技术细节由 skill 自动判断，提示词只给任务目标。

### 核心模板（纯逆向）

方括号 `< >` 内为占位说明，实际使用时替换为真实值：

```
请逆向还原JS加密生成逻辑：
- 目标网站：<网页浏览入口>
- 目标接口：<req.txt 文件路径 / 接口URL字符串 / "无，自动抓包">
- 目标参数：<参数名>
```

### 扩展模板（含业务要求）

在核心模板基础上追加输出与备注：

```
请逆向还原JS加密生成逻辑：
- 目标网站：<网页浏览入口>
- 目标接口：<req.txt 文件路径 / 接口URL字符串 / "无，自动抓包">
- 目标参数：<参数名>

# 输出（可选）
- 抽取为 HTTP API：<路径>
- 报告归档到：<路径>

# 备注（可选）
- 项目规范引用（如"项目结构见仓库 README"）
- 取证模式指定（如"手动取证，提供 cURL"）
- 一次性偏好（如"本次用原生 https，不模拟 TLS 指纹"）
```

### skill 默认交付内容

每次任务默认产出以下交付物（与 SKILL.md §5.2 一致，不通过不交付）：

```
result/
├── final.js                 # 唯一执行入口（默认发真实 API 请求验证）
├── config.json              # 外置配置（脱敏静态配置）
├── package.json             # 依赖契约（curl-cffi-node 等）
├── 最终项目总结.md           # 必选：项目总结报告
└── src/                     # 源码模块（按需拆分）
    ├── signer.js            # 签名生成
    ├── env/                 # 补环境（路径 D 时，含内联 native-protect.js）
    └── request/             # 请求客户端
```

- 纯协议、无浏览器自动化代码（可在无显示器 / Docker 环境独立运行）
- ≥5 次真实 API 请求验证通过（200 响应 + 正确业务数据）
- `最终项目总结.md` 缺失 = 任务未完成

> Python 交付同理：`final.py` 入口 + `src/` 模块。完整交付规范见 SKILL.md §5.2。

## License

MIT
