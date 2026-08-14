#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = {
    caseDir: '.',
    inputs: '',
    url: '',
    requireTargetSignal: [],
    json: false,
    markdown: false,
    help: false,
    selfTest: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = () => {
      if (i + 1 >= argv.length || typeof argv[i + 1] !== 'string' || argv[i + 1].startsWith('-')) {
        throw new Error(`参数 ${a} 缺少值`);
      }
      i += 1;
      return argv[i];
    };
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal();
    else if (a === '--inputs' || a === '-i') args.inputs = nextVal();
    else if (a === '--url' || a === '-u') args.url = nextVal();
    else if (a === '--require-target-signal') args.requireTargetSignal.push(nextVal());
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  args.requireTargetSignal = args.requireTargetSignal.filter((s) => s && s.trim());
  return args;
}

function usage() {
  return `用法：
  node scripts/check_evidence.js --case-dir . --markdown
  node scripts/check_evidence.js --case-dir . --url <目标URL> --inputs <材料1,材料2> --markdown
  node scripts/check_evidence.js --case-dir . --url <目标URL> --require-target-signal handshake --require-target-signal /api/verify --markdown
  node scripts/check_evidence.js --case-dir . --json
  node scripts/check_evidence.js --self-test

说明：
- 取证证据门禁：在 INTENT_CONFIRM 之后、EVIDENCE_GATE 判定"用户已提供证据 / 可跳过取证"时必跑。
- 判定 Step 1（ruyipage 网络取证）与 Step 2（RuyiTrace 日志采集）的证据是否真实存在，
  并输出 none / step1-only / step2-only / both 路由。
- 退出码是硬信号：任何步骤缺失证据（missing 非空）或材料格式错误（errors 非空）时退出 1；
  两步证据齐全退出 0。调用方（含 AI）必须按退出码 + 输出文本判定，不能只看输出文本。
- Step 1 只接受有效 capture 网络记录或用户 HAR / cURL / 原始 HTTP 请求文本；JS、截图和指纹只能作为辅助材料。
- Step 2 只接受内容可解析、记录非空且关联目标域的 NDJSON；摘要不能替代 NDJSON。
- JS 落盘质量门禁：capture 记录到 JS 资源但全部落盘为空（0B）时按 Step 1 缺失处理（退出码 1），防止"带病 PASS"。
- --require-target-signal <信号>（可多次）：NDJSON 里必须出现该目标接口 URL / 关键词，
  未命中则 Step 2 判定为缺失（退出码 1）——防止“页面加载日志”冒充“目标路径已触发”。
- URL 不是证据：--url 只记录目标地址，绝不作为跳过任何取证的依据；仅提供 URL → 两步全做。
- --inputs：逗号分隔的用户声称提供材料路径（NDJSON/HAR/cURL/请求文本/JS/截图等）。
  文件必须真实存在且通过内容校验才会被计入对应步骤；失败原因会以警告列出。
- 用户粘贴的 cURL / 请求文本不是文件，必须先落盘（如 case/notes/user-request.txt）再传入。`;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function stat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function isDir(p) {
  const st = stat(p);
  return !!st && st.isDirectory();
}

function isNonEmpty(p) {
  try { return fs.statSync(p).size > 0; } catch { return false; }
}

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

function listFiles(dir, accept) {
  if (!isDir(dir)) return [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { names = []; }
  return names.filter(accept).sort().map((n) => path.join(dir, n));
}

function listScriptFiles(dir) {
  return listFiles(dir, (n) => /\.(?:js|mjs|cjs)$/i.test(n) || /\.(?:js|mjs|cjs)\.[a-f0-9]{10}$/i.test(n));
}

function listNdjsonFiles(dir) {
  return listFiles(dir, (n) => /\.(?:ndjson|jsonl)$/i.test(n));
}

function fmtSize(p) {
  if (isDir(p)) return '';
  try {
    const b = fs.statSync(p).size;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
  } catch { return '?'; }
}

function getTarget(url) {
  if (!url) return null;
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`目标 URL 只支持 HTTP(S)：${url}`);
  return { url: parsed.href, hostname: parsed.hostname.toLowerCase() };
}

function registrableDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!host || /^\d+(?:\.\d+){3}$/.test(host) || host === 'localhost') return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const compoundSuffixes = new Set(['co.uk', 'org.uk', 'com.cn', 'net.cn', 'org.cn', 'com.au', 'co.jp']);
  const suffix = labels.slice(-2).join('.');
  return labels.slice(compoundSuffixes.has(suffix) ? -3 : -2).join('.');
}

function hostMatches(hostname, targetHostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\.+|\.+$/g, '');
  const target = String(targetHostname || '').toLowerCase().replace(/^\.+|\.+$/g, '');
  return !!host && !!target && (host === target || host.endsWith(`.${target}`) || target.endsWith(`.${host}`) || registrableDomain(host) === registrableDomain(target));
}

