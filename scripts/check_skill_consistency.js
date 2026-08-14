#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = {
    skill: 'SKILL.md',
    projectDir: null,
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
    if (a === '--skill') args.skill = nextVal();
    else if (a === '--project-dir' || a === '--root') args.projectDir = nextVal();
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--self-test') args.selfTest = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/check_skill_consistency.js --project-dir <skill-root> --markdown
  node scripts/check_skill_consistency.js --skill SKILL.md --json
  node scripts/check_skill_consistency.js --self-test

检查项：
- SKILL.md 存在且 YAML frontmatter 包含 name / description。
- 关键硬门禁锚点存在：GATE-0 / GATE-1 / GATE-2 / EVIDENCE_GATE / 纯协议红线 / REAL_VERIFY /
  check_evidence.js / check_final_artifact.js / 最终项目总结.md / --target-signal / TRACE_RETRY。
- SKILL.md 中引用的 references / scripts / assets / templates / cases 路径真实存在。
- reference-map 若被引用，其内部相对链接同样校验。`;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

function stripRefEdge(value) {
  let v = value.trim();
  v = v.replace(/^[`<(]+|[`>)\].,;:!?]+$/g, '');
  v = v.replace(/[`>)\].,;:!?]+$/g, '');
  return v;
}

function collectRefs(text) {
  const refs = new Set();
  const re = /\b(?:references|scripts|assets|templates|cases)\/[A-Za-z0-9_./-]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const value = stripRefEdge(raw);
    if (!value) continue;
    if (value.endsWith('/') || !/\.[A-Za-z0-9]+$/.test(value)) {
      refs.add(value.replace(/\/$/, ''));
    } else {
      refs.add(value);
    }
  }
  return Array.from(refs);
}

function walkFiles(dir) {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const REQUIRED_ANCHORS = [
  'GATE-0',
  'GATE-1',
  'GATE-2',
  'EVIDENCE_GATE',
  '纯协议红线',
  'REAL_VERIFY',
  'check_evidence.js',
  'check_final_artifact.js',
  '最终项目总结.md',
  '--target-signal',
  'TRACE_RETRY',
];

function checkSkill(skillPath, root) {
  const problems = [];
  const references = [];

  if (!exists(skillPath)) {
    return { skillPath, references, problems: [{ type: 'missing-skill', message: `SKILL.md 不存在：${skillPath}` }] };
  }

  const text = readText(skillPath);
  if (!/^---\s*\r?\n/.test(text) || !/name:\s*\S+/.test(text) || !/description:\s*\S+/.test(text)) {
    problems.push({ type: 'frontmatter', message: 'YAML frontmatter 必须包含 name 和 description' });
  }

  for (const anchor of REQUIRED_ANCHORS) {
    if (!text.includes(anchor)) {
      problems.push({ type: 'missing-anchor', message: `缺少关键锚点：${anchor}` });
    }
  }

  for (const rel of collectRefs(text)) {
    references.push(rel);
    if (!exists(path.join(root, rel))) {
      problems.push({ type: 'missing-reference', message: `引用路径不存在：${rel}` });
    }
  }

  const mapRel = 'references/workflow/reference-map.md';
  let mapText = '';
  if (text.includes(mapRel)) {
    const mapPath = path.join(root, mapRel);
    if (!exists(mapPath)) {
      problems.push({ type: 'missing-reference', message: `引用路径不存在：${mapRel}` });
    } else {
      mapText = readText(mapPath);
      for (const rel of collectRefs(mapText)) {
        references.push(rel);
        if (!exists(path.join(root, rel))) {
          problems.push({ type: 'missing-reference', message: `${mapRel} 引用路径不存在：${rel}` });
        }
      }
    }
  }

  const refsDir = path.join(root, 'references');
  for (const full of walkFiles(refsDir)) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (rel === mapRel) continue;
    if (!text.includes(rel) && !mapText.includes(rel)) {
      problems.push({ type: 'orphan-reference', message: `references 文件未在 SKILL.md 或 ${mapRel} 中路由：${rel}` });
    }
  }

  return { skillPath, references, problems };
}

function renderMarkdown(result) {
  const lines = [];
  lines.push(`# Skill 一致性检查：${result.skillPath}`);
  lines.push('');
  lines.push(`- 引用条目：${result.references.length}`);
  lines.push(`- 问题数量：${result.problems.length}`);
  lines.push('');
  if (result.problems.length === 0) {
    lines.push('[通过] 通过');
  } else {
    for (const p of result.problems) {
      lines.push(`- [未通过] ${p.message}`);
    }
  }
  return lines.join('\n');
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-consistency-'));
  try {
    const skill = path.join(dir, 'SKILL.md');
    fs.writeFileSync(skill, [
      '---',
      'name: test',
      'description: test',
      '---',
      '',
      'GATE-0 GATE-1 GATE-2 EVIDENCE_GATE 纯协议红线 REAL_VERIFY check_evidence.js check_final_artifact.js 最终项目总结.md --target-signal TRACE_RETRY',
      'scripts/missing.js',
    ].join('\n'));
    const result = checkSkill(skill, dir);
    assert.strictEqual(result.problems.length, 1);
    assert.strictEqual(result.problems[0].type, 'missing-reference');
    assert(result.problems[0].message.includes('scripts/missing.js'));
    return 'self-test passed';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  if (args.selfTest) {
    console.log(selfTest());
    return;
  }

  const root = path.resolve(args.projectDir || path.join(__dirname, '..'));
  const skillPath = path.resolve(root, args.skill);
  const result = checkSkill(skillPath, root);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderMarkdown(result));
  }

  process.exitCode = result.problems.length === 0 ? 0 : 1;
}

main();
