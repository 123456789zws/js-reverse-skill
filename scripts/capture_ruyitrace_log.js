#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    url: '',
    input: '',
    caseDir: '.',
    outDir: '',
    profileDir: '',
    ruyitraceHome: '',
    ruyitraceExe: '',
    duration: 60,
    limit: 200000,
    dryRun: false,
    importAfter: false,
    json: false,
    markdown: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--url') args.url = nextVal('');
    else if (a === '--input') args.input = nextVal('');
    else if (a === '--case-dir' || a === '--dir') args.caseDir = nextVal('');
    else if (a === '--out-dir') args.outDir = nextVal('');
    else if (a === '--profile-dir') args.profileDir = nextVal('');
    else if (a === '--ruyitrace-home') args.ruyitraceHome = nextVal('');
    else if (a === '--ruyitrace-exe') args.ruyitraceExe = nextVal('');
    else if (a === '--duration') args.duration = Number(nextVal('60'));
    else if (a === '--limit') args.limit = Number(nextVal('200000'));
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--import-after') args.importAfter = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  if (!Number.isFinite(args.duration) || args.duration <= 0) args.duration = 60;
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 200000;
  return args;
}

function usage() {
  return `用法（自动 trace / 手动 trace 二选一）：
  # 自动 trace：自动启动随 RuyiTrace 提供的 trace Firefox 捕获 NDJSON
  node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir . --ruyitrace-home <RuyiTrace-dir> --duration 90 --import-after --markdown
  # 手动 trace：用户已用 RuyiTrace 手动 trace 完成，指定 NDJSON 日志直接导入生成摘要
  node scripts/capture_ruyitrace_log.js --input <用户trace生成的.ndjson> --case-dir . --markdown
  # 仅检测环境并打印计划（不启动浏览器）
  node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir . --dry-run --json

说明：--case-dir 指项目根目录（其下应有 case/ 和 result/ 两个平级子目录），默认当前目录。
--url 与 --input 互斥：--url 为自动捕获（需 RuyiTrace 完整安装）；--input 为手动 trace 后直接导入用户指定的 NDJSON，无需 RuyiTrace 安装检测。`;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function run(cmd, args, timeout = 8000) {
  const ret = spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true });
  return { ok: ret.status === 0, stdout: ret.stdout || '', stderr: ret.stderr || '' };
}

function whereCommand(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const ret = run(cmd, [name]);
  return ret.ok ? ret.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}

function normalizeTraceHome(args) {
  if (args.ruyitraceHome) return path.resolve(args.ruyitraceHome);
  if (args.ruyitraceExe) return path.dirname(path.resolve(args.ruyitraceExe));
  if (process.env.RUYI_TRACE_HOME) return path.resolve(process.env.RUYI_TRACE_HOME);
  if (process.env.RUYITRACE_HOME) return path.resolve(process.env.RUYITRACE_HOME);
  const found = whereCommand(process.platform === 'win32' ? 'RuyiTrace.exe' : 'RuyiTrace');
  return found.length ? path.dirname(found[0]) : '';
}

function detectRuyiTrace(args) {
  const home = normalizeTraceHome(args);
  const exeName = process.platform === 'win32' ? 'RuyiTrace.exe' : 'RuyiTrace';
  const exe = args.ruyitraceExe ? path.resolve(args.ruyitraceExe) : (home ? path.join(home, exeName) : '');
  const firefoxExe = home ? path.join(home, 'firefox', process.platform === 'win32' ? 'firefox.exe' : 'firefox') : '';
  const marker = home ? path.join(home, 'firefox', 'RUYI_DOMTRACE.txt') : '';
  const installed = exists(exe) && exists(firefoxExe) && exists(marker);
  return {
    installed,
    home,
    exe,
    exeExists: exists(exe),
    firefoxExe,
    firefoxExists: exists(firefoxExe),
    marker,
    markerExists: exists(marker),
    reason: installed ? '' : 'RuyiTrace 不完整：需要 RuyiTrace 可执行文件、firefox 可执行文件以及 firefox/RUYI_DOMTRACE.txt',
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function buildPlan(args, trace) {
  const caseDir = path.resolve(args.caseDir || '.');
  const caseSubdir = path.join(caseDir, 'case');
  const outDir = path.resolve(args.outDir || path.join(caseSubdir, 'ruyi-trace', 'logs'));
  const profileDir = path.resolve(args.profileDir || path.join(caseSubdir, 'tmp', 'ruyitrace-profile'));
  const traceFile = path.join(outDir, `trace-${timestamp()}.ndjson`);
  const firefoxArgs = ['-no-remote', '-new-instance', '-profile', profileDir];
  if (args.url) firefoxArgs.push(args.url);
  return {
    caseDir,
    outDir,
    profileDir,
    traceFile,
    firefoxExe: trace.firefoxExe,
    firefoxArgs,
    env: {
      MOZ_DOM_TRACE: '1',
      MOZ_DOM_TRACE_FILE: traceFile,
      MOZ_DOM_TRACE_LIMIT: String(args.limit),
      MOZ_DISABLE_LAUNCHER_PROCESS: '1',
    },
  };
}

function listNdjsonFiles(dir, sinceMs) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.ndjson'))
    .map((name) => path.join(dir, name))
    .filter((file) => {
      try { return fs.statSync(file).mtimeMs >= sinceMs - 1000; } catch { return false; }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    child.once('exit', (code, signal) => finish({ exited: true, code, signal }));
    setTimeout(() => finish({ exited: false, code: null, signal: null }), timeoutMs).unref();
  });
}

// 结束整个浏览器进程树（Firefox 多进程）：Windows 用 taskkill /T /F，其他平台杀进程组。
// 仅 child.kill() 只杀直接 spawn 的主进程，content/GPU 子进程会残留并锁住 profile。
function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) { resolve(false); return; }
    const cmd = process.platform === 'win32'
      ? spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      : spawn('kill', ['-TERM', `-${pid}`], { windowsHide: true });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    cmd.once('error', () => finish(false));
    cmd.once('exit', (code) => finish(code === 0));
  });
}