function textMatchesTarget(text, target) {
  if (!target) return true;
  if (target.invalid || !target.hostname) return false;
  const source = String(text || '');
  const urls = source.match(/https?:\/\/[^\s"'<>\\)\]}]+/gi) || [];
  for (const value of urls) {
    try {
      if (hostMatches(new URL(value).hostname, target.hostname)) return true;
    } catch {}
  }
  return source.toLowerCase().includes(target.hostname);
}

function valueMatchesTarget(value, target, seen = new Set()) {
  if (!target || !target.hostname) return true;
  if (typeof value === 'string') return textMatchesTarget(value, target);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => valueMatchesTarget(item, target, seen));
  return Object.values(value).some((item) => valueMatchesTarget(item, target, seen));
}

function countJsonRecords(value, kind) {
  if (kind === 'HAR') return value && value.log && Array.isArray(value.log.entries) ? value.log.entries.length : 0;
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  for (const key of ['entries', 'records', 'events', 'items', 'requests', 'logs', 'data']) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  return Object.keys(value).length ? 1 : 0;
}

function inspectJson(p, target, requiredKind) {
  let value;
  try {
    value = JSON.parse(readText(p));
  } catch (err) {
    return { ok: false, parseable: false, formatError: true, recordCount: 0, targetMatched: false, reason: `JSON 解析失败：${err.message}` };
  }
  const isHar = !!(value && value.log && Array.isArray(value.log.entries));
  if (requiredKind === 'HAR' && !isHar) {
    return { ok: false, parseable: true, formatError: true, recordCount: 0, targetMatched: false, reason: 'HAR 结构无效：缺少 log.entries 数组' };
  }
  const kind = isHar ? 'HAR' : 'JSON';
  const recordCount = countJsonRecords(value, kind);
  const targetMatched = valueMatchesTarget(value, target);
  const harEntries = isHar ? value.log.entries.filter((entry) => {
    const request = entry && entry.request;
    if (!request || typeof request.url !== 'string' || typeof request.method !== 'string') return false;
    try { return /^https?:$/.test(new URL(request.url).protocol) && !!request.method.trim(); } catch { return false; }
  }) : [];
  const effectiveRecordCount = isHar ? harEntries.length : recordCount;
  const effectiveTargetMatched = isHar ? harEntries.some((entry) => valueMatchesTarget(entry, target)) : targetMatched;
  const reason = effectiveRecordCount === 0 ? '记录数量为 0' : !effectiveTargetMatched ? `未发现与目标域 ${target?.hostname || '目标域'} 关联的记录` : '';
  const result = { ok: !reason, parseable: true, recordCount: effectiveRecordCount, targetMatched: effectiveTargetMatched, kind, reason };
  Object.defineProperty(result, 'value', { value, enumerable: false });
  return result;
}

function inspectCapture(p, target) {
  const inspection = inspectJson(p, target);
  if (!inspection.parseable || !inspection.value) return inspection;
  const records = Array.isArray(inspection.value) ? inspection.value : [];
  const networkRecords = records.filter((record) => {
    if (!record || typeof record !== 'object' || typeof record.url !== 'string') return false;
    try {
      const url = new URL(record.url);
      return /^https?:$/.test(url.protocol) && typeof record.method === 'string' && !!record.method.trim();
    } catch {
      return false;
    }
  });
  const matchedRecords = networkRecords.filter((record) => valueMatchesTarget(record, target));
  const reason = networkRecords.length === 0
    ? '未发现包含 HTTP(S) URL 和 method 的网络记录'
    : matchedRecords.length === 0
      ? `未发现与目标域 ${target.hostname} 关联的网络记录`
      : '';
  const result = {
    ok: !reason,
    parseable: true,
    recordCount: matchedRecords.length,
    totalRecordCount: records.length,
    networkRecordCount: networkRecords.length,
    targetMatched: matchedRecords.length > 0,
    kind: 'capture',
    reason,
  };
  Object.defineProperty(result, 'value', { value: inspection.value, enumerable: false });
  return result;
}

function inspectNdjson(p, target, signals) {
  // 同步分块逐行读取，避免大 NDJSON 用 readText().split() 全量读入内存导致 OOM。
  // 保持同步签名：check()/runSelfTest() 无需改造成 async。
  let fd;
  try { fd = fs.openSync(p, 'r'); } catch (err) {
    return { ok: false, parseable: false, recordCount: 0, targetMatched: false, reason: `NDJSON 读取失败：${err.message}` };
  }
  const buffer = Buffer.alloc(64 * 1024);
  let leftover = '';
  let lineNo = 0;
  let recordCount = 0;
  let targetMatched = false;
  const sigHits = (signals || []).map((s) => ({ signal: s, hits: 0, sampleLine: 0 }));
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      leftover += buffer.toString('utf8', 0, bytesRead);
      let nl;
      while ((nl = leftover.indexOf('\n')) >= 0) {
        const line = leftover.slice(0, nl).trim();
        leftover = leftover.slice(nl + 1);
        if (!line) continue;
        lineNo += 1;
        let record;
        try { record = JSON.parse(line); } catch (err) {
          return { ok: false, parseable: false, formatError: true, recordCount, targetMatched: false, reason: `第 ${lineNo} 条记录解析失败：${err.message}` };
        }
        recordCount += 1;
        if (!targetMatched && valueMatchesTarget(record, target)) targetMatched = true;
        if (sigHits.length) {
          const text = JSON.stringify(record).toLowerCase();
          for (const sig of sigHits) {
            if (sig.hits > 0 || !text.includes(sig.signal.toLowerCase())) continue;
            sig.hits += 1;
            sig.sampleLine = lineNo;
          }
        }
      }
    }
  } catch (err) {
    return { ok: false, parseable: false, recordCount: 0, targetMatched: false, reason: `NDJSON 读取失败：${err.message}` };
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
  if (!recordCount) return { ok: false, parseable: true, recordCount: 0, targetMatched: false, reason: '记录数量为 0' };
  const signalEnabled = sigHits.length > 0;
  const allHit = !signalEnabled || sigHits.every((sig) => sig.hits > 0);
  const missed = sigHits.filter((sig) => sig.hits === 0).map((sig) => sig.signal);
  let reason = !targetMatched ? `未发现与目标域 ${target.hostname} 关联的记录` : '';
  if (!reason && !allHit) reason = `目标信号未命中：${missed.join('、')}（日志未触发目标接口，不能当作采集完成）`;
  return {
    ok: !reason,
    parseable: true,
    recordCount,
    targetMatched,
    reason,
    targetSignal: { enabled: signalEnabled, allHit, signals: sigHits },
  };
}

