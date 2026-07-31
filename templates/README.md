# 交付入口模板索引

本目录提供 6 类交付入口模板，复制到 `case/result/` 后按站点签名逻辑填充。

## 模板清单

| 模板 | 入口文件 | 解法模式 | 用途 |
|------|---------|---------|------|
| `final-entry/` | `final.js` + `config.json` + `package.json` | 所有模式 | **Node.js 唯一执行入口**：`final.js` 默认发真实 API 请求验证（≥5 次），带 `require.main` 守卫（被 `require('./result')` 时只导出 `sign` / `buildSignedRequest` 等 API、不自动执行、不发请求）；`config.json` 外置静态配置；`package.json` 依赖契约 |
| `node-request/` | `client.js` | B/C/D | **Node.js TLS 客户端**：curl-cffi-node → impers 优先级检测（已移除 CycleTLS）。纯算法模式 A 且无 TLS 指纹检测时可跳过 |
| `python-request/` | `final.py` + `client.py` + `requirements.txt` | A/B/C/D | **Python 唯一执行入口 + TLS 客户端**：`final.py` 自验（带 `__main__` 守卫，可被 `from final import sign` 取 API）、默认发真实请求（≥5 次）；`client.py` 提供 `create_request_session`+`CookieJar`（curl_cffi → cffi_curl → cyCronet 优先级）；`requirements.txt` 依赖契约 |
| `vm-sandbox/` | `install-env.js` + `vm-context.js` + `native-protect.js` | B/D | **补环境安装**：JS 层 NativeProtect 保护（`native-protect.js` 已内联，交付物不依赖 skill 仓库） |
| `wasm-loader/` | `loader.js` | C | **WASM 加载器**：buffer 实例化 + importObject 注入 |
| `captcha-verify/` | `final.js` + `config.json` + `package.json` | 验证码 | **验证码逆向专用**：load→solve→verify 三段链路 + 业务接口消费凭据；answer JSON 契约衔接 solver/verifier；challenge 一次性不复用 |

## 模板间引用关系

```
final.js（唯一执行入口，带 require.main 守卫）
  ├── 引用 ./src/signer.js          → 用户实现 generateSign + buildParams
  ├── 引用 ./src/env/install-env.js → 复制自 vm-sandbox/install-env.js（含内联 native-protect.js）
  ├── 引用 ./src/request/client.js  → 复制自 node-request/client.js
  └── 读 ./config.json（静态外置配置）

result/ 被其他项目调用：const { sign, buildSignedRequest } = require('/path/to/result');  // 守卫生效，不自动执行
```

Python 交付同理：`final.py` 唯一执行入口，引用 `python-request/client.py`（含 CookieJar）与 `src/signer.py`（实现 `generate_sign(params, env)` + `build_params(config)`）；若需补环境，通过 `execjs` 桥接 `vm-sandbox/install-env.js`。

## 使用方式

1. Phase 4 编码时，根据解法模式选择对应模板
2. 复制模板文件到 `case/result/`（`final-entry/`：final.js + config.json + package.json）
3. 按站点签名逻辑填充 `src/signer.js` / `src/signer.py`（参考 `cases/` 中的还原代码模板）
4. `vm-sandbox/install-env.js` 是"快速验证用"简化版，正式交付时需完善原型链和构造函数（参考 `references/env/env-native-protection.md` 保护策略）
