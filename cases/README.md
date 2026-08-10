# 逆向经验库（Cases）

本目录存放已验证的逆向分析经验案例,供 CHECK-2 速查阶段自动检索。

> **本目录是经验库（只读参考）**：运行期 skill 目录通常不可写，**新增经验先沉淀到 `result/`**（按 `_template.md` 的 **Part 2** 格式，文件名如 `result/经验沉淀-<站点>.md`），由 skill 维护者周期性合并进本目录；agent 运行期不要直接写本目录。

## 案例索引

| 案例文件 | 技术特征 | 难度 | 核心方案 | 反爬类型 |
|---------|---------|------|---------|---------|
| [jsvmp-xhr-interceptor-env-emulation.md](jsvmp-xhr-interceptor-env-emulation.md) | JSVMP + XHR 拦截器 + 多层 SDK + jsdom | ★★★★★ | jsdom 沙箱 + 58 项环境补丁 | 行为型 |
| [jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md](jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md) | JSVMP 双签名 + XHR/fetch 双通道 + cacheOpts | ★★★★★ | jsdom + Firefox native code 伪装 + got-scraping TLS | 行为型 |
| [jsvmp-ruishu6-cookie-412-sdenv.md](jsvmp-ruishu6-cookie-412-sdenv.md) | RS6 412 挑战 Cookie + 业务层 md5 签名 + GET 接口（双层防护） | ★★★★★ | D sdenv 生成 RS6 Cookie + A 纯算业务 sign | 签名型 |
| [universal-vmp-source-instrumentation.md](universal-vmp-source-instrumentation.md) | 通用 VMP 骨架(RS/Akamai/webmssdk) | ★★★★ | 源码级插桩 + hot_keys 学习 | 混合 |
| [vm-sandbox-custom-algo.md](vm-sandbox-custom-algo.md) | 自定义 MD5/混淆算法，vm 沙箱执行（骨架模板） | ★★★ | vm.createContext + 最小 sandbox | 无/轻检测 |
| [vm-sandbox-chameleon-iwencai.md](vm-sandbox-chameleon-iwencai.md) | chameleon.js 混淆 + cookie"v"=hexin-v + try-catch 静默吞错 + 中等量环境 stub | ★★★ | vm.createContext + 中等量浏览器环境 stub(Element/Document/XHR) | 无/轻检测 |
| [sm2-sm4-sm3-guomi-jobonline.md](sm2-sm4-sm3-guomi-jobonline.md) | SM2/SM4/SM3 国密三参数签名 + 随机密钥下发 | ★★ | 纯 Node 复现(sm-crypto) | 无(标准国密) |
| [jsvmp-bundle-bdms-a_bogus-douyin.md](jsvmp-bundle-bdms-a_bogus-douyin.md) | JSVMP + bundle.js 常驻 + bdms.init + XHR patch + uncaughtException 兜底 | ★★★★ | vm + 手写环境补丁 + XHR patch 只真发 mssdk 请求 | 行为型 |
| [jsvmp-dual-sign-purealgo-vm-xiaohongshu.md](jsvmp-dual-sign-purealgo-vm-xiaohongshu.md) | JSVMP + X-s/X-s-common 双轨（纯算 + vm 沙箱）+ 修改版 CRC32 + 自定义 Base64 | ★★★★ | A 纯算（X-S-Common）+ B vm 沙箱（X-s）双轨 | 签名型 |
| [browser-extract-modified-md5-yuanrenxue.md](browser-extract-modified-md5-yuanrenxue.md) | obfuscator.io + 修改版 MD5(T常量含动态时间戳) + WAF cookie + charCode反hook | ★★★ | puppeteer 提取 m/f/完整cookie + Node.js https 请求 | 签名型 |
| [kuaishou-hxfalcon-kww-reverse.md](kuaishou-hxfalcon-kww-reverse.md) | __NS_hxfalcon + kww + Jose 模块 + kwpsec JSVMP | ★★★★ | A 纯算（__NS_hxfalcon/kww SSR fallback）+ D 黑盒（kww 浏览器端） | 签名型 |
| [jsvmp-baidu-waf-nox-tox-gitee.md](jsvmp-baidu-waf-nox-tox-gitee.md) | 百度 WAF 三件套（Banti+nox+tox）JSVMP + nox_jst_v1 cookie + tox_token query | ★★★★ | D 环境伪装（vm 沙箱补环境，构造函数+Object.create） | 签名型 |
| [jsvmp-dual-vm-location-whitelist-qqmusic.md](jsvmp-dual-vm-location-whitelist-qqmusic.md) | JSVMP 双 VM + location.host 白名单静默降级 + musics.fcg 加解密（zzc 签名 + ag-1 加密） | ★★★ | B vm 沙箱执行 + D 环境伪装（Node vm + `window===self` 自引用 + 域名守卫） | 签名型 |
| [yidun-intellisense-vm-env.md](yidun-intellisense-vm-env.md) | 易盾智能无感验证码（type=5）：core-optimi SDK obfuscator 混淆 + 自定义 AES/XOR + vm 沙箱补环境 | ★★★★ | D 环境伪装（vm 沙箱运行 SDK，模块访问器直调）+ neguardian 共用 AES | 验证码型 |
| [yidun-jigsaw.md](yidun-jigsaw.md) | 易盾滑块(type=2) check 参数 d/m/p/f/ext：core-optimi 模块提取 + SDK 阶梯轨迹 + m 空串陷阱 + SCAN_PX 坐标扫描 | ★★★★ | A 纯算还原（d/p/f/ext 加密链）+ 打码坐标 + SCAN_PX 扫描 | 验证码型 |
| [jsvmp-h5st-js-security-v3-jd.md](jsvmp-h5st-js-security-v3-jd.md) | 京东 h5st（js_security_v3 JSVMP）+ TLS 指纹校验（JA3/JA4 仅 Firefox 系）+ 会话级 fp/eid 绑定 + 动态密钥预热 | ★★★★★ | B vm 沙箱执行原版 + D 环境伪装（curl-cffi-node firefox133） | 签名型+行为型 |

