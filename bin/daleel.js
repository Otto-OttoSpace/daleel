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
const crypto = require('crypto');
const { scanSource } = require('../lib/daleel-core');
const lic = require('../lib/license');

const VERSION = require('../package.json').version;
// "structural" is deliberate: Daleel automates the structural AA criteria
// (alt/label/aria/heading/id/tabindex/lang) + same-element colour contrast.
// Full-cascade contrast, images, and judgement criteria stay on the manual
// checklist — so a PASS never reads as a complete WCAG 2.2 AA audit.
const RULESET = 'DGA-DLS + WCAG 2.2 AA (structural)';

function lineAt(src, index) { let line = 1; for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++; return line; }

// Guarded clock (some sandboxes stub Date) — returns an ISO string or null.
function safeNowIso() { try { const n = Date.now(); if (typeof n === 'number' && isFinite(n) && n > 0) return new Date(n).toISOString(); } catch {} return null; }

// ---------------------------------------------------------------------------
// Daleel Pro — category / rule → DGA-DLS + WCAG references (for --report).
// ---------------------------------------------------------------------------
const CAT_REF = {
  RTL:  { title: 'RTL / bidirectional layout', ref: 'DGA-DLS §Layout (RTL-first) · WCAG 2.2 AA 1.3.2' },
  FONT: { title: 'Typography (Arabic web font)', ref: 'DGA-DLS §Typography (IBM Plex Sans Arabic)' },
  A11Y: { title: 'Accessibility', ref: 'WCAG 2.2 AA (1.1.1 · 1.3.1 · 2.4.4 · 3.3.2 · 4.1.1 · 4.1.2)' },
};
const CAT_ORDER = ['RTL', 'FONT', 'A11Y'];
const RULE_REF = {
  'rtl-physical-utility': 'DGA-DLS RTL · WCAG 1.3.2',
  'rtl-css-physical': 'DGA-DLS RTL · WCAG 1.3.2',
  'rtl-physical-corner': 'DGA-DLS RTL · WCAG 1.3.2',
  'rtl-hardcoded-dir': 'DGA-DLS RTL · WCAG 1.3.2',
  'font-not-dga': 'DGA-DLS Typography',
  'font-no-arabic-coverage': 'DGA-DLS Typography (render-proof)',
  'a11y-img-alt': 'WCAG 1.1.1',
  'a11y-html-lang': 'WCAG 3.1.1',
  'a11y-heading-skip': 'WCAG 1.3.1 / 2.4.6',
  'a11y-empty-link': 'WCAG 2.4.4 / 4.1.2',
  'a11y-duplicate-id': 'WCAG 4.1.1',
  'a11y-positive-tabindex': 'WCAG 2.4.3',
  'a11y-input-no-label': 'WCAG 1.3.1 / 3.3.2 / 4.1.2',
  'a11y-invalid-aria': 'WCAG 4.1.2',
};

// Stable content hash over the normalized findings (order-independent).
function contentDigest(target, flat) {
  const canon = flat.map(f => [f.file, f.line, f.cat, f.rule, f.from].join('|')).sort().join('\n');
  return crypto.createHash('sha256').update('daleel/' + VERSION + '\n' + RULESET + '\n' + (target || '') + '\n' + canon).digest('hex');
}

function upsellLine(feature) {
  return `\x1b[35m✦ ${feature} is a Daleel Pro feature.\x1b[0m  Upgrade → ${lic.UPGRADE_URL}\n  Already bought a key?  \x1b[1mdaleel activate <license-key>\x1b[0m   ·   check with  daleel status`;
}

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
  // A repo-supplied ignore glob is untrusted; cap its length so it can't be a
  // pathological pattern.
  glob = String(glob).slice(0, 200);
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
  // Collapse adjacent equal quantifiers so `**` runs can't cause catastrophic
  // backtracking (e.g. eight `**` → eight chained `.*` is exponential).
  re = re.replace(/(?:\.\*)+/g, '.*').replace(/(?:\[\^\/\]\*)+/g, '[^/]*');
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
  □ WCAG 2.2 AA colour contrast beyond same-element literal colours
    (cascaded/inherited colours, text over images, icon/UI states)
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

