import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBody } from '../dist/frl.js';

test('readBody returns a body that fits under the cap', async () => {
  const res = new Response(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...(await readBody(res, 50, 'test'))], [1, 2, 3]);
});

test('readBody stops reading once the cap is exceeded', async () => {
  const res = new Response(new Uint8Array(100));
  await assert.rejects(readBody(res, 50, 'test'), /test response exceeded 50 bytes/);
});

test('readBody refuses a declared content-length above the cap before reading', async () => {
  const res = new Response(new Uint8Array(10), { headers: { 'content-length': '999' } });
  await assert.rejects(readBody(res, 50, 'test'), /declares 999 bytes, above the 50 byte limit/);
});
