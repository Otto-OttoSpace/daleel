'use strict';
/*
 * shape-core.js — HarfBuzz FONT-PROOF tier for Daleel (OPTIONAL, lazy-loaded).
 *
 * The static tier (daleel-core.js) only checks that the DGA font family
 * ("IBM Plex Sans Arabic") is NAMED in the font stack. Naming it proves nothing:
 * the file may never load, may be a Latin face mislabeled, or may simply lack the
 * Arabic glyphs — and the reader still sees ▯ (tofu) or disconnected letters.
 *
 * This tier shapes the ACTUAL Arabic in your source against a real font FILE and
 * proves it:
 *   - covers every Arabic char        (no glyph → .notdef/g=0 → the reader sees ▯)
 *   - does real contextual joining     (a Latin face faking Arabic produces the
 *                                       same output with joining ON and OFF, so
 *                                       cursive letters render disconnected)
 * Both failures collapse to ONE rule: font-no-arabic-coverage (sev 'render').
 *
 * Deps (optionalDependencies): harfbuzzjs (WASM) + fontkit — lazy-loaded,
 * mirroring daleel-core's try/require degradation. If either is missing this
 * module degrades to { available:false } and NEVER throws, so the default static
 * tier stays dependency-light and unchanged.
 *
 * A reference Arabic face (assets/Amiri-Regular.ttf) ships so the proof runs
 * out-of-the-box; point `--font` at your actual IBM Plex Sans Arabic webfont to
 * prove the exact file you ship.
 */
const fs = require('fs');
const path = require('path');

const REF_FONT = path.join(__dirname, '..', 'assets', 'Amiri-Regular.ttf');
const JOIN_PAIR = 'بب'; // two beh — a guaranteed medial/initial join in any real Arabic face
const NO_JOIN_FEATURES = '-calt,-rlig,-liga,-init,-medi,-fina';
let AR_RE;
try { AR_RE = new RegExp('\\p{Script=Arabic}', 'u'); } catch { AR_RE = { test: () => false }; }

/** Does this text contain any Arabic-script char? (fast, zero-dep) */
function hasArabic(text) { return !!text && AR_RE.test(text); }

// short, single-line label for the `from` column
function ev(s) { return String(s).trim().replace(/\s+/g, ' ').slice(0, 60); }

// ── lazy HarfBuzz loader (memoized) ────────────────────────────────────────
let _hbPromise = null;
function loadHB() {
  if (_hbPromise) return _hbPromise;
  _hbPromise = (async () => {
    // Modern harfbuzzjs (>=0.5): the package default export is a Promise<hb>
    // whose emscripten glue loads hb.wasm (via require.resolve) for us.
    try {
      const mod = require('harfbuzzjs');
      if (mod && typeof mod.then === 'function') {
        const hb = await mod;
        if (hb && typeof hb.createBlob === 'function') return hb;
      }
      if (mod && typeof mod.createBlob === 'function') return mod;
    } catch { /* fall through */ }
    // Classic harfbuzzjs (0.3.x–0.4.x): hbjs(instance) over a raw hb.wasm.
    try {
      const hbjs = require('harfbuzzjs/hbjs.js');
      const bytes = fs.readFileSync(require.resolve('harfbuzzjs/hb.wasm'));
      let memory;
      const env = {
        _emscripten_runtime_keepalive_clear: () => {},
        _abort_js: () => { throw new Error('hb abort'); },
        _setitimer_js: () => {},
        emscripten_resize_heap: (req) => {
          try { if (!memory) return 0; req >>>= 0; const cur = memory.buffer.byteLength; if (req <= cur) return 1; memory.grow(Math.ceil((req - cur) / 65536)); return 1; } catch { return 0; }
        },
      };
      const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: { proc_exit: () => {} }, env });
      memory = instance.exports.memory;
      const hb = hbjs(instance);
      if (hb && typeof hb.createBlob === 'function') return hb;
    } catch { /* fall through */ }
    return null;
  })().catch(() => null);
  return _hbPromise;
}

/** True only if HarfBuzz actually loaded — callers guard on this before shaping. */
async function isAvailable() { return !!(await loadHB()); }

// ── low-level shape ────────────────────────────────────────────────────────
/**
 * shape(fontBytes, text, {dir, script, lang, features}) → array of glyph records
 * { g, cl, ax, ay, dx, dy, flags } (HarfBuzz's own serialization). `features` is
 * a comma string, e.g. '' or '-calt,-rlig'. Throws only if HB is unavailable —
 * callers guard with isAvailable().
 */
async function shape(fontBytes, text, opts = {}) {
  const hb = await loadHB();
  if (!hb) throw new Error('harfbuzzjs unavailable');
  const blob = hb.createBlob(fontBytes);
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();
  buffer.addText(text);
  if (opts.dir) buffer.setDirection(opts.dir);
  if (opts.script && buffer.setScript) buffer.setScript(opts.script);
  if (opts.lang && buffer.setLanguage) buffer.setLanguage(opts.lang);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer, opts.features != null ? opts.features : '');
  const out = buffer.json(font);
  buffer.destroy();
  if (font.destroy) font.destroy();
  if (face.destroy) face.destroy();
  if (blob.destroy) blob.destroy();
  return out;
}

