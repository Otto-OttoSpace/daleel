#!/usr/bin/env node
'use strict';
/*
 * dls-check — scan a codebase for Saudi DGA (Digital Government Authority) design-system
 * readiness. Part of Otto · dev.ottospace.co. Zero dependencies.
 *
 * DGA mandates one unified design system for every ministry: RTL-first, IBM Plex Sans Arabic,
 * WCAG 2.1 AA. Compliance is a legal requirement. dls-check flags the auto-checkable gaps and
 * prints the manual checklist for the rest.
 */
const fs = require('fs');
const path = require('path');

const VERSION = '0.1.0';
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.html', '.vue', '.svelte', '.astro']);
const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const IGNORE_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', 'vendor', '.svelte-kit']);

function lineOf(src, i) { return src.slice(0, i).split('\n').length; }

const PHYS_TW = /(^|[\s"'`])(-?(ml|mr|pl|pr|left|right)-[\w./[\]]+|text-(left|right)|rounded-[lr](-[\w]+)?|border-[lr](-[\w]+)?|float-(left|right))(?=[\s"'`]|$)/g;
const PHYS_CSS = /(margin|padding|border)-(left|right)|text-align:\s*(left|right)/g;

function scanFile(file, src) {
  const F = [];
  const push = (idx, from, msg, cat) => F.push({ file, line: lineOf(src, idx), from: String(from).trim().slice(0, 46), msg, cat });
  const ext = path.extname(file);
  let m;

  // RTL — DGA is RTL-first
  if (CODE_EXT.has(ext)) {
    const p = new RegExp(PHYS_TW.source, 'g');
    while ((m = p.exec(src))) push(m.index, m[2], 'not RTL-safe — DGA is RTL-first; use logical utilities (ms-/me-/ps-/pe-/start-/end-)', 'RTL');
  }
  if (CSS_EXT.has(ext)) {
    const p = new RegExp(PHYS_CSS.source, 'g');
    while ((m = p.exec(src))) push(m.index, m[0], 'physical property — DGA is RTL-first; use logical (margin-inline-*, text-align: start/end)', 'RTL');
  }
  // Font — DGA mandates IBM Plex Sans Arabic
  const ff = /font-family:\s*([^;}"'\n]+)/g;
  while ((m = ff.exec(src))) { if (!/plex\s*sans\s*arabic/i.test(m[1])) push(m.index, 'font-family: ' + m[1].trim(), 'DGA mandates "IBM Plex Sans Arabic" — not in this stack', 'FONT'); }
  // WCAG 2.1 AA (a subset that's regex-checkable)
  const img = /<img\b(?![^>]*\balt=)[^>]*>/g;
  while ((m = img.exec(src))) push(m.index, '<img …>', 'missing alt attribute (WCAG 2.1 AA)', 'A11Y');
  const html = /<html\b(?![^>]*\blang=)[^>]*>/g;
  while ((m = html.exec(src))) push(m.index, '<html>', 'missing lang attribute (WCAG / DGA bilingual)', 'A11Y');
  const ltr = /dir=["']ltr["']/g;
  while ((m = ltr.exec(src))) push(m.index, 'dir="ltr"', 'hard-coded LTR — DGA defaults RTL; derive dir from locale', 'RTL');

  return F;
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (IGNORE_DIR.has(name) || (name.startsWith('.') && name !== '.')) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(full)) || CSS_EXT.has(path.extname(full))) out.push(full);
  }
  return out;
}

const MANUAL = `Manual DGA checks (dls-check can't verify these — confirm by hand):
  □ Uses the official DGA component library / tokens (not just look-alikes)
  □ DGA colour palette + spacing tokens (not arbitrary values)
  □ WCAG 2.1 AA colour contrast on text & controls
  □ Full keyboard navigation + visible focus states
  □ IBM Plex Sans Arabic actually loaded (not just named)
  □ Full Arabic ⇄ English parity (every screen works in both)`;

const HELP = `dls-check v${VERSION} — Saudi DGA design-system readiness scanner.
Part of Otto · dev.ottospace.co

Usage:
  npx dls-check [path]           scan for DGA readiness (default: .)
  npx dls-check [path] --json    machine-readable (CI)
  npx dls-check --help | --version

DGA compliance (RTL-first · IBM Plex Sans Arabic · WCAG 2.1 AA) is a legal requirement for
Saudi government digital services. This flags the auto-checkable gaps + prints the manual list.`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { console.log(VERSION); return; }
  const asJson = args.includes('--json');
  const target = args.find(a => !a.startsWith('-')) || '.';

  let files;
  try { files = fs.statSync(target).isDirectory() ? walk(target) : [target]; }
  catch { console.error(`dls-check: cannot read ${target}`); process.exit(2); }

  const byFile = {}; let total = 0; const cats = {};
  for (const file of files) {
    let src; try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const f = scanFile(file, src);
    if (f.length) { byFile[file] = f; total += f.length; for (const x of f) cats[x.cat] = (cats[x.cat] || 0) + 1; }
  }
  const rel = f => path.relative(process.cwd(), f) || f;

  if (asJson) {
    console.log(JSON.stringify({ version: VERSION, files: files.length, findings: total, byCategory: cats,
      results: Object.entries(byFile).flatMap(([f, arr]) => arr.map(x => ({ ...x, file: rel(f) }))) }, null, 2));
    process.exit(total ? 1 : 0);
  }
  for (const file of Object.keys(byFile)) {
    console.log(`\n\x1b[1m${rel(file)}\x1b[0m`);
    for (const f of byFile[file]) console.log(`  \x1b[36m${f.cat.padEnd(4)}\x1b[0m :${f.line}  ${f.from}  \x1b[2m${f.msg}\x1b[0m`);
  }
  const bits = Object.entries(cats).map(([k, v]) => `${v} ${k}`).join(' · ');
  console.log(`\n\x1b[1mdls-check v${VERSION}\x1b[0m  ${files.length} files  ·  \x1b[36m${total} DGA gaps\x1b[0m${bits ? '  (' + bits + ')' : ''}`);
  console.log('\n' + MANUAL);
  if (!total) console.log('\n✓ auto-checks clean — still confirm the manual list above.');
  process.exit(total ? 1 : 0);
}

main();
