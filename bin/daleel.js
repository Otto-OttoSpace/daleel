#!/usr/bin/env node
'use strict';
/*
 * Daleel (دليل) — scan a codebase for Saudi DGA (Digital Government Authority)
 * design-system readiness: RTL-first · IBM Plex Sans Arabic · WCAG 2.2 AA.
 * Part of Otto · dev.ottospace.co
 *
 * Detection is AST-verified (Babel for JS/TS/JSX, PostCSS for CSS) so comments,
 * strings and identifiers never produce false findings. Daleel is a readiness
 * GATE — report-only, it never edits your source. It flags the auto-checkable
 * gaps and prints the manual checklist for the rest.
 */
const fs = require('fs');
const path = require('path');
const { scanSource } = require('../lib/daleel-core');

const VERSION = require('../package.json').version;

function lineAt(src, index) { let line = 1; for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++; return line; }

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.vue', '.svelte', '.astro']);
const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const IGNORE_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', 'vendor', '.svelte-kit']);
const CONFIG_NAMES = ['.daleelrc.json', '.daleelrc', 'daleel.config.json'];

// ---------------------------------------------------------------------------
// Config: { fonts?: string[], ignore?: string[] (globs), disable?: string[] }
// ---------------------------------------------------------------------------
function loadConfig(startDir, explicit) {
  let file = explicit || null;
  if (!file) {
    for (const dir of [startDir, process.cwd()]) {
      for (const n of CONFIG_NAMES) {
        const p = path.join(dir, n);
        try { if (fs.statSync(p).isFile()) { file = p; break; } } catch {}
      }
      if (file) break;
    }
  }
  const cfg = { fonts: [], ignore: [], disable: [], fontFile: null };
  if (file) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw.fonts) cfg.fonts = [].concat(raw.fonts);
      if (raw.ignore) cfg.ignore = [].concat(raw.ignore);
      if (raw.disable) cfg.disable = [].concat(raw.disable);
      if (raw.fontFile) cfg.fontFile = String(raw.fontFile); // path to the actual DGA font, for --render
      cfg._file = file;
    } catch (e) { console.error(`daleel: could not read config ${file}: ${e.message}`); }
  }
  return cfg;
}

// Minimal glob → RegExp (supports **, *, ?). Matched against the path relative
// to cwd (posix separators) and the basename.
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('/.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^(?:' + re + ')$');
}
function makeIgnorer(patterns) {
  const res = (patterns || []).map(globToRe);
  return (file) => {
    if (!res.length) return false;
    const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
    const base = path.basename(file);
    return res.some(r => r.test(rel) || r.test(base));
  };
}

function walk(dir, ignore, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (IGNORE_DIR.has(name) || (name.startsWith('.') && name !== '.')) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, ignore, out);
    else {
      const ext = path.extname(full);
      if ((CODE_EXT.has(ext) || CSS_EXT.has(ext)) && !ignore(full)) out.push(full);
    }
  }
  return out;
}

const MANUAL = `Manual DGA checks (Daleel can't verify these — confirm by hand):
  □ Uses the official DGA component library / tokens (not just look-alikes)
  □ DGA colour palette + spacing tokens (not arbitrary values)
  □ WCAG 2.2 AA colour contrast on text & controls
  □ Full keyboard navigation + visible focus states
  □ IBM Plex Sans Arabic actually loaded (not just named)
  □ Full Arabic ⇄ English parity (every screen works in both)`;

const HELP = `Daleel v${VERSION} — Saudi DGA design-system readiness scanner (دليل).
Part of Otto · dev.ottospace.co

Usage:
  npx daleel [path]             scan for DGA readiness (default: .)
  npx daleel [path] --json      machine-readable (CI)
  npx daleel [path] --render    + HarfBuzz font-proof: shape the Arabic in your
                                source and PROVE the DGA font actually covers +
                                joins it (no tofu / real contextual joining) —
                                not just that it is NAMED in the stack
  npx daleel [path] --render --font <path>   prove YOUR font file (e.g. the
                                IBM Plex Sans Arabic webfont you ship)
  npx daleel [path] --config f  use config file f (else .daleelrc.json)
  npx daleel --help | --version

DGA design-system alignment (RTL-first · IBM Plex Sans Arabic · WCAG 2.2 AA) is
the standard for Saudi government digital services. Daleel is an advisory readiness
gate — it flags the auto-checkable gaps (report-only, never edits) + prints the
manual list. It maps to the DGA design system as published; confirm against the
current DGA spec for your project. The static tier is
dependency-light; --render adds an OPTIONAL HarfBuzz tier (harfbuzzjs + fontkit)
and ships a reference Arabic face so it works out-of-the-box.

Suppress a line inline with  // daleel-ignore  (or  daleel-ignore-next-line),
optionally narrowed:  // daleel-ignore FONT  ·  // daleel-ignore rtl-physical-utility
Config (.daleelrc.json): { "fonts": [...extra approved families],
  "ignore": ["glob/**"], "disable": ["A11Y", "font-not-dga"],
  "fontFile": "public/fonts/IBMPlexSansArabic-Regular.ttf" }`;

