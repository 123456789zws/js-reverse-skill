# 补环境框架选择策略

> 本文件提供框架选择策略指导，不随包提供框架运行时代码。用户如需 sdenv / vm / jsEnv，需自行安装或实现。

本文件用于进入 Node.js 补环境阶段前读取。核心原则：**默认不使用补环境框架**（纯 vm + 手动补环境，最小检测面）；AI 根据题型自动判断是否需要升级；用户可显式覆盖。

## 核心规则

1. **默认不使用补环境框架**——纯 Node.js vm 沙箱 + 手动补环境，检测面最小。
2. AI 根据题型自动判断是否需要升级：
   - 纯算法 → 不需要框架
   - JSVMP 行为型（抖音/TikTok 类）→ 多数情况纯 vm 够用，搬运 SDK 直接运行
   - JSVMP 签名型（瑞数类）→ 检测 `typeof document.all` 等原生行为时，需升级 sdenv
   - 极端检测（多维度交叉验证）→ 可能需要 sdenv
3. **用户可显式覆盖**——高级用户可指定框架，但不强制选择。
4. 可选项：不使用（默认）、Node.js 内置 vm、sdenv、jsEnv。
5. 平台缺失时要求用户提供匹配构建产物或改选框架；Node ABI 不匹配时先读取 `references/debug/debug-playbook.md` 中的 Node 版本排查章节，提示用户使用与本机 Node 兼容的构建；不要自动 npm 安装或退回 npm 原版运行时。
6. 最终项目只保留实际使用的 runtime；未选择框架时不得复制无关运行时构建目录。

## 何时升级 sdenv

AI 在以下信号出现时自动建议升级框架（需向用户说明原因）：

| 信号 | 建议升级到 | 原因 |
|------|-----------|------|
| `typeof document.all` 检测 | sdenv | 纯 JS 无法模拟 HTMLDDA undetectable 行为 |
| `Function("return this")()` 逃逸 | sdenv | 纯 vm 无法阻断上下文逃逸 |
| `constructor.constructor` 逃逸 | sdenv | 同上 |
| Realm / intrinsic 差异 | sdenv | 需要强隔离的 intrinsic 对齐 |
| 多 fixture 互相污染 | sdenv | 需要上下文级隔离 |
| 无以上信号 | **不使用框架** | 保持最小检测面 |

用户可随时显式指定任意框架，AI 按用户指定执行。

## Trace 复杂度评估

如果存在 RuyiTrace NDJSON、`run_with_trace.js` 产生的 JSONL、`missing-env.json` 或其他环境访问日志，必须用日志辅助理解复杂度。复杂度评估只用于判断补环境范围、排定 WebAPI 补齐优先级、识别风险和写入阶段报告，不得用于自动选择框架。

```bash
node scripts/analyze_trace_complexity.js --case-dir case --markdown
```

## 框架说明

- **Node.js 内置 vm**：用户明确选择时需显式构造干净 context，不得暴露 `process`、`Buffer`、`require`、`module`、`global`，也不得把 vm 当强安全边界。
- **sdenv**：用户明确选择时需自行安装（魔改 jsdom + C++ V8 扩展）。必须先确认 sdenv 项目路径、版本、入口模块和初始化函数；未提供文档时只能生成待适配模板，不能虚构 API。
- **jsEnv**：用户明确选择时需自行实现或安装。必须先确认项目路径、版本、入口模块和初始化函数；未提供文档时只能生成待适配模板，不能虚构 API。
- **xbs isolated-vm**：随包魔改的 isolated-vm 框架，提供 `window.xbs` / `xbs.dom.createDocument` 等 API。如目标站点随包提供 xbs runtime，需先读取 `references/env/xbs-isolated-vm-api.md` 确认 API 形状，再决定是否启用；未提供 xbs 构建时不得虚构 API。
- **C++ Addon（native-first）**：sdenv / xbs 等框架依赖的 C++ Addon 提供原生对象采集与保护能力（如 `createNativeCollection` / `getMimeTypesAndPlugins` / `jsEnv`）。Addon API 形状与可用 private API 详见 `references/env/addon-api.md`；未提供 addon 构建产物时只能生成待适配模板。

## Node ABI 兼容恢复

C++ Addon（sdenv / xbs 等）对 Node ABI 敏感，Node 升级后常出现 `addon.node` 加载失败或符号未解析。出现以下任一信号时，先读取 `references/env/node-version-recovery.md` 排查，不要直接重装框架或退回 npm 原版运行时：

- `Module did not self-register` / `The module was compiled against a different Node.js version`
- `addon.node is not a valid Win32 application`
- 升级 Node 后原本可用的 sdenv / xbs 突然 `require` 失败

排查方向：ABI 版本对齐 / `node-gyp rebuild` / 切换到匹配 Node 版本 / 使用 `scripts/check_node_runtime_compat.js` 检测兼容性。平台缺失时要求用户提供匹配构建产物或改选框架；不要自动 `npm install` 或退回 npm 原版运行时。

## 二次提醒触发条件

如果默认未使用框架，但后续出现普通上下文无法阻断 `Function("return this")()`、`constructor.constructor`、Realm / intrinsic 差异、全局对象污染、多 fixture 互相影响等问题，暂停并建议用户切换。不得自动启用框架，需用户确认。

## 交付检查

- 框架选择已记录。
- Trace 复杂度评估已写入阶段报告（如果存在 Trace）。
- 未选择框架时最终项目不含无关运行时构建目录或 runtime。

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/jsvmp-ruishu6-cookie-412-sdenv.md` | sdenv 框架选择（魔改 jsdom + C++ V8 扩展） |
