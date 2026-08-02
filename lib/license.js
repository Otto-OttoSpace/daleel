'use strict';
/*
 * Daleel Pro — license layer (open-core).
 *
 * Free scan stays free; Pro features (--report, --cert) are gated behind a
 * Lemon Squeezy license key. Zero new npm deps — built-in https/fs/os/crypto.
 *
 * Lemon Squeezy's license activate/validate/deactivate endpoints are keyed by
 * the license key itself and need NO store API key. On activation we cache a
 * tiny record at ~/.daleel/license.json (chmod 600):
 *     { key, instanceId, activatedAt, lastValidated, status:'active' }
 *   - lastValidated is epoch-ms (for the freshness window)
 *   - activatedAt   is ISO-8601 (human)
 *
 * Pro is granted when the cache says status:'active' AND lastValidated is
 * within REVALIDATE_DAYS. Older than that → re-validate over the network and
 * refresh lastValidated. Offline-friendly: a network error during re-validate
 * keeps the last known-good status until the license actually expires.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const API_HOST = 'api.lemonsqueezy.com';
const API_BASE = '/v1/licenses';
const REVALIDATE_DAYS = 3;
const REVALIDATE_MS = REVALIDATE_DAYS * 24 * 60 * 60 * 1000;
const UPGRADE_URL = 'https://ottospace.co/daleel/pro';

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
// Lemon Squeezy POST (form-encoded; keyed by the license key, no store token).
// Resolves { statusCode, json }. Rejects only on a transport error.
// ---------------------------------------------------------------------------
function apiPost(endpoint, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      host: API_HOST,
      path: API_BASE + '/' + endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ statusCode: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// activate(key): POST /activate, cache on success.
// ---------------------------------------------------------------------------
async function activate(key) {
  key = String(key || '').trim();
  if (!key) { console.error('daleel: activate needs a license key — usage: daleel activate <key>'); return { ok: false, error: 'no-key' }; }
  let res;
  try { res = await apiPost('activate', { license_key: key, instance_name: os.hostname() }); }
  catch (e) { console.error('daleel: activation failed — network error (' + (e && e.message || e) + ')'); return { ok: false, error: 'network' }; }

  const j = res.json || {};
  if (res.statusCode >= 200 && res.statusCode < 300 && j.activated && j.instance && j.instance.id) {
    const t = nowMs();
    const rec = {
      key,
      instanceId: j.instance.id,
      activatedAt: t == null ? null : new Date(t).toISOString(),
      lastValidated: t,
      status: (j.license_key && j.license_key.status) || 'active',
    };
    writeCache(rec);
    console.log('✓ Daleel Pro activated on ' + os.hostname() + '.');
    return { ok: true, record: rec };
  }
  const msg = j.error || ('HTTP ' + res.statusCode);
  console.error('daleel: activation failed — ' + msg);
  return { ok: false, error: msg };
}

// ---------------------------------------------------------------------------
// deactivate(): POST /deactivate, then drop the local cache.
// ---------------------------------------------------------------------------
async function deactivate() {
  const rec = readCache();
  if (!rec || !rec.key) { console.log('daleel: no active license on this machine.'); return { ok: true, noop: true }; }
  let res;
  try { res = await apiPost('deactivate', { license_key: rec.key, instance_id: rec.instanceId }); }
  catch (e) {
    removeCache();
    console.error('daleel: deactivate network error (' + (e && e.message || e) + ') — removed the local license anyway.');
    return { ok: true, offline: true };
  }
  removeCache();
  const j = res.json || {};
  if (j.deactivated) console.log('✓ Daleel Pro deactivated on this machine.');
  else console.log('daleel: local license removed (server said: ' + (j.error || ('HTTP ' + res.statusCode)) + ').');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Freshness of the cached validation timestamp.
// ---------------------------------------------------------------------------
function isFresh(rec) {
  const t = nowMs();
  if (t == null) return true;                       // can't read the clock → trust the cache
  const lv = Number(rec.lastValidated);
  if (!lv || Number.isNaN(lv)) return false;        // never validated → stale
  return (t - lv) <= REVALIDATE_MS;
}

// ---------------------------------------------------------------------------
// Re-validate a stale-but-active license. Offline-friendly: a transport error
// keeps the last known-good status until the license actually expires.
// ---------------------------------------------------------------------------
async function revalidate(rec) {
  let res;
  try { res = await apiPost('validate', { license_key: rec.key, instance_id: rec.instanceId }); }
  catch { return { pro: true, status: 'active', key: rec.key, offline: true }; }

  const j = res.json || {};
  const lstatus = (j.license_key && j.license_key.status) || null;
  const ok = res.statusCode >= 200 && res.statusCode < 300 && j.valid && (lstatus === null || lstatus === 'active');
  if (ok) {
    rec.lastValidated = nowMs();
    rec.status = 'active';
    writeCache(rec);
    return { pro: true, status: 'active', key: rec.key };
  }
  rec.status = lstatus === 'expired' ? 'expired' : 'invalid';
  writeCache(rec);
  return { pro: false, status: rec.status, key: rec.key };
}

// ---------------------------------------------------------------------------
// status(): resolve current entitlement. isPro(): boolean shorthand.
// ---------------------------------------------------------------------------
async function status() {
  const rec = readCache();
  if (!rec || !rec.key) return { pro: false, status: 'none' };
  if (rec.status !== 'active') return { pro: false, status: rec.status || 'inactive', key: rec.key };
  if (isFresh(rec)) return { pro: true, status: 'active', key: rec.key, instanceId: rec.instanceId, lastValidated: rec.lastValidated };
  return await revalidate(rec);
}
async function isPro() { return (await status()).pro === true; }

module.exports = {
  activate, deactivate, status, isPro,
  // exposed for tests / reuse
  licensePath, REVALIDATE_DAYS, UPGRADE_URL,
};
