#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    caseDir: '.',
    inputs: '',
    url: '',
    json: false,
    markdown: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal('.');
    else if (a === '--inputs' || a === '-i') args.inputs = nextVal('');
    else if (a === '--url' || a === '-u') args.url = nextVal('');
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
  node scripts/check_evidence.js --case-dir . --markdown
  node scripts/check_evidence.js --case-dir . --url <目标URL> --inputs <材料1,材料2> --markdown
  node scripts/check_evidence.js --case-dir . --json

说明：
- 取证证据门禁：在 CHECK-3 意图声明和 Phase 0.1 判定"用户已提供证据 / 可跳过取证"前必跑。
- 判定 Step 1（ruyipage 网络取证）与 Step 2（RuyiTrace 日志采集）的证据是否真实存在，
  并给出可跳过的步骤。只有存在对应取证产物（或用户提供真实材料文件）才能跳过该步骤。
- URL 不是证据：--url 只记录目标地址，绝不作为跳过任何取证的依据；仅提供 URL → 两步全做。
- --inputs：逗号分隔的用户声称提供材料路径（NDJSON/HAR/JS 文件/cURL 文本/调用栈截图等）。
  文件必须真实存在才会被计入证据；声称存在但实际不存在的文件会以警告列出。
- 用户粘贴的 cURL / 调用栈文本不是文件，必须先落盘（如 case/notes/user-curl.txt）再传入。`;
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

function listFiles(dir, extList) {
  if (!isDir(dir)) return [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { names = []; }
  return names
    .filter((n) => extList.some((e) => n.toLowerCase().endsWith(e)))
    .sort()
    .map((n) => path.join(dir, n));
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

function looksLikeHAR(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    const j = JSON.parse(raw);
    return !!(j && j.log && Array.isArray(j.log.entries));
  } catch { return false; }
}

function looksLikeCurl(p) {
  try {
    const head = fs.readFileSync(p, 'utf8').slice(0, 4096);
    return /curl\s+['"]?-i?['"]?\s+['"]?https?:/i.test(head);
  } catch { return false; }
}

function classifyUserInput(p, warnings) {
  const ext = path.extname(p).toLowerCase();
  const base = path.basename(p).toLowerCase();
  if (!exists(p)) {
    warnings.push(`声称提供但文件不存在：${p}`);
    return { path: p, exists: false, step1: false, step2: false, kind: 'missing' };
  }
  if (isDir(p)) {
    warnings.push(`材料为目录（仅支持文件）：${p}`);
    return { path: p, exists: true, step1: false, step2: false, kind: 'directory' };
  }
  if (!isNonEmpty(p)) {
    warnings.push(`材料为空文件：${p}`);
    return { path: p, exists: true, step1: false, step2: false, kind: 'empty' };
  }
  if (ext === '.ndjson' || ext === '.jsonl') return { path: p, exists: true, step1: false, step2: true, kind: 'NDJSON' };
  if (ext === '.har') return { path: p, exists: true, step1: true, step2: false, kind: 'HAR' };
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return { path: p, exists: true, step1: true, step2: false, kind: 'JS 文件' };
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) return { path: p, exists: true, step1: true, step2: false, kind: '调用栈/截图' };
  if (ext === '.json') {
    if (looksLikeHAR(p)) return { path: p, exists: true, step1: true, step2: false, kind: 'HAR(JSON)' };
    return { path: p, exists: true, step1: true, step2: false, kind: 'JSON 取证产物' };
  }
  if ((ext === '.txt' || ext === '.md' || ext === '.log') && looksLikeCurl(p)) {
    return { path: p, exists: true, step1: true, step2: false, kind: 'cURL 文本' };
  }
  if (ext === '.txt' || ext === '.md' || ext === '.log') {
    return { path: p, exists: true, step1: false, step2: false, kind: '文本材料(未识别为取证证据)' };
  }
  return { path: p, exists: true, step1: false, step2: false, kind: `未知类型(${ext || '无扩展名'})` };
}

function check(args) {
  const caseDir = path.resolve(args.caseDir);
  const caseSubdir = path.join(caseDir, 'case');
  const warnings = [];
  const missing = [];

  const step1 = { checks: [], evidence: false };
  const step2 = { checks: [], evidence: false };

  const capJson = path.join(caseSubdir, 'forensic', 'capture.json');
  step1.checks.push({ label: 'case/forensic/capture.json（网络包元数据）', ok: isNonEmpty(capJson), file: capJson });

  const jsOriginalDir = path.join(caseSubdir, 'js', 'original');
  const jsFiles = listFiles(jsOriginalDir, ['.js', '.mjs', '.cjs']);
  step1.checks.push({ label: `case/js/original/（JS 落盘，${jsFiles.length} 个）`, ok: jsFiles.length > 0, file: jsOriginalDir });

  const fpBaseline = path.join(caseSubdir, 'notes', 'fingerprint-baseline.json');
  step1.checks.push({ label: 'case/notes/fingerprint-baseline.json（指纹基线）', ok: isNonEmpty(fpBaseline), file: fpBaseline });

  const ndjsonDir = path.join(caseSubdir, 'ruyi-trace', 'logs');
  const ndjsonFiles = listFiles(ndjsonDir, ['.ndjson', '.jsonl']);
  step2.checks.push({ label: `case/ruyi-trace/logs/（NDJSON 日志，${ndjsonFiles.length} 个）`, ok: ndjsonFiles.length > 0, file: ndjsonDir });

  const traceSummary = path.join(caseSubdir, 'notes', 'ruyitrace-summary.md');
  step2.checks.push({ label: 'case/notes/ruyitrace-summary.md（trace 摘要）', ok: isNonEmpty(traceSummary), file: traceSummary });

  const userInputs = [];
  if (args.inputs) {
    for (const p of args.inputs.split(',').map((s) => s.trim()).filter(Boolean)) {
      userInputs.push(classifyUserInput(path.resolve(p), warnings));
    }
  }

  step1.evidence = step1.checks.some((c) => c.ok) || userInputs.some((u) => u.step1);
  step2.evidence = step2.checks.some((c) => c.ok) || userInputs.some((u) => u.step2);

  const skipStep1 = step1.evidence;
  const skipStep2 = step2.evidence;

  if (!step1.evidence) missing.push('Step 1 网络取证证据（无 capture.json / JS 落盘 / 指纹基线 / 用户 HAR·JS·cURL 材料）');
  if (!step2.evidence) missing.push('Step 2 RuyiTrace 日志证据（无 NDJSON / ruyitrace-summary.md / 用户 NDJSON 材料）');

  const urlOnly = !!args.url && !step1.evidence && !step2.evidence;
  const anyEvidence = step1.evidence || step2.evidence;

  const mode = !anyEvidence ? 'none'
    : (step1.evidence && step2.evidence) ? 'both'
    : step1.evidence ? 'step1-only'
    : 'step2-only';

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
    clean: anyEvidence && missing.length === 0,
    actionable: !(urlOnly && mode === 'none'),
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
  for (const c of result.step1.checks) lines.push(`- [${c.ok ? 'x' : ' '}] ${c.label}${c.ok ? (fmtSize(c.file) ? `（${fmtSize(c.file)}）` : '') : ''}`);
  const step1User = result.userInputs.filter((u) => u.step1);
  if (step1User.length) lines.push(`- [x] 用户材料计入 Step 1：${step1User.map((u) => `${u.path}（${u.kind}）`).join('；')}`);
  lines.push('', '## Step 2 RuyiTrace 日志证据');
  for (const c of result.step2.checks) lines.push(`- [${c.ok ? 'x' : ' '}] ${c.label}${c.ok ? (fmtSize(c.file) ? `（${fmtSize(c.file)}）` : '') : ''}`);
  const step2User = result.userInputs.filter((u) => u.step2);
  if (step2User.length) lines.push(`- [x] 用户材料计入 Step 2：${step2User.map((u) => `${u.path}（${u.kind}）`).join('；')}`);
  lines.push('', '## 用户声称提供材料');
  if (result.userInputs.length) {
    for (const u of result.userInputs) {
      const flag = !u.exists ? '不存在' : u.step1 || u.step2 ? `计入（${u.kind}）` : `未计入（${u.kind}）`;
      lines.push(`- ${u.path}：${flag}`);
    }
  } else {
    lines.push('- 未提供（--inputs）');
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
    lines.push('- ⚠️ 仅提供 URL，URL 不是证据。必须走完整两步取证：ruyipage 网络取证 + RuyiTrace 日志采集。');
  } else if (result.missing.length) {
    lines.push(`- 证据不完整，缺少：${result.missing.map((m) => m.split('（')[0]).join('；')}。对应取证步骤不可跳过。`);
    if (result.skipStep1) lines.push('- Step 1 证据已具备，可跳过 ruyipage 网络取证（或由用户材料替代）。');
    if (result.skipStep2) lines.push('- Step 2 证据已具备（有 RuyiTrace NDJSON），可跳过日志采集。');
  } else {
    lines.push('- 两步取证证据齐全（或由用户材料完整替代），可跳过取证直接进入参数识别。');
  }
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(usage()); process.exit(0); }
    const result = check(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    process.exit(result.clean || result.missing.length === 0 ? 0 : 1);
  } catch (err) {
    console.error(err.message || String(err));
    console.error(usage());
    process.exit(1);
  }
}

module.exports = { check };
