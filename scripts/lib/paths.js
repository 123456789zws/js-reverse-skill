#!/usr/bin/env node
'use strict';

// 共享路径定位模块
// 统一 findProjectRoot / normalizeTraceHome / getDefaultRuyiBrowsersDirs / resolveProjectDirFromCaseDir
// 解决路径逻辑散落多脚本（check_external_tools / capture_ruyitrace_log / check_session_resume）、
// 改一处漏一处的问题（2.3.8 漏 check_session_resume、2.3.14 漏 capture_ruyitrace_log）。
// 候选顺序：显式参数 > 环境变量 > --project-dir/tools > cwd/tools > findProjectRoot/tools > where

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }
function isDir(p) { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } }

function uniquePaths(items) {
  const seen = new Set();
  return items.filter((p) => {
    const k = process.platform === 'win32' ? String(p).toLowerCase() : p;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function whereCommand(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const ret = spawnSync(cmd, [name], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  return ret.status === 0 ? ret.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}

function compareVersion(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

// 找 skill 根（含 SKILL.md 的目录）。本模块位于 <skill根>/scripts/lib/，向上找即可。
// 安装模式下 skill 安装目录也有 SKILL.md，第一段 __dirname 命中即 return。
function findProjectRoot() {
  let cur = path.dirname(__dirname);
  for (let i = 0; i < 5; i++) {
    if (exists(path.join(cur, 'SKILL.md'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  cur = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (exists(path.join(cur, 'SKILL.md'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

// 从 --case-dir 推用户工程根：若指向 case/ 子目录则取父级，否则视为工程根本身
function resolveProjectDirFromCaseDir(caseDir) {
  if (!caseDir) return process.cwd();
  const resolved = path.resolve(caseDir);
  return (path.basename(resolved).toLowerCase() === 'case') ? path.dirname(resolved) : resolved;
}

// 定位 RuyiTrace home 目录
// args: { ruyitraceHome, ruyitraceExe, projectDir }
function normalizeTraceHome(args) {
  if (args.ruyitraceHome) return path.resolve(args.ruyitraceHome);
  if (args.ruyitraceExe) return path.dirname(path.resolve(args.ruyitraceExe));
  if (process.env.RUYI_TRACE_HOME) return path.resolve(process.env.RUYI_TRACE_HOME);
  if (process.env.RUYITRACE_HOME) return path.resolve(process.env.RUYITRACE_HOME);
  // 优先 --project-dir（安装模式下用户工程目录，tools/ 所在），其次 cwd，最后 skill 根兜底
  const toolsDirs = [
    args.projectDir ? path.resolve(args.projectDir, 'tools') : null,
    path.join(process.cwd(), 'tools'),
    path.join(findProjectRoot(), 'tools'),
  ].filter(Boolean);
  let candidates = [];
  for (const toolsDir of toolsDirs) {
    if (!isDir(toolsDir)) continue;
    try {
      const found = fs.readdirSync(toolsDir)
        .filter((n) => /^RuyiTrace/i.test(n) && isDir(path.join(toolsDir, n)))
        .map((n) => path.join(toolsDir, n));
      candidates = candidates.concat(found);
    } catch { /* ignore */ }
  }
  candidates = uniquePaths(candidates);
  const versioned = candidates
    .map((p) => ({ p, v: (/RuyiTrace[-_]?v?(\d+(?:\.\d+)+)/i.exec(path.basename(p)) || [])[1] || '' }))
    .filter((x) => x.v)
    .sort((a, b) => compareVersion(b.v, a.v) || 0);
  if (versioned.length) return versioned[0].p;
  const legacy = candidates.find((p) => /^RuyiTrace$/i.test(path.basename(p)));
  if (legacy) return legacy;
  const found = whereCommand(process.platform === 'win32' ? 'RuyiTrace.exe' : 'RuyiTrace');
  if (found.length) return path.dirname(found[0]);
  return '';
}

// 定位 ruyipage-browsers 候选目录
// explicitInstallDir: --ruyipage-install-dir；projectDir: --project-dir
function getDefaultRuyiBrowsersDirs(explicitInstallDir, projectDir) {
  const dirs = [];
  if (explicitInstallDir) dirs.push(path.resolve(explicitInstallDir));
  if (projectDir) dirs.push(path.resolve(projectDir, 'tools', 'ruyipage-browsers'));
  if (process.env.RUYIPAGE_BROWSERS_PATH) dirs.push(path.resolve(process.env.RUYIPAGE_BROWSERS_PATH));
  dirs.push(path.join(process.cwd(), 'tools', 'ruyipage-browsers'));
  dirs.push(path.join(findProjectRoot(), 'tools', 'ruyipage-browsers'));
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    dirs.push(path.join(base, 'ruyipage', 'browsers'));
  } else if (process.platform === 'darwin') {
    dirs.push(path.join(os.homedir(), 'Library', 'Caches', 'ruyipage', 'browsers'));
  } else {
    const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
    dirs.push(path.join(base, 'ruyipage', 'browsers'));
  }
  return uniquePaths(dirs);
}

// 归一化 --case-dir：兼容"项目根"与"case 目录"，统一返回 case 目录。
// 传 <project-root>（其下含 case/ 子目录）→ 返回 <project-root>/case；
// 传 <project-root>/case 或任意 case 目录 → 返回自身。
function resolveCaseDir(input) {
  const p = path.resolve(input || '.');
  const caseSub = path.join(p, 'case');
  try { if (fs.statSync(caseSub).isDirectory()) return caseSub; } catch {}
  return p;
}

module.exports = {
  findProjectRoot,
  normalizeTraceHome,
  getDefaultRuyiBrowsersDirs,
  resolveProjectDirFromCaseDir,
  resolveCaseDir,
};