function importLog(caseDir, file, markdown) {
  const script = path.join(__dirname, 'import_ruyitrace_log.js');
  const args = [script, '--input', file, '--case-dir', caseDir, '--truncation-threshold', '3900', markdown ? '--markdown' : '--json'];
  const ret = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
  return { ok: ret.status === 0, status: ret.status, stdout: ret.stdout || '', stderr: ret.stderr || '' };
}

async function capture(args, plan) {
  ensureDir(plan.outDir);
  ensureDir(plan.profileDir);
  const startedAt = Date.now();
  const child = spawn(plan.firefoxExe, plan.firefoxArgs, {
    env: { ...process.env, ...plan.env },
    stdio: 'ignore',
    windowsHide: false,
  });
  const result = {
    launched: true,
    pid: child.pid,
    waitedSeconds: args.duration,
    killAttempted: false,
    killMethod: '',
    killOk: false,
    exit: null,
    logs: [],
    importResult: null,
  };
  child.on('error', (err) => { result.launchError = err.message || String(err); });
  try {
    await wait(args.duration * 1000);
  } finally {
    // 采集结束（成功或异常）一律主动关闭浏览器进程树，避免残留进程锁住 profile
    if (!result.launchError) {
      const exitBeforeKill = await waitForExit(child, 200);
      if (!exitBeforeKill.exited) {
        result.killAttempted = true;
        result.killMethod = process.platform === 'win32' ? 'taskkill-tree' : 'kill-group';
        try {
          result.killOk = await killProcessTree(child.pid);
          if (!result.killOk) {
            result.killError = 'taskkill 进程树结束失败，回退 child.kill()';
            try {
              child.kill();
              result.killOk = await waitForExit(child, 3000).then((e) => e.exited);
            } catch (err) {
              result.killError = err.message || String(err);
            }
          }
        } catch (err) {
          result.killError = err.message || String(err);
        }
      }
      result.exit = await waitForExit(child, 3000);
    }
  }
  result.logs = listNdjsonFiles(plan.outDir, startedAt);
  if (args.importAfter && result.logs.length) {
    result.importResults = result.logs.map(file => importLog(plan.caseDir, file, args.markdown));
  }
  return result;
}