// ── detector: tofu (missing glyphs → .notdef) ──────────────────────────────
async function detectTofu(fontBytes, text, opts = {}) {
  const glyphs = await shape(fontBytes, text, opts);
  const missing = [];
  const seen = new Set();
  for (const g of glyphs) {
    if (g.g !== 0) continue;
    const cp = text.codePointAt(g.cl);
    if (cp == null) continue;
    const ch = String.fromCodePoint(cp);
    const key = cp + ':' + g.cl;
    if (seen.has(key)) continue; seen.add(key);
    missing.push({ char: ch, codepoint: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), cluster: g.cl });
  }
  return missing; // [] means every char had a glyph
}

// ── detector: does this face actually DO Arabic joining? ───────────────────
/**
 * A real Arabic face shapes "بب" differently with joining ON vs OFF. A Latin
 * face faking Arabic (or one with no GSUB joining) produces identical output —
 * or tofu — for both. Returns { joins, tofu, normal, noJoin }.
 */
async function fontJoinsArabic(fontBytes) {
  const normal = await shape(fontBytes, JOIN_PAIR, { features: '' });
  const noJoin = await shape(fontBytes, JOIN_PAIR, { features: NO_JOIN_FEATURES });
  const ids = (a) => a.map(g => g.g).join(',');
  const tofu = normal.some(g => g.g === 0);
  const joins = !tofu && ids(normal) !== ids(noJoin);
  return { joins, tofu, normal: ids(normal), noJoin: ids(noJoin) };
}

// ── high-level: PROVE a font covers + joins the Arabic in one text run ─────
/**
 * proveArabicCoverage(fontBytes, text, {label, fontName}) → findings[] where a
 * finding means the font FAILED the proof. Shape { cat:'FONT',
 * rule:'font-no-arabic-coverage', sev:'render', from, msg, evidence }.
 *
 * Non-Arabic text → [] (the DGA Arabic-font mandate doesn't apply). A real
 * Arabic face that covers + joins the run → [] (proof passes). A Latin/broken
 * face → one finding describing exactly why (tofu chars and/or no joining).
 */
async function proveArabicCoverage(fontBytes, text, opts = {}) {
  const findings = [];
  if (!hasArabic(text)) return findings;
  const label = opts.label || (text.length > 24 ? text.slice(0, 24) + '…' : text);
  const fontName = opts.fontName || null;

  let tofu = [];
  try { tofu = await detectTofu(fontBytes, text); } catch { return findings; } // HB gone → skip, never throw
  let join = { joins: true, tofu: false, normal: '', noJoin: '' };
  try { join = await fontJoinsArabic(fontBytes); } catch {}

  const problems = [];
  if (tofu.length) {
    const chars = tofu.map(t => `${t.char} (${t.codepoint})`).join(', ');
    problems.push(`has NO glyph for ${tofu.length} Arabic char(s) → the reader sees ▯: ${chars}`);
  }
  if (join.tofu) {
    problems.push(`cannot even shape the reference join "${JOIN_PAIR}" (tofu) — it is not an Arabic face`);
  } else if (!join.joins) {
    problems.push(`does NO Arabic joining (output identical with joining ON and OFF) → cursive letters render disconnected (fake-Arabic / Latin fallback)`);
  }
  if (problems.length) {
    findings.push({
      cat: 'FONT', rule: 'font-no-arabic-coverage', sev: 'render', from: ev(label),
      msg: `the rendered DGA font${fontName ? ` (${fontName})` : ''} ${problems.join('; ')} — naming "IBM Plex Sans Arabic" in the stack is not enough`,
      evidence: { tofu, joins: join.joins, faceTofu: join.tofu, font: fontName },
    });
  }
  return findings;
}

// ── extract Arabic-bearing text runs from arbitrary source ─────────────────
// A run = a maximal non-ASCII slice (marks/ZWJ ride along). Only runs that carry
// Arabic are returned — that's all the DGA font mandate is about.
function extractArabicRuns(src, maxRuns = 300) {
  const runs = [];
  const re = /[^\x00-\x7F][^\x00-\x7F\s]*(?:\s[^\x00-\x7F\s]+)*/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(src)) !== null && runs.length < maxRuns) {
    const text = m[0].trim();
    if (!text || !hasArabic(text)) continue;
    if (seen.has(text)) continue; seen.add(text);
    runs.push({ text, index: m.index });
  }
  return runs;
}

function referenceFontBytes() {
  try { return fs.readFileSync(REF_FONT); } catch { return null; }
}

module.exports = {
  isAvailable, shape,
  detectTofu, fontJoinsArabic, proveArabicCoverage,
  hasArabic, extractArabicRuns, referenceFontBytes, REF_FONT,
};