Daleel Pro (open-core — license via Lemon Squeezy):
  daleel activate <key>        activate Daleel Pro on this machine
  daleel status                show Free / Pro
  daleel deactivate            release this machine's activation
  npx daleel [path] --report   Pro: FULL compliance report — every finding
                                grouped by category with its WCAG/DGA § refs,
                                a per-category pass/fail summary + content hash
  npx daleel [path] --cert     Pro: emit a signed-ish compliance certificate
                                (JSON + a human line: tool/version/target/ruleset,
                                findings summary, sha256 content hash)
     add  --timestamp <iso>    stamp --cert with a fixed time (else now / omit)

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

  // ---- Daleel Pro license subcommands -------------------------------------
  const sub = args[0];
  if (sub === 'activate') { await lic.activate(args[1]); return; }
  if (sub === 'deactivate') { await lic.deactivate(); return; }
  if (sub === 'status') {
    const s = await lic.status();
    if (s.pro) console.log('Daleel Pro \x1b[32m(licensed)\x1b[0m' + (s.offline ? ' — offline, using last known-good' : ''));
    else console.log('Daleel Free' + (s.status && s.status !== 'none' ? ` (license ${s.status})` : '') + `  ·  upgrade → ${lic.UPGRADE_URL}`);
    return;
  }

  const asJson = args.includes('--json');
  const render = args.includes('--render');
  const wantReport = args.includes('--report');
  const wantCert = args.includes('--cert');
  const cfgIdx = args.indexOf('--config');
  const cfgPath = cfgIdx !== -1 ? args[cfgIdx + 1] : null;
  const fontIdx = args.indexOf('--font');
  let fontArg = fontIdx !== -1 ? args[fontIdx + 1] : null;
  for (const a of args) if (a.startsWith('--font=')) fontArg = a.slice(7);
  const tsIdx = args.indexOf('--timestamp');
  let tsArg = tsIdx !== -1 ? args[tsIdx + 1] : null;
  for (const a of args) if (a.startsWith('--timestamp=')) tsArg = a.slice(12);
  // the positional target skips the value consumed by --config / --font / --timestamp
  const target = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--config' && args[i - 1] !== '--font' && args[i - 1] !== '--timestamp') || '.';

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
    // Canonical envelope: `findings` is ALWAYS an array (matches miraat/kashida), the
    // count lives in `total`. `results` kept one release as a deprecated alias.
    const findingsArr = Object.entries(byFile).flatMap(([f, arr]) => arr.map(x => ({ file: rel(f), ...x })));
    console.log(JSON.stringify({
      version: VERSION, tier: render ? 'static+render' : 'static', files: files.length,
      total, renderFindings: renderTotal, byCategory: cats,
      config: cfg._file ? rel(cfg._file) : null,
      findings: findingsArr,
      results: findingsArr,
    }, null, 2));
    process.exit(total + renderTotal ? 1 : 0);
  }

  // ---- Daleel Pro output modes (--report / --cert) ------------------------
  if (wantReport || wantCert) {
    if (!(await lic.isPro())) {
      console.log(upsellLine(wantReport ? '--report' : '--cert'));
      console.log('\x1b[2mThe free scan is unchanged: run  daleel ' + (rel(target) || '.') + '  for the concise report.\x1b[0m');
      process.exit(0);
    }
    const flat = Object.entries(byFile).flatMap(([f, arr]) => arr.map(x => ({ file: rel(f), cat: x.cat, rule: x.rule, line: x.line, from: x.from, msg: x.msg })));
    const totalAll = total + renderTotal;
    const hash = contentDigest(rel(target) || target, flat);

    if (wantReport) {
      const groups = {};
      for (const f of flat) (groups[f.cat] = groups[f.cat] || []).push(f);
      console.log(`\x1b[1mDaleel Pro — ${RULESET} compliance report\x1b[0m`);
      console.log(`Target: ${rel(target) || target}   ·   Files scanned: ${files.length}`);
      const ts = safeNowIso(); if (ts) console.log(`Generated: ${ts}`);
      for (const cat of CAT_ORDER) {
        const arr = (groups[cat] || []).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line);
        const meta = CAT_REF[cat] || { title: cat, ref: '' };
        console.log(`\n\x1b[36m${cat}\x1b[0m — ${meta.title}   \x1b[2m${meta.ref}\x1b[0m`);
        if (!arr.length) { console.log('  \x1b[32m✓ pass\x1b[0m — no findings'); continue; }
        for (const f of arr) {
          const rref = RULE_REF[f.rule] ? `  \x1b[2m[${RULE_REF[f.rule]}]\x1b[0m` : '';
          console.log(`  \x1b[31m✗\x1b[0m ${f.file}:${f.line}  ${f.from}  \x1b[2m(${f.rule})\x1b[0m${rref}`);
        }
      }
      console.log('\n\x1b[1mSummary\x1b[0m');
      for (const cat of CAT_ORDER) {
        const n = (groups[cat] || []).length;
        console.log(`  ${cat.padEnd(5)} ${n === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m (' + n + ')'}`);
      }
      console.log(`  \x1b[1mOverall: ${totalAll === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m  (${totalAll} findings across ${files.length} files)`);
      console.log(`  Content hash (sha256): ${hash}`);
      console.log('\n' + MANUAL);
      process.exit(totalAll ? 1 : 0);
    }

    // --cert
    const cats2 = {};
    for (const f of flat) cats2[f.cat] = (cats2[f.cat] || 0) + 1;
    const ts = tsArg || safeNowIso();
    const cert = {
      tool: 'daleel',
      version: VERSION,
      target: rel(target) || target,
      ruleset: RULESET,
      ...(ts ? { timestamp: ts } : {}),
      findings: { total: totalAll, static: total, render: renderTotal, byCategory: cats2 },
      result: totalAll === 0 ? 'PASS' : 'FAIL',
      sha256: hash,
    };
    console.log(`daleel/${VERSION} · ${cert.result} · ${RULESET} · ${totalAll} findings · sha256:${hash.slice(0, 16)}…${ts ? ' · ' + ts : ''}`);
    console.log(JSON.stringify(cert, null, 2));
    process.exit(0);
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
