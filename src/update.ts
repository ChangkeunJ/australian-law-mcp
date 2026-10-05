// Tells the operator when a newer release is on npm. npx users get the latest
// release on every restart anyway; this is for global installs and Docker
// images, which stay at whatever version they were built with.
//
// The check is best effort by design: one request per process, a short
// timeout, every failure resolved to "nothing to say", and never on the path
// of a tool call. AUSTRALIAN_LAW_MCP_NO_UPDATE_CHECK switches it off, and the
// NO_UPDATE_NOTIFIER and CI conventions are honoured.

import { readBody } from './frl.js';

export const REGISTRY_URL = 'https://registry.npmjs.org/australian-law-mcp/latest';
const UA = 'australian-law-mcp (github.com/ChangkeunJ/australian-law-mcp)';
const MAX_BODY = 1024 * 1024;

export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1, 4).map(Number);
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}

const set = (value: string | undefined) =>
  value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';

export function updateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return set(env.AUSTRALIAN_LAW_MCP_NO_UPDATE_CHECK) || set(env.NO_UPDATE_NOTIFIER) || set(env.CI);
}

export function updateNotice(current: string, latest: string): string {
  return (
    `australian-law-mcp ${current} is running; ${latest} is on npm. To update: npx users restart the client ` +
    `(npx resolves the latest release; or run "npx -y australian-law-mcp@latest" once), global installs run ` +
    `"npm i -g australian-law-mcp@latest", Docker users rebuild with "docker build --pull".`
  );
}

export interface CheckOptions {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  url?: string;
  timeoutMs?: number;
}

// Resolves to the notice, or to null for any reason at all; it never rejects.
export async function checkOnce(current: string, options: CheckOptions = {}): Promise<string | null> {
  const { fetch: doFetch = globalThis.fetch, env = process.env, url = REGISTRY_URL, timeoutMs = 3000 } = options;
  try {
    if (updateCheckDisabled(env)) return null;
    const res = await doFetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = JSON.parse(new TextDecoder().decode(await readBody(res, MAX_BODY, 'registry'))) as {
      version?: unknown;
    };
    if (typeof body.version !== 'string') return null;
    return isNewer(body.version, current) ? updateNotice(current, body.version) : null;
  } catch {
    return null;
  }
}

let pending: Promise<string | null> | undefined;
let settled: string | null = null;

// One check per process; later callers share the same answer.
export function startUpdateCheck(current: string, options?: CheckOptions): Promise<string | null> {
  if (!pending) pending = checkOnce(current, options).then((notice) => (settled = notice));
  return pending;
}

export function latestNotice(): string | null {
  return settled;
}
