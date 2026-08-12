#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 默认安装目录：cwd 优先（安装模式下装到用户工作目录），开发模式下 cwd 即 skill 项目根；
// 支持 --project-dir 显式指定，避免在 skill 安装目录运行时装错位置
let PROJECT_ROOT = process.cwd();
let TOOLS_DIR = path.join(PROJECT_ROOT, 'tools');
let RUYIPAGE_BROWSERS_DIR = path.join(TOOLS_DIR, 'ruyipage-browsers');
let RUYITRACE_DIR = path.join(TOOLS_DIR, 'RuyiTrace');

function parseArgs(argv) {
  const args = { python: 'python', yes: false, json: false, markdown: false, projectDir: '', help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--python') args.python = nextVal('python');
    else if (a === '--project-dir') args.projectDir = nextVal('');
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function initPaths(args) {
  PROJECT_ROOT = args.projectDir ? path.resolve(args.projectDir) : process.cwd();
  TOOLS_DIR = path.join(PROJECT_ROOT, 'tools');
  RUYIPAGE_BROWSERS_DIR = path.join(TOOLS_DIR, 'ruyipage-browsers');
  RUYITRACE_DIR = path.join(TOOLS_DIR, 'RuyiTrace');
}

function usage() {
  return `用法：
  node scripts/install_all.js --markdown
  node scripts/install_all.js --python python --yes --markdown

说明：检测并自动安装 ruyiPage（Python 包 + 定制 Firefox runtime）和 RuyiTrace（定制 trace 内核）。
默认安装目录（当前工作目录）：
  - ruyiPage runtime：<cwd>/tools/ruyipage-browsers/
  - RuyiTrace：       <cwd>/tools/RuyiTrace/
请先在项目根目录（tools/ 要安装到的用户工程目录）运行本脚本；在 skill 安装目录运行会装错位置。
--python <cmd>：显式指定 Python 解释器，严格使用、失败不回退；未传时自动按 python → python3 → py -3 探测，安装与后验全程用同一解释器。
--yes：跳过用户确认，直接安装缺失项。
--project-dir <dir>：用户工程目录（tools/ 安装目标）。安装模式下 skill 安装目录无 tools/，必须显式指定，避免装到 skill 根附近。未传时使用当前工作目录。`;
}

function run(cmd, args, timeout = 300000, env = null) {
  const ret = spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true, env: env ? { ...process.env, ...env } : undefined });
  return {
    ok: ret.status === 0,
    status: ret.status,
    stdout: (ret.stdout || '').trim(),
    stderr: (ret.stderr || '').trim(),
    error: ret.error ? ret.error.message : '',
  };
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

const MIRROR_CANDIDATES = [
  'https://gh-proxy.com',
  'https://ghproxy.net',
];

// 镜像连通性测试路径候选：优先用最新 release asset，旧版作后备（历史 release 可能被作者清理）
const MIRROR_TEST_PATHS = [
  'https://github.com/LoseNine/ruyipage/releases/download/v1.2.58/firefox-155.0a1.en-US.win64-20260803.zip',
  'https://github.com/LoseNine/ruyipage/releases/download/151-ruyi/firefox-151.0a1.en-US.win64.zip',
];

function detectBestMirror() {
  if (process.env.GITHUB_MIRROR) return process.env.GITHUB_MIRROR;
  // 用已知的 release URL + 范围请求测试（只下载 1 字节，避免全量下载）
  // ghproxy 等镜像只转发 releases/download 路径，不代理仓库主页和 api.github.com
  for (const m of MIRROR_CANDIDATES) {
    for (const testPath of MIRROR_TEST_PATHS) {
      const ret = run('curl', ['-sk', '--max-time', '10', '-r', '0-0', '-o', 'NUL', '-w', '%{http_code}', `${m}/${testPath}`], 15000);
      const code = ret.stdout.trim();
      if (ret.ok && (code === '200' || code === '206')) return m;
    }
  }
  return '';
}

function mirrorEnv(mirror) {
  return mirror ? { GITHUB_MIRROR: mirror } : null;
}

// 解析唯一 Python 解释器：显式 --python 严格使用不回退；未提供时按 python → python3 → py -3 自动探测
// 安装、runtime 安装、后验检测必须全程用同一个解释器，避免"用 A 装、用 B 验"导致的误判
function resolvePython(explicit) {
  if (explicit) return { cmd: explicit, args: [] };
  for (const c of [['python'], ['python3'], ['py', '-3']]) {
    const ret = run(c[0], c.slice(1).concat(['-c', 'import sys; print(sys.version.split()[0])']), 15000);
    if (ret.ok) return { cmd: c[0], args: c.slice(1) };
  }
  return { cmd: 'python', args: [] };
}

function detectState(pythonSpec) {
  const result = {
    node: { ok: false, version: '' },
    ruyipagePackage: false,
    ruyipageRuntime: false,
    ruyitrace: false,
    ruyitraceKernel: false,
  };

  const nodeMajor = parseInt(process.version.replace(/^v/, '').split('.')[0], 10) || 0;
  result.node = { ok: nodeMajor >= 18, version: process.version };

  const pkgCode = 'import ruyipage, json; print(json.dumps({"ok": True}, ensure_ascii=False))';
  const pkgRet = run(pythonSpec.cmd, pythonSpec.args.concat(['-c', pkgCode]), 20000);
  result.ruyipagePackage = pkgRet.ok && /"ok":\s*true/i.test(pkgRet.stdout);

  if (result.ruyipagePackage) {
    const checkScript = path.join(__dirname, 'check_external_tools.js');
    const checkArgs = [checkScript, '--python', pythonSpec.cmd, '--ruyipage-install-dir', RUYIPAGE_BROWSERS_DIR, '--json'];
    if (pythonSpec.args.length) checkArgs.push('--python-args', pythonSpec.args.join(' '));
    const checkRet = run(process.execPath, checkArgs, 60000);
    try {
      const parsed = JSON.parse(checkRet.stdout.replace(/^\uFEFF/, ''));
      result.ruyipageRuntime = !!(parsed.ruyiPage && parsed.ruyiPage.managedRuntimeVerified);
    } catch { /* ignore */ }
  }

  const exeName = process.platform === 'win32' ? 'RuyiTrace.exe' : 'RuyiTrace';
  const ruyitraceExe = path.join(RUYITRACE_DIR, exeName);
  const firefoxName = process.platform === 'win32' ? 'firefox.exe' : 'firefox';
  // 兼容两代 RuyiTrace 内核路径：新版 2.5+ 在 resources/kernel/，旧版 1.x 在 firefox/
  const ruyitraceKernelCandidates = [
    path.join(RUYITRACE_DIR, 'resources', 'kernel', firefoxName),
    path.join(RUYITRACE_DIR, 'firefox', firefoxName),
  ];
  const ruyitraceMarkerCandidates = [
    path.join(RUYITRACE_DIR, 'resources', 'kernel', 'RUYI_DOMTRACE.txt'),
    path.join(RUYITRACE_DIR, 'firefox', 'RUYI_DOMTRACE.txt'),
  ];
  const kernelIdx = ruyitraceKernelCandidates.findIndex((p, i) => exists(p) && exists(ruyitraceMarkerCandidates[i]));
  result.ruyitraceKernel = kernelIdx >= 0;
  result.ruyitrace = exists(ruyitraceExe) && result.ruyitraceKernel;

  return result;
}

function installRuyipagePackage(pythonSpec) {
  const ret = run(pythonSpec.cmd, pythonSpec.args.concat(['-m', 'pip', 'install', 'ruyiPage', 'requests', '--upgrade']), 180000);
  return { ok: ret.ok, output: (ret.stdout || ret.stderr || ret.error || '').slice(0, 2000) };
}

function installRuyipageRuntime(pythonSpec, mirror) {
  fs.mkdirSync(RUYIPAGE_BROWSERS_DIR, { recursive: true });
  // 两步安装：先用镜像下载 zip，再用 --from-file 本地安装
  // 原因：python -m ruyipage install 直连 GitHub 下载，不支持镜像，速度极慢
  const script = path.join(__dirname, 'download_ruyi_tool.js');
  const env = mirrorEnv(mirror);
  // 步骤1：下载 zip（支持镜像加速）
  const dlRet = run(process.execPath, [script, '--tool', 'ruyipage-firefox', '--dest', TOOLS_DIR, '--json'], 900000, env);
  let zipFile = '';
  try {
    const parsed = JSON.parse(dlRet.stdout.replace(/^\uFEFF/, ''));
    zipFile = parsed.destFile || '';
  } catch { /* ignore */ }
  if (!zipFile || !fs.existsSync(zipFile)) {
    return { ok: false, output: `下载失败：${(dlRet.stdout || dlRet.stderr || dlRet.error || '').slice(0, 1500)}` };
  }
  // 步骤2：用 --from-file 本地安装（不走网络）
  const instRet = run(pythonSpec.cmd, pythonSpec.args.concat(['-m', 'ruyipage', 'install', '--from-file', zipFile, '--install-dir', RUYIPAGE_BROWSERS_DIR]), 300000);
  return { ok: instRet.ok, output: (instRet.stdout || instRet.stderr || instRet.error || '').slice(0, 2000) };
}

function downloadAndExtractRuyiTrace(mirror) {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const script = path.join(__dirname, 'download_ruyi_tool.js');
  const env = mirrorEnv(mirror);
  const ret = run(process.execPath, [script, '--tool', 'ruyitrace', '--dest', TOOLS_DIR, '--extract', '--json'], 600000, env);
  let parsed = null;
  try { parsed = JSON.parse(ret.stdout.replace(/^\uFEFF/, '')); } catch { /* ignore */ }
  const ok = ret.ok && parsed && parsed.downloaded && parsed.extracted;
  // 解压目录归一：新版资产名带版本号（如 RuyiTrace-2.5.5-win64），统一重命名为 tools/RuyiTrace
  // 以匹配 check_external_tools.js / 文档约定的默认检测路径；tools/RuyiTrace 已存在时不覆盖
  if (ok && parsed.extractDir && path.resolve(parsed.extractDir) !== path.resolve(RUYITRACE_DIR) && !exists(RUYITRACE_DIR)) {
    try {
      fs.renameSync(parsed.extractDir, RUYITRACE_DIR);
      parsed.extractDir = RUYITRACE_DIR;
    } catch { /* 重命名失败时保留原目录，由用户手动指定 --ruyitrace-home */ }
  }
  // 新版 2.5+ 内核在 resources/kernel/，旧版在 firefox/：归一后检测脚本可自动识别任一结构
  return {
    ok,
    output: (ret.stdout || ret.stderr || ret.error || '').slice(0, 2000),
    extractDir: parsed ? parsed.extractDir : '',
  };
}

function install(state, pythonSpec, mirror) {
  const steps = [];

  if (!state.ruyipagePackage) {
    steps.push({ name: '安装 ruyiPage Python 包 + requests', ...installRuyipagePackage(pythonSpec) });
  }

  if (!state.ruyipageRuntime) {
    steps.push({ name: '安装 ruyiPage 定制 Firefox runtime', ...installRuyipageRuntime(pythonSpec, mirror) });
  }

  if (!state.ruyitrace) {
    steps.push({ name: '下载并解压 RuyiTrace', ...downloadAndExtractRuyiTrace(mirror) });
  }

  return steps;
}

function verify(pythonSpec) {
  const script = path.join(__dirname, 'check_external_tools.js');
  const checkArgs = [script, '--python', pythonSpec.cmd, '--ruyipage-install-dir', RUYIPAGE_BROWSERS_DIR, '--ruyitrace-home', RUYITRACE_DIR, '--json'];
  if (pythonSpec.args.length) checkArgs.push('--python-args', pythonSpec.args.join(' '));
  const ret = run(process.execPath, checkArgs, 60000);
  let parsed = null;
  try { parsed = JSON.parse(ret.stdout.replace(/^\uFEFF/, '')); } catch { /* ignore */ }
  return parsed;
}

// 安装后全量检测结果汇总：全部通过才视为成功
function computeAllOk(after) {
  return !!(after && after.node && after.node.ok
    && after.ruyiPage && after.ruyiPage.packageInstalled
    && after.ruyiPage.managedRuntimeVerified
    && after.ruyiTrace && after.ruyiTrace.installed
    && after.ruyiTrace.kernelVerified);
}

function renderMarkdown(result) {
  const lines = ['# 一键安装结果', '', `- 工作目录：${PROJECT_ROOT}`, `- 安装目录：${TOOLS_DIR}`, `- Python：${result.python}`, ''];

  lines.push('## 安装前状态');
  lines.push(`- Node.js：${result.before.node.ok ? '通过' : '不通过'}（${result.before.node.version}）`);
  lines.push(`- ruyiPage Python 包：${result.before.ruyipagePackage ? '已安装' : '未安装'}`);
  lines.push(`- ruyiPage 定制 Firefox runtime：${result.before.ruyipageRuntime ? '已验证' : '未安装'}`);
  lines.push(`- RuyiTrace：${result.before.ruyitrace ? '已安装' : '未安装'}`);
  lines.push(`- RuyiTrace 定制 trace 内核：${result.before.ruyitraceKernel ? '已验证' : '未验证'}`);

  if (result.skipped) {
    lines.push('', '## 跳过安装（所有组件已就绪）');
    return lines.join('\n') + '\n';
  }

  if (result.steps.length) {
    lines.push('', '## 安装步骤');
    for (const s of result.steps) {
      lines.push(`### ${s.name}：${s.ok ? '成功' : '失败'}`);
      if (s.output) lines.push('```', s.output, '```');
    }
  }

  if (result.after) {
    lines.push('', '## 安装后状态');
    const a = result.after;
    if (a.node) lines.push(`- Node.js：${a.node.ok ? '通过' : '不通过'}（${a.node.version}）`);
    if (a.ruyiPage) {
      lines.push(`- ruyiPage Python 包：${a.ruyiPage.packageInstalled ? '已安装' : '未安装'}`);
      lines.push(`- ruyiPage 定制 Firefox runtime：${a.ruyiPage.managedRuntimeVerified ? '已验证' : '未验证'}`);
    }
    if (a.ruyiTrace) {
      lines.push(`- RuyiTrace：${a.ruyiTrace.installed ? '已安装' : '未安装'}`);
      lines.push(`- RuyiTrace 定制 trace 内核：${a.ruyiTrace.kernelVerified ? '已验证' : '未验证'}`);
    }
  }

  const allOk = computeAllOk(result.after);
  lines.push('', `## 结果：${allOk ? '全部通过' : '部分未通过，请检查上方日志'}`);
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return; }
  initPaths(args);

  // 解析唯一解释器并全程复用：显式 --python 严格使用；未提供时自动探测可用解释器
  const pythonSpec = resolvePython(args.python);
  const pythonLabel = pythonSpec.args.length ? `${pythonSpec.cmd} ${pythonSpec.args.join(' ')}` : pythonSpec.cmd;

  const before = detectState(pythonSpec);
  const allInstalled = before.node.ok && before.ruyipagePackage && before.ruyipageRuntime && before.ruyitrace && before.ruyitraceKernel;

  let mirror = '';
  if (!allInstalled) {
    console.error('检测 GitHub 镜像...');
    mirror = detectBestMirror();
    if (mirror) console.error(`使用镜像：${mirror}`);
    else console.error('未检测到可用镜像，将直连 GitHub（可能较慢）');
  }

  const result = {
    python: pythonLabel,
    mirror,
    before,
    skipped: allInstalled,
    steps: [],
    after: null,
  };

  if (allInstalled) {
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    return;
  }

  if (!args.yes) {
    console.log('检测到缺失组件，将安装到：');
    if (!before.ruyipagePackage) console.log(`  - ruyiPage Python 包（pip install）`);
    if (!before.ruyipageRuntime) console.log(`  - ruyiPage 定制 Firefox runtime → ${RUYIPAGE_BROWSERS_DIR}`);
    if (!before.ruyitrace) console.log(`  - RuyiTrace 定制 trace 内核 → ${RUYITRACE_DIR}`);
    if (mirror) console.log(`\nGitHub 镜像：${mirror}`);
    console.log('\n添加 --yes 跳过确认直接安装。');
    if (args.markdown) {
      const lines = ['# 一键安装', '', '检测到缺失组件，添加 `--yes` 确认安装：', ''];
      if (!before.ruyipagePackage) lines.push('- ruyiPage Python 包（pip install）');
      if (!before.ruyipageRuntime) lines.push(`- ruyiPage 定制 Firefox runtime → \`${RUYIPAGE_BROWSERS_DIR}\``);
      if (!before.ruyitrace) lines.push(`- RuyiTrace 定制 trace 内核 → \`${RUYITRACE_DIR}\``);
      if (mirror) lines.push('', `> GitHub 镜像：${mirror}`);
      lines.push('', '```bash', `node scripts/install_all.js --yes --markdown`, '```');
      process.stdout.write(lines.join('\n') + '\n');
    }
    return;
  }

  result.steps = install(before, pythonSpec, mirror);
  result.after = verify(pythonSpec);
  // 真正执行安装后必须同时满足"本次安装步骤全部成功 + 最终环境全部通过"才返回 0，
  // 否则退非零，避免安装动作失败但后验被其它 Python 回退兜底时上层（AI/CI/脚本）误判成功
  const stepsOk = result.steps.every((s) => s.ok);
  process.exitCode = stepsOk && computeAllOk(result.after) ? 0 : 1;

  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
}

try {
  main();
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}
