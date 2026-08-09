/**
 * final.js — 验证码逆向交付物【单一入口】（load → solve → verify 三段链路）。
 *
 * 与签名逆向模板（final-entry/）的区别：
 *   - 签名逆向：生成参数 → 请求（单段）
 *   - 验证码：load（拿 challenge+素材）→ solve（求解答案）→ verify（提交加密答案+轨迹换凭据）→ 业务接口消费凭据（三段+消费）
 *
 * 双重角色：
 *   - 自验：   node final.js            → 完整走 load→solve→verify→业务接口，交叉验证 5 次
 *   - 库调用： const { solveCaptcha, verifyChain } = require('./result');  → 只取 API，不自动执行
 *
 * 含 require.main 守卫。硬编码纪律（红线）：不含浏览器自动化代码；challenge 每次重新 load，不复用。
 *
 * 使用方式：
 *   node final.js                       # 默认：完整链路发真实请求，交叉验证 5 次
 *   node final.js --verify 5            # 指定验证次数
 *   node final.js --sign-only           # 仅输出 verify 参数（w 等），不发真实请求
 *   node final.js --cookie "name=value" # 注入用户 cookie（业务接口需要登录态时）
 *
 * answer JSON 契约见 references/captcha/captcha-overview.md；
 * 成功基线/失败复盘见 scripts/check_success_baseline.js + check_verification_attempts.js。
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// 依赖（由用户从 templates 复制到 result/src/ 后填充）
// ============================================================
// 请求客户端：从 templates/node-request/client.js 复制到 result/src/request/client.js
const { createRequestSession, CookieJar } = require('./src/request/client');
// verify 加密入口：用户自行实现（参考 cases/ + references/captcha/），需导出 encryptVerifyParam + buildVerifyPayload
const verifier = require('./src/verifier');
// 答案求解器：本地 ddddocr 或打码平台适配器，需导出 solve(imageBytes, type, options) → answer JSON
let solver = null;
try { solver = require('./src/solver'); } catch (_) { solver = null; }

// ============================================================
// 配置（静态外置 config.json + 内置默认）
// ============================================================
function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (_) {}
  return Object.assign({
    target: {
      page_url: '<目标页>',
      load_api: '<load/register 接口>',
      verify_api: '<verify 接口>',
      business_api: '<业务接口>',
    },
    captcha: {
      provider: 'geetest',
      captcha_type: 'slider',
      gt_or_captcha_id: '<厂商标识>',
    },
    solver: {
      mode: 'ddddocr',
      platform: '',
      api_key: '',
    },
    verify_count: 5,
  }, cfg);
}

// ============================================================
// 三段链路：load → solve → verify
// ============================================================

/**
 * ① load 阶段：拿 challenge 标识 + 素材地址
 * 返回：{ challenge, gt_or_captcha_id, bg_url, slice_url, ... }
 */
async function loadChallenge(session, config) {
  const res = await session.get(config.target.load_api, {
    params: { gt: config.captcha.gt_or_captcha_id, /* 或 captcha_id */ },
  });
  const data = res.data;
  if (!data.challenge && !data.lot_number) {
    throw new Error('load 响应缺少 challenge/lot_number：' + JSON.stringify(data).slice(0, 200));
  }
  return data;
}

/**
 * ② solve 阶段：下载素材 → 本地求解/人工接管/打码 → answer JSON
 * 返回：{ captcha_type, provider, offset/points, source_image_size, ... }（见 answer JSON 契约）
 *
 * solver 求解路径（按优先级）：
 *   1. 本地开源：ddddocr slide_match / OpenCV 模板匹配（solver.mode='ddddocr'）
 *   2. 人工接管：ddddocr/OpenCV 失效时（如易盾拼图块重着色），用 scripts/click_gap.py 点击缺口
 *      → Node 侧通过 child_process 调 Python click_gap.py，或预存坐标后命令行传入
 *   3. 打码平台：solver.mode='platform'，走 solver_request_template.py 生成请求
 */