function renderMarkdown(obj) {
  const { args, trace, plan, result } = obj;
  const lines = ['# RuyiTrace 自动捕获日志', ''];
  lines.push(`- RuyiTrace 检测结果：${trace.installed ? '通过' : '不通过'}`);
  if (trace.home) lines.push(`- RuyiTrace 目录：${trace.home}`);
  if (trace.exe) lines.push(`- RuyiTrace 可执行文件：${trace.exeExists ? '存在' : '不存在'} - ${trace.exe}`);
  if (trace.firefoxExe) lines.push(`- trace Firefox：${trace.firefoxExists ? '存在' : '不存在'} - ${trace.firefoxExe}`);
  if (trace.marker) lines.push(`- trace 标志文件：${trace.markerExists ? '存在' : '不存在'} - ${trace.marker}`);
  if (trace.reason) lines.push(`- 原因：${trace.reason}`);
  lines.push('', '## 自动捕获计划');
  lines.push(`- 目标页面：${args.url || '未提供'}`);
  lines.push(`- 输出目录：${plan.outDir}`);
  lines.push(`- Profile 目录：${plan.profileDir}`);
  lines.push(`- 计划 trace 文件：${plan.traceFile}`);
  lines.push(`- 采集时长：${args.duration} 秒`);
  lines.push(`- DOM trace 行数上限：${args.limit}`);
  lines.push(`- 启动参数：${[plan.firefoxExe].concat(plan.firefoxArgs).join(' ')}`);
  lines.push('- 环境变量：MOZ_DOM_TRACE=1，MOZ_DOM_TRACE_FILE=<case trace file>，MOZ_DOM_TRACE_LIMIT=<limit>，MOZ_DISABLE_LAUNCHER_PROCESS=1');
  if (args.dryRun) {
    lines.push('', '## Dry-run 结果');
    lines.push('- 未启动浏览器，未创建日志文件。');
    if (trace.installed) {
      lines.push('- RuyiTrace 检测通过：自动 trace 可用；用户也可选择手动 trace（--input 指定日志）。');
    } else {
      lines.push('- RuyiTrace 检测未通过，不能进入自动 trace；可让用户安装 / 提供 RuyiTrace 路径，或改用手动 trace（用户 trace 后 --input 指定日志），或明确确认降级为仅 ruyiPage。');
    }
    return lines.join('\n') + '\n';
  }
  lines.push('', '## 捕获结果');
  if (result.launchError) lines.push(`- 启动错误：${result.launchError}`);
  lines.push(`- 是否已启动：${result.launched ? '是' : '否'}`);
  if (result.pid) lines.push(`- 进程 PID：${result.pid}`);
  lines.push(`- 是否尝试结束进程：${result.killAttempted ? '是' : '否'}`);
  if (result.killAttempted) lines.push(`- 结束方式：${result.killMethod}，是否成功：${result.killOk ? '是' : '否'}${result.killError ? `（${result.killError}）` : ''}`);
  lines.push(`- 发现 NDJSON 数量：${result.logs.length}`);
  for (const file of result.logs) lines.push(`  - ${file}`);
  if (!result.logs.length) {
    lines.push('- 未发现 NDJSON：应检查 RuyiTrace trace Firefox 是否能写入日志、目标页面是否触发了环境访问、是否需要登录/验证码/权限交互；自动 trace 失败后可改用手动 trace（--input 指定用户采集的日志）。');
  }
  if (result.importResults && result.importResults.length) {
    lines.push('', '## 导入结果');
    result.importResults.forEach((imp, idx) => {
      const label = result.logs && result.logs[idx] ? path.basename(result.logs[idx]) : `#${idx + 1}`;
      lines.push(`- ${label} 导入是否成功：${imp.ok ? '是' : '否'}`);
      if (imp.stdout.trim()) lines.push('', '```text', imp.stdout.trim(), '```');
      if (imp.stderr.trim()) lines.push('', '```text', imp.stderr.trim(), '```');
    });
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  // 手动 trace 模式：用户已用 RuyiTrace 手动采集完成，直接导入指定 NDJSON
  if (args.input) {
    const inputPath = path.resolve(args.input);
    if (!exists(inputPath)) throw new Error(`日志文件不存在：${inputPath}`);
    const ret = importLog(args.caseDir || '.', inputPath, args.markdown);
    if (args.markdown) {
      const lines = ['# RuyiTrace 手动日志导入', ''];
      lines.push(`- 手动 trace 日志：${inputPath}`);
      lines.push(`- case 目录：${path.resolve(args.caseDir || '.')}`);
      lines.push(`- 导入是否成功：${ret.ok ? '是' : '否'}`);
      lines.push('', '> 以下为 import_ruyitrace_log.js 生成的摘要：', '');
      if (ret.stdout.trim()) lines.push('```text', ret.stdout.trim(), '```');
      if (ret.stderr.trim()) lines.push('', '```text', ret.stderr.trim(), '```');
      process.stdout.write(lines.join('\n') + '\n');
    } else {
      process.stdout.write(JSON.stringify({
        ok: ret.ok,
        mode: 'manual',
        input: inputPath,
        caseDir: path.resolve(args.caseDir || '.'),
        importStatus: ret.status,
        importStdout: ret.stdout,
        importStderr: ret.stderr,
      }, null, 2) + '\n');
    }
    process.exitCode = ret.ok ? 0 : 1;
    return;
  }
  if (!args.url) throw new Error('缺少 --url（自动 trace）或 --input（手动 trace 指定日志）之一。');
  const trace = detectRuyiTrace(args);
  const plan = buildPlan(args, trace);
  if (!trace.installed) {
    const obj = { args, trace, plan, result: { launched: false, logs: [] } };
    if (args.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    if (args.markdown) process.stdout.write(renderMarkdown(obj));
    process.exitCode = 2;
    return;
  }
  if (args.dryRun) {
    const obj = { args, trace, plan, result: { launched: false, logs: [] } };
    if (args.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    if (args.markdown) process.stdout.write(renderMarkdown(obj));
    return;
  }
  const result = await capture(args, plan);
  const obj = { args, trace, plan, result };
  if (args.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  if (args.markdown) process.stdout.write(renderMarkdown(obj));
  if (!result.logs.length) process.exitCode = 3;
}

main().catch((err) => {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
});
