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

// request() is reached through ping(), which is the one caller with no cache
// in front of it.
import { ping } from '../dist/frl.js';

async function withFetch(stub, body) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

test('a response that arrived from another host is refused, not parsed', async () => {
  await withFetch(
    async () => {
      const res = new Response('[]');
      Object.defineProperty(res, 'url', { value: 'https://elsewhere.example/v1/titles' });
      return res;
    },
    () => assert.rejects(ping(), /redirected to elsewhere\.example, which this server does not read from/),
  );
});

test('a response from the register itself is read', async () => {
  await withFetch(
    async () => {
      const res = new Response('[]', { headers: { 'x-frl-version': 'release-1' } });
      Object.defineProperty(res, 'url', { value: 'https://api.prod.legislation.gov.au/v1/titles?$top=1' });
      return res;
    },
    async () => assert.equal((await ping()).release, 'release-1'),
  );
});