// ---------------------------------------------------------------------------
// --render font-proof tier (OPTIONAL). Lazy-loads lib/shape-core (harfbuzzjs +
// fontkit); degrades to a no-op with a stderr note if the deps are absent, so
// the default static tier stays dependency-light and unchanged.
// ---------------------------------------------------------------------------
async function setupRender(cfg, fontArg) {
  let shapeCore = null;
  try { shapeCore = require('../lib/shape-core'); } catch { shapeCore = null; }
  if (shapeCore && !(await shapeCore.isAvailable())) shapeCore = null;
  if (!shapeCore) {
    console.error('daleel: --render needs harfbuzzjs + fontkit (optionalDependencies). Skipping the font-proof tier.');
    return { shapeCore: null, fontBytes: null, fontLabel: null };
  }
  let fontBytes = null, fontLabel = null, usingReference = false;
  const wantFont = fontArg || cfg.fontFile || null;
  if (wantFont) {
    try { fontBytes = fs.readFileSync(wantFont); fontLabel = path.basename(wantFont); }
    catch { console.error(`daleel: cannot read font ${wantFont} — falling back to the reference Arabic face`); }
  }
  if (!fontBytes) {
    fontBytes = shapeCore.referenceFontBytes(); fontLabel = 'Amiri (reference Arabic face)'; usingReference = true;
    console.error('daleel: --render is proving against the bundled reference face (Amiri), NOT your shipped font — pass --font <path> to prove your production font. These results are indicative only.');
  }
  if (!fontBytes) { console.error('daleel: reference font missing — skipping the font-proof tier.'); return { shapeCore: null, fontBytes: null, fontLabel: null, usingReference: false }; }
  return { shapeCore, fontBytes, fontLabel, usingReference };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { console.log(VERSION); return; }
  const asJson = args.includes('--json');
  const render = args.includes('--render');
  const cfgIdx = args.indexOf('--config');
  const cfgPath = cfgIdx !== -1 ? args[cfgIdx + 1] : null;
  const fontIdx = args.indexOf('--font');
  let fontArg = fontIdx !== -1 ? args[fontIdx + 1] : null;
  for (const a of args) if (a.startsWith('--font=')) fontArg = a.slice(7);
  // the positional target skips the value consumed by --config / --font
  const target = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--config' && args[i - 1] !== '--font') || '.';

  let isDir;
  try { isDir = fs.statSync(target).isDirectory(); }
  catch { console.error(`daleel: cannot read ${target}`); process.exit(2); }

  const cfg = loadConfig(isDir ? target : path.dirname(target), cfgPath);
  const ignore = makeIgnorer(cfg.ignore);
  const opts = { fonts: cfg.fonts, disable: cfg.disable };
  const files = isDir ? walk(target, ignore) : (ignore(target) ? [] : [target]);

  const { shapeCore, fontBytes, fontLabel, usingReference } = render ? await setupRender(cfg, fontArg) : {};
  const renderRan = !!(shapeCore && fontBytes);

  const byFile = {}; let total = 0; let renderTotal = 0; const cats = {};
  for (const file of files) {
    let src; try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const { findings } = scanSource(file, src, opts);
    let all = findings.slice();
    if (shapeCore && fontBytes && shapeCore.hasArabic(src)) {
      for (const r of shapeCore.extractArabicRuns(src)) {
        try {
          const rf = await shapeCore.proveArabicCoverage(fontBytes, r.text, { fontName: fontLabel, label: r.text.slice(0, 24) });
          for (const f of rf) { all.push({ cat: f.cat, rule: f.rule, sev: 'render', line: lineAt(src, r.index), from: f.from, msg: f.msg }); renderTotal++; }
        } catch {}
      }
    }
    if (all.length) {
      all.sort((a, b) => a.line - b.line);
      byFile[file] = all;
      total += findings.length;
      for (const x of findings) cats[x.cat] = (cats[x.cat] || 0) + 1;
    }
  }
  const rel = f => path.relative(process.cwd(), f) || f;

  if (asJson) {
    console.log(JSON.stringify({
      version: VERSION, tier: render ? 'static+render' : 'static', files: files.length,
      findings: total, renderFindings: renderTotal, byCategory: cats,
      config: cfg._file ? rel(cfg._file) : null,
      results: Object.entries(byFile).flatMap(([f, arr]) => arr.map(x => ({ file: rel(f), ...x }))),
    }, null, 2));
    process.exit(total + renderTotal ? 1 : 0);
  }

  for (const file of Object.keys(byFile)) {
    console.log(`\n\x1b[1m${rel(file)}\x1b[0m`);
    for (const f of byFile[file]) {
      const tag = f.sev === 'render' ? '\x1b[33mrender\x1b[0m' : `\x1b[36m${f.cat.padEnd(4)}\x1b[0m`;
      console.log(`  ${tag} :${f.line}  ${f.from}  \x1b[2m${f.msg}\x1b[0m`);
    }
  }
  const bits = Object.entries(cats).map(([k, v]) => `${v} ${k}`).join(' · ');
  console.log(`\n\x1b[1mDaleel v${VERSION}\x1b[0m  ${files.length} files  ·  \x1b[36m${total} DGA gaps\x1b[0m${bits ? '  (' + bits + ')' : ''}${render ? `  ·  \x1b[33m${renderTotal} render\x1b[0m` : ''}`);
  console.log('\n' + MANUAL);
  if (!(total + renderTotal)) {
    const proof = (render && renderRan && !usingReference) ? ' (incl. font-proof vs your font)'
      : (render && renderRan && usingReference) ? ' — font-proof used the bundled reference face; pass --font <your font> to prove your shipped font'
      : '';
    console.log(`\n✓ auto-checks clean${proof} — still confirm the manual list above.`);
  }
  process.exit(total + renderTotal ? 1 : 0);
}

main().catch(e => { console.error('daleel: ' + (e && e.stack || e)); process.exit(2); });
