#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function parseArgs(argv) {
  const args = {
    skillDir: '',
    skillsRoot: '',
    require: false,
    json: false,
    markdown: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--skill-dir') args.skillDir = nextVal('');
    else if (a === '--skills-root') args.skillsRoot = nextVal('');
    else if (a === '--require') args.require = true;
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
  node scripts/check_web_verify_patcher.js --markdown
  node scripts/check_web_verify_patcher.js --require --json
  node scripts/check_web_verify_patcher.js --skill-dir <web-verify-patcher-dir> --markdown
  node scripts/check_web_verify_patcher.js --skills-root <skills-root> --require --markdown

说明：检测可选参考资源 web-verify-patcher skill 是否已安装。本 skill 验证码答案层资产（ddddocr/坐标/轨迹脚本 + 题型分类器 classify_verify.py）已内化，web-verify-patcher 仅作扩展参考，非必需依赖。未安装时输出中文安装指引。`;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; }
}

function unique(list) {
  return [...new Set(list.filter(Boolean).map(p => path.normalize(p)))];
}

function defaultCandidates(args) {
  if (args.skillDir) return [path.resolve(args.skillDir)];
  if (args.skillsRoot) return [path.join(path.resolve(args.skillsRoot), 'web-verify-patcher')];
  const roots = [];
  if (process.env.CODEX_HOME) roots.push(path.join(process.env.CODEX_HOME, 'skills'));
  const home = os.homedir();
  roots.push(path.join(home, '.codex', 'skills'));
  roots.push(path.join(home, '.claude', 'skills'));
  roots.push(path.join(process.cwd(), 'skills'));
  return unique(roots).map(root => path.join(root, 'web-verify-patcher'));
}

function inspectSkill(dir) {
  const skillMd = path.join(dir, 'SKILL.md');
  const text = readText(skillMd);
  const nameMatch = text.match(/^name:\s*([^\r\n]+)/m);
  const descriptionMatch = text.match(/^description:\s*(.+)$/m);
  return {
    dir,
    skillMd,
    exists: exists(skillMd),
    name: nameMatch ? nameMatch[1].replace(/["']/g, '').trim() : '',
    hasExpectedName: /name:\s*web-verify-patcher\b/m.test(text),
    description: descriptionMatch ? descriptionMatch[1].trim().slice(0, 160) : '',
  };
}

function inspect(args) {
  const candidates = defaultCandidates(args).map(inspectSkill);
  const installed = candidates.find(c => c.exists && c.hasExpectedName) || null;
  const report = {
    ok: Boolean(installed),
    installed: Boolean(installed),
    selected: installed,
    candidates,
    installRepo: 'https://github.com/lwjjike/xbsReverseSkill',
    expectedFolder: 'web-verify-patcher',
    instructions: [
      '自动安装前先输出一行宣布（安装目标 $HOME/.codex/skills/web-verify-patcher，Windows 为 %USERPROFILE%\\.codex\\skills\\web-verify-patcher），随后执行安装，不要求用户确认；克隆仓库后必须检查是否存在 web-verify-patcher/ 目录。',
      '如果仓库当前分支没有 web-verify-patcher/，不得假装安装成功，要求用户提供正确分支、正确仓库、压缩包或本地目录。',
      '自行安装时，将 web-verify-patcher 文件夹放到 $HOME/.codex/skills/web-verify-patcher；Windows 可使用 %USERPROFILE%\\.codex\\skills\\web-verify-patcher。',
      '如当前环境使用 Claude CLI，也可同步放到 $HOME/.claude/skills/web-verify-patcher。安装后重启或刷新对应 CLI 再检测。',
    ],
  };
  return report;
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# web-verify-patcher 安装检测');
  lines.push('');
  lines.push(`- 检测结果：${report.ok ? '已安装' : '未检测到可用安装'}`);
  if (report.selected) lines.push(`- 命中目录：${report.selected.dir}`);
  lines.push(`- 预期 Skill 名称：web-verify-patcher`);
  lines.push(`- 建议仓库：${report.installRepo}`);
  lines.push('');
  lines.push('## 检测路径');
  lines.push('');
  for (const c of report.candidates) {
    lines.push(`- ${c.exists ? '存在' : '不存在'}：${c.skillMd}${c.exists ? `，name=${c.name || '未识别'}` : ''}`);
  }
  if (!report.ok) {
    lines.push('');
    lines.push('## 安装指引');
    lines.push('');
    for (const item of report.instructions) lines.push(`- ${item}`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const report = inspect(args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(toMarkdown(report));
  if (args.require && !report.ok) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(`web-verify-patcher 检测失败：${err.message}`);
  process.exit(1);
}