function inspectJs(p, target, linkedUrls = []) {
  let text;
  try { text = readText(p); } catch (err) {
    return { ok: false, recordCount: 0, targetMatched: false, reason: `JS 读取失败：${err.message}` };
  }
  const nonWhitespaceBytes = Buffer.byteLength(text.replace(/\s+/g, ''), 'utf8');
  const linkedTarget = linkedUrls.some((url) => textMatchesTarget(url, target));
  const targetMatched = textMatchesTarget(text, target) || textMatchesTarget(path.basename(p), target) || linkedTarget;
  const reason = nonWhitespaceBytes === 0 ? 'JS 仅包含空白内容' : !targetMatched ? `JS 未与目标域 ${target.hostname} 建立关联` : '';
  return { ok: !reason, recordCount: nonWhitespaceBytes > 0 ? 1 : 0, nonWhitespaceBytes, targetMatched, reason };
}

function inspectRequestText(p, target) {
  let text;
  try { text = readText(p); } catch (err) {
    return { ok: false, recordCount: 0, targetMatched: false, reason: `文本读取失败：${err.message}` };
  }
  const curlCount = (text.match(/(?:^|\s)curl(?:\.exe)?\s+/gim) || []).length;
  const rawRequestCount = (text.match(/^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)\s+\S+\s+HTTP\/\d(?:\.\d)?\s*$/gim) || []).length;
  const devtoolsUrlCount = (text.match(/^Request URL:\s*https?:\/\/\S+/gim) || []).length;
  const devtoolsMethodCount = (text.match(/^Request Method:\s*[A-Z]+\s*$/gim) || []).length;
  const requestCount = curlCount + rawRequestCount + Math.min(devtoolsUrlCount, devtoolsMethodCount);
  const targetMatched = textMatchesTarget(text, target);
  const reason = requestCount === 0
    ? '未识别到 cURL、原始 HTTP 请求行或 DevTools 请求文本'
    : !targetMatched
      ? `请求文本未关联目标域 ${target.hostname}`
      : '';
  const kind = curlCount > 0 ? 'cURL 文本' : 'HTTP 请求文本';
  return { ok: !reason, recordCount: requestCount, targetMatched, kind, reason };
}

function sanitizedJsName(url) {
  const clean = String(url || '').split('?')[0].split('#')[0].replace(/\/+$/, '');
  let base = clean.split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_') || 'script';
  if (!base.endsWith('.js')) base += '.js';
  const digest = crypto.createHash('sha1').update(String(url || '')).digest('hex').slice(0, 10);
  return `${base}.${digest}`;
}

function captureLinks(captureInspection) {
  const links = new Map();
  if (!captureInspection || !Array.isArray(captureInspection.value)) return links;
  for (const record of captureInspection.value) {
    if (!record || typeof record.url !== 'string') continue;
    const name = sanitizedJsName(record.url);
    if (!links.has(name)) links.set(name, []);
    links.get(name).push(record.url);
  }
  return links;
}

function isJsRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const cleanUrl = String(record.url || '').split('?')[0].split('#')[0];
  if (/\.js$/i.test(cleanUrl)) return true;
  const headers = record.response_headers || {};
  const ct = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  return ct.includes('javascript') || ct.includes('ecmascript');
}

function countCapturedJs(captureInspection) {
  if (!captureInspection || !Array.isArray(captureInspection.value)) return 0;
  return captureInspection.value.filter(isJsRecord).length;
}

function detailText(inspection) {
  const parts = [];
  if (typeof inspection.recordCount === 'number') parts.push(`记录 ${inspection.recordCount}`);
  if (typeof inspection.nonWhitespaceBytes === 'number') parts.push(`非空白 ${inspection.nonWhitespaceBytes} B`);
  if (typeof inspection.parseable === 'boolean') parts.push(inspection.parseable ? '可解析' : '不可解析');
  if (typeof inspection.targetMatched === 'boolean') parts.push(inspection.targetMatched ? '目标域匹配' : '目标域未匹配');
  if (inspection.targetSignal && inspection.targetSignal.enabled) {
    const hitText = inspection.targetSignal.signals.map((sig) => (sig.hits > 0 ? `${sig.signal}×${sig.hits}` : `${sig.signal}×0`)).join('，');
    parts.push(`目标信号[${hitText}]`);
  }
  if (inspection.reason) parts.push(inspection.reason);
  return parts.join('，');
}

