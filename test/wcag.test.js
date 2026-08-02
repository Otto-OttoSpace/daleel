'use strict';
/*
 * Daleel WCAG 2.2 AA pack regression suite. Runs the real CLI over temp JSX and
 * asserts the new accessibility rules fire — and stay low-FP.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'daleel.js');

function a11yRules(jsx) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'daleel-wcag-'));
  fs.writeFileSync(path.join(d, 'F.jsx'), jsx);
  try {
    let out;
    try { out = execFileSync(process.execPath, [CLI, d, '--json'], { encoding: 'utf8' }); }
    catch (e) { out = e.stdout; } // exit 1 when findings exist; JSON still on stdout
    const r = JSON.parse(out);
    return new Set((r.results || []).filter(x => x.cat === 'A11Y').map(x => x.rule));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

test('wcag 2.2: flags positive tabindex, unlabeled form control, invalid aria', () => {
  const rules = a11yRules('export default () => <div tabIndex={3}><input type="text" /><button aria-lable="x">x</button></div>;');
  assert.ok(rules.has('a11y-positive-tabindex'), 'positive tabindex');
  assert.ok(rules.has('a11y-input-no-label'), 'unlabeled input');
  assert.ok(rules.has('a11y-invalid-aria'), 'aria-lable typo');
});

test('wcag 2.2: low-FP — hidden/labeled/id inputs + valid aria are NOT flagged', () => {
  const rules = a11yRules(`export default () => (<form>
    <input type="hidden" name="c" />
    <input type="text" aria-label="Name" />
    <input type="text" id="email" />
    <button aria-label="Close" aria-hidden="true">x</button>
  </form>);`);
  assert.ok(!rules.has('a11y-input-no-label'), 'hidden/labeled/id inputs must not flag');
  assert.ok(!rules.has('a11y-invalid-aria'), 'valid aria-* must not flag');
  assert.ok(!rules.has('a11y-positive-tabindex'), 'no tabindex → no flag');
});

test('wcag 2.2: flags heading skip, empty link, duplicate id', () => {
  const rules = a11yRules(`export default () => (<article>
    <h1>Title</h1>
    <h3>Skips h2</h3>
    <a onClick={() => go()}></a>
    <span id="dup">a</span>
    <span id="dup">b</span>
  </article>);`);
  assert.ok(rules.has('a11y-heading-skip'), 'h1→h3 skips a level');
  assert.ok(rules.has('a11y-empty-link'), '<a> with no href and no name');
  assert.ok(rules.has('a11y-duplicate-id'), 'id="dup" appears twice');
});

test('wcag 2.2: low-FP — sequential headings, real links, unique ids are NOT flagged', () => {
  const rules = a11yRules(`export default () => (<article>
    <h1>Title</h1>
    <h2>Section</h2>
    <h3>Sub</h3>
    <h2>Next</h2>
    <a href="/x">home</a>
    <a onClick={() => go()} aria-label="Menu"></a>
    <a onClick={() => go()}><Icon /></a>
    <span id="one">a</span>
    <span id="two">b</span>
    <div id={dynamic}>c</div>
    <div id={dynamic}>d</div>
  </article>);`);
  assert.ok(!rules.has('a11y-heading-skip'), 'sequential/shallower headings must not flag');
  assert.ok(!rules.has('a11y-empty-link'), 'href / aria-label / child-content links must not flag');
  assert.ok(!rules.has('a11y-duplicate-id'), 'unique + dynamic ids must not flag');
});
