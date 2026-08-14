#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = {
    input: '',
    caseDir: '',
    name: '',
    maxExamples: 10,
    truncationThreshold: 3900,
    maxTruncationExamples: 50,
    targetSignals: [],
    noSummaryWrite: false,
    json: false,
    markdown: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--input') args.input = nextVal('');
    else if (a === '--case-dir' || a === '--dir') args.caseDir = nextVal('');
    else if (a === '--name') args.name = nextVal('');
    else if (a === '--max-examples') args.maxExamples = Number(nextVal('10'));
    else if (a === '--truncation-threshold') args.truncationThreshold = Number(nextVal('3900'));
    else if (a === '--max-truncation-examples') args.maxTruncationExamples = Number(nextVal('50'));
    else if (a === '--target-signal') args.targetSignals.push(nextVal(''));
    else if (a === '--no-summary-write') args.noSummaryWrite = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!Number.isFinite(args.truncationThreshold) || args.truncationThreshold < 1) args.truncationThreshold = 3900;
  if (!Number.isFinite(args.maxTruncationExamples) || args.maxTruncationExamples < 1) args.maxTruncationExamples = 50;
  args.targetSignals = args.targetSignals.filter((s) => s && s.trim());
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir . --markdown
  node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir . --truncation-threshold 3900 --json
  node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir . --target-signal handshake --target-signal /api/verify --markdown