function makeCheck(label, file, inspection) {
  return { label, ok: inspection.ok, file, ...inspection, detail: detailText(inspection) };
}

function classifyUserInput(p, warnings, target, signals) {
  const ext = path.extname(p).toLowerCase();
  if (!exists(p)) {
    warnings.push(`声称提供但文件不存在：${p}`);
    return { path: p, exists: false, step1: false, step2: false, kind: 'missing', recordCount: 0, reason: '文件不存在' };
  }
  if (isDir(p)) {
    warnings.push(`材料为目录（仅支持文件）：${p}`);
    return { path: p, exists: true, step1: false, step2: false, kind: 'directory', recordCount: 0, reason: '材料为目录' };
  }
  if (!isNonEmpty(p)) {
    warnings.push(`材料为空文件：${p}`);
    return { path: p, exists: true, step1: false, step2: false, kind: 'empty', recordCount: 0, reason: '文件大小为 0' };
  }
  let inspection;
  let kind;
  let step = 0;
  if (ext === '.ndjson' || ext === '.jsonl') {
    inspection = inspectNdjson(p, target, signals);
    kind = 'NDJSON';
    step = 2;
  } else if (ext === '.har') {
    inspection = inspectJson(p, target, 'HAR');
    kind = 'HAR';
    step = 1;
  } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    inspection = inspectJs(p, target);
    kind = 'JS 文件（仅辅助材料）';
  } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    const targetMatched = !target || !target.hostname || textMatchesTarget(path.basename(p), target);
    inspection = { ok: targetMatched, recordCount: 1, targetMatched, reason: targetMatched ? '截图仅作为辅助材料，不能替代网络记录' : `截图文件名未关联目标域 ${target.hostname}` };
    kind = '调用栈/截图（仅辅助材料）';
  } else if (ext === '.json') {
    inspection = inspectJson(p, target);
    kind = inspection.kind === 'HAR' ? 'HAR(JSON)' : 'JSON 材料（仅 HAR 可计入 Step 1）';
    step = inspection.kind === 'HAR' ? 1 : 0;
  } else if (ext === '.txt' || ext === '.md' || ext === '.log') {
    inspection = inspectRequestText(p, target);
    kind = inspection.ok || inspection.recordCount > 0 ? inspection.kind : '文本材料(未识别为请求证据)';
    step = inspection.recordCount > 0 ? 1 : 0;
  } else {
    inspection = { ok: false, recordCount: 0, targetMatched: false, reason: `不支持的材料类型：${ext || '无扩展名'}` };
    kind = `未知类型(${ext || '无扩展名'})`;
  }
  const accepted = step > 0 && inspection.ok;
  if (!accepted && inspection.reason) warnings.push(`材料未通过内容校验：${p}（${inspection.reason}）`);
  return {
    path: p,
    exists: true,
    step1: accepted && step === 1,
    step2: accepted && step === 2,
    kind,
    ...inspection,
    detail: detailText(inspection),
  };
}

