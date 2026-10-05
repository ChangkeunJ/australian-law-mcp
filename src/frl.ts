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
// - $filter is rejected on titles/search and there is no criteria function for
//   principal titles, so narrowing has to be done by the query itself
// - enum-valued fields come back as their number from Versions/Find(asAt=...)
//   and as their name from Versions/Find(asAtSpecification='Latest'), so both
//   have to be accepted

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

const cache = new Map<string, { at: number; value: unknown; bytes: number }>();
const HOUR = 3_600_000;
// Counting entries alone would let 200 full search pages pin a few hundred
// MB, so the cache is bounded by bytes as well as by entries.
const CACHE_ENTRIES = 200;
const CACHE_BYTES = 64 * 1024 * 1024;
let cacheBytes = 0;

function remember<T>(key: string, value: T, bytes: number): T {
  const old = cache.get(key);
  if (old) {
    cacheBytes -= old.bytes;
    cache.delete(key);
  }
  cache.set(key, { at: Date.now(), value, bytes });
  cacheBytes += bytes;
  while (cache.size > 1 && (cache.size > CACHE_ENTRIES || cacheBytes > CACHE_BYTES)) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cacheBytes -= cache.get(oldest)?.bytes ?? 0;
    cache.delete(oldest);
  }
  return value;
}

// The largest JSON page the register legitimately sends (100 titles with
// their search contexts) is under 1 MB and the largest epub is tens of MB, so
// a body past these caps is not the register answering a question; it is
// refused part-way rather than buffered whole.
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_EPUB_BYTES = 300 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
const decoder = new TextDecoder();

async function request(path: string): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status >= 500) {
        last = new FrlError(`FRL API responded ${res.status}`, res.status);
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      // A request that ran out of time will run out of time again; retrying it
      // only doubles the wait before the caller hears about it.
      if (e instanceof Error && e.name === 'TimeoutError') break;
    }
  }
  const reason = last instanceof Error ? last.message : String(last);
  throw new FrlError(`could not reach the Federal Register of Legislation API (${reason}) for ${path}`);
}

export async function readBody(res: Response, cap: number, what: string): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    throw new FrlError(`the ${what} response declares ${declared} bytes, above the ${cap} byte limit`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw new FrlError(`the ${what} response exceeded ${cap} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function getJson<T>(path: string, ttl: number): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const res = await request(path);
  if (!res.ok) {
    let detail = '';
    try {
      const body = JSON.parse(decoder.decode(await readBody(res, MAX_ERROR_BYTES, 'error'))) as {
        error?: { message?: string };
      };
      detail = body.error?.message ? `: ${body.error.message}` : '';
    } catch {}
    throw new FrlError(`FRL API responded ${res.status} for ${path}${detail}`, res.status);
  }
  const raw = await readBody(res, MAX_JSON_BYTES, 'register');
  return remember(path, JSON.parse(decoder.decode(raw)) as T, raw.byteLength);
}

function quoted(value: string): string {
  const out = value.replace(/'/g, "''").replace(/"/g, '');
  if (out.trim() === '') throw new FrlError('the search query is empty once quoting characters are removed');
  return out;
}

// Title ids sit in the URL path, so a stray %, # or ? would truncate or
// corrupt the request rather than produce a clean "no such title".
function pathId(titleId: string): string {
  if (!/^[A-Za-z0-9]+$/.test(titleId)) {
    throw new FrlError(`"${titleId}" is not a register title id (letters and digits only, e.g. C2004A03348)`);
  }
  return titleId;
}

// Member order is the enum's, from the service $metadata.
const STATUS = ['InForce', 'Ceased', 'Repealed', 'NeverEffective'];
const AFFECT = ['AsMade', 'Amend', 'Repeal', 'Cease', 'ChangeDate', 'Disallow'];

function named(members: string[], value: unknown): string {
  if (typeof value === 'number') return members[value] ?? String(value);
  return typeof value === 'string' ? value : '';
}

function nameReasons(reasons: Reason[] | undefined): void {
  for (const r of reasons ?? []) r.affect = named(AFFECT, r.affect);
}

function nameTitleEnums<T extends Title>(title: T): T {
  title.status = named(STATUS, title.status);
  for (const entry of title.statusHistory ?? []) {
    entry.status = named(STATUS, entry.status);
    nameReasons(entry.reasons);
  }
  return title;
}

function nameVersionEnums(version: Version): Version {
  version.status = named(STATUS, version.status);
  nameReasons(version.reasons);
  return version;
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
  byName = false,
): Promise<SearchResult> {
  const criteria = encodeURIComponent(`text("${quoted(query)}",${searchType},${match})`);
  const expand = encodeURIComponent('searchContexts($expand=text,fullTextVersion)');
  const order = byName ? `&$orderby=${encodeURIComponent('name asc')}` : '';
  const path = `/titles/search(criteria='${criteria}')?$top=${Math.min(top, 100)}&$count=true&$expand=${expand}${order}`;
  const data = await getJson<ODataList<Title>>(path, HOUR);
  return { count: data['@odata.count'] ?? data.value.length, titles: data.value.map(nameTitleEnums) };
}

export async function amendingTitles(titleId: string, top = 15): Promise<SearchResult> {
  const criteria = encodeURIComponent(`affectedby("${quoted(titleId)}",[amending])`);
  const path = `/titles/search(criteria='${criteria}')?$top=${Math.min(top, 100)}&$count=true`;
  const data = await getJson<ODataList<Title>>(path, HOUR);
  return { count: data['@odata.count'] ?? data.value.length, titles: data.value.map(nameTitleEnums) };
}

export async function getTitle(titleId: string): Promise<Title | null> {
  try {
    return nameTitleEnums(await getJson<Title>(`/Titles('${pathId(titleId)}')`, HOUR));
  } catch (e) {
    // pathId has already rejected anything that is not id-shaped, so the 400
    // the register answers for an unknown id means exactly "no such title".
    if (e instanceof FrlError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The register answers 404 for a calendar-impossible date, which findVersion
// would otherwise report as "no version was in force then" — a statement
// about a day that does not exist.
export function assertDate(date: string): string {
  const m = DATE.exec(date);
  if (!m) throw new FrlError(`date must be yyyy-mm-dd, got "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== mo - 1 || parsed.getUTCDate() !== d) {
    throw new FrlError(`"${date}" is not a real calendar date`);
  }
  if (y < 1901) throw new FrlError(`"${date}" predates federation; the register starts in 1901`);
  return date;
}

