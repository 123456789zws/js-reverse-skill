#!/usr/bin/env node
'use strict';

// 校验答案层产出的 answer JSON 是否符合 references/captcha/captcha-overview.md 的交接契约。
// schema 不通过不进 Phase 4 参数化。

const fs = require('fs');

const OFFSET_TYPES = ['slider', 'rotate'];
const POINT_TYPES = ['click-select', 'grid', 'area-select', 'difference-click', 'font-identify', 'semantic-reasoning'];

function parseArgs(argv) {
  const args = { file: null, json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--file' || a === '-f') args.file = nextVal(undefined);
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：\n  node scripts/check_captcha_answer.js --file answer.json --markdown\n  node scripts/check_captcha_answer.js --file answer.json --json\n\n不提供 --file 时会从标准输入读取 JSON。契约定义见 references/captcha/captcha-overview.md。`;
}

function isSize2(v) {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validate(answer) {
  const errors = [];
  const warnings = [];

  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return { errors: ['顶层必须是 JSON 对象'], warnings };
  }

  if (typeof answer.captcha_type !== 'string' || !answer.captcha_type) {
    errors.push('缺少 captcha_type（题型标签，如 slider / click-select）');
  }
  if (typeof answer.provider !== 'string' || !answer.provider) {
    warnings.push('缺少 provider（厂商标签，如 geetest）；厂商未知时可填 custom-or-unknown');
  }
  if (typeof answer.solver !== 'string' || !answer.solver) {
    warnings.push('缺少 solver（求解器标识，如 ddddocr-slide_match），复盘时需要');
  }
  if (typeof answer.coordinate_space !== 'string' || !answer.coordinate_space) {
    warnings.push('缺少 coordinate_space（image-pixel / element-css / page），坐标换算需要');
  }
  if (!isSize2(answer.source_image_size)) {
    errors.push('source_image_size 必须是两个正数 [宽, 高]');
  }
  if (answer.display_size !== undefined && !isSize2(answer.display_size)) {
    errors.push('display_size 必须是两个正数 [宽, 高]（可省略，默认等于 source_image_size）');
  }
  if (answer.confidence !== undefined && (!isNum(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) {
    errors.push('confidence 必须在 [0, 1] 区间');
  }

  const type = answer.captcha_type;
  const hasOffset = answer.offset && typeof answer.offset === 'object' && isNum(answer.offset.x);
  const hasPoints = Array.isArray(answer.points) && answer.points.length > 0;

  if (OFFSET_TYPES.includes(type)) {
    if (!hasOffset) errors.push(`题型 ${type} 必须提供 offset.x（滑块偏移或旋转角度换算后的距离）`);
    if (hasPoints) warnings.push(`题型 ${type} 一般不需要 points，请确认没有混用`);
  } else if (POINT_TYPES.includes(type)) {
    if (!hasPoints) {
      errors.push(`题型 ${type} 必须提供非空 points 数组`);
    } else {
      answer.points.forEach((p, idx) => {
        if (!p || !isNum(p.x) || !isNum(p.y)) errors.push(`points[${idx}] 必须包含数值 x、y`);
      });
      const orders = answer.points.map((p) => p && p.order).filter((o) => o !== undefined);
      if (orders.length > 0) {
        if (orders.length !== answer.points.length) {
          warnings.push('部分 point 缺少 order；多点题必须完整保留点击顺序');
        }
        const sorted = [...orders].sort((a, b) => a - b);
        if (orders.some((o, i) => o !== sorted[i])) errors.push('points 的 order 不是递增序列，点击顺序丢失');
      } else if (answer.points.length > 1) {
        warnings.push('多点题未提供 order 字段，请确认顺序由数组顺序表达');
      }
    }
  } else if (type) {
    warnings.push(`题型 ${type} 不在已知 offset/points 规则内，按通用结构放行，请人工确认答案字段`);
  }

  if (answer.track !== undefined) {
    if (!Array.isArray(answer.track)) {
      errors.push('track 必须是数组');
    } else {
      answer.track.forEach((p, idx) => {
        if (!p || !isNum(p.x) || !isNum(p.y) || !isNum(p.t)) errors.push(`track[${idx}] 必须包含数值 x、y、t`);
      });
      if (hasOffset && answer.track.length > 0) {
        const lastX = answer.track[answer.track.length - 1].x;
        if (isNum(lastX) && Math.abs(lastX - answer.offset.x) > 20) {
          warnings.push(`track 终点 x(${lastX}) 与 offset.x(${answer.offset.x}) 差距 >20px，轨迹与答案不一致`);
        }
      }
    }
  }

  if (answer.challenge_binding !== undefined && (typeof answer.challenge_binding !== 'object' || answer.challenge_binding === null)) {
    errors.push('challenge_binding 必须是对象（如 { gt, challenge } 或 { captcha_id, lot_number }）');
  } else if (answer.challenge_binding && Object.values(answer.challenge_binding).every((v) => !v)) {
    warnings.push('challenge_binding 字段全为空；verify 提交前必须填入本次 load 阶段的真实绑定值');
  }

  return { errors, warnings };
}

function renderMarkdown(result) {
  const lines = [];
  lines.push(`## check_captcha_answer 结果：${result.clean ? 'CLEAN' : 'FAIL'}`);
  lines.push('');
  lines.push(`- clean: ${result.clean}`);
  lines.push(`- errors: ${result.errors.length}`);
  lines.push(`- warnings: ${result.warnings.length}`);
  if (result.errors.length) {
    lines.push('');
    lines.push('### Errors（必须修复）');
    result.errors.forEach((e) => lines.push(`- ${e}`));
  }
  if (result.warnings.length) {
    lines.push('');
    lines.push('### Warnings（确认后可放行）');
    result.warnings.forEach((w) => lines.push(`- ${w}`));
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  let raw;
  try {
    raw = args.file
      ? fs.readFileSync(args.file, 'utf8').replace(/^\uFEFF/, '')
      : fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    console.error(`读取输入失败：${e.message}`);
    process.exit(2);
  }

  let answer;
  try {
    answer = JSON.parse(raw);
  } catch (e) {
    console.error(`JSON 解析失败：${e.message}`);
    process.exit(2);
  }

  const { errors, warnings } = validate(answer);
  const result = { clean: errors.length === 0, errors, warnings };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderMarkdown(result));
  }
  process.exit(result.clean ? 0 : 1);
}

main();