function check(args) {
  const caseDir = path.resolve(args.caseDir);
  const caseSubdir = path.join(caseDir, 'case');
  const warnings = [];
  const missing = [];
  const target = getTarget(args.url || '');
  const step1 = { checks: [], evidence: false };
  const step2 = { checks: [], evidence: false };

  const capJson = path.join(caseSubdir, 'forensic', 'capture.json');
  const capInspection = exists(capJson) ? inspectCapture(capJson, target) : { ok: false, parseable: false, recordCount: 0, targetMatched: false, reason: '文件不存在' };
  step1.checks.push(makeCheck('case/forensic/capture.json（网络包元数据）', capJson, capInspection));

  const jsOriginalDir = path.join(caseSubdir, 'js', 'original');
  const jsFiles = listScriptFiles(jsOriginalDir);
  const links = captureLinks(capInspection);
  const jsInspections = jsFiles.map((file) => inspectJs(file, target, links.get(path.basename(file)) || []));
  const validJsCount = jsInspections.filter((item) => item.ok).length;
  const emptyJsCount = jsInspections.filter((item) => item.nonWhitespaceBytes === 0).length;
  const capturedJsCount = countCapturedJs(capInspection);
  const jsInspection = {
    ok: validJsCount > 0,
    recordCount: validJsCount,
    fileCount: jsFiles.length,
    targetMatched: jsInspections.some((item) => item.targetMatched),
    nonWhitespaceBytes: jsInspections.reduce((sum, item) => sum + (item.nonWhitespaceBytes || 0), 0),
    reason: validJsCount > 0 ? '' : jsFiles.length ? jsInspections.map((item) => item.reason).filter(Boolean).join('；') : '未找到 JS 文件',
  };
  step1.checks.push(makeCheck(`case/js/original/（JS 落盘，${jsFiles.length} 个，通过 ${validJsCount} 个）`, jsOriginalDir, jsInspection));

  const fpBaseline = path.join(caseSubdir, 'notes', 'fingerprint-baseline.json');
  const fpInspection = exists(fpBaseline) ? inspectJson(fpBaseline, target) : { ok: false, parseable: false, recordCount: 0, targetMatched: false, reason: '文件不存在' };
  step1.checks.push(makeCheck('case/notes/fingerprint-baseline.json（指纹基线）', fpBaseline, fpInspection));

  const ndjsonDir = path.join(caseSubdir, 'ruyi-trace', 'logs');
  const ndjsonFiles = listNdjsonFiles(ndjsonDir);
  const ndjsonInspections = ndjsonFiles.map((file) => inspectNdjson(file, target, args.requireTargetSignal));
  const validNdjson = ndjsonInspections.filter((item) => item.ok);
  const ndjsonInspection = {
    ok: validNdjson.length > 0,
    parseable: ndjsonFiles.length > 0 && ndjsonInspections.every((item) => item.parseable),
    recordCount: validNdjson.reduce((sum, item) => sum + item.recordCount, 0),
    fileCount: ndjsonFiles.length,
    targetMatched: validNdjson.some((item) => item.targetMatched),
    reason: validNdjson.length ? '' : ndjsonFiles.length ? ndjsonInspections.map((item) => item.reason).filter(Boolean).join('；') : '未找到 NDJSON 日志',
  };
  step2.checks.push(makeCheck(`case/ruyi-trace/logs/（NDJSON 日志，${ndjsonFiles.length} 个，通过 ${validNdjson.length} 个）`, ndjsonDir, ndjsonInspection));

  const traceSummary = path.join(caseSubdir, 'notes', 'ruyitrace-summary.md');
  const summaryText = isNonEmpty(traceSummary) ? readText(traceSummary) : '';
  const summaryMatched = !!summaryText.trim() && textMatchesTarget(summaryText, target);
  const summaryInspection = {
    ok: false,
    recordCount: summaryText.trim() ? 1 : 0,
    targetMatched: summaryMatched,
    reason: !summaryText.trim() ? '文件不存在或内容为空' : summaryMatched ? '摘要仅作为辅助信息，不能替代 NDJSON' : `摘要未关联目标域 ${target.hostname}`,
  };
  step2.checks.push(makeCheck('case/notes/ruyitrace-summary.md（trace 摘要）', traceSummary, summaryInspection));

  const errors = [];
  if (capInspection.formatError) errors.push(`材料格式错误：${capJson}（${capInspection.reason}）`);
  for (let i = 0; i < ndjsonInspections.length; i += 1) {
    if (ndjsonInspections[i].formatError) errors.push(`材料格式错误：${ndjsonFiles[i]}（${ndjsonInspections[i].reason}）`);
  }
  const userInputs = [];
  if (args.inputs) {
    for (const p of args.inputs.split(',').map((s) => s.trim()).filter(Boolean)) {
      const input = classifyUserInput(path.resolve(p), warnings, target, args.requireTargetSignal);
      userInputs.push(input);
      if (input.formatError) errors.push(`材料格式错误：${input.path}（${input.reason}）`);
    }
  }

  step1.evidence = step1.checks[0].ok || userInputs.some((u) => u.step1);
  step2.evidence = step2.checks[0].ok || userInputs.some((u) => u.step2);
  const skipStep1 = step1.evidence;
  const skipStep2 = step2.evidence;

  if (!step1.evidence) missing.push('Step 1 网络取证证据（无有效 capture 网络记录或用户 HAR / cURL / HTTP 请求文本）');
  if (!step2.evidence) {
    const required = args.requireTargetSignal || [];
    const sigPart = required.length
      ? `；且目标信号未命中：${required.join('、')}（日志未触发目标接口，不能当作采集完成）`
      : '';
    missing.push(`Step 2 RuyiTrace 日志证据（无可解析、记录非空且关联目标域的 NDJSON${sigPart}；摘要不能替代）`);
  }

  // JS 落盘质量门禁：capture 记录到 JS 资源但全部落盘为空（gzip/br 响应体未拿回 → 0B）时，
  // 取证结论会"带病 PASS"，必须硬阻断；部分缺失给警告。
  if (capturedJsCount > 0 && jsFiles.length === 0) {
    missing.push(`Step 1 JS 落盘质量：capture 记录到 ${capturedJsCount} 个 JS 资源，但 case/js/original/ 无任何落盘文件（响应体 0B/未写盘），取证质量不达标，需重采或补采 JS`);
  }
  if (capturedJsCount > 0 && jsFiles.length > 0 && emptyJsCount === jsFiles.length) {
    missing.push(`Step 1 JS 落盘质量：${jsFiles.length} 个 JS 全部为 0B/空白（capture 记录到 ${capturedJsCount} 个 JS 资源），取证质量不达标，需重采或补采 JS`);
  }
  if (emptyJsCount > 0 && emptyJsCount < jsFiles.length) {
    warnings.push(`JS 落盘不完整：${emptyJsCount}/${jsFiles.length} 个 JS 为 0B/空白，定位关键资源时注意补采`);
  }
  if (capturedJsCount > jsFiles.length && jsFiles.length > 0) {
    warnings.push(`JS 落盘不完整：capture 记录到 ${capturedJsCount} 个 JS 资源，实际落盘 ${jsFiles.length} 个（约 ${capturedJsCount - jsFiles.length} 个未写盘，可能是 0B 响应体），定位关键资源时注意补采`);
  }

  const urlOnly = !!args.url && !step1.evidence && !step2.evidence;
  const anyEvidence = step1.evidence || step2.evidence;
  const mode = !anyEvidence ? 'none' : (step1.evidence && step2.evidence) ? 'both' : step1.evidence ? 'step1-only' : 'step2-only';

  return {
    caseDir,
    caseSubdir,
    url: args.url || '',
    urlOnly,
    anyEvidence,
    mode,
    step1,
    step2,
    userInputs,
    skipStep1,
    skipStep2,
    missing,
    warnings,
    errors,
    clean: anyEvidence && missing.length === 0,
    actionable: !(urlOnly && mode === 'none'),
    capturedJsCount,
    emptyJsCount,
  };
}

