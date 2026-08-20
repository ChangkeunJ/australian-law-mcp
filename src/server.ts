import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as frl from './frl.js';
import { parseCitations } from './cite.js';
import {
  type ActText,
  type Provision,
  diffLines,
  epubDocuments,
  findProvision,
  nearest,
  parseAct,
} from './text.js';

const VERSION = '0.1.0';
const PAGE_SIZE = 5000;

// The register's terms require this exact attribution wording for changed
// content, a link to the source page and a licence link.
// https://www.legislation.gov.au/terms-of-use
function attribution(): string {
  const today = new Date().toISOString().slice(0, 10);
  return (
    `Based on content from the Federal Register of Legislation at ${today}. ` +
    'For the latest information on Australian Government legislation please go to ' +
    'https://www.legislation.gov.au. Licence: CC BY 4.0 ' +
    '(https://creativecommons.org/licenses/by/4.0/). Not legal advice; the authorised ' +
    'version is the one published on the register.'
  );
}

function webLink(titleId: string): string {
  return `https://www.legislation.gov.au/${titleId}`;
}

function paginate(text: string, page = 1): string {
  const pages = Math.max(1, Math.ceil(text.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.trunc(page)), pages);
  const slice = text.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  if (pages === 1) return slice;
  // Inviting a page past the last one sends the caller round a loop: the
  // request clamps back and returns this same instruction.
  const more = current < pages ? ` — request page=${current + 1} to continue` : ' — end of text';
  return `${slice}\n\n[page ${current} of ${pages}${more}]`;
}

function statusLabel(t: frl.Title): string {
  const bits = [t.collection];
  if (t.isPrincipal) bits.push('principal');
  bits.push(t.isInForce ? 'in force' : t.status.toUpperCase());
  if (t.hasCommencedUnincorporatedAmendments) bits.push('amendments commenced but not yet incorporated');
  return bits.filter(Boolean).join(', ');
}

// Keyed by register id, not by title and date: a register id names one
// immutable compilation, so a newly published compilation can never be served
// under the previous one's text.
//
// Counting entries is not enough to bound this: one parsed ITAA 1997 is ~90 MB
// while a short instrument is a few kilobytes, so the character budget is what
// actually keeps a long-lived stdio process from pinning half a gigabyte.
const CACHE_ENTRIES = 8;
const CACHE_CHARS = 12_000_000;
const actCache = new Map<string, ActText>();
const actChars = new Map<string, number>();
const fullBody = new WeakMap<ActText, string>();
let cachedChars = 0;

function sizeOf(act: ActText): number {
  let n = act.endnotes.length;
  for (const p of act.provisions) n += p.no.length + p.heading.length + p.body.length;
  return n;
}

async function loadAct(version: frl.Version, asAt?: string): Promise<ActText> {
  const hit = actCache.get(version.registerId);
  if (hit) return hit;
  const act = parseAct(epubDocuments(await frl.getEpub(version.titleId, asAt)));
  const size = sizeOf(act);
  actCache.set(version.registerId, act);
  actChars.set(version.registerId, size);
  cachedChars += size;
  while (actCache.size > 1 && (actCache.size > CACHE_ENTRIES || cachedChars > CACHE_CHARS)) {
    const oldest = actCache.keys().next().value;
    if (oldest === undefined) break;
    actCache.delete(oldest);
    cachedChars -= actChars.get(oldest) ?? 0;
    actChars.delete(oldest);
  }
  return act;
}

// Joining 4,649 provisions into a 7 MB string on every page request is the
// whole cost of reading a large act page by page, so it is done once.
function fullText(act: ActText): string {
  let body = fullBody.get(act);
  if (body === undefined) {
    body = act.provisions.map((p) => `${label(p)}  ${p.heading}\n${p.body}`).join('\n\n');
    fullBody.set(act, body);
  }
  return body;
}