> 同质化案例（不进速查表，按需读取）：[sha1-sort-params-zhitongcaijing.md](sha1-sort-params-zhitongcaijing.md) — 标准 SHA1 签名，供同站升级参考

## 使用方式

```
CHECK-2 速查:
1. 目标 URL 域名 / 搜索到的 JS 变量名 / 请求参数名 → 查上表
2. 命中 → 读取对应案例文件,踩坑记录内化为约束
3. 未命中 → 走标准 Phase 0-5,结束时把新经验沉淀到 `result/`（不写本目录）
```

## 指纹匹配快速参考

| 技术特征关键词 | 匹配案例 | 置信度 |
|--------------|---------|--------|
| `webmssdk` / `byted_acrawler` / `_SdkGlueInit` | jsvmp-xhr-interceptor-env-emulation | 高 |
| `cacheOpts` + `X-Gnarly` | jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox | 高(国际版双签名) |
| `a_bogus` + 180-192 字符 + 无 cacheOpts | jsvmp-xhr-interceptor-env-emulation | 高(国内版单签名) |
| `sdenv` / `FSSBBIl1UgzbN7N` / 412 挑战 | jsvmp-ruishu6-cookie-412-sdenv | 高(RS) |
| `while-switch` + 200KB+ 文件 | universal-vmp-source-instrumentation | 中(通用骨架) |
| `E-CONTENT-PATH` / `E-SIGN` / `businessData` + SM2/SM4/SM3 | sm2-sm4-sm3-guomi-jobonline | 高(国密) |
| 自定义 MD5(非标准输出) / 混淆算法不可静态还原 / eval 包裹算法 | vm-sandbox-custom-algo | 中(自定义算法) |
| `chameleon` / `hexin-v` / `TOKEN_SERVER_TIME` + try-catch 静默吞错 | vm-sandbox-chameleon-iwencai | 高(同花顺) |
| `bdms.init` / `signUrl` / `bundle.js` 常驻 + `a_bogus` + `mssdk.bytedance.com` | jsvmp-bundle-bdms-a_bogus-douyin | 高(抖音常驻) |
| `X-s` / `X-s-common` / `XYS_` + `as-v2-ds.js` + 修改版 CRC32 + 自定义 Base64 | jsvmp-dual-sign-purealgo-vm-xiaohongshu | 高(小红书双轨) |
| `RM4hZBv0dDon443M` / 修改版 MD5(T常量含动态时间戳) + `$_zw` 指纹数组 + charCode 反hook | browser-extract-modified-md5-yuanrenxue | 高(猿人学浏览器提取) |
| `nox_jst_v1` cookie / `tox_token` query / `gangplank`+`nox`+`tox` 三件套 / `wafbotsr.baidu.com` / `mejd42mp` 标识 / `window.Tox.getToken` | jsvmp-baidu-waf-nox-tox-gitee | 高(百度 WAF 三件套) |
| `_getSecuritySign` / `__cgiEncrypt` / `__cgiDecrypt` + `musics.fcg` + `sign=zzc...`(44位) + `encoding=ag-1` + 两段 JSVMP IIFE | jsvmp-dual-vm-location-whitelist-qqmusic | 高(QQ音乐) |
| `__NS_hxfalcon` / `kww` / `Jose` 模块 + `kwpsec` JSVMP | kuaishou-hxfalcon-kww-reverse | 高(快手双轨) |
| `dun.163.com` / `c.dun.163.com` / `NECaptcha` / `core-optimi.*.min.js` / `neguardian` / `gdxidpyhxde` / `vfnv46` / type=5 无感 | yidun-intellisense-vm-env | 高(易盾智能无感) |
| `dun.163.com` / `NECaptcha` / check data `m` 空串 / `__JSONP_` callback / slider type=2 / 阶梯轨迹 | yidun-jigsaw | 高(易盾滑块 check) |
| `js_security_v3` / `ParamsSign` / `h5st` 10 字段分号分隔 / `request_algo` / `cactus.jd.com` / `x-api-eid-token` / `jdd03` / `api.m.jd.com` + 403 空 body | jsvmp-h5st-js-security-v3-jd | 高(京东 h5st) |

## 新增案例

> 运行期不要直接写本目录：新经验先落 `result/经验沉淀-<站点>.md`，由维护者周期性并入本目录。

1. 复制 `_template.md` 的 **Part 2 · 经验库归档条目** 骨架为新文件，以技术特征命名（如 `jsvmp-xxx.md`）
2. 补全头部元数据块：难度 / 还原方案 / 实现语言 / 最后验证日期 / 平台类型
3. 填写 5 个标准段（**缺一不可**）：技术指纹（供 CHECK-2 自动匹配）/ 加密方案 / 踩坑记录 / 可验证事实清单（经验资产）/ 相关参考
4. 在"可验证事实清单（经验资产）"段列 5-15 条最小可验证事实
5. 更新本文件的案例索引表和指纹匹配表