async function solveCaptcha(session, config, loadResult) {
  // 下载素材（用与业务请求一致的 TLS 指纹客户端 + Session cookie）
  const bgUrl = loadResult.bg || loadResult.fullbg;
  const sliceUrl = loadResult.slice;
  const bgBytes = (await session.get(bgUrl, { responseType: 'arraybuffer' })).data;
  const sliceBytes = sliceUrl ? (await session.get(sliceUrl, { responseType: 'arraybuffer' })).data : null;

  if (!solver) throw new Error('未配置 solver，请实现 result/src/solver.js');
  const answer = await solver.solve(bgBytes, config.captcha.captcha_type, {
    slice: sliceBytes,
    provider: config.captcha.provider,
    source_image_size: loadResult.bg_size ? [loadResult.bg_size.w, loadResult.bg_size.h] : undefined,
  });

  // 生成轨迹（slider/drag-drop/scratch/trace）
  if (answer.offset && answer.offset.x != null && !answer.track) {
    answer.track = require('./src/track').generateMotionTrack({
      mode: 'slider', distance: answer.offset.x, duration_ms: 1100,
    });
  }

  // 填入 challenge 绑定
  answer.challenge_binding = {
    gt: loadResult.gt || config.captcha.gt_or_captcha_id,
    challenge: loadResult.challenge || '',
    lot_number: loadResult.lot_number || '',
  };
  return answer;
}

/**
 * ③ verify 阶段：加密 answer+track → 提交 → 换取通过凭据
 * 返回：{ validate, seccode, ticket, randstr, pass, rid, ... }（按厂商不同）
 */
async function verifyChain(session, config, loadResult, answer) {
  // 校验 answer JSON（交付门禁）
  // 命令行可跑：node scripts/check_captcha_answer.js --file answer.json
  const encrypted = verifier.encryptVerifyParam(answer, loadResult);
  const payload = verifier.buildVerifyPayload(encrypted, loadResult);

  // ⚠ 提交方式按厂商不同，禁止无脑 POST：
  //   极验 v3：必须 GET + JSONP（callback=geetest_<ts>，w 等参数全拼 query string），POST 返回 error_31
  //   且 w 含自定义 base64 的 ()，encodeURIComponent 后须把 %28/%29 还原为字面括号，否则被 WAF 拦
  //   其他厂商多为 POST。详见 cases/geetest-slide-popup.md 踩坑#2/#5
  const res = await session.post(config.target.verify_api, payload);
  const cred = res.data;
  if (!cred.validate && !cred.seccode && !cred.ticket && !cred.pass) {
    throw new Error('verify 响应缺少通过凭据：' + JSON.stringify(cred).slice(0, 200));
  }
  return cred;
}

/**
 * ④ 业务接口消费凭据
 */
async function callBusinessApi(session, config, credential) {
  const res = await session.post(config.target.business_api, { credential });
  return res.data;
}

// ============================================================
// 主流程：完整链路 + 交叉验证
// ============================================================
async function runOnce(config, cookieStr) {
  const session = createRequestSession(cookieStr);
  const jar = new CookieJar();
  session.defaults({ jar });

  const loadResult = await loadChallenge(session, config);
  const answer = await solveCaptcha(session, config, loadResult);
  const credential = await verifyChain(session, config, loadResult, answer);
  const bizResult = await callBusinessApi(session, config, credential);

  return { answer, credential, bizResult };
}

async function main() {
  const args = require('minimist')(process.argv.slice(2), {
    boolean: ['sign-only'],
    alias: { verify: 'n', cookie: 'c' },
    default: { verify: null },
  });
  const config = loadConfig();
  const verifyCount = args.verify || config.verify_count || 5;

  console.log(`[captcha-verify] provider=${config.captcha.provider} type=${config.captcha.captcha_type} verify=${verifyCount}`);

  if (args['sign-only']) {
    const session = createRequestSession();
    const loadResult = await loadChallenge(session, config);
    const answer = await solveCaptcha(session, config, loadResult);
    const encrypted = verifier.encryptVerifyParam(answer, loadResult);
    console.log(JSON.stringify({ load: loadResult, answer, encrypted }, null, 2));
    return;
  }

  let success = 0;
  for (let i = 1; i <= verifyCount; i++) {
    try {
      const result = await runOnce(config, args.cookie);
      success++;
      console.log(`  [${i}/${verifyCount}] OK  biz=${JSON.stringify(result.bizResult).slice(0, 100)}`);
    } catch (e) {
      console.error(`  [${i}/${verifyCount}] FAIL  ${e.message}`);
    }
  }
  console.log(`[captcha-verify] 完成 ${success}/${verifyCount}`);
  process.exit(success > 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { loadChallenge, solveCaptcha, verifyChain, callBusinessApi, runOnce };