function renderMarkdown(result) {
  const lines = [
    '# 取证证据门禁检查',
    '',
    `case 目录：${result.caseSubdir}`,
    `目标 URL：${result.url || '未提供'}`,
    `证据判定：${result.anyEvidence ? '存在取证证据' : '无任何取证证据'}`,
    `可跳过 Step 1（ruyipage 网络取证）：${result.skipStep1 ? '是' : '否'}`,
    `可跳过 Step 2（RuyiTrace 日志采集）：${result.skipStep2 ? '是' : '否'}`,
    '',
    '## Step 1 网络取证证据',
  ];
  for (const c of result.step1.checks) lines.push(`- [${c.ok ? 'x' : ' '}] ${c.label}${c.ok && fmtSize(c.file) ? `（${fmtSize(c.file)}）` : ''}${c.detail ? `：${c.detail}` : ''}`);
  const step1User = result.userInputs.filter((u) => u.step1);
  if (step1User.length) lines.push(`- [x] 用户材料计入 Step 1：${step1User.map((u) => `${u.path}（${u.kind}，${u.detail}）`).join('；')}`);
  lines.push('', '## Step 2 RuyiTrace 日志证据');
  for (const c of result.step2.checks) lines.push(`- [${c.ok ? 'x' : ' '}] ${c.label}${c.ok && fmtSize(c.file) ? `（${fmtSize(c.file)}）` : ''}${c.detail ? `：${c.detail}` : ''}`);
  const step2User = result.userInputs.filter((u) => u.step2);
  if (step2User.length) lines.push(`- [x] 用户材料计入 Step 2：${step2User.map((u) => `${u.path}（${u.kind}，${u.detail}）`).join('；')}`);
  lines.push('', '## 用户声称提供材料');
  if (result.userInputs.length) {
    for (const u of result.userInputs) {
      const flag = !u.exists ? '不存在' : u.step1 || u.step2 ? `计入（${u.kind}）` : `未计入（${u.kind}）`;
      lines.push(`- ${u.path}：${flag}${u.detail ? `，${u.detail}` : ''}`);
    }
  } else {
    lines.push('- 未提供（--inputs）');
  }
  if (result.errors.length) {
    lines.push('', '## 格式错误');
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  if (result.warnings.length) {
    lines.push('', '## 提醒');
    for (const w of result.warnings) lines.push(`- ${w}`);
  }
  if (result.missing.length) {
    lines.push('', '## 缺失证据（不可跳过的取证步骤）');
    for (const m of result.missing) lines.push(`- ${m}`);
  }
  lines.push('', '## 结论');
  if (result.urlOnly) {
    lines.push('- [警告] 仅提供 URL 或现有材料未通过内容校验，URL 不是证据。必须走完整两步取证：ruyipage 网络取证 + RuyiTrace 日志采集。');
  } else if (result.missing.length) {
    lines.push(`- 证据不完整，缺少：${result.missing.map((m) => m.split('（')[0]).join('；')}。对应取证步骤不可跳过。`);
    if (result.skipStep1) lines.push('- Step 1 证据已具备，可跳过 ruyipage 网络取证（或由用户材料替代）。');
    if (result.skipStep2) lines.push('- Step 2 证据已具备（有内容合格的 RuyiTrace NDJSON），可跳过日志采集。');
  } else {
    lines.push('- 两步取证证据内容校验通过，可跳过取证直接进入参数识别。');
  }
  return `${lines.join('\n')}\n`;
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-evidence-'));
  try {
    const caseDir = path.join(root, 'project');
    const forensicDir = path.join(caseDir, 'case', 'forensic');
    const jsDir = path.join(caseDir, 'case', 'js', 'original');
    const traceDir = path.join(caseDir, 'case', 'ruyi-trace', 'logs');
    fs.mkdirSync(forensicDir, { recursive: true });
    fs.mkdirSync(jsDir, { recursive: true });
    fs.mkdirSync(traceDir, { recursive: true });
    const targetUrl = 'https://api.example.com/page';
    const scriptUrl = 'https://static.example.com/app.js';
    fs.writeFileSync(path.join(forensicDir, 'capture.json'), JSON.stringify([
      { url: targetUrl, method: 'POST', request_body: 'x' },
      { url: scriptUrl, method: 'GET' },
    ]), 'utf8');
    fs.writeFileSync(path.join(jsDir, sanitizedJsName(scriptUrl)), 'window.answer = 42;\n', 'utf8');
    fs.writeFileSync(path.join(traceDir, 'trace.ndjson'), `${JSON.stringify({ api: 'fetch', url: targetUrl })}\n`, 'utf8');
    const valid = check({ caseDir, inputs: '', url: targetUrl });
    assert.strictEqual(valid.clean, true);
    assert.strictEqual(valid.mode, 'both');
    assert.strictEqual(valid.step1.checks[0].recordCount, 2);
    assert.strictEqual(valid.step1.checks[1].recordCount, 1);
    assert.strictEqual(valid.step2.checks[0].recordCount, 1);

    fs.writeFileSync(path.join(forensicDir, 'capture.json'), '{broken', 'utf8');
    fs.writeFileSync(path.join(jsDir, sanitizedJsName(scriptUrl)), '   \n', 'utf8');
    fs.writeFileSync(path.join(traceDir, 'trace.ndjson'), `${JSON.stringify({ url: 'https://other.test/' })}\nnot-json\n`, 'utf8');
    const invalid = check({ caseDir, inputs: '', url: targetUrl });
    assert.strictEqual(invalid.anyEvidence, false);
    assert.strictEqual(invalid.step1.checks[0].parseable, false);
    assert.strictEqual(invalid.step1.checks[1].recordCount, 0);
    assert.strictEqual(invalid.step2.checks[0].parseable, false);

    const har = path.join(root, 'input.har');
    fs.writeFileSync(har, JSON.stringify({ log: { entries: [{ request: { url: targetUrl, method: 'GET' } }] } }), 'utf8');
    const ndjson = path.join(root, 'input.ndjson');
    fs.writeFileSync(ndjson, `${JSON.stringify({ stack: { file: scriptUrl } })}\n`, 'utf8');
    const userEvidence = check({ caseDir: path.join(root, 'empty'), inputs: `${har},${ndjson}`, url: targetUrl });
    assert.strictEqual(userEvidence.clean, true);
    assert.strictEqual(userEvidence.userInputs[0].recordCount, 1);
    assert.strictEqual(userEvidence.userInputs[1].recordCount, 1);

    const unrelated = path.join(root, 'unrelated.har');
    fs.writeFileSync(unrelated, JSON.stringify({ log: { entries: [{ request: { url: 'https://other.test/', method: 'GET' } }] } }), 'utf8');
    const rejected = check({ caseDir: path.join(root, 'empty'), inputs: unrelated, url: targetUrl });
    assert.strictEqual(rejected.skipStep1, false);
    assert.match(rejected.userInputs[0].reason, /目标域/);

    const jsOnly = path.join(root, 'script.js');
    fs.writeFileSync(jsOnly, `fetch('${targetUrl}')`, 'utf8');
    const jsOnlyResult = check({ caseDir: path.join(root, 'js-only'), inputs: jsOnly, url: targetUrl });
    assert.strictEqual(jsOnlyResult.mode, 'none');
    assert.strictEqual(jsOnlyResult.step1.evidence, false);

    const summaryCase = path.join(root, 'summary-only');
    fs.mkdirSync(path.join(summaryCase, 'case', 'notes'), { recursive: true });
    fs.writeFileSync(path.join(summaryCase, 'case', 'notes', 'ruyitrace-summary.md'), targetUrl, 'utf8');
    const summaryOnly = check({ caseDir: summaryCase, inputs: '', url: targetUrl });
    assert.strictEqual(summaryOnly.mode, 'none');
    assert.strictEqual(summaryOnly.step2.evidence, false);

    const requestText = path.join(root, 'request.txt');
    fs.writeFileSync(requestText, `POST /page HTTP/1.1\nHost: api.example.com\n\n`, 'utf8');
    const step1Only = check({ caseDir: path.join(root, 'request-only'), inputs: requestText, url: targetUrl });
    assert.strictEqual(step1Only.mode, 'step1-only');

    const step2Only = check({ caseDir: path.join(root, 'trace-only'), inputs: ndjson, url: targetUrl });
    assert.strictEqual(step2Only.mode, 'step2-only');

    const cli = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', path.join(root, 'empty'), '--url', targetUrl, '--json'], { encoding: 'utf8' });
    assert.strictEqual(cli.status, 1); // 缺失证据 → 退出码 1（硬信号）

    // 目标信号：命中通过、未命中按缺失处理
    const sigRoot = path.join(root, 'sig');
    const sigForensic = path.join(sigRoot, 'case', 'forensic');
    const sigTrace = path.join(sigRoot, 'case', 'ruyi-trace', 'logs');
    fs.mkdirSync(sigForensic, { recursive: true });
    fs.mkdirSync(sigTrace, { recursive: true });
    fs.writeFileSync(path.join(sigForensic, 'capture.json'), JSON.stringify([{ url: targetUrl, method: 'POST', request_body: 'x' }]), 'utf8');
    fs.writeFileSync(path.join(sigTrace, 'trace.ndjson'), `${JSON.stringify({ api: 'fetch', url: targetUrl })}\n`, 'utf8');
    const sigHitCli = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', sigRoot, '--url', targetUrl, '--require-target-signal', 'handshake', '--markdown'], { encoding: 'utf8' });
    assert.strictEqual(sigHitCli.status, 1); // NDJSON 关联目标域但无 handshake 信号 → 退出码 1
    assert.match(sigHitCli.stdout, /目标信号未命中/);
    const sigBoth = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', sigRoot, '--url', targetUrl, '--require-target-signal', targetUrl, '--markdown'], { encoding: 'utf8' });
    assert.strictEqual(sigBoth.status, 0); // 信号命中 → 通过

    const bothRoot = path.join(root, 'both');
    const bothForensic = path.join(bothRoot, 'case', 'forensic');
    const bothJs = path.join(bothRoot, 'case', 'js', 'original');
    const bothTrace = path.join(bothRoot, 'case', 'ruyi-trace', 'logs');
    fs.mkdirSync(bothForensic, { recursive: true });
    fs.mkdirSync(bothJs, { recursive: true });
    fs.mkdirSync(bothTrace, { recursive: true });
    fs.writeFileSync(path.join(bothForensic, 'capture.json'), JSON.stringify([{ url: targetUrl, method: 'POST', request_body: 'x' }]), 'utf8');
    fs.writeFileSync(path.join(bothJs, sanitizedJsName(scriptUrl)), 'window.answer = 42;\n', 'utf8');
    fs.writeFileSync(path.join(bothTrace, 'trace.ndjson'), `${JSON.stringify({ api: 'fetch', url: targetUrl })}\n`, 'utf8');
    const bothCli = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', bothRoot, '--url', targetUrl, '--json'], { encoding: 'utf8' });
    assert.strictEqual(bothCli.status, 0); // 两步证据齐全 → 退出码 0

    // JS 落盘质量门禁：capture 记录到 JS 但全部落盘为空 → 硬阻断（防"带病 PASS"）
    const jsGateRoot = path.join(root, 'js-gate');
    const jsGateForensic = path.join(jsGateRoot, 'case', 'forensic');
    const jsGateJs = path.join(jsGateRoot, 'case', 'js', 'original');
    const jsGateTrace = path.join(jsGateRoot, 'case', 'ruyi-trace', 'logs');
    fs.mkdirSync(jsGateForensic, { recursive: true });
    fs.mkdirSync(jsGateJs, { recursive: true });
    fs.mkdirSync(jsGateTrace, { recursive: true });
    fs.writeFileSync(path.join(jsGateForensic, 'capture.json'), JSON.stringify([
      { url: targetUrl, method: 'POST', request_body: 'x' },
      { url: scriptUrl, method: 'GET' },
    ]), 'utf8');
    fs.writeFileSync(path.join(jsGateJs, sanitizedJsName(scriptUrl)), '', 'utf8'); // 0B 落盘
    fs.writeFileSync(path.join(jsGateTrace, 'trace.ndjson'), `${JSON.stringify({ api: 'fetch', url: targetUrl })}\n`, 'utf8');
    const jsGateCli = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', jsGateRoot, '--url', targetUrl, '--markdown'], { encoding: 'utf8' });
    assert.strictEqual(jsGateCli.status, 1); // JS 全部 0B → 退出码 1
    assert.match(jsGateCli.stdout, /JS 落盘质量/);
    const jsGatePartial = check({ caseDir: jsGateRoot, inputs: '', url: targetUrl });
    assert.strictEqual(jsGatePartial.capturedJsCount, 1);
    assert.strictEqual(jsGatePartial.emptyJsCount, 1);

    // JS 部分缺失：capture 记录到多个 JS，但只落盘一部分 → 仅警告，不硬阻断
    const jsPartialRoot = path.join(root, 'js-partial');
    const jsPartialForensic = path.join(jsPartialRoot, 'case', 'forensic');
    const jsPartialJs = path.join(jsPartialRoot, 'case', 'js', 'original');
    const jsPartialTrace = path.join(jsPartialRoot, 'case', 'ruyi-trace', 'logs');
    fs.mkdirSync(jsPartialForensic, { recursive: true });
    fs.mkdirSync(jsPartialJs, { recursive: true });
    fs.mkdirSync(jsPartialTrace, { recursive: true });
    const scriptUrl2 = 'https://static.example.com/helper.js';
    fs.writeFileSync(path.join(jsPartialForensic, 'capture.json'), JSON.stringify([
      { url: targetUrl, method: 'POST', request_body: 'x' },
      { url: scriptUrl, method: 'GET' },
      { url: scriptUrl2, method: 'GET' },
    ]), 'utf8');
    fs.writeFileSync(path.join(jsPartialJs, sanitizedJsName(scriptUrl)), 'window.answer = 42;\n', 'utf8');
    fs.writeFileSync(path.join(jsPartialTrace, 'trace.ndjson'), `${JSON.stringify({ api: 'fetch', url: targetUrl })}\n`, 'utf8');
    const jsPartial = check({ caseDir: jsPartialRoot, inputs: '', url: targetUrl });
    assert.strictEqual(jsPartial.capturedJsCount, 2);
    assert.strictEqual(jsPartial.step1.checks[1].fileCount, 1);
    assert.ok(jsPartial.warnings.some((w) => w.includes('未写盘')), '部分缺失 JS 应产生警告');

    const brokenHar = path.join(root, 'broken.har');
    fs.writeFileSync(brokenHar, '{broken', 'utf8');
    const brokenCli = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', path.join(root, 'empty'), '--inputs', brokenHar, '--json'], { encoding: 'utf8' });
    assert.strictEqual(brokenCli.status, 1);
    return { clean: true, tests: 33 };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(usage()); process.exit(0); }
    if (args.selfTest) {
      const result = runSelfTest();
      console.log(`check_evidence.js 自测通过：${result.tests} 项断言`);
      process.exit(0);
    }
    const result = check(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    process.exit(result.errors.length || result.missing.length ? 1 : 0);
  } catch (err) {
    console.error(err.stack || err.message || String(err));
    console.error(usage());
    process.exit(1);
  }
}

module.exports = { check };
