#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths');

const STAGE_FILES = {
  '需求信息确认': '01-需求信息确认.md',
  'intake': '01-需求信息确认.md',
  '取证方案确认': '02-取证方案确认.md',
  'forensics': '02-取证方案确认.md',
  '请求样本与可疑参数确认': '03-请求样本与可疑参数确认.md',
  'params': '03-请求样本与可疑参数确认.md',
  'JS文件与入口定位': '04-JS文件与入口定位.md',
  'entry': '04-JS文件与入口定位.md',
  '补环境前置分析': '05-补环境前置分析.md',
  'pre-env': '05-补环境前置分析.md',
  '补环境实现记录': '06-补环境实现记录.md',
  'env': '06-补环境实现记录.md',
  '验证与清理记录': '07-验证与清理记录.md',
  'validation': '07-验证与清理记录.md',
};

const DYNAMIC_REQUIRED_SECTIONS = [
  '当前阶段目标',
  '当前项目进展',
  '本阶段修改文件',
  'Trace 计划内首轮实现 / 调整的 WebAPI',
  '计划外新增 WebAPI 与原因',
  '本阶段新增功能',
  '本阶段修复的 Bug',
  '本阶段新增 / 修改的指纹能力',
  '真实性保护变化',
  '本阶段测试内容与结果',
  '清理情况',
  '风险与遗留问题',
  '下一步计划',
];

const CAPABILITY_SECTIONS = [
  'Trace 计划内首轮实现 / 调整的 WebAPI',
  '计划外新增 WebAPI 与原因',
  '本阶段新增功能',
  '本阶段修复的 Bug',
  '本阶段新增 / 修改的指纹能力',
  '真实性保护变化',
  '本阶段测试内容与结果',
];

