#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths');

// 当前 case 目录与其真实路径（供删除时的越界校验使用）
let CASE_DIR = '';
let CASE_REAL = '';
let FULL_TREE_CACHE = null;

function parseArgs(argv) {
  const args = {
    caseDir: null,
    dryRun: false,
    force: false,
    includeProfiles: false,
    json: false,
    markdown: false,
    pruneEmpty: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal('');
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--include-profiles') args.includeProfiles = true;
    else if (a === '--no-prune-empty') args.pruneEmpty = false;
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
  node scripts/clean_case.js --case-dir case --dry-run --markdown
  node scripts/clean_case.js --case-dir case --force --markdown
  node scripts/clean_case.js --case-dir case --force --include-profiles --markdown
  node scripts/clean_case.js --case-dir case --force --no-prune-empty --json

说明：清理 case 内测试文件、临时文件、缓存文件、中间产物和空目录。默认不删除疑似登录态 Profile / Cookie / IndexedDB。`;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// 跟随符号链接的类型判断（仅用于“真实文件/目录”语义，不用于遍历决策）
function stat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// 不跟随符号链接：用于遍历与删除决策，避免符号链接逃逸
function lstat(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

// 解析真实路径（跟随符号链接）；失败则退回绝对路径
function resolveReal(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

// 目标真实路径是否落在 case 真实目录内（防御符号链接 / 越界）
function isContained(target) {
  if (!CASE_REAL) return true;
  const t = resolveReal(target);
  return t === CASE_REAL || t.startsWith(CASE_REAL + path.sep);
}

function isDangerousDir(p) {
  const root = path.parse(p).root;
  if (!root) return true; // 无盘符/根（异常相对路径）一律拒绝
  const normalized = path.resolve(p);
  if (normalized === root) return true; // 盘符根

  // 仅 1 层深度（/home、/Users、C:\Users 等）过于危险，拒绝
  const rel = path.relative(root, normalized);
  const depth = rel === '' ? 0 : rel.split(path.sep).length;
  if (depth <= 1) return true;

  // 已知敏感系统/用户根目录（仅精确匹配，不拦截其子目录）
  const lower = normalized.toLowerCase();
  const dangerRoots = [
    '/etc', '/usr', '/var', '/opt', '/system', '/library', '/applications',
    '/windows', '/program files', '/programdata', '/users', '/home',
  ];
  if (dangerRoots.includes(lower)) return true;

  // 用户主目录本身（精确匹配）
  const home = (process.env.USERPROFILE || process.env.HOME || '').toLowerCase();
  if (home && lower === home) return true;

  return false;
}

function normalizeSlash(p) {
  return String(p).replace(/\\/g, '/');
}

function relPath(caseDir, p) {
  const rel = path.relative(caseDir, p) || '.';
  return normalizeSlash(rel);
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isFirefoxProfileDir(p) {
  const st = stat(p);
  if (!st || !st.isDirectory()) return false;
  let names = [];
  try { names = fs.readdirSync(p).map(name => name.toLowerCase()); } catch { return false; }
  const nameSet = new Set(names);
  const markerHits = [
    'prefs.js',
    'cookies.sqlite',
    'places.sqlite',
    'storage',
    'cache2',
    'cert9.db',
    'key4.db',
    'logins.db',
    'webappsstore.sqlite',
    'parent.lock',
    'sessionstore-backups',
  ].filter(name => nameSet.has(name)).length;
  return markerHits >= 2;
}

function isProfilePath(p) {
  const lower = normalizeSlash(p).toLowerCase();
  if (/(^|\/)(cloak-profile|browser-profile|user-data-dir|user-data|firefox-profile|chrome-profile|ruyipage-profile|profile)(\/|$)/.test(lower)
    || /(^|\/)[^/]*profile[^/]*(\/|$)/.test(lower)
    || /(^|\/)(cookies|local storage|indexeddb|session storage)(\/|$)/.test(lower)
    || /\b(cookie|localstorage|sessionstorage|authorization|token)\b/i.test(lower)) return true;

  let cur = path.resolve(p);
  const st = stat(cur);
  if (!st || !st.isDirectory()) cur = path.dirname(cur);
  while (true) {
    if (isFirefoxProfileDir(cur)) return true;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

function isDisposableDirName(name) {
  const n = name.toLowerCase();
  return [
    'tmp', '.tmp', 'temp', '.temp', 'cache', '.cache',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
    'browser-temp', 'failed', '.downloads', '.tmp-downloads',
  ].includes(n);
}

function isDisposableFileName(name) {
  const n = name.toLowerCase();
  if (['.ds_store', 'thumbs.db', 'desktop.ini'].includes(n)) return true;
  if (/\.(tmp|temp|bak|old|orig|retry|partial|download|crdownload|cache)$/i.test(n)) return true;
  if (/^(env-trace\.jsonl|missing-env\.json|node-output\.json|run-output\.json)$/i.test(n)) return true;
  if (/^(fingerprint-hook|.*-fingerprint-hook|hook-fingerprint).*\.(js|mjs|cjs)$/i.test(n)) return true;
  if (/^(test-|tmp-|temp-|debug-|scratch-|capture[-_]|extract[-_]).+\.(js|mjs|cjs|py|json|jsonl|log|txt|md|html|png|jpg|jpeg|webp|har)$/i.test(n)) return true;
  if (/(\.test-output|\.debug-output|\.tmp-output)\./i.test(n)) return true;
  return false;
}

// 不跟随符号链接地遍历整棵树；符号链接本身入列但不再递归
function listTree(p, out = []) {
  if (!exists(p)) return out;
  const st = lstat(p);
  if (!st) return out;
  out.push(p);
  if (st.isDirectory() && !st.isSymbolicLink()) {
    let names = [];
    try { names = fs.readdirSync(p); } catch { names = []; }
    for (const name of names) listTree(path.join(p, name), out);
  }
  return out;
}

// 整目录遍历（用于剪枝空目录），同样不跟随符号链接
function listDirsDeepFirst(p) {
  const out = [];
  function visit(dir) {
    if (!exists(dir)) return;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { names = []; }
    for (const name of names) {
      const child = path.join(dir, name);
      const st = lstat(child);
      if (st && st.isDirectory() && !st.isSymbolicLink()) visit(child);
    }
    out.push(dir);
  }
  visit(p);
  return out.sort((a, b) => b.length - a.length);
}

// 全量文件列表缓存（一次构建，避免 hasProfileInside 反复 listTree 造成 O(n^2)）
function getFullTree() {
  if (!FULL_TREE_CACHE) FULL_TREE_CACHE = listTree(CASE_DIR);
  return FULL_TREE_CACHE;
}

function hasProfileInside(p) {
  return getFullTree().some(f => (f === p || isInside(p, f)) && isProfilePath(f));
}

function isProfileProtectedContainer(p, includeProfiles) {
  if (includeProfiles) return false;
  const st = stat(p);
  return !!st && st.isDirectory() && !isProfilePath(p) && hasProfileInside(p);
}

function hasOnlyProfileChildren(dir) {
  const st = stat(dir);
  if (!st || !st.isDirectory()) return false;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return false; }
  if (names.length === 0) return false;
  return names.every(name => {
    const child = path.join(dir, name);
    return isProfilePath(child) || hasProfileInside(child);
  });
}

function addAction(actions, action, target, reason) {
  actions.push({ action, path: target, reason: reason || '' });
}

// 删除带越界校验 + 失败容错（不抛错中断整体清理）
function removePath(target, dryRun, recursive = true, actions) {
  if (dryRun) return;
  const st = lstat(target);
  if (!st) return;

  if (!isContained(target)) {
    if (actions) addAction(actions, 'blocked-outside', target, '拒绝删除 case 目录之外的路径（符号链接 / 越界）');
    return;
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (st.isDirectory() && recursive) fs.rmSync(target, { recursive: true, force: true });
      else if (st.isDirectory()) fs.rmdirSync(target);
      else fs.rmSync(target, { force: true });
      return;
    } catch (err) {
      lastErr = err;
      if (err.code === 'ENOENT') return; // 已被删除
    }
  }
  if (lastErr) {
    if (actions) addAction(actions, 'delete-error', target, `删除失败：${lastErr.code || lastErr.message}`);
    else throw lastErr;
  }
}

function cleanDisposableDir(caseDir, dir, args, actions) {
  if (!exists(dir)) return;
  const st = stat(dir);
  if (!st || !st.isDirectory()) return;

  if (isProfilePath(dir) && !args.includeProfiles) {
    addAction(actions, 'skip-profile', dir, '疑似登录态或浏览器 Profile，默认保留');
    return;
  }

  if (isProfileProtectedContainer(dir, args.includeProfiles)) {
    addAction(actions, 'keep-profile-container', dir, '目录内包含疑似 Profile，仅清理非敏感子项');
    let names = [];
    try { names = fs.readdirSync(dir); } catch { names = []; }
    for (const name of names) {
      const child = path.join(dir, name);
      if (isProfilePath(child) || hasProfileInside(child)) {
        addAction(actions, 'skip-profile', child, '疑似登录态或浏览器 Profile，默认保留');
        continue;
      }
      addAction(actions, args.dryRun ? 'would-delete' : 'delete', child, '清理临时目录中的非敏感子项');
      removePath(child, args.dryRun, true, actions);
    }
    return;
  }

  addAction(actions, args.dryRun ? 'would-delete' : 'delete', dir, '清理临时 / 缓存 / 中间产物目录');
  removePath(dir, args.dryRun, true, actions);
}

function isTempLikePath(caseDir, p, includeProfiles) {
  if (p === caseDir) return false;
  if (!includeProfiles && isProfilePath(p)) return false;
  const rel = relPath(caseDir, p).toLowerCase();
  const base = path.basename(p).toLowerCase();
  const tempLike = rel.split('/').some(part => isDisposableDirName(part)) || isDisposableFileName(base);
  if (!tempLike) return false;

  const st = stat(p);
  if (!includeProfiles && st && st.isDirectory() && isProfileProtectedContainer(p, includeProfiles) && hasOnlyProfileChildren(p)) {
    return false;
  }
  return true;
}

function collectRemainingTempLike(caseDir, includeProfiles) {
  return getFullTree().filter(p => exists(p) && isTempLikePath(caseDir, p, includeProfiles));
}

function retryRemainingCleanup(caseDir, args, actions) {
  if (args.dryRun) return;
  for (let round = 0; round < 2; round++) {
    const remaining = collectRemainingTempLike(caseDir, args.includeProfiles);
    if (!remaining.length) return;
    for (const p of remaining.sort((a, b) => b.length - a.length)) {
      if (!exists(p) || p === caseDir || !isInside(caseDir, p)) continue;
      const st = stat(p);
      if (!st) continue;
      if (!args.includeProfiles && isProfilePath(p)) continue;
      if (!args.includeProfiles && st.isDirectory() && isProfileProtectedContainer(p, args.includeProfiles)) {
        cleanDisposableDir(caseDir, p, args, actions);
        continue;
      }
      if (st.isDirectory()) {
        addAction(actions, 'delete', p, '二次清理残留临时目录');
        removePath(p, false, true, actions);
      } else if (isDisposableFileName(path.basename(p)) || relPath(caseDir, p).toLowerCase().split('/').some(part => isDisposableDirName(part))) {
        addAction(actions, 'delete', p, '二次清理残留临时文件');
        removePath(p, false, false, actions);
      }
    }
    pruneEmptyDirs(caseDir, args, actions);
  }
}

function collectDisposableDirs(caseDir) {
  const dirs = [];
  const direct = [
    'tmp', '.tmp', 'temp', '.temp', 'browser-temp', 'cache', '.cache',
    'downloads/failed', 'downloads/.tmp', 'downloads/.cache',
    'logs/tmp', 'logs/.tmp', 'trace/tmp', 'trace/.tmp',
    'ruyi-trace/tmp', 'ruyi-trace/.tmp',
    'screenshots/tmp', 'screenshots/.tmp',
  ];
  for (const rel of direct) dirs.push(path.join(caseDir, rel));

  for (const p of getFullTree()) {
    const st = stat(p);
    if (!st || !st.isDirectory()) continue;
    if (p === caseDir) continue;
    if (isDisposableDirName(path.basename(p))) dirs.push(p);
  }

  return Array.from(new Set(dirs.map(p => path.resolve(p)))).sort((a, b) => b.length - a.length);
}

function cleanDisposableFiles(caseDir, args, actions) {
  for (const p of getFullTree()) {
    if (!exists(p)) continue;
    const st = stat(p);
    if (!st || !st.isFile()) continue;
    if (isProfilePath(p) && !args.includeProfiles) {
      addAction(actions, 'skip-sensitive-file', p, '疑似 Cookie / token / 登录态文件，默认保留');
      continue;
    }
    const rel = relPath(caseDir, p).toLowerCase();
    const inTempLikeDir = rel.split('/').some(part => isDisposableDirName(part));
    const shouldDelete = isDisposableFileName(path.basename(p)) || (st.size === 0 && inTempLikeDir);
    if (!shouldDelete) continue;
    addAction(actions, args.dryRun ? 'would-delete' : 'delete', p, st.size === 0 ? '清理空临时文件' : '清理临时 / 测试 / 缓存文件');
    removePath(p, args.dryRun, false, actions);
  }
}

function pruneEmptyDirs(caseDir, args, actions) {
  if (!args.pruneEmpty) return;
  for (const dir of listDirsDeepFirst(caseDir)) {
    if (dir === caseDir) continue;
    if (!exists(dir)) continue;
    if (isProfilePath(dir) && !args.includeProfiles) continue;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    if (names.length !== 0) continue;
    addAction(actions, args.dryRun ? 'would-remove-empty-dir' : 'remove-empty-dir', dir, '清理空目录');
    removePath(dir, args.dryRun, false, actions);
  }
}

function cleanup(args) {
  if (!args.caseDir) throw new Error('必须提供 --case-dir');
  const caseDir = paths.resolveCaseDir(args.caseDir);
  if (!exists(caseDir)) throw new Error(`case 目录不存在：${caseDir}`);
  const caseStat = stat(caseDir);
  if (!caseStat || !caseStat.isDirectory()) throw new Error(`case 路径不是目录：${caseDir}`);
  if (isDangerousDir(caseDir)) throw new Error(`拒绝清理危险目录：${caseDir}`);
  if (!args.dryRun && !args.force) throw new Error('未提供 --force，拒绝删除；请先使用 --dry-run 预览');

  CASE_DIR = caseDir;
  CASE_REAL = resolveReal(caseDir);
  FULL_TREE_CACHE = null;

  const actions = [];
  const disposableDirs = collectDisposableDirs(caseDir);
  for (const dir of disposableDirs) {
    if (!exists(dir)) continue;
    if (dir === caseDir || !isInside(caseDir, dir)) continue;
    cleanDisposableDir(caseDir, dir, args, actions);
  }

  cleanDisposableFiles(caseDir, args, actions);
  pruneEmptyDirs(caseDir, args, actions);
  retryRemainingCleanup(caseDir, args, actions);

  const remainingTempLike = collectRemainingTempLike(caseDir, args.includeProfiles);

  return {
    caseDir,
    dryRun: args.dryRun,
    includeProfiles: args.includeProfiles,
    pruneEmpty: args.pruneEmpty,
    actions,
    remainingTempLike,
    clean: remainingTempLike.length === 0,
  };
}

function renderMarkdown(result) {
  const label = {
    'skip-profile': '跳过 Profile',
    'skip-sensitive-file': '跳过敏感文件',
    'keep-profile-container': '保留 Profile 容器目录',
    'would-delete': '将删除',
    'delete': '已删除',
    'would-remove-empty-dir': '将删除空目录',
    'remove-empty-dir': '已删除空目录',
    'blocked-outside': '已拦截（越界）',
    'delete-error': '删除失败',
  };
  const lines = ['# 清理结果', '', `case 目录：${result.caseDir}`, `dry-run：${result.dryRun ? '是' : '否'}`, `是否包含 Profile：${result.includeProfiles ? '是' : '否'}`, `是否清理空目录：${result.pruneEmpty ? '是' : '否'}`, ''];
  if (result.actions.length) {
    lines.push('## 操作列表');
    for (const a of result.actions) {
      lines.push(`- ${label[a.action] || a.action}：${a.path}${a.reason ? `（${a.reason}）` : ''}`);
    }
  } else {
    lines.push('## 操作列表', '- 没有需要清理的内容');
  }
  lines.push('', '## 清理后检查');
  lines.push(`- 是否仍存在普通临时 / 缓存 / 中间产物：${result.clean ? '否' : '是'}`);
  if (result.remainingTempLike.length) {
    for (const p of result.remainingTempLike) lines.push(`  - ${p}`);
  }
  return lines.join('\n') + '\n';
}

try {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); process.exit(0); }
  const result = cleanup(args);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}
