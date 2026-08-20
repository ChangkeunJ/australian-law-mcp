// Drives the built server over real stdio JSON-RPC, as an MCP client would.
// Live network. Run manually: node scripts/protocol-test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.execPath, ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let nextId = 1;

createInterface({ input: child.stdout }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function rpc(method, params) {
  const id = nextId++;
  const p = new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 120_000);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return p;
}

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'protocol-test', version: '0' },
});
assert.equal(init.result.serverInfo.name, 'australian-law-mcp');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
console.log('ok  initialize:', init.result.serverInfo.name, init.result.protocolVersion);

const tools = await rpc('tools/list', {});
const names = tools.result.tools.map((t) => t.name).sort();
assert.equal(names.length, 8);
console.log('ok  tools/list:', names.join(', '));

const call = await rpc('tools/call', {
  name: 'verify_citations',
  arguments: { text: 'See s 3A and s 999 of the Income Tax Rates Act 1986.' },
});
const text = call.result.content[0].text;
assert.match(text, /\[OK\] Income Tax Rates Act 1986/);
assert.match(text, /s 3A exists/);
assert.match(text, /\[NOT FOUND\] s 999/);
console.log('ok  verify_citations:\n' + text.split('\n').slice(0, 4).map((l) => '      ' + l).join('\n'));

const asAt = await rpc('tools/call', {
  name: 'get_law_as_at',
  arguments: { titleId: 'C2004A03348', date: '2017-01-05', section: '3A' },
});
assert.match(asAt.result.content[0].text, /Compilation No\. 48/);
assert.match(asAt.result.content[0].text, /working holiday maker/i);
console.log('ok  get_law_as_at: s 3A as at 2017-01-05 served from Compilation No. 48');

child.kill();
console.log('protocol test passed');
