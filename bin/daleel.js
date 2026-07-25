#!/usr/bin/env node
'use strict';
/*
 * Daleel (دليل) — scan a codebase for Saudi DGA (Digital Government Authority)
 * design-system readiness: RTL-first · IBM Plex Sans Arabic · WCAG 2.1 AA.
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
  const cfg = { fonts: [], ignore: [], disable: [] };
  if (file) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw.fonts) cfg.fonts = [].concat(raw.fonts);
      if (raw.ignore) cfg.ignore = [].concat(raw.ignore);
      if (raw.disable) cfg.disable = [].concat(raw.disable);
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
  □ WCAG 2.1 AA colour contrast on text & controls
  □ Full keyboard navigation + visible focus states
  □ IBM Plex Sans Arabic actually loaded (not just named)
  □ Full Arabic ⇄ English parity (every screen works in both)`;

const HELP = `Daleel v${VERSION} — Saudi DGA design-system readiness scanner (دليل).
Part of Otto · dev.ottospace.co

Usage:
  npx daleel [path]             scan for DGA readiness (default: .)
  npx daleel [path] --json      machine-readable (CI)
  npx daleel [path] --config f  use config file f (else .daleelrc.json)
  npx daleel --help | --version

DGA compliance (RTL-first · IBM Plex Sans Arabic · WCAG 2.1 AA) is a legal
requirement for Saudi government digital services. Daleel flags the auto-checkable
gaps (report-only, never edits) + prints the manual list.

Suppress a line inline with  // daleel-ignore  (or  daleel-ignore-next-line),
optionally narrowed:  // daleel-ignore FONT  ·  // daleel-ignore rtl-physical-utility
Config (.daleelrc.json): { "fonts": [...extra approved families],
  "ignore": ["glob/**"], "disable": ["A11Y", "font-not-dga"] }`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { console.log(VERSION); return; }
  const asJson = args.includes('--json');
  const cfgIdx = args.indexOf('--config');
  const cfgPath = cfgIdx !== -1 ? args[cfgIdx + 1] : null;
  const target = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--config') || '.';

  let isDir;
  try { isDir = fs.statSync(target).isDirectory(); }
  catch { console.error(`daleel: cannot read ${target}`); process.exit(2); }

  const cfg = loadConfig(isDir ? target : path.dirname(target), cfgPath);
  const ignore = makeIgnorer(cfg.ignore);
  const opts = { fonts: cfg.fonts, disable: cfg.disable };
  const files = isDir ? walk(target, ignore) : (ignore(target) ? [] : [target]);

  const byFile = {}; let total = 0; const cats = {};
  for (const file of files) {
    let src; try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const { findings } = scanSource(file, src, opts);
    if (findings.length) { byFile[file] = findings; total += findings.length; for (const x of findings) cats[x.cat] = (cats[x.cat] || 0) + 1; }
  }
  const rel = f => path.relative(process.cwd(), f) || f;

  if (asJson) {
    console.log(JSON.stringify({
      version: VERSION, files: files.length, findings: total, byCategory: cats,
      config: cfg._file ? rel(cfg._file) : null,
      results: Object.entries(byFile).flatMap(([f, arr]) => arr.map(x => ({ file: rel(f), ...x }))),
    }, null, 2));
    process.exit(total ? 1 : 0);
  }

  for (const file of Object.keys(byFile)) {
    console.log(`\n\x1b[1m${rel(file)}\x1b[0m`);
    for (const f of byFile[file]) console.log(`  \x1b[36m${f.cat.padEnd(4)}\x1b[0m :${f.line}  ${f.from}  \x1b[2m${f.msg}\x1b[0m`);
  }
  const bits = Object.entries(cats).map(([k, v]) => `${v} ${k}`).join(' · ');
  console.log(`\n\x1b[1mDaleel v${VERSION}\x1b[0m  ${files.length} files  ·  \x1b[36m${total} DGA gaps\x1b[0m${bits ? '  (' + bits + ')' : ''}`);
  console.log('\n' + MANUAL);
  if (!total) console.log('\n✓ auto-checks clean — still confirm the manual list above.');
  process.exit(total ? 1 : 0);
}

main();
