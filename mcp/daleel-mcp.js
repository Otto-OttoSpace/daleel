#!/usr/bin/env node
'use strict';
/*
 * Daleel MCP server — lets AI agents check Saudi DGA design-system readiness by
 * calling Daleel over the Model Context Protocol (stdio, newline-delimited
 * JSON-RPC). Part of Otto · dev.ottospace.co
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'daleel.js');
const VERSION = require('../package.json').version;
const PROTOCOL = '2025-06-18';

function runCli(args) {
  try { return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

const TOOLS = [
  { name: 'daleel_scan', description: 'Scan a file or directory for Saudi DGA design-system readiness (RTL-first, IBM Plex Sans Arabic, WCAG 2.2 AA). Returns JSON gaps by category (RTL/FONT/A11Y).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'daleel_check_code', description: 'Check a code snippet for Saudi DGA design-system gaps before shipping a Saudi-gov UI.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, ext: { type: 'string', description: 'e.g. .tsx or .css' } }, required: ['code'] } },
  // Backwards-compatible aliases (pre-rebrand names).
  { name: 'dls_scan', description: 'Alias of daleel_scan.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'dls_check_code', description: 'Alias of daleel_check_code.', inputSchema: { type: 'object', properties: { code: { type: 'string' }, ext: { type: 'string' } }, required: ['code'] } },
];

// A caller-supplied scan `path` must not be readable as a flag or subcommand
// (e.g. `--init-rules`, `activate`, `deactivate`), which would hijack the CLI
// into writing/deleting files instead of scanning. Reject leading-dash and
// prefix a bare relative path with `./` so it can only be a path.
function safeScanPath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('-')) return null;
  if (!path.isAbsolute(p) && !p.startsWith('./') && !p.startsWith('../')) return './' + p;
  return p;
}

function callTool(name, args) {
  if (name === 'daleel_scan' || name === 'dls_scan') {
    const p = safeScanPath(args.path);
    if (!p) throw new Error('invalid path (must be a file/dir, not a flag or subcommand)');
    return runCli([p, '--json']);
  }
  if (name === 'daleel_check_code' || name === 'dls_check_code') {
    // `ext` is attacker-controlled and gets joined into a temp path, so accept
    // only a leading dot followed by alphanumerics (no '/', '\\', '..' or other
    // separators). Anything else — including `.x/../../etc/passwd` — falls back
    // to the safe default, preventing an arbitrary-write/-delete path traversal.
    const ext = typeof args.ext === 'string' && /^\.[A-Za-z0-9]+$/.test(args.ext) ? args.ext : '.tsx';
    const tmp = path.join(os.tmpdir(), `daleel-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`);
    fs.writeFileSync(tmp, args.code);
    const out = runCli([tmp, '--json']);
    try { fs.unlinkSync(tmp); } catch {}
    return out;
  }
  throw new Error('unknown tool: ' + name);
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'daleel', version: VERSION } } });
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    try { return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: callTool(params.name, params.arguments || {}) }] } }); }
    catch (e) { return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true } }); }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
process.stderr.write(`Daleel MCP server v${VERSION} ready\n`);
