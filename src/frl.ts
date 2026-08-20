// Client for the Federal Register of Legislation OData API.
// No auth, no key. Content is CC BY 4.0: https://www.legislation.gov.au/terms-of-use
//
// Quirks confirmed by probing the live API (2026-08-20):
// - datetime function parameters must omit the trailing Z or the server
//   rejects them with an ODataException
// - documents/find treats uniqueTypeNumber/volumeNumber/rectificationVersionNumber
//   as mandatory even though the swagger marks them optional; volumeNumber=0
//   returns the complete document even for multi-volume acts
// - /v1/Affect and /v1/_PointInTimeSearch are listed in $metadata but return
//   404; amendment data comes from Versions reasons[] and the affectedby()
//   search criteria instead
// - the text() search criteria needs the undocumented 3-argument form
//   text("query",searchType,matchType); the 1-argument form matches names only

const BASE = 'https://api.prod.legislation.gov.au/v1';
const UA = 'australian-law-mcp (github.com/ChangkeunJ/australian-law-mcp)';

export class FrlError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export interface AffectedByTitle {
  titleId: string;
  name: string;
  provisions?: string | null;
  year?: number;
  number?: number;
  seriesType?: string;
}

export interface Reason {
  affect: string;
  markdown?: string | null;
  affectedByTitle?: AffectedByTitle | null;
  amendedByTitle?: AffectedByTitle | null;
}

export interface StatusEntry {
  status: string;
  start: string;
  reasons: Reason[];
}

export interface Title {
  id: string;
  name: string;
  collection: string;
  subCollection?: string | null;
  status: string;
  isPrincipal: boolean;
  isInForce: boolean;
  year?: number | null;
  number?: number | null;
  seriesType?: string | null;
  hasCommencedUnincorporatedAmendments?: boolean;
  statusHistory?: StatusEntry[];
  searchContexts?: {
    text?: { relevance: number } | null;
    fullTextVersion?: {
      registerId: string;
      start: string;
      isLatest: boolean;
      isAsMade: boolean;
      relevance: number;
    } | null;
  } | null;
}

export interface Version {
  titleId: string;
  name: string;
  status: string;
  start: string;
  end?: string | null;
  registerId: string;
  compilationNumber?: string | null;
  isCurrent?: boolean;
  isLatest?: boolean;
  hasUnincorporatedAmendments?: boolean;
  reasons?: Reason[];
}

const cache = new Map<string, { at: number; value: unknown }>();
const HOUR = 3_600_000;

function remember<T>(key: string, ttl: number, value: T): T {
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function request(path: string): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status >= 500) {
        last = new FrlError(`FRL API responded ${res.status}`, res.status);
        continue;
      }
      return res;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new FrlError(String(last));
}

async function getJson<T>(path: string, ttl: number): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const res = await request(path);
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ? `: ${body.error.message}` : '';
    } catch {}
    throw new FrlError(`FRL API responded ${res.status} for ${path}${detail}`, res.status);
  }
  return remember(path, ttl, (await res.json()) as T);
}

function quoted(value: string): string {
  return value.replace(/'/g, "''").replace(/"/g, '');
}

export type SearchType = 'name' | 'nameAndText' | 'id';
export type MatchType = 'exact' | 'all' | 'any' | 'contains' | 'excludes' | 'startswith';

export interface SearchResult {
  count: number;
  titles: Title[];
}

interface ODataList<T> {
  '@odata.count'?: number;
  value: T[];
}

export async function searchTitles(
  query: string,
  searchType: SearchType,
  match: MatchType,
  top = 10,
): Promise<SearchResult> {
  const criteria = encodeURIComponent(`text("${quoted(query)}",${searchType},${match})`);
  const expand = encodeURIComponent('searchContexts($expand=text,fullTextVersion)');
  const path = `/titles/search(criteria='${criteria}')?$top=${top}&$count=true&$expand=${expand}`;
  const data = await getJson<ODataList<Title>>(path, HOUR);
  return { count: data['@odata.count'] ?? data.value.length, titles: data.value };
}

export async function amendingTitles(titleId: string, top = 15): Promise<SearchResult> {
  const criteria = encodeURIComponent(`affectedby("${quoted(titleId)}",[amending])`);
  const path = `/titles/search(criteria='${criteria}')?$top=${top}&$count=true`;
  const data = await getJson<ODataList<Title>>(path, HOUR);
  return { count: data['@odata.count'] ?? data.value.length, titles: data.value };
}

export async function getTitle(titleId: string): Promise<Title | null> {
  try {
    return await getJson<Title>(`/Titles('${quoted(titleId)}')`, HOUR);
  } catch (e) {
    if (e instanceof FrlError && e.status === 404) return null;
    throw e;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(date: string): string {
  if (!DATE.test(date)) throw new FrlError(`date must be yyyy-mm-dd, got "${date}"`);
  return date;
}

export async function findVersion(titleId: string, asAt?: string): Promise<Version | null> {
  const selector = asAt
    ? `asAt=${assertDate(asAt)}T00:00:00`
    : `asAtSpecification='Latest'`;
  try {
    return await getJson<Version>(
      `/Versions/Find(titleId='${quoted(titleId)}',${selector})`,
      asAt ? 24 * HOUR : HOUR,
    );
  } catch (e) {
    if (e instanceof FrlError && e.status === 404) return null;
    throw e;
  }
}

export async function listVersions(titleId: string, top = 200): Promise<Version[]> {
  const filter = encodeURIComponent(`titleId eq '${quoted(titleId)}'`);
  const order = encodeURIComponent('start desc');
  const data = await getJson<ODataList<Version>>(
    `/Versions?$filter=${filter}&$orderby=${order}&$top=${top}`,
    HOUR,
  );
  return data.value;
}

export async function getEpub(titleId: string, asAt?: string): Promise<Uint8Array> {
  const selector = asAt ? `asat=${assertDate(asAt)}` : `asatspecification='Latest'`;
  const path =
    `/documents/find(titleid='${quoted(titleId)}',${selector},type='Primary',` +
    `format='Epub',uniqueTypeNumber=0,volumeNumber=0,rectificationVersionNumber=0)`;
  const res = await request(path);
  if (!res.ok) throw new FrlError(`FRL API responded ${res.status} for the ${titleId} document`, res.status);
  return new Uint8Array(await res.arrayBuffer());
}

export async function ping(): Promise<{ ms: number; release: string | null }> {
  const started = Date.now();
  const res = await request('/titles?$top=1');
  if (!res.ok) throw new FrlError(`FRL API responded ${res.status}`, res.status);
  await res.arrayBuffer();
  return { ms: Date.now() - started, release: res.headers.get('x-frl-version') };
}