export async function findVersion(titleId: string, asAt?: string): Promise<Version | null> {
  const selector = asAt ? `asAt=${assertDate(asAt)}T00:00:00` : `asAtSpecification='Latest'`;
  try {
    return nameVersionEnums(
      await getJson<Version>(`/Versions/Find(titleId='${pathId(titleId)}',${selector})`, asAt ? 24 * HOUR : HOUR),
    );
  } catch (e) {
    if (e instanceof FrlError && e.status === 404) return null;
    throw e;
  }
}

// The API caps $top at 100.
export async function listVersions(titleId: string, top = 100, order: 'asc' | 'desc' = 'desc'): Promise<Version[]> {
  const filter = encodeURIComponent(`titleId eq '${pathId(titleId)}'`);
  const orderBy = encodeURIComponent(`start ${order}`);
  const data = await getJson<ODataList<Version>>(
    `/Versions?$filter=${filter}&$orderby=${orderBy}&$top=${Math.min(top, 100)}`,
    HOUR,
  );
  return data.value.map(nameVersionEnums);
}

export async function earliestVersion(titleId: string): Promise<Version | null> {
  const rows = await listVersions(titleId, 1, 'asc');
  return rows[0] ?? null;
}

export async function getEpub(titleId: string, asAt?: string): Promise<Uint8Array> {
  const selector = asAt ? `asat=${assertDate(asAt)}` : `asatspecification='Latest'`;
  const path =
    `/documents/find(titleid='${pathId(titleId)}',${selector},type='Primary',` +
    `format='Epub',uniqueTypeNumber=0,volumeNumber=0,rectificationVersionNumber=0)`;
  const res = await request(path);
  if (!res.ok) throw new FrlError(`FRL API responded ${res.status} for the ${titleId} document`, res.status);
  return readBody(res, MAX_EPUB_BYTES, `${titleId} document`);
}

export async function ping(): Promise<{ ms: number; release: string | null }> {
  const started = Date.now();
  const res = await request('/titles?$top=1');
  if (!res.ok) throw new FrlError(`FRL API responded ${res.status}`, res.status);
  await readBody(res, MAX_JSON_BYTES, 'register');
  return { ms: Date.now() - started, release: res.headers.get('x-frl-version') };
}
