'use strict';
/*
 * Daleel Pro — license layer (open-core), provider-agnostic.
 *
 * Free scan stays free; Pro features (--report, --cert) are gated behind a
 * license key. A key from EITHER provider works:
 *   - Gumroad  (primary, live now)  — verified against the Daleel Pro product(s).
 *   - Lemon Squeezy (fallback)      — activate/validate/deactivate by key.
 * Both are keyed by the license key itself and need NO store/secret token.
 *
 * On activation we cache a tiny record at ~/.daleel/license.json (chmod 600):
 *   Gumroad:       { provider:'gumroad', key, product, activatedAt, lastValidated, status }
 *   LemonSqueezy:  { provider:'lemonsqueezy', key, instanceId, activatedAt, lastValidated, status }
 * Pro is granted when status:'active' AND lastValidated within REVALIDATE_DAYS;
 * older → re-validate over the network. Offline-friendly: a transport error during
 * re-validate keeps the last known-good status until the license actually expires.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const REVALIDATE_DAYS = 3;
const REVALIDATE_MS = REVALIDATE_DAYS * 24 * 60 * 60 * 1000;

// Gumroad — permalinks that grant Pro (Daleel Pro membership + Compliance Certificate).
const GUMROAD_HOST = 'api.gumroad.com';
const GUMROAD_PATH = '/v2/licenses/verify';
const GUMROAD_PRODUCTS = (process.env.DALEEL_GUMROAD_PRODUCTS || 'xlgiqj,wlwiwz')
  .split(',').map(s => s.trim()).filter(Boolean);
// Lemon Squeezy — license endpoints (no store token needed).
const LS_HOST = 'api.lemonsqueezy.com';
const LS_BASE = '/v1/licenses';

const UPGRADE_URL = process.env.DALEEL_UPGRADE_URL || 'https://moradpro7.gumroad.com/l/xlgiqj';

// ---------------------------------------------------------------------------
// Paths — read HOME at call time so tests can point at a temp HOME.
// ---------------------------------------------------------------------------
function homeDir() { return process.env.HOME || (os.homedir && os.homedir()) || '.'; }
function daleelDir() { return path.join(homeDir(), '.daleel'); }
function licensePath() { return path.join(daleelDir(), 'license.json'); }

// ---------------------------------------------------------------------------
// Time — guarded (some sandboxes stub Date). Returns epoch-ms or null.
// ---------------------------------------------------------------------------
function nowMs() {
  try { const n = Date.now(); return (typeof n === 'number' && isFinite(n) && n > 0) ? n : null; }
  catch { return null; }
}
function nowIso() { const t = nowMs(); return t == null ? null : new Date(t).toISOString(); }

// ---------------------------------------------------------------------------
// Cache read/write (600).
// ---------------------------------------------------------------------------
function readCache() {
  try { return JSON.parse(fs.readFileSync(licensePath(), 'utf8')); }
  catch { return null; }
}
function writeCache(rec) {
  try { fs.mkdirSync(daleelDir(), { recursive: true, mode: 0o700 }); } catch {}
  const p = licensePath();
  fs.writeFileSync(p, JSON.stringify(rec, null, 2));
  try { fs.chmodSync(p, 0o600); } catch {}
  return rec;
}
function removeCache() { try { fs.unlinkSync(licensePath()); } catch {} }

// ---------------------------------------------------------------------------
// Generic form-encoded POST. Resolves { statusCode, json }; rejects on transport error.
// ---------------------------------------------------------------------------
function postForm(host, reqPath, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      host, path: reqPath, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch {} resolve({ statusCode: res.statusCode, json }); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
const lsPost = (endpoint, params) => postForm(LS_HOST, LS_BASE + '/' + endpoint, params);

// ---------------------------------------------------------------------------
// Gumroad: a purchase is "active" unless refunded/chargebacked/disputed, or the
// subscription has ended/failed (a cancelled-but-not-yet-ended sub stays active).
// ---------------------------------------------------------------------------
function gumroadActive(p) {
  if (!p) return false;
  if (p.refunded || p.chargebacked || p.disputed) return false;
  if (p.subscription_ended_at || p.subscription_failed_at) return false;
  return true;
}
// Verify a key against each Pro product; returns {product, purchase, uses} or null.
async function gumroadVerify(key, increment) {
  for (const product of GUMROAD_PRODUCTS) {
    const res = await postForm(GUMROAD_HOST, GUMROAD_PATH, {
      product_id: product, license_key: key, increment_uses_count: increment ? 'true' : 'false',
    });
    const j = res.json || {};
    if (j.success === true) return { product, purchase: j.purchase || {}, uses: j.uses };
  }
  return null;
}

// ---------------------------------------------------------------------------
// activate(key): Gumroad first, Lemon Squeezy fallback; cache on success.
// ---------------------------------------------------------------------------
async function activate(key) {
  key = String(key || '').trim();
  if (!key) { console.error('daleel: activate needs a license key — usage: daleel activate <key>'); return { ok: false, error: 'no-key' }; }

  // 1) Gumroad
  let g = null, gnet = false;
  try { g = await gumroadVerify(key, true); } catch { gnet = true; }
  if (g) {
    if (!gumroadActive(g.purchase)) { console.error('daleel: that Gumroad license is refunded or expired.'); return { ok: false, error: 'inactive' }; }
    const t = nowMs();
    const rec = { provider: 'gumroad', key, product: g.product, activatedAt: t == null ? null : new Date(t).toISOString(), lastValidated: t, status: 'active' };
    writeCache(rec);
    console.log('✓ Daleel Pro activated on ' + os.hostname() + '.');
    return { ok: true, record: rec };
  }

  // 2) Lemon Squeezy fallback
  let res;
  try { res = await lsPost('activate', { license_key: key, instance_name: os.hostname() }); }
  catch (e) {
    if (gnet) { console.error('daleel: activation failed — network error (' + (e && e.message || e) + ')'); return { ok: false, error: 'network' }; }
    console.error('daleel: that license key was not found. Buy Daleel Pro → ' + UPGRADE_URL); return { ok: false, error: 'not-found' };
  }
  const j = res.json || {};
  if (res.statusCode >= 200 && res.statusCode < 300 && j.activated && j.instance && j.instance.id) {
    const t = nowMs();
    const rec = { provider: 'lemonsqueezy', key, instanceId: j.instance.id, activatedAt: t == null ? null : new Date(t).toISOString(), lastValidated: t, status: (j.license_key && j.license_key.status) || 'active' };
    writeCache(rec);
    console.log('✓ Daleel Pro activated on ' + os.hostname() + '.');
    return { ok: true, record: rec };
  }
  const msg = j.error || 'that license key was not found';
  console.error('daleel: activation failed — ' + msg + '. Buy Daleel Pro → ' + UPGRADE_URL);
  return { ok: false, error: msg };
}

// ---------------------------------------------------------------------------
// deactivate(): LS releases the seat over the network; Gumroad drops locally.
// ---------------------------------------------------------------------------
async function deactivate() {
  const rec = readCache();
  if (!rec || !rec.key) { console.log('daleel: no active license on this machine.'); return { ok: true, noop: true }; }
  if (rec.provider === 'lemonsqueezy') {
    let res;
    try { res = await lsPost('deactivate', { license_key: rec.key, instance_id: rec.instanceId }); }
    catch (e) { removeCache(); console.error('daleel: deactivate network error (' + (e && e.message || e) + ') — removed the local license anyway.'); return { ok: true, offline: true }; }
    removeCache();
    const j = res.json || {};
    if (j.deactivated) console.log('✓ Daleel Pro deactivated on this machine.');
    else console.log('daleel: local license removed (server said: ' + (j.error || ('HTTP ' + res.statusCode)) + ').');
    return { ok: true };
  }
  // gumroad / unknown: local removal (seat release needs the store token; dropping local is enough)
  removeCache();
  console.log('✓ Daleel Pro deactivated on this machine.');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Freshness of the cached validation timestamp.
// ---------------------------------------------------------------------------
function isFresh(rec) {
  const t = nowMs();
  if (t == null) return true;
  const lv = Number(rec.lastValidated);
  if (!lv || Number.isNaN(lv)) return false;
  return (t - lv) <= REVALIDATE_MS;
}

// ---------------------------------------------------------------------------
// Re-validate a stale-but-active license (provider-aware). Offline-friendly.
// ---------------------------------------------------------------------------
async function revalidate(rec) {
  if (rec.provider === 'gumroad' || (!rec.provider && rec.product)) {
    let g;
    try { g = await gumroadVerify(rec.key, false); }
    catch { return { pro: true, status: 'active', key: rec.key, offline: true }; }
    if (g && gumroadActive(g.purchase)) { rec.lastValidated = nowMs(); rec.status = 'active'; writeCache(rec); return { pro: true, status: 'active', key: rec.key }; }
    rec.status = g ? 'expired' : 'invalid'; writeCache(rec);
    return { pro: false, status: rec.status, key: rec.key };
  }
  // lemonsqueezy
  let res;
  try { res = await lsPost('validate', { license_key: rec.key, instance_id: rec.instanceId }); }
  catch { return { pro: true, status: 'active', key: rec.key, offline: true }; }
  const j = res.json || {};
  const lstatus = (j.license_key && j.license_key.status) || null;
  const ok = res.statusCode >= 200 && res.statusCode < 300 && j.valid && (lstatus === null || lstatus === 'active');
  if (ok) { rec.lastValidated = nowMs(); rec.status = 'active'; writeCache(rec); return { pro: true, status: 'active', key: rec.key }; }
  rec.status = lstatus === 'expired' ? 'expired' : 'invalid'; writeCache(rec);
  return { pro: false, status: rec.status, key: rec.key };
}

// ---------------------------------------------------------------------------
// status(): resolve current entitlement. isPro(): boolean shorthand.
// ---------------------------------------------------------------------------
async function status() {
  const rec = readCache();
  if (!rec || !rec.key) return { pro: false, status: 'none' };
  if (rec.status !== 'active') return { pro: false, status: rec.status || 'inactive', key: rec.key };
  if (isFresh(rec)) return { pro: true, status: 'active', key: rec.key, provider: rec.provider, lastValidated: rec.lastValidated };
  return await revalidate(rec);
}
async function isPro() { return (await status()).pro === true; }

module.exports = {
  activate, deactivate, status, isPro,
  // exposed for tests / reuse
  licensePath, REVALIDATE_DAYS, UPGRADE_URL,
};
