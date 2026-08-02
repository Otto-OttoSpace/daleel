'use strict';
/*
 * Daleel Pro license-gate regression suite.
 *
 * Unit-tests isPro()/status() against a MOCKED ~/.daleel/license.json in a temp
 * HOME (no network — the mocked cache is always FRESH so re-validation never
 * fires) and CLI-tests the Pro gate on --report / --cert. The free scan, --json
 * and --render tiers are covered by run.js / wcag.test.js and stay green.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const license = require('../lib/license');
const CLI = path.join(__dirname, '..', 'bin', 'daleel.js');

// A throwaway project with a guaranteed FONT + RTL finding, scanned by the CLI tests.
const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'daleel-proj-'));
fs.writeFileSync(path.join(PROJECT, 'x.css'), '.a { font-family: Inter; margin-left: 4px; }\n');
process.on('exit', () => { try { fs.rmSync(PROJECT, { recursive: true, force: true }); } catch {} });

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'daleel-home-')); }
function writeLicense(home, rec) {
  const d = path.join(home, '.daleel');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'license.json'), JSON.stringify(rec, null, 2));
}
const freshActive = () => ({ key: 'test-key', instanceId: 'inst-1', activatedAt: new Date().toISOString(), lastValidated: Date.now(), status: 'active' });

// Run the real binary against an isolated HOME. Returns { code, out }.
function runCli(args, home) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: ((e.stdout || '') + '') };
  }
}

// Point the in-process license module at a temp HOME for one test body.
async function withHome(fn) {
  const home = tmpHome();
  const orig = process.env.HOME;
  process.env.HOME = home;
  try { return await fn(home); }
  finally { process.env.HOME = orig; try { fs.rmSync(home, { recursive: true, force: true }); } catch {} }
}

// ---------------------------------------------------------------------------
// Unit: isPro() / status() over a mocked cache (no network)
// ---------------------------------------------------------------------------
test('license: no cache → Free', async () => {
  await withHome(async () => {
    assert.strictEqual(await license.isPro(), false);
    const s = await license.status();
    assert.strictEqual(s.pro, false);
    assert.strictEqual(s.status, 'none');
  });
});

test('license: fresh active cache → Pro', async () => {
  await withHome(async (home) => {
    writeLicense(home, freshActive());
    assert.strictEqual(await license.isPro(), true);
    const s = await license.status();
    assert.strictEqual(s.pro, true);
    assert.strictEqual(s.status, 'active');
  });
});

test('license: non-active status → Free (short-circuits, no re-validate)', async () => {
  await withHome(async (home) => {
    writeLicense(home, { ...freshActive(), status: 'expired' });
    assert.strictEqual(await license.isPro(), false);
    assert.strictEqual((await license.status()).status, 'expired');
  });
});

// ---------------------------------------------------------------------------
// CLI: Pro gate on --report / --cert
// ---------------------------------------------------------------------------
test('cli: --report without Pro prints the upsell and exits 0', () => {
  const home = tmpHome();
  try {
    const r = runCli([PROJECT, '--report'], home);
    assert.strictEqual(r.code, 0, 'upsell must exit 0');
    assert.match(r.out, /Daleel Pro/, 'mentions Daleel Pro');
    assert.match(r.out, /daleel activate/, 'points at activation');
    assert.doesNotMatch(r.out, /Content hash \(sha256\)/, 'no Pro report leaks to Free');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('cli: --cert without Pro is gated (no certificate emitted) and exits 0', () => {
  const home = tmpHome();
  try {
    const r = runCli([PROJECT, '--cert'], home);
    assert.strictEqual(r.code, 0, 'gated cert must exit 0');
    assert.match(r.out, /Daleel Pro/, 'mentions Daleel Pro');
    assert.doesNotMatch(r.out, /"tool":\s*"daleel"/, 'no certificate JSON for Free');
    assert.doesNotMatch(r.out, /"sha256"/, 'no signed hash for Free');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('cli: with a fresh active license, --report renders and --cert emits a certificate', () => {
  const home = tmpHome();
  try {
    writeLicense(home, freshActive());

    const rep = runCli([PROJECT, '--report'], home);
    assert.strictEqual(rep.code, 1, 'report exits 1 when gaps remain');
    assert.match(rep.out, /compliance report/i, 'renders the Pro report');
    assert.match(rep.out, /Content hash \(sha256\)/, 'includes a content hash');
    assert.match(rep.out, /Overall: /, 'includes a pass/fail summary');

    const cert = runCli([PROJECT, '--cert', '--timestamp', '2026-01-01T00:00:00.000Z'], home);
    assert.strictEqual(cert.code, 0, 'cert exits 0');
    assert.match(cert.out, /"tool":\s*"daleel"/, 'emits the certificate JSON');
    assert.match(cert.out, /"ruleset":\s*"DGA-DLS \+ WCAG 2\.2 AA"/, 'names the ruleset');
    assert.match(cert.out, /"sha256":\s*"[0-9a-f]{64}"/, 'includes a sha256 content hash');
    assert.match(cert.out, /2026-01-01T00:00:00\.000Z/, 'honors --timestamp');
    assert.match(cert.out, /"result":\s*"FAIL"/, 'FAIL result when findings exist');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
