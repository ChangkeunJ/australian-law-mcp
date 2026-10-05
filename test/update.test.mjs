import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOnce, isNewer, latestNotice, startUpdateCheck, updateCheckDisabled } from '../dist/update.js';

test('isNewer compares release numbers, not strings', () => {
  assert.equal(isNewer('0.1.6', '0.1.5'), true);
  assert.equal(isNewer('0.2.0', '0.1.5'), true);
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
  assert.equal(isNewer('0.1.5', '0.1.5'), false);
  assert.equal(isNewer('0.1.4', '0.1.5'), false);
  assert.equal(isNewer('latest', '0.1.5'), false);
  assert.equal(isNewer('0.2.0', 'unknown'), false);
});

test('the check is off under the usual opt-out variables', () => {
  assert.equal(updateCheckDisabled({}), false);
  assert.equal(updateCheckDisabled({ AUSTRALIAN_LAW_MCP_NO_UPDATE_CHECK: '1' }), true);
  assert.equal(updateCheckDisabled({ AUSTRALIAN_LAW_MCP_NO_UPDATE_CHECK: '0' }), false);
  assert.equal(updateCheckDisabled({ NO_UPDATE_NOTIFIER: '1' }), true);
  assert.equal(updateCheckDisabled({ CI: 'true' }), true);
  assert.equal(updateCheckDisabled({ CI: 'false' }), false);
});

const registry = (body, init) => async () => new Response(body, init);

test('a newer release on npm produces a notice naming both versions', async () => {
  const notice = await checkOnce('0.1.5', { fetch: registry(JSON.stringify({ version: '0.2.0' })), env: {} });
  assert.match(notice, /0\.1\.5 is running; 0\.2\.0 is on npm/);
  assert.match(notice, /npx -y australian-law-mcp@latest/);
});

test('the same or an older release produces nothing', async () => {
  assert.equal(await checkOnce('0.1.5', { fetch: registry(JSON.stringify({ version: '0.1.5' })), env: {} }), null);
  assert.equal(await checkOnce('0.1.5', { fetch: registry(JSON.stringify({ version: '0.1.0' })), env: {} }), null);
});

test('every failure resolves to nothing rather than rejecting', async () => {
  assert.equal(await checkOnce('0.1.5', { fetch: registry('{}', { status: 500 }), env: {} }), null);
  assert.equal(await checkOnce('0.1.5', { fetch: registry('not json'), env: {} }), null);
  assert.equal(await checkOnce('0.1.5', { fetch: registry(JSON.stringify({ version: 7 })), env: {} }), null);
  assert.equal(
    await checkOnce('0.1.5', {
      fetch: async () => {
        throw new Error('offline');
      },
      env: {},
    }),
    null,
  );
});

test('a registry that does not answer in time produces nothing', async () => {
  // AbortSignal.timeout does not keep the event loop alive, so the stub holds
  // it open itself and gives up far later than the check's own timeout.
  const slow = (_url, init) =>
    new Promise((_resolve, reject) => {
      const giveUp = setTimeout(() => reject(new Error('the stub outlived the timeout')), 2000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(giveUp);
        reject(init.signal.reason);
      });
    });
  const started = performance.now();
  assert.equal(await checkOnce('0.1.5', { fetch: slow, env: {}, timeoutMs: 50 }), null);
  assert.ok(performance.now() - started < 1000, 'the timeout must be the only wait');
});

test('opting out means the registry is never contacted', async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return new Response('{}');
  };
  await checkOnce('0.1.5', { fetch, env: { AUSTRALIAN_LAW_MCP_NO_UPDATE_CHECK: '1' } });
  assert.equal(calls, 0);
});

test('the process checks once and remembers the answer', async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ version: '9.9.9' }));
  };
  const [a, b] = await Promise.all([
    startUpdateCheck('0.1.5', { fetch, env: {} }),
    startUpdateCheck('0.1.5', { fetch, env: {} }),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.match(latestNotice(), /9\.9\.9 is on npm/);
});
