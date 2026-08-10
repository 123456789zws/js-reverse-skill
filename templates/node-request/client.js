/**
 * Node.js TLS 指纹兼容客户端模板
 *
 * 支持两种客户端（按优先级）：
 *   1. curl-cffi-node（impersonate Chrome/Firefox，JA3/JA4/Akamai 对齐最完善）
 *   2. impers（Node.js 原生 TLS 指纹伪装）
 *
 * 注：CycleTLS 因请求 API（ja3Request/strongRequest）与统一 request 包装不兼容，已不再作为可选客户端。
 *
 * 硬性要求：
 *   - Session 模式：同一 session 复用 Cookie jar / TLS 上下文 / HTTP2 连接
 *   - final.js 中必须使用 createRequestSession + try-finally close
 *   - 不得使用普通 fetch / axios / requests 发送最终业务请求
 *   - 仅用于授权范围内的少量最终验证请求，不用于批量访问
 */

'use strict';

// ============================================================
// 客户端检测：按优先级选择可用的 TLS 兼容客户端
// ============================================================
function detectAvailableClient() {
  // 1. curl-cffi-node（推荐：impersonate 支持最完善）
  try {
    const { CurlImpersonate } = require('curl-cffi-node');
    return { name: 'curl-cffi-node', Client: CurlImpersonate };
  } catch (e) {}

  // 2. impers
  try {
    const impers = require('impers');
    return { name: 'impers', Client: impers.Session };
  } catch (e) {}

  throw new Error(
    '未检测到 TLS 指纹兼容客户端，请安装其一：\n' +
    '  npm i curl-cffi-node   # 推荐\n' +
    '  npm i impers'
  );
}

// ============================================================
// Session 工厂：创建 TLS 指纹兼容会话
// ============================================================
/**
 * 创建请求 Session
 * @param {Object} options
 * @param {string} [options.impersonate='chrome135']  目标浏览器指纹（curl-cffi-node）
 * @param {string} [options.userAgent]                自定义 UA（必须与签名用 UA 一致）
 * @param {Object} [options.headers]                  默认 Header
 * @param {string} [options.proxy]                    代理
 * @param {boolean} [options.followRedirects=true]    是否跟随重定向
 * @returns {Promise<RequestSession>}
 */
async function createRequestSession(options = {}) {
  const { name, Client } = detectAvailableClient();
  const {
    impersonate = 'chrome135',
    userAgent,
    headers = {},
    proxy,
    followRedirects = true,
  } = options;

  const finalHeaders = {
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...headers,
  };
  if (userAgent) finalHeaders['User-Agent'] = userAgent;

  let session;
  if (name === 'curl-cffi-node') {
    // curl-cffi-node：impersonate 模式
    session = new Client({
      impersonate,
      headers: finalHeaders,
      proxy,
      follow_redirects: followRedirects,
    });
  } else if (name === 'impers') {
    session = new Client({
      headers: finalHeaders,
      proxy,
      followRedirects,
    });
  } else {
    throw new Error(`不支持的客户端：${name}`);
  }

  // 统一包装 request 方法（适配 curl-cffi-node / impers）
  const rawRequest = session.request ? session.request.bind(session) : null;
  if (rawRequest) {
    session.request = async function (method, url, opts = {}) {
      // 合并 defaults
      const defaults = session._defaults || {};
      const mergedOpts = { ...defaults, ...opts };
      // 构建 query string
      let finalUrl = url;
      if (mergedOpts.params) {
        const urlObj = new URL(url);
        for (const [k, v] of Object.entries(mergedOpts.params)) {
          urlObj.searchParams.set(k, String(v));
        }
        finalUrl = urlObj.toString();
      }
      const merged = {
        method,
        url: finalUrl,
        headers: { ...finalHeaders, ...(mergedOpts.headers || {}) },
        body: mergedOpts.body,
        proxy: mergedOpts.proxy || proxy,
        followRedirects: mergedOpts.followRedirects ?? followRedirects,
        timeout: mergedOpts.timeout || 30,
      };
      const res = await rawRequest(merged);
      const response = {
        status: res.status,
        headers: res.headers,
        body: res.body,
        text: () => Promise.resolve(typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
        json: () => Promise.resolve(typeof res.body === 'string' ? JSON.parse(res.body) : res.body),
      };
      // data 属性：与 Axios 的 res.data 语义对齐
      Object.defineProperty(response, 'data', {
        get() {
          if (mergedOpts.responseType === 'arraybuffer' || mergedOpts.responseType === 'buffer') {
            return res.body;
          }
          if (typeof res.body === 'string') {
            try { return JSON.parse(res.body); } catch { return res.body; }
          }
          return res.body;
        },
      });
      // Cookie 自动管理
      if (mergedOpts.jar && res.headers['set-cookie']) {
        mergedOpts.jar.merge(res.headers['set-cookie']);
      }
      return response;
    };
  }

  // 便捷方法：get/post/defaults
  session.get = async function (url, opts = {}) { return session.request('GET', url, opts); };
  session.post = async function (url, opts = {}) { return session.request('POST', url, opts); };
  session._defaults = {};
  session.defaults = function (opts = {}) {
    Object.assign(session._defaults, opts);
    return session;
  };

  session._clientName = name;
  session._impersonate = impersonate;
  return session;
}

// ============================================================
// Cookie Jar 简易实现（与 Session 绑定）
// ============================================================
class CookieJar {
  constructor() { this.cookies = new Map(); }

  set(name, value, domain = '') {
    this.cookies.set(`${domain}:${name}`, { value, domain });
  }

  get(name, domain = '') {
    return this.cookies.get(`${domain}:${name}`)?.value;
  }

  toString(domain = '') {
    const items = [];
    for (const [key, c] of this.cookies) {
      if (!domain || c.domain === domain || key.endsWith(`:${domain}`)) {
        items.push(`${key.split(':').pop()}=${c.value}`);
      }
    }
    return items.join('; ');
  }

  merge(setCookieHeader, domain = '') {
    if (!setCookieHeader) return;
    const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const item of list) {
      const pair = item.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.set(name, value, domain);
    }
  }
}

// ============================================================
// 使用示例（在 final.js 中引用）
// ============================================================
//
// const { createRequestSession, CookieJar } = require('./request/client');
//
// async function main() {
//   const session = createRequestSession({
//     impersonate: 'chrome135',
//     userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...',
//   });
//   const jar = new CookieJar();
//
//   try {
//     // 1. 访问主页刷新 Cookie
//     const home = await session.request('GET', 'https://example.com/');
//     jar.merge(home.headers['set-cookie']);
//
//     // 2. 调用前置接口
//     const init = await session.request('GET', 'https://example.com/api/init', {
//       headers: { Cookie: jar.toString() },
//     });
//     jar.merge(init.headers['set-cookie']);
//     const { secretKey } = init.json();
//
//     // 3. 生成签名
//     const sign = generateSign({ ts: Date.now() }, secretKey);
//
//     // 4. 发送目标请求
//     const res = await session.request('GET', 'https://example.com/api/search', {
//       headers: { 'x-sign': sign, Cookie: jar.toString() },
//     });
//     console.log(res.json());
//   } finally {
//     if (session.close) session.close();
//   }
// }

module.exports = { createRequestSession, CookieJar, detectAvailableClient };