function parseArgs(argv) {
  const args = { caseDir: 'case', requiredStages: [], requireDynamicFields: false, requireCapabilityReport: false, json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal('');
    else if (a === '--require-stage') args.requiredStages.push(nextVal(''));
    else if (a === '--require-initial') args.requiredStages.push('需求信息确认');
    else if (a === '--require-dynamic-fields') args.requireDynamicFields = true;
    else if (a === '--require-capability-report') args.requireCapabilityReport = true;
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
  node scripts/check_stage_reports.js --case-dir case --require-stage 需求信息确认 --markdown
  node scripts/check_stage_reports.js --case-dir case --require-stage WebAPI补齐阶段报告 --require-dynamic-fields --markdown
  node scripts/check_stage_reports.js --case-dir case --require-stage 需求信息确认 --require-stage 请求样本与可疑参数确认 --json

说明：默认只检查已存在的阶段报告是否使用中文文件名、UTF-8 编码并满足动态章节要求；目录缺失仅提醒，不失败。传入 --require-stage 或 --require-initial 时才把阶段报告缺失作为问题（退出码非 0）。使用 --require-dynamic-fields 时会校验动态阶段报告是否包含 Trace 计划内 WebAPI、计划外新增 WebAPI 原因、功能、Bug、指纹、测试、清理和风险等章节。`;
}
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function stat(p) { try { return fs.statSync(p); } catch { return null; } }
function readText(p) { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); }
function hasChinese(s) { return /[\u4e00-\u9fff]/.test(String(s || '')); }
function rel(root, p) { return (path.relative(root, p) || '.').replace(/\\/g, '/'); }
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function listMarkdown(dir) {
  if (!exists(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = stat(p);
    if (st && st.isFile() && path.extname(name).toLowerCase() === '.md') out.push(p);
  }
  return out.sort();
}
function fixedStageFileName(stage) {
  const s = String(stage || '').trim();
  return STAGE_FILES[s] || '';
}
function stageTitle(stage) {
  const fixed = fixedStageFileName(stage);
  if (!fixed) return String(stage || '').trim();
  return fixed.replace(/^\d+-/, '').replace(/\.md$/i, '');
}
function locateStageReport(stageDir, stage) {
  const s = String(stage || '').trim();
  if (!s) return '';
  const fixed = fixedStageFileName(s);
  if (fixed) {
    const p = path.join(stageDir, fixed);
    if (exists(p)) return p;
    return '';
  }
  if (!hasChinese(s)) return '';
  const exact = path.join(stageDir, `${s}.md`);
  if (exists(exact)) return exact;
  const pattern = new RegExp(`^(\\d{1,3}-)?${escapeRegExp(s)}\\.md$`, 'i');
  const files = listMarkdown(stageDir);
  return files.find(file => pattern.test(path.basename(file))) || files.find(file => path.basename(file).includes(s)) || '';
}
function hasMojibake(text) {
  const questionRuns = text.match(/\?{5,}/g) || [];
  return text.includes('\uFFFD') || questionRuns.length > 0;
}
function missingSections(text, sections) {
  return sections.filter(section => !text.includes(section));
}
function isDynamicCandidate(name, text) {
  if (/WebAPI|指纹|Bug|补环境|NativeProtect|能力|修复|回归|阶段报告/i.test(name)) return true;
  const sectionHits = DYNAMIC_REQUIRED_SECTIONS.filter(section => text.includes(section)).length;
  return sectionHits >= 4;
}
function check(args) {
  const caseDir = paths.resolveCaseDir(args.caseDir || 'case');
  const stageDir = path.join(caseDir, '阶段报告');
  const reports = listMarkdown(stageDir);
  const problems = [];
  const warnings = [];
  const requirePresence = args.requiredStages.length > 0;
  if (!exists(stageDir)) {
    if (requirePresence) problems.push('缺少阶段报告目录：case/阶段报告');
    else warnings.push('未生成阶段报告目录 case/阶段报告（默认按需生成，仅提醒）。');
  }
  if (!reports.length) {
    if (requirePresence) problems.push('缺少阶段报告 Markdown 文件，至少应生成 01-需求信息确认.md');
    else warnings.push('未生成阶段报告 Markdown 文件（默认按需生成，仅提醒）。');
  }
  const reportResults = [];
  for (const file of reports) {
    const name = path.basename(file);
    const item = {
      file: rel(caseDir, file),
      chineseFileName: hasChinese(name),
      utf8Readable: false,
      mojibakeSuspected: false,
      dynamicCandidate: false,
      initialRequiredFieldsMissing: [],
      dynamicFieldsMissing: [],
      capabilityFieldsMissing: [],
    };
    if (!item.chineseFileName) problems.push(`阶段报告文件名必须包含中文：${item.file}`);
    let text = '';
    try { text = readText(file); item.utf8Readable = true; } catch (err) { problems.push(`阶段报告无法按 UTF-8 读取：${item.file}：${err.message}`); }
    if (text) {
      item.mojibakeSuspected = hasMojibake(text);
      if (item.mojibakeSuspected) problems.push(`阶段报告疑似乱码或包含连续问号：${item.file}`);
      if (name === '01-需求信息确认.md') {
        for (const key of ['目标网站 URL', '目标 API', '取证模式', '加密参数', '已知 JS 文件']) {
          if (!text.includes(key)) item.initialRequiredFieldsMissing.push(key);
        }
        if (item.initialRequiredFieldsMissing.length) problems.push(`需求信息确认报告缺少字段：${item.initialRequiredFieldsMissing.join('、')}`);
      }
      item.dynamicCandidate = isDynamicCandidate(name, text);
      const simpleFixedStage = /^0[1-4]-/.test(name);
      const shouldCheckDynamic = item.dynamicCandidate || (args.requireDynamicFields && !simpleFixedStage);
      if (shouldCheckDynamic) {
        item.dynamicFieldsMissing = missingSections(text, DYNAMIC_REQUIRED_SECTIONS);
        if (item.dynamicFieldsMissing.length) problems.push(`动态阶段报告缺少章节：${item.file}：${item.dynamicFieldsMissing.join('、')}`);
      }
      if (args.requireCapabilityReport && shouldCheckDynamic) {
        item.capabilityFieldsMissing = missingSections(text, CAPABILITY_SECTIONS);
        if (item.capabilityFieldsMissing.length) problems.push(`阶段报告缺少能力增量章节：${item.file}：${item.capabilityFieldsMissing.join('、')}`);
      }
    }
    reportResults.push(item);
  }
  for (const stage of args.requiredStages) {
    const file = locateStageReport(stageDir, stage);
    if (!file) {
      const title = stageTitle(stage);
      if (!title || !hasChinese(title)) problems.push(`未知必需阶段：${stage}`);
      else problems.push(`缺少必需阶段报告：${title}`);
    }
  }
  return { caseDir, stageDir, clean: problems.length === 0, problems, warnings, reports: reportResults };
}
function renderMarkdown(result) {
  const lines = ['# 阶段报告检查结果', '', `case 目录：${result.caseDir}`, `阶段报告目录：${result.stageDir}`, `是否通过：${result.clean ? '是' : '否'}`, ''];
  lines.push('## 报告列表');
  if (result.reports.length) {
    for (const r of result.reports) {
      lines.push(`- ${r.file}：中文文件名=${r.chineseFileName ? '是' : '否'}，UTF-8=${r.utf8Readable ? '是' : '否'}，疑似乱码=${r.mojibakeSuspected ? '是' : '否'}，动态报告=${r.dynamicCandidate ? '是' : '否'}`);
      if (r.dynamicFieldsMissing.length) lines.push(`  - 缺少动态章节：${r.dynamicFieldsMissing.join('、')}`);
      if (r.capabilityFieldsMissing.length) lines.push(`  - 缺少能力章节：${r.capabilityFieldsMissing.join('、')}`);
    }
  } else lines.push('- 无');
  if (result.problems.length) {
    lines.push('', '## 问题');
    for (const p of result.problems) lines.push(`- ${p}`);
  }
  if (result.warnings.length) {
    lines.push('', '## 提醒');
    for (const w of result.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n') + '\n';
}
try {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); process.exit(0); }
  const result = check(args);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
  process.exit(result.clean ? 0 : 1);
} catch (err) { console.error(err.message || String(err)); console.error(usage()); process.exit(1); }
