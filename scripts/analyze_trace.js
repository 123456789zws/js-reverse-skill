#!/usr/bin/env node
'use strict';

const fs = require('fs');
const readline = require('readline');

function parseArgs(argv) {
  const args = { trace: '', summary: '', json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--trace') args.trace = nextVal('');
    else if (a === '--summary') args.summary = nextVal('');
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/analyze_trace.js --trace case/tmp/env-trace.jsonl --summary case/tmp/missing-env.json --markdown
  node scripts/analyze_trace.js --trace case/tmp/env-trace.jsonl --json`;
}

function readJsonMaybe(file, fallback) {
  if (!file) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}

// 流式读取并聚合 trace，不把全部事件留在内存（避免大 jsonl OOM）。
async function readTrace(file) {
  const state = { eventCount: 0, parseErrors: 0, modules: new Map(), paths: new Set(), riskSignals: new Set() };
  if (!file) return state;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { state.parseErrors += 1; continue; }
    state.eventCount += 1;
    const pathText = e.path || e.prop || '';
    if (pathText) state.paths.add(pathText);
    const moduleName = moduleOf(pathText || e.type);
    if (!state.modules.has(moduleName)) state.modules.set(moduleName, { module: moduleName, priority: priorityOf(moduleName), count: 0, examples: [], eventTypes: new Set() });
    const item = state.modules.get(moduleName);
    item.count += 1;
    item.eventTypes.add(e.type || 'unknown');
    if (item.examples.length < 8 && pathText) item.examples.push(pathText);
    if (['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'toPrimitive'].includes(e.type)) state.riskSignals.add(`${e.type}:${pathText}`);
    if (String(pathText).endsWith('.toString')) state.riskSignals.add(`toString:${pathText}`);
  }
  return state;
}

function moduleOf(pathText) {
  const p = String(pathText || '');
  if (/^(window|self|globalThis|top|parent)(\.|$)/.test(p)) return 'base-env';
  if (/^location(\.|$)|^URL(SearchParams)?(\.|$)/.test(p)) return 'location-url-env';
  if (/^navigator(\.|$)/.test(p)) return 'navigator-env';
  if (/^screen(\.|$)|devicePixelRatio/.test(p)) return 'screen-env';
  if (/^document\.cookie/.test(p)) return 'document-cookie-env';
  if (/^document\.all/.test(p)) return 'document-all-special';
  if (/^document(\.|$)|^HTMLElement|^HTML/.test(p)) return 'document-dom-env';
  if (/^(localStorage|sessionStorage)(\.|$)/.test(p)) return 'storage-env';
  if (/^crypto(\.|$)|getRandomValues|randomUUID/.test(p)) return 'crypto-env';
  if (/^performance(\.|$)|^Date(\.|$)|Date\.now|Math\.random/.test(p)) return 'time-random-env';
  if (/fetch|XMLHttpRequest|Headers|Request|Response/.test(p)) return 'network-stub-env';
  if (/Canvas|canvas|WebGL|OffscreenCanvas/.test(p)) return 'canvas-webgl-env';
  if (/Worker|postMessage|MessageChannel|onmessage/.test(p)) return 'worker-message-env';
  if (/WebAssembly|\.wasm|wasm/i.test(p)) return 'wasm-boundary-env';
  if (/toString|getOwnPropertyDescriptor|getPrototypeOf|ownKeys|toPrimitive/.test(p)) return 'native-protection';
  return 'target-specific-env';
}

function priorityOf(moduleName) {
  if (['base-env', 'location-url-env', 'storage-env', 'document-cookie-env'].includes(moduleName)) return 1;
  if (['navigator-env', 'time-random-env', 'crypto-env', 'network-stub-env'].includes(moduleName)) return 2;
  if (['native-protection', 'document-all-special', 'canvas-webgl-env'].includes(moduleName)) return 3;
  if (['worker-message-env', 'wasm-boundary-env'].includes(moduleName)) return 4;
  return 5;
}

function analyze(state, summary) {
  const riskSignals = new Set(summary.proxyRiskSignals || []);
  for (const s of state.riskSignals) riskSignals.add(s);
  for (const name of summary.missingGlobals || []) {
    const moduleName = moduleOf(name);
    if (!state.modules.has(moduleName)) state.modules.set(moduleName, { module: moduleName, priority: priorityOf(moduleName), count: 0, examples: [], eventTypes: new Set() });
    state.modules.get(moduleName).examples.push(name);
  }
  const moduleList = Array.from(state.modules.values()).map(m => ({ ...m, eventTypes: Array.from(m.eventTypes), examples: Array.from(new Set(m.examples)) }))
    .sort((a, b) => a.priority - b.priority || b.count - a.count || a.module.localeCompare(b.module));
  return {
    eventCount: state.eventCount,
    parseErrors: state.parseErrors,
    uniquePathCount: state.paths.size,
    modulePriorities: moduleList,
    runtimeErrors: summary.runtimeErrors || [],
    missingGlobals: summary.missingGlobals || [],
    missingMethods: summary.missingMethods || [],
    missingProperties: summary.missingProperties || [],
    specialObjects: summary.specialObjects || [],
    proxyRiskSignals: Array.from(riskSignals).slice(0, 100),
    recommendation: moduleList.slice(0, 5).map(m => `优先补齐 ${m.module}`),
  };
}

function renderMarkdown(result) {
  const lines = ['# trace 分析与补齐优先级', '', `- trace 事件数：${result.eventCount}`, `- 解析失败：${result.parseErrors || 0}`, `- 唯一路径数：${result.uniquePathCount}`, `- 运行错误数：${result.runtimeErrors.length}`];
  lines.push('', '## 模块优先级');
  if (!result.modulePriorities.length) lines.push('- 未发现可归类的环境访问');
  for (const m of result.modulePriorities) {
    lines.push(`- P${m.priority} ${m.module}：${m.count} 次；示例：${m.examples.slice(0, 5).join(', ') || '无'}`);
  }
  if (result.proxyRiskSignals.length) {
    lines.push('', '## Proxy / native-like 风险');
    for (const s of result.proxyRiskSignals.slice(0, 20)) lines.push(`- ${s}`);
  }
  if (result.runtimeErrors.length) {
    lines.push('', '## 运行错误');
    for (const e of result.runtimeErrors) lines.push(`- ${e.type || 'error'}：${e.message || JSON.stringify(e)}`);
  }
  lines.push('', '## 建议下一步');
  for (const r of result.recommendation) lines.push(`- ${r}`);
  if (!result.recommendation.length) lines.push('- 先确认入口函数是否执行、fixture 是否完整。');
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return; }
  if (!args.trace && !args.summary) throw new Error('必须提供 --trace 或 --summary');
  const state = await readTrace(args.trace);
  const summary = readJsonMaybe(args.summary, {});
  const result = analyze(state, summary);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
}

main().catch((err) => {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
});