说明：--case-dir 指项目根目录（其下应有 case/ 和 result/ 两个平级子目录），默认当前目录。复制 RuyiTrace NDJSON 日志到 <case-dir>/case/ruyi-trace/logs/，生成 <case-dir>/case/notes/ruyitrace-summary.md，并标记接近 4000 / 4096 字符的字段为“疑似被 RuyiTrace 截断”。
--target-signal <信号>（可多次）：扫描日志是否命中目标接口 URL / 关键词，未命中时退出码非 0，作为“目标路径未覆盖”的硬信号，不得当作采集完成。
--no-summary-write：不覆盖写入 notes/ruyitrace-summary.md。capture_ruyitrace_log.js 对 cookie/storage/event 等分类日志导入时使用，避免分类日志覆盖主 DOM trace 摘要。`;
}

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function safeName(name) {
  return String(name || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180);
}

function inc(map, key) {
  key = key || '(空)';
  map.set(key, (map.get(key) || 0) + 1);
}

function top(map, n) {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([key, count]) => ({ key, count }));
}

function classifyApi(api) {
  api = String(api || '');
  if (/Canvas|CanvasRenderingContext2D|OffscreenCanvas/.test(api)) return 'canvas';
  if (/WebGL|GLRenderingContext/.test(api)) return 'webgl';
  if (/Audio|Oscillator|Analyser|OfflineAudioContext/.test(api)) return 'audio';
  if (/Navigator|navigator/.test(api)) return 'navigator';
  if (/Screen|screen/.test(api)) return 'screen';
  if (/Crypto|getRandomValues|randomUUID/.test(api)) return 'crypto';
  if (/Performance|performance/.test(api)) return 'performance';
  if (/Storage|localStorage|sessionStorage|IndexedDB|IDB/.test(api)) return 'storage';
  if (/WebRTC|RTCPeerConnection|MediaDevices/.test(api)) return 'webrtc';
  if (/Worker|ServiceWorker|postMessage|MessageChannel/.test(api)) return 'worker-message';
  if (/Document|Element|Node|CSS|Style|Layout|DOMRect/.test(api)) return 'dom-layout';
  return 'other';
}

function visibleHash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function preview(value, side = 80) {
  const text = String(value || '');
  if (text.length <= side * 2) return text;
  return `${text.slice(0, side)}...${text.slice(-side)}`;
}

function stackBrief(evt) {
  const stack = Array.isArray(evt && evt.stack) ? evt.stack : [];
  const first = stack.find(s => s && (s.file || s.line || s.col));
  if (!first) return '';
  const loc = [first.file || '', first.line || '', first.col || ''].filter(v => v !== '').join(':');
  return loc;
}

function walkStrings(value, visitor, currentPath = '') {
  const stack = [{ value, path: currentPath }];
  while (stack.length) {
    const { value: v, path: p } = stack.pop();
    if (typeof v === 'string') {
      visitor(p || '$', v);
      continue;
    }
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push({ value: v[i], path: `${p}[${i}]` });
    } else {
      for (const [k, child] of Object.entries(v)) {
        const nextPath = p ? `${p}.${k}` : k;
        stack.push({ value: child, path: nextPath });
      }
    }
  }
}

function collectTruncationSignals(evt, lineNo, threshold, maxExamples, state) {
  const api = evt.api || evt.name || evt.path || '';
  walkStrings(evt, (fieldPath, value) => {
    const visibleLength = value.length;
    if (visibleLength < threshold) return;
    state.totalSuspectedFields++;
    state.maxVisibleLength = Math.max(state.maxVisibleLength, visibleLength);
    inc(state.byFieldPath, fieldPath);
    inc(state.byApi, api || '(空)');
    if (state.examples.length >= maxExamples) return;
    state.examples.push({
      line: lineNo,
      api: api || '(空)',
      fieldPath,
      visibleLength,
      minLength: visibleLength,
      actualLength: 'unknown',
      truncationSuspected: true,
      reason: `字段可见长度达到阈值 ${threshold}，RuyiTrace 可能已截断长字符串，不能把可见长度当成真实长度。`,
      stack: stackBrief(evt),
      visibleSha256: visibleHash(value),
      visiblePreview: preview(value),
    });
  });
}

function sanitizeLongStrings(value, threshold, currentPath = '') {
  const root = { value, path: currentPath, out: undefined, children: null, idx: 0 };
  const stack = [root];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.children === null) {
      const v = frame.value;
      if (typeof v === 'string') {
        frame.out = v.length < threshold ? v : {
          __ruyiTraceLongString__: true,
          fieldPath: frame.path || '$',
          visibleLength: v.length,
          minLength: v.length,
          actualLength: 'unknown',
          truncationSuspected: true,
          visibleSha256: visibleHash(v),
          visiblePreview: preview(v),
          note: '该字符串接近或超过 RuyiTrace 截断阈值，示例中不保留完整可见内容，真实长度未知。',
        };
        stack.pop();
        continue;
      }
      if (!v || typeof v !== 'object') { frame.out = v; stack.pop(); continue; }
      const entries = Array.isArray(v) ? v.map((item, index) => [index, item]) : Object.entries(v);
      frame.children = entries.map(([key, child]) => {
        const nextPath = frame.path ? `${frame.path}.${key}` : key;
        return { key, value: child, path: nextPath, out: undefined, children: null, idx: 0 };
      });
      frame.idx = 0;
      continue;
    }
    if (frame.idx < frame.children.length) {
      const child = frame.children[frame.idx];
      frame.idx += 1;
      stack.push(child);
      continue;
    }
    const v = frame.value;
    const out = Array.isArray(v) ? [] : {};
    for (const child of frame.children) out[child.key] = child.out;
    frame.out = out;
    stack.pop();
  }
  return root.out;
}

async function summarizeNdjson(file, options) {
  const apiCounts = new Map();
  const typeCounts = new Map();
  const categoryCounts = new Map();
  const fileCounts = new Map();
  const examples = [];
  const truncationState = { totalSuspectedFields: 0, maxVisibleLength: 0, byFieldPath: new Map(), byApi: new Map(), examples: [] };
  let lines = 0, parsed = 0, invalid = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  const targetHits = options.targetSignals.map((s) => ({ signal: s, hits: 0, sampleLine: 0 }));
  for await (const raw of rl) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    lines++;
    let evt;
    try { evt = JSON.parse(line); parsed++; } catch { invalid++; continue; }
    if (targetHits.length) {
      const text = JSON.stringify(evt).toLowerCase();
      for (const t of targetHits) {
        if (text.includes(t.signal.toLowerCase())) {
          t.hits++;
          if (!t.sampleLine) t.sampleLine = lines;
        }
      }
    }
    const api = evt.api || evt.name || evt.path || '';
    inc(apiCounts, api);
    inc(typeCounts, evt.t || evt.type || '');
    inc(categoryCounts, classifyApi(api));
    const stack = Array.isArray(evt.stack) ? evt.stack : [];
    for (const s of stack) if (s && s.file) inc(fileCounts, s.file);
    collectTruncationSignals(evt, lines, options.truncationThreshold, options.maxTruncationExamples, truncationState);
    if (examples.length < options.maxExamples) examples.push(sanitizeLongStrings(evt, options.truncationThreshold));
  }
  return {
    lines,
    parsed,
    invalid,
    topApis: top(apiCounts, 30),
    topTypes: top(typeCounts, 20),
    topCategories: top(categoryCounts, 20),
    topStackFiles: top(fileCounts, 30),
    targetSignal: {
      enabled: targetHits.length > 0,
      allHit: targetHits.length > 0 && targetHits.every((t) => t.hits > 0),
      signals: targetHits,
    },
    truncation: {
      threshold: options.truncationThreshold,
      totalSuspectedFields: truncationState.totalSuspectedFields,
      maxVisibleLength: truncationState.maxVisibleLength,
      topFieldPaths: top(truncationState.byFieldPath, 20),
      topApis: top(truncationState.byApi, 20),
      examples: truncationState.examples,
      rule: '可见长度达到阈值的字符串一律按疑似截断处理；Canvas / WebGL / WebGPU / Audio 等长指纹值不得使用日志可见片段作为最终值，真实长度为 unknown，只能确认至少达到可见长度。',
    },
    examples,
  };
}

function renderMarkdown(result) {
  const lines = ['# RuyiTrace 日志导入摘要', '', `- 原始日志：${result.input}`, `- 复制后日志：${result.copiedTo}`, `- 行数：${result.summary.lines}`, `- 成功解析：${result.summary.parsed}`, `- 解析失败：${result.summary.invalid}`];
  lines.push('', '## API 类别统计');
  for (const item of result.summary.topCategories) lines.push(`- ${item.key}：${item.count}`);
  lines.push('', '## 高频 API');
  for (const item of result.summary.topApis.slice(0, 20)) lines.push(`- ${item.key}：${item.count}`);
  lines.push('', '## 高频调用栈文件');
  if (!result.summary.topStackFiles.length) lines.push('- 未发现 stack.file');
  for (const item of result.summary.topStackFiles.slice(0, 20)) lines.push(`- ${item.key}：${item.count}`);

  const ts = result.summary.targetSignal;
  if (ts.enabled) {
    lines.push('', '## 目标信号命中检查');
    for (const t of ts.signals) {
      if (t.hits > 0) lines.push(`- ✅ 命中「${t.signal}」：${t.hits} 次（示例行 ${t.sampleLine}）`);
      else lines.push(`- ❌ 未命中「${t.signal}」：0 次`);
    }
    if (!ts.allHit) lines.push('- ⚠️ **目标路径未覆盖：日志未触发目标接口，不得当作“采集完成”，按 TRACE_RETRY 处理（查因→重试/转手动/降级补充）**');
  }

  const truncation = result.summary.truncation;
  lines.push('', '## 长字段截断风险');
  lines.push(`- 检测阈值：${truncation.threshold}`);
  lines.push(`- 疑似截断字段数：${truncation.totalSuspectedFields}`);
  lines.push(`- 最大可见长度：${truncation.maxVisibleLength}`);
  lines.push('- 规则：达到或接近阈值的字符串只能说明“至少达到该可见长度”，真实长度记为 unknown，不能把 4000 或可见长度当成真实长度。');
  if (!truncation.examples.length) {
    lines.push('- 未发现达到阈值的长字符串字段。');
  } else {
    lines.push('', '| 行号 | API | 字段路径 | 可见长度 | 真实长度判断 | 调用栈 | 可见值 SHA256 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const item of truncation.examples.slice(0, 20)) {
      lines.push(`| ${item.line} | ${item.api} | ${item.fieldPath} | ${item.visibleLength} | unknown，疑似被 RuyiTrace 截断 | ${item.stack || '未记录'} | ${item.visibleSha256} |`);
    }
    lines.push('', '### 长字段补采要求');
    lines.push('- 不要根据 RuyiTrace 中的 4000 / 4096 字符可见值判断完整加密参数、长 token、长 Cookie、长 body、Canvas dataURL、WebGL readPixels、WebGPU adapter 信息或 Audio channel data 的真实长度。');
    lines.push('- 如果该字段影响签名、补环境验证或指纹回放，必须通过 HAR/cURL、ruyiPage / 手动浏览器采样、专用 Hook 分片落盘、或最终 Node.js signer 输出重新确认完整值。');
    lines.push('- 写入 `notes/missing-env-priority.md` 时标明 `actualLength: unknown`、`minLength: 可见长度`、`truncationSuspected: true`。');
  }

  lines.push('', '## 建议下一步');
  lines.push('- 将高频 API 映射到 `env-module-levels.md` 的 Level 1/2/3 环境模块。');
  lines.push('- 结合 stack.file / line / col 更新 `notes/entry-chain.md` 和 `notes/missing-env-priority.md`。');
  lines.push('- 对长字段优先补采完整值或记录 hash / 长度 / 前后片段，避免把 RuyiTrace 的截断值误当作完整值。');
  lines.push('- 仅把摘要写入最终报告，原始 NDJSON 作为本地证据文件保存或由用户确认删除。');
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return; }
  if (!args.input) throw new Error('必须提供 --input');
  if (!args.caseDir) throw new Error('必须提供 --case-dir');
  const input = path.resolve(args.input);
  const caseDir = path.resolve(args.caseDir);
  const caseSubdir = path.join(caseDir, 'case');
  if (!exists(input)) throw new Error(`日志文件不存在：${input}`);
  fs.mkdirSync(caseSubdir, { recursive: true });
  const logDir = path.join(caseSubdir, 'ruyi-trace', 'logs');
  const notesDir = path.join(caseSubdir, 'notes');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  const dstName = safeName(args.name || path.basename(input) || `trace-${Date.now()}.ndjson`);
  const copiedTo = path.join(logDir, dstName.endsWith('.ndjson') ? dstName : `${dstName}.ndjson`);
  fs.copyFileSync(input, copiedTo);
  const summary = await summarizeNdjson(copiedTo, args);
  const result = { input, copiedTo, summary };
  const md = renderMarkdown(result);
  if (!args.noSummaryWrite) fs.writeFileSync(path.join(notesDir, 'ruyitrace-summary.md'), md, 'utf8');
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(md);
  if (args.targetSignals.length && !summary.targetSignal.allHit) {
    console.error('⚠️ 目标信号未命中：日志未触发目标接口，不得当作“采集完成”，按 TRACE_RETRY 处理');
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
});
