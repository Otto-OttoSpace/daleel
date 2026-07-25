'use strict';
/*
 * Daleel regression suite (node --test).
 *
 * Daleel is a REPORT-ONLY readiness gate, so the corpus asserts detection, not
 * edits. For every case under test/corpus/<case>/ it runs the real CLI binary
 * with --json and asserts the normalized findings deep-equal expected.findings.json.
 *
 * Permanent guards baked in (the bugs this harden pass fixed):
 *   - inverted-font-css / compliant-font-styleobj  → a compliant IBM Plex Sans
 *     Arabic stack produces ZERO findings (the old regex inverted this).
 *   - noncompliant-font-css                         → a non-DGA font IS flagged.
 *   - variant-utilities                             → md:/hover:/rtl: physical
 *     utilities ARE flagged.
 *   - comment-string-safe                           → a utility in a comment or a
 *     non-class string is NOT flagged.
 * Plus explicit acceptance asserts and a config (fonts/ignore/disable) test.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scanSource } = require('../lib/daleel-core');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'daleel.js');
const CORPUS = path.join(__dirname, 'corpus');

function runCli(args) {
  try { return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + ''; } // CLI exits 1 when gaps remain
}
function scanJson(file, extraArgs = []) {
  return JSON.parse(runCli([file, '--json', ...extraArgs]) || '{}');
}
function normalize(results) {
  return (results || [])
    .map(f => ({ cat: f.cat, rule: f.rule, line: f.line, from: f.from }))
    .sort((a, b) => a.line - b.line || a.cat.localeCompare(b.cat) || a.rule.localeCompare(b.rule) || a.from.localeCompare(b.from));
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------
const cases = fs.readdirSync(CORPUS)
  .filter(c => fs.statSync(path.join(CORPUS, c)).isDirectory())
  .sort();

assert.ok(cases.length >= 12, `expected the seeded corpus, found ${cases.length} cases`);

for (const name of cases) {
  const dir = path.join(CORPUS, name);
  const input = fs.readdirSync(dir).find(f => f.startsWith('input.'));
  const inputPath = path.join(dir, input);

  test(`corpus/${name}: findings match expected`, () => {
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.findings.json'), 'utf8'));
    assert.deepStrictEqual(normalize(scanJson(inputPath).results), expected);
  });
}

// ---------------------------------------------------------------------------
// Acceptance guards (unit level, via scanSource directly)
// ---------------------------------------------------------------------------
test('acceptance: compliant IBM Plex Sans Arabic stack has NO font finding', () => {
  for (const [file, src] of [
    ['a.css', '.x { font-family: "IBM Plex Sans Arabic", sans-serif; }'],
    ['b.tsx', 'const s = { fontFamily: "IBM Plex Sans Arabic, sans-serif" };'],
  ]) {
    const fonts = scanSource(file, src).findings.filter(f => f.cat === 'FONT');
    assert.strictEqual(fonts.length, 0, `${file} wrongly flagged a compliant DGA font`);
  }
});

test('acceptance: a non-DGA font IS flagged', () => {
  const fonts = scanSource('c.css', '.x { font-family: "Inter", sans-serif; }').findings.filter(f => f.cat === 'FONT');
  assert.strictEqual(fonts.length, 1);
  assert.strictEqual(fonts[0].rule, 'font-not-dga');
});

test('acceptance: md:ml-4 (variant-prefixed) IS flagged', () => {
  const f = scanSource('d.tsx', 'export const A = () => <div className="md:ml-4" />;').findings;
  assert.ok(f.some(x => x.cat === 'RTL' && x.from === 'md:ml-4'));
});

test('acceptance: ml-4 inside a // comment is NOT flagged', () => {
  const f = scanSource('e.tsx', 'function A(){ // ml-4 here\n return null; }').findings;
  assert.strictEqual(f.length, 0);
});

test('acceptance: ml-4 inside a plain (non-class) string is NOT flagged', () => {
  const f = scanSource('f.tsx', 'const label = "use ml-4 here";').findings;
  assert.strictEqual(f.length, 0);
});

// ---------------------------------------------------------------------------
// Config: fonts allowlist · ignore glob · disable category
// ---------------------------------------------------------------------------
test('config: fonts/ignore/disable are honored', () => {
  const out = scanJson(path.join(__dirname, 'config'));
  const R = out.results || [];
  assert.ok(out.config && /daleelrc/.test(out.config), 'config file should be discovered');
  // fonts: "My Brand Arabic" approved → not flagged; "Inter" still flagged
  assert.ok(!R.some(f => /My Brand Arabic/i.test(f.from)), 'configured font must be approved');
  assert.ok(R.some(f => f.rule === 'font-not-dga' && /Inter/.test(f.from)), 'non-approved font must still flag');
  // ignore glob: nothing from skip-me.css
  assert.ok(!R.some(f => /skip-me\.css/.test(f.file)), 'ignore glob must exclude the file');
  // disable: no A11Y findings anywhere
  assert.ok(!R.some(f => f.cat === 'A11Y'), 'A11Y disabled → no a11y findings');
  // but RTL still fires (page.html ml-4)
  assert.ok(R.some(f => f.cat === 'RTL' && /page\.html/.test(f.file)), 'RTL must still be reported');
});