// A compilation whose text would not break into provisions must never be
// answered as a law that has no sections. That is a false statement about the
// law, and it is the one failure this server cannot afford.
function unparsed(v: frl.Version): string {
  return (
    `The text of this compilation (register id ${v.registerId}) could not be broken into numbered ` +
    `provisions, so nothing about its sections can be reported here. This is a limitation of this ` +
    `tool, not a statement about the law. Read it on the register: ${webLink(v.titleId)}`
  );
}

function versionHeader(v: frl.Version): string {
  const lines = [
    `${v.name} [${v.titleId}]`,
    `Compilation No. ${v.compilationNumber ?? '?'} (register id ${v.registerId}), in force from ${v.start.slice(0, 10)}` +
      (v.end ? ` to ${v.end.slice(0, 10)}` : '') +
      `. Status: ${v.status}.`,
  ];
  if (v.hasUnincorporatedAmendments) {
    lines.push('Warning: amendments have commenced that this compilation does not yet incorporate.');
  }
  lines.push(`Source: ${webLink(v.titleId)}`);
  return lines.join('\n');
}

// Schedules are provisions too, but they are cited by name rather than as
// "section N".
function label(p: Provision): string {
  return /^Schedule/i.test(p.no) ? p.no : `s ${p.no}`;
}

function counts(act: ActText): string {
  const schedules = act.provisions.filter((p) => /^Schedule/i.test(p.no)).length;
  const sections = act.provisions.length - schedules;
  return schedules > 0 ? `${sections} sections and ${schedules} schedules` : `${sections} sections`;
}

function tocOf(act: ActText): string {
  if (act.provisions.length === 0) return 'No numbered provisions found in this document.';
  return act.provisions.map((p) => `${label(p)}  ${p.heading}`).join('\n');
}

function provisionText(act: ActText, section: string): string | null {
  const p = findProvision(act, section);
  if (!p) return null;
  const head = p.context ? `${p.context}\n` : '';
  return `${head}${label(p)}  ${p.heading}\n\n${p.body}`;
}

function missingSection(act: ActText, section: string): string {
  const close = nearest(act, section)
    .map((p) => `${label(p)} (${p.heading})`)
    .join(', ');
  return (
    `Provision ${section} was not found in this compilation. It has ${counts(act)}.` +
    (close ? ` Closest by number: ${close}.` : '')
  );
}

const KEYWORD = /\b(act|regulations?|rules|code|determination)\b/i;
const EMPTY: frl.SearchResult = { count: 0, titles: [] };

type Args = Record<string, unknown>;

function tool(fn: (args: Args) => Promise<string>) {
  return async (args: Args) => {
    try {
      return { content: [{ type: 'text' as const, text: await fn(args) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
    }
  };
}

const readOnly = { readOnlyHint: true, openWorldHint: true };

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'australian-law-mcp', version: VERSION },
    {
      instructions:
        'Australian Commonwealth legislation from the Federal Register of Legislation. ' +
        'Use search_law to find a title id, get_law_text to read sections, get_law_as_at for the text ' +
        'in force on a past date, and verify_citations to check statute citations before presenting them.',
    },
  );

  server.registerTool(
    'search_law',
    {
      title: 'Search Australian legislation by name',
      description:
        'Finds Commonwealth acts and legislative instruments on the Federal Register of Legislation by title. ' +
        'Returns title ids for the other tools. Falls back to full-text matching when nothing matches by name.',
      inputSchema: z.object({
        query: z.string().min(2).describe('Words from the title, e.g. "income tax rates"'),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: readOnly,
    },
    tool(async (args) => {
      const query = (args.query as string).replace(/[,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
      const limit = (args.limit as number | undefined) ?? 10;
      const wanted = query.toLowerCase();
      // The register orders a name search by a relevance that is flat across
      // every title containing the words, so "migration" buries the Migration
      // Act 1958 beneath two thousand amending acts and instruments and no
      // amount of local ranking over the first page recovers it. Anchoring a
      // second search on the opening words plus the title keyword narrows the
      // set to something a page can hold, and the two are merged and ranked
      // here.
      const anchor = KEYWORD.test(query) ? query : `${query} act`;
      const [broad, narrow] = await Promise.all([
        frl.searchTitles(query, 'name', 'all', 100),
        frl.searchTitles(anchor, 'name', 'startswith', 100, true).catch(() => EMPTY),
      ]);
      let pool = [...narrow.titles, ...broad.titles];
      let note = '';
      if (pool.length === 0) {
        const text = await frl.searchTitles(query, 'nameAndText', 'all', 50);
        pool = text.titles;
        note = 'No title-name match; showing full-text matches instead.\n\n';
        if (pool.length === 0) return `No titles match "${query}" on the register.`;
      }
      const seen = new Set<string>();
      const unique = pool.filter((t) => !seen.has(t.id) && seen.add(t.id));
      const principal = new RegExp(
        `^${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (act|regulations?|rules|code|determination)\\b.*\\d{4}$`,
        'i',
      );
      const score = (t: frl.Title) => {
        const name = t.name.replace(/\s+/g, ' ').toLowerCase();
        return (
          (name === wanted ? 1000 : 0) +
          (principal.test(name) ? 500 : 0) +
          (t.isPrincipal ? 100 : 0) +
          (name.startsWith(wanted) ? 50 : 0) +
          (t.isInForce ? 10 : 0) -
          name.length / 1000
        );
      };
      const ranked = [...unique].sort((a, b) => score(b) - score(a)).slice(0, limit);
      const rows = ranked.map((t) => `${t.id}  ${t.name}  [${statusLabel(t)}]`);
      // The register will not filter or order this search usefully, so say how
      // much of it was actually ranked rather than implying all of it was.
      const scope =
        broad.count > unique.length
          ? `${broad.count} titles match "${query}"; ranked the ${unique.length} the register returned first`
          : `${unique.length} titles match "${query}"`;
      return `${note}${scope} (showing ${rows.length}):\n${rows.join('\n')}`;
    }),
  );

  server.registerTool(
    'get_law_text',
    {
      title: 'Read the current text of an act',
      description:
        'Returns the latest compilation of a Commonwealth act or instrument. Without a section number it lists ' +
        'the table of sections; with one it returns that provision. Set full=true for the whole text, paginated.',
      inputSchema: z.object({
        titleId: z.string().describe('Register title id, e.g. C2004A03348'),
        section: z.string().optional().describe('Section number, e.g. "3A" or "90-5"'),
        full: z.boolean().optional().describe('Return the full text instead of the table of sections'),
        page: z.number().int().min(1).optional(),
      }),
      annotations: readOnly,
    },
    tool(async (args) => {
      const titleId = args.titleId as string;
      const version = await frl.findVersion(titleId);
      if (!version) return `No version of ${titleId} found on the register.`;
      const act = await loadAct(version);
      let body: string;
      if (act.provisions.length === 0) {
        body = unparsed(version);
      } else if (args.section) {
        body = provisionText(act, args.section as string) ?? missingSection(act, args.section as string);
      } else if (args.full) {
        body = fullText(act);
      } else {
        body = `Table of sections (pass section="..." for text):\n${tocOf(act)}`;
      }
      return `${versionHeader(version)}\n\n${paginate(body, args.page as number | undefined)}\n\n${attribution()}`;
    }),
  );

  server.registerTool(
    'get_law_as_at',
    {
      title: 'Read an act as it stood on a date',
      description:
        'Returns the compilation of a Commonwealth act that was in force on the given date — the register keeps ' +
        'every historical version. Same output shape as get_law_text.',
      inputSchema: z.object({
        titleId: z.string(),
        date: z.string().describe('yyyy-mm-dd'),
        section: z.string().optional(),
        full: z.boolean().optional(),
        page: z.number().int().min(1).optional(),
      }),
      annotations: readOnly,
    },
    tool(async (args) => {
      const titleId = args.titleId as string;
      const date = frl.assertDate(args.date as string);
      const version = await frl.findVersion(titleId, date);
      if (!version) {
        const earliest = await frl.earliestVersion(titleId);
        return earliest
          ? `No version of ${titleId} was in force on ${date}. The earliest version on the register starts ${earliest.start.slice(0, 10)}.`
          : `No versions of ${titleId} found on the register.`;
      }
      const act = await loadAct(version, date);
      let body: string;
      if (act.provisions.length === 0) {
        body = unparsed(version);
      } else if (args.section) {
        body = provisionText(act, args.section as string) ?? missingSection(act, args.section as string);
      } else if (args.full) {
        body = fullText(act);
      } else {
        body = `Table of sections as at ${date} (pass section="..." for text):\n${tocOf(act)}`;
      }
      return `As at ${date}:\n${versionHeader(version)}\n\n${paginate(body, args.page as number | undefined)}\n\n${attribution()}`;
    }),
  );

  server.registerTool(
    'get_amendment_status',
    {
      title: 'Amendment status of an act',
      description:
        'Reports whether a title is in force, what its latest compilation incorporates, whether commenced ' +
        'amendments are still unincorporated, and which acts have amended it.',
      inputSchema: z.object({ titleId: z.string() }),
      annotations: readOnly,
    },
    tool(async (args) => {
      const titleId = args.titleId as string;
      const title = await frl.getTitle(titleId);
      if (!title) return `No title ${titleId} on the register.`;
      const lines = [`${title.name} [${title.id}] — ${statusLabel(title)}`];
      for (const entry of title.statusHistory ?? []) {
        const why = entry.reasons
          .map((r) => `${r.affect}${r.affectedByTitle ? ` by ${r.affectedByTitle.name} [${r.affectedByTitle.titleId}]` : ''}`)
          .join('; ');
        lines.push(`  ${entry.start.slice(0, 10)}: ${entry.status}${why ? ` (${why})` : ''}`);
      }
      const version = await frl.findVersion(titleId);
      if (version) {
        lines.push('');
        lines.push(
          `Latest compilation: No. ${version.compilationNumber ?? '?'} (${version.registerId}), in force from ` +
            version.start.slice(0, 10) +
            (version.end ? ` to ${version.end.slice(0, 10)}` : '') +
            '.',
        );
        for (const r of version.reasons ?? []) {
          if (r.affectedByTitle) {
            lines.push(
              `  Incorporates: ${r.affectedByTitle.provisions ?? r.affect} of ${r.affectedByTitle.name} [${r.affectedByTitle.titleId}]`,
            );
          }
        }
        if (version.hasUnincorporatedAmendments) {
          lines.push('  Warning: commenced amendments are not yet incorporated in this compilation.');
        }
      }
      const amending = await frl.amendingTitles(titleId, 15);
      if (amending.count > 0) {
        lines.push('');
        lines.push(`Amended by ${amending.count} titles. Most relevant:`);
        for (const t of amending.titles) lines.push(`  ${t.id}  ${t.name}`);
      }
      lines.push('', `Source: ${webLink(titleId)}`, attribution());
      return lines.join('\n');
    }),
  );

  server.registerTool(
    'compare_versions',
    {
      title: 'Compare an act between two dates',
      description:
        'Shows what changed in an act between two dates: which sections were added, removed or reworded. ' +
        'Give a section number for a line-by-line diff of that provision.',
      inputSchema: z.object({
        titleId: z.string(),
        dateA: z.string().describe('yyyy-mm-dd, the earlier date'),
        dateB: z.string().describe('yyyy-mm-dd, the later date'),
        section: z.string().optional(),
        page: z.number().int().min(1).optional(),
      }),
      annotations: readOnly,
    },
    tool(async (args) => {
      const titleId = args.titleId as string;
      const dateA = frl.assertDate(args.dateA as string);
      const dateB = frl.assertDate(args.dateB as string);
      // Added and removed are read off the direction of travel, so taking the
      // dates in the wrong order would report every insertion as a repeal.
      if (dateA > dateB) {
        throw new Error(`dateA (${dateA}) must be on or before dateB (${dateB}), or the changes are reported backwards`);
      }
      const [va, vb] = await Promise.all([frl.findVersion(titleId, dateA), frl.findVersion(titleId, dateB)]);
      if (!va || !vb) {
        return `No version in force on ${!va ? dateA : dateB} for ${titleId}.`;
      }
      const intro =
        `${va.name} [${titleId}]\n` +
        `${dateA}: Compilation No. ${va.compilationNumber ?? '?'} (${va.registerId})\n` +
        `${dateB}: Compilation No. ${vb.compilationNumber ?? '?'} (${vb.registerId})`;
      if (va.registerId === vb.registerId) {
        return `${intro}\n\nSame compilation was in force on both dates — no textual change between them.`;
      }
      const [actA, actB] = await Promise.all([loadAct(va, dateA), loadAct(vb, dateB)]);
      // Diffing against an empty side would present the entire act as newly
      // enacted, which reads as a sweeping amendment that never happened.
      if (actA.provisions.length === 0 || actB.provisions.length === 0) {
        const side = actA.provisions.length === 0 ? va : vb;
        return `${intro}\n\n${unparsed(side)}\nNo comparison is possible while one side cannot be read.`;
      }
      if (args.section) {
        const a = findProvision(actA, args.section as string);
        const b = findProvision(actB, args.section as string);
        if (!a && !b) return `${intro}\n\nSection ${args.section} exists in neither version.`;
        if (!a) return `${intro}\n\nSection ${args.section} did not exist on ${dateA}; on ${dateB}:\n\n${b!.body}\n\n${attribution()}`;
        if (!b) return `${intro}\n\nSection ${args.section} existed on ${dateA} but not on ${dateB}. Text on ${dateA}:\n\n${a.body}\n\n${attribution()}`;
        const diff = diffLines(`${a.heading}\n${a.body}`, `${b.heading}\n${b.body}`);
        const changed = diff.some((d) => d.kind !== ' ');
        const rendered = changed
          ? diff.map((d) => `${d.kind} ${d.text}`).join('\n')
          : 'No change to this section between the two dates.';
        const page = paginate(`${label(a)}:\n${rendered}`, args.page as number | undefined);
        return `${intro}\n\n${page}\n\n${attribution()}`;
      }
      const byNo = (act: ActText) => new Map(act.provisions.map((p) => [p.no, p]));
      const mapA = byNo(actA);
      const mapB = byNo(actB);
      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];
      for (const [no, p] of mapB) {
        const old = mapA.get(no);
        if (!old) added.push(`+ ${label(p)}  ${p.heading}`);
        else if (old.body !== p.body || old.heading !== p.heading) changed.push(`~ ${label(p)}  ${p.heading}`);
      }
      for (const [no, p] of mapA) {
        if (!mapB.has(no)) removed.push(`- ${label(p)}  ${p.heading}`);
      }
      const summary =
        added.length + removed.length + changed.length === 0
          ? 'Different compilations, but no change at section level (formatting or endnote changes only).'
          : [...added, ...removed, ...changed].join('\n');
      const page = paginate(summary, args.page as number | undefined);
      return `${intro}\n\n${page}\n\nPass section="..." for a line-by-line diff.\n\n${attribution()}`;
    }),
  );

  server.registerTool(
    'verify_citations',
    {
      title: 'Check statute citations against the register',
      description:
        'Extracts Australian statute citations from text and checks each against the Federal Register of ' +
        'Legislation: does the act exist, is it still in force, does the cited section exist in the current ' +
        'compilation. Use before presenting legal citations to a user. An upstream failure is reported as ' +
        'UNVERIFIED, never as a missing law.',
      inputSchema: z.object({
        text: z.string().min(3).describe('Text containing the citations to check'),
      }),
      annotations: readOnly,
    },
    tool(async (args) => {
      const citations = parseCitations(args.text as string);
      if (citations.length === 0) {
        return 'No Australian statute citations recognised in the text (looked for act names ending in Act/Regulations/Rules + year).';
      }
      const out: string[] = [];
      for (const citation of citations) {
        let title: frl.Title | null = null;
        let fuzzy = false;
        try {
          let found = await frl.searchTitles(citation.act, 'name', 'exact', 5);
          if (found.count === 0) {
            found = await frl.searchTitles(citation.act, 'name', 'all', 5);
            fuzzy = true;
          }
          const wanted = citation.act.replace(/\s+/g, ' ').toLowerCase();
          title =
            found.titles.find((t) => t.name.replace(/\s+/g, ' ').toLowerCase() === wanted) ??
            found.titles[0] ??
            null;
          if (title && title.name.replace(/\s+/g, ' ').toLowerCase() !== wanted) fuzzy = true;
        } catch (e) {
          out.push(`[UNVERIFIED] ${citation.act} — register lookup failed (${e instanceof Error ? e.message : e}). Do not treat as nonexistent.`);
          continue;
        }
        if (!title) {
          out.push(`[NO MATCH] ${citation.act} — no such title found on the Federal Register of Legislation.`);
          continue;
        }
        const nameNote = fuzzy ? ` (closest register title, not an exact name match)` : '';
        if (!title.isInForce) {
          const repeal = (title.statusHistory ?? []).find((s) => s.status !== 'InForce');
          const why = repeal?.reasons?.[0]?.affectedByTitle
            ? ` by ${repeal.reasons[0].affectedByTitle.name}`
            : '';
          out.push(
            `[${title.status.toUpperCase()}] ${title.name} [${title.id}]${nameNote} — no longer in force${why}. A citation to it can only be historical.`,
          );
        } else {
          out.push(`[OK] ${title.name} [${title.id}]${nameNote} — in force.`);
        }
        if (citation.sections.length > 0) {
          try {
            const version = await frl.findVersion(title.id);
            if (!version) throw new Error('no current version on the register');
            const act = await loadAct(version);
            // Reporting a real provision as missing because the parse came
            // back empty is the one answer this tool promises never to give.
            if (act.provisions.length === 0) throw new Error(unparsed(version));
            for (const sec of citation.sections) {
              const p = findProvision(act, sec);
              out.push(
                p
                  ? `  [OK] ${label(p)} exists: "${p.heading}"`
                  : `  [NOT FOUND] s ${sec} — ${missingSection(act, sec)}`,
              );
            }
          } catch (e) {
            out.push(
              `  [UNVERIFIED] sections ${citation.sections.join(', ')} — could not check them ` +
                `(${e instanceof Error ? e.message : e}). Do not treat them as nonexistent.`,
            );
          }
        }
      }
      out.push('', attribution());
      return out.join('\n');
    }),
  );

  server.registerTool(
    'search_full_text',
    {
      title: 'Full-text search across all legislation',
      description:
        'Searches the body text of every act and instrument on the register for a phrase, ranked by relevance. ' +
        'Slower and broader than search_law.',
      inputSchema: z.object({
        phrase: z.string().min(3),
        match: z.enum(['exact', 'all', 'any']).optional().describe('exact = the phrase verbatim (default), all = every word, any = any word'),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: readOnly,
    },
    tool(async (args) => {
      const match = (args.match as frl.MatchType | undefined) ?? 'exact';
      const result = await frl.searchTitles(args.phrase as string, 'nameAndText', match, (args.limit as number | undefined) ?? 10);
      if (result.count === 0) return `Nothing on the register matches "${args.phrase}" (${match}).`;
      const rows = result.titles.map((t) => {
        const ctx = t.searchContexts?.fullTextVersion;
        const rel = t.searchContexts?.text?.relevance ?? ctx?.relevance;
        const where = ctx ? ` — matched in ${ctx.registerId}${ctx.isLatest ? ' (latest version)' : ' (historical version)'}` : '';
        return `${t.id}  ${t.name}  [${statusLabel(t)}]${rel ? `  relevance ${rel.toFixed(1)}` : ''}${where}`;
      });
      return `${result.count} matches (showing ${rows.length}):\n${rows.join('\n')}`;
    }),
  );

  server.registerTool(
    'check_frl_health',
    {
      title: 'Check the register API',
      description: 'Pings the Federal Register of Legislation API and reports latency, so failures elsewhere can be attributed.',
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    tool(async () => {
      const { ms, release } = await frl.ping();
      return `Federal Register of Legislation API is up: ${ms} ms round trip${release ? `, release ${release}` : ''}.`;
    }),
  );

  return server;
}
