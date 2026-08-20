// Turns an FRL epub into provision-level text.
//
// The register serves whole-document epubs only (no provision endpoint), but
// the generated XHTML is regular: every piece of content is a block whose
// class, or tag, says what it is.
//
// Quirks that the parsing has to survive, all confirmed against live epubs:
// - there are two epub generations. Compilations from about 2005 onwards mark
//   headings as <p class="ActHeadN">; older ones, which include every
//   compilation of a long-repealed act, use <hN> with no class at all. A
//   document is one generation or the other, never both, so mapping <hN> onto
//   ActHeadN cannot double-count
// - a section number is split across consecutive <span class="CharSectno">
//   spans, so "50-5" arrives as "50", U+2011, "5" and must be rejoined
// - the dash inside a section number is a non-breaking hyphen (U+2011), not
//   the hyphen a caller will type
// - Schedules carry operative content (the rate tables live there) under
//   ActHead1/<h1> headings with no section numbers at all
// - statutory formulas are images whose alt text is the formula
// - a multi-volume epub is several document_N.html files that the register
//   does not order logically, each with its own endnotes, so the endnote
//   latch has to reset per document

import { unzipSync } from 'fflate';

export interface Provision {
  no: string;
  heading: string;
  context: string;
  body: string;
}

export interface ActText {
  provisions: Provision[];
  endnotes: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function textOf(inner: string): string {
  const withFormulas = inner.replace(/<img\b[^>]*?\balt="([^"]*)"[^>]*>/gi, ' $1 ');
  return decodeEntities(withFormulas.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

export interface Block {
  cls: string;
  sectNo: string | null;
  heading: string;
  text: string;
}

const SECTNO_SPAN = /<span class="CharSectno">([\s\S]*?)<\/span>/g;

export function htmlBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const re = /<(p|h[1-6])\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tag = (m[1] ?? '').toLowerCase();
    const attrs = m[2] ?? '';
    const inner = m[3] ?? '';
    const level = /^h([1-6])$/.exec(tag);
    const cls =
      /class="([^"]*)"/.exec(attrs)?.[1] ??
      (level ? `ActHead${Math.min(Number(level[1]), 5)}` : '');
    const parts = [...inner.matchAll(SECTNO_SPAN)].map((s) => textOf(s[1] ?? ''));
    const sectNo = parts.length > 0 ? parts.join('') : null;
    const text = textOf(inner);
    const heading = textOf(inner.replace(SECTNO_SPAN, ''));
    if (!text && !sectNo) continue;
    blocks.push({ cls, sectNo: sectNo || null, heading, text });
  }
  return blocks;
}

export function epubDocuments(epub: Uint8Array): string[] {
  const files = unzipSync(epub);
  const names = Object.keys(files)
    .filter((n) => /^OEBPS\/document_\d+\/document_\d+\.html$/.test(n))
    .sort((a, b) => Number(/_(\d+)\//.exec(a)?.[1]) - Number(/_(\d+)\//.exec(b)?.[1]));
  if (names.length === 0) throw new Error('no document html found inside the epub');
  const decoder = new TextDecoder();
  return names.map((n) => decoder.decode(files[n]));
}

export function epubToHtml(epub: Uint8Array): string {
  return epubDocuments(epub).join('\n');
}

const SKIP = /^(TOC\d*|Header|ShortT|Tabbing|UpdateDate)$/;
const SCHEDULE = /^(Schedule\s*[\w]+)\s*(?:[—–-]\s*)?(.*)$/i;
// Where the operative text stops and the compilation's own notes begin. The
// modern generation opens them with ENote*; the older one opens them with
// "Notes to the <act>" and then runs tables of acts and amendments.
const ENDNOTE = /^(ENote|EndNote|NotesSection|TableOf|ActNotes)/;

function parseDocument(html: string, provisions: Provision[], endnoteLines: string[]): void {
  const context: string[] = [];
  let current: Provision | null = null;
  let inSchedule = false;
  let inEndnotes = false;

  function open(no: string, heading: string): Provision {
    const p: Provision = { no, heading, context: context.filter(Boolean).join(' > '), body: '' };
    provisions.push(p);
    return p;
  }

  for (const block of htmlBlocks(html)) {
    if (SKIP.test(block.cls)) continue;
    if (ENDNOTE.test(block.cls)) {
      inEndnotes = true;
      current = null;
      if (block.text) endnoteLines.push(block.text);
      continue;
    }
    if (inEndnotes) {
      if (block.text) endnoteLines.push(block.text);
      continue;
    }

    const head = /^ActHead([1-5])$/.exec(block.cls);
    if (head) {
      const depth = Number(head[1]);
      if (depth === 5 && block.sectNo) {
        current = open(block.sectNo, block.heading);
        continue;
      }
      const schedule = depth === 1 ? SCHEDULE.exec(block.text) : null;
      if (schedule) {
        // A Schedule is where rate tables and forms live; treat the whole
        // schedule as one addressable provision rather than dropping it.
        context.length = 0;
        inSchedule = true;
        current = open((schedule[1] ?? block.text).replace(/\s+/g, ' '), schedule[2] ?? '');
        continue;
      }
      if (inSchedule && depth > 1) {
        // Parts and Divisions inside a schedule are section-less headings, so
        // they belong in the schedule body.
        if (current && block.text) current.body += (current.body ? '\n' : '') + block.text;
        continue;
      }
      context.length = depth - 1;
      context[depth - 1] = block.text;
      inSchedule = false;
      current = null;
      continue;
    }

    if (current && block.text) {
      current.body += (current.body ? '\n' : '') + block.text;
    }
  }
}

// The register's third and oldest generation: as-made scans of acts from 1901
// into the 1970s, converted to XHTML with no structural markup whatsoever —
// no ActHead classes, no heading tags, no CharSectno. The only section
// boundary left is the prose: a marginal note, then a paragraph opening
// "3.—(1.)". Reading that wrong would file one section's words under another
// section's number, so what it recovers is accepted only if the numbers run
// strictly upwards; anything else is treated as unreadable.
const FLAT_SECTION = /^(\d{1,4}[A-Z]{0,3})\s*\.\s*(?:[—–-]\s*)?(?:\(\s*\d+[A-Za-z]?\s*\.?\s*\)\s*)?(?=[A-Z“"'(])/;
const FLAT_SCHEDULE = /^(?:THE\s+)?(SCHEDULES?|FIRST\s+SCHEDULE|SECOND\s+SCHEDULE|Schedules?)\b/;

function sortsAfter(a: string, b: string): boolean {
  const [an, as] = [parseInt(a, 10), a.replace(/^\d+/, '')];
  const [bn, bs] = [parseInt(b, 10), b.replace(/^\d+/, '')];
  return bn > an || (bn === an && bs > as);
}

function parseFlatDocument(html: string): Provision[] {
  const texts = htmlBlocks(html)
    .filter((b) => !SKIP.test(b.cls) && b.text)
    .map((b) => b.text);
  // First decide where the sections and schedules start, so that a marginal
  // note is never also read as body text of the section above it.
  const opens = new Map<number, string>();
  let last = '';
  let sections = 0;
  let schedules = 0;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!;
    if (schedules === 0) {
      const m = FLAT_SECTION.exec(text);
      if (m && (last === '' || sortsAfter(last, m[1]!))) {
        opens.set(i, m[1]!);
        last = m[1]!;
        sections++;
        continue;
      }
    }
    // The word "Schedules" also appears in these documents' tables of contents
    // and in compilation notes, either of which would otherwise swallow the
    // rest of the act. A real schedule comes after the sections.
    if (sections >= 2 && text.length < 60 && FLAT_SCHEDULE.test(text)) {
      opens.set(i, `Schedule${schedules === 0 ? '' : ` ${schedules + 1}`}`);
      schedules++;
    }
  }
  // An as-made act opens at section 1. Anything else means these numbers came
  // from a table or a set of notes, not from the act's own structure.
  if (sections < 2 || [...opens.values()][0] !== '1') return [];
  const out: Provision[] = [];
  let current: Provision | null = null;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!;
    const no = opens.get(i);
    if (no !== undefined) {
      const prior = texts[i - 1];
      // A marginal note is a short label. A run-on subsection like "(3.) The
      // Principal Act ..." is the tail of the section above, not a heading.
      const marginal =
        i > 0 && prior !== undefined && !opens.has(i - 1) && prior.length <= 120 && /^[A-Z“"']/.test(prior);
      current = {
        no,
        heading: no.startsWith('Schedule') ? text : marginal ? prior!.replace(/\.$/, '') : '',
        context: '',
        body: no.startsWith('Schedule') ? '' : text,
      };
      if (marginal && !no.startsWith('Schedule') && out.length > 0) {
        const above = out[out.length - 1]!;
        // Take the marginal note back off the previous section's body.
        if (above.body.endsWith(prior!)) above.body = above.body.slice(0, -prior!.length).replace(/\n$/, '');
      }
      out.push(current);
      continue;
    }
    if (current) current.body += (current.body ? '\n' : '') + text;
  }
  return out.filter((p) => p.body).length >= 2 ? out : [];
}

export function parseAct(html: string | string[]): ActText {
  const docs = Array.isArray(html) ? html : [html];
  const provisions: Provision[] = [];
  const endnoteLines: string[] = [];
  for (const doc of docs) {
    parseDocument(doc, provisions, endnoteLines);
  }
  if (provisions.length === 0) {
    for (const doc of docs) provisions.push(...parseFlatDocument(doc));
  }
  return { provisions, endnotes: endnoteLines.join('\n') };
}

// The register writes section numbers with a non-breaking hyphen; callers type
// an ordinary one. Dots are significant (reg 1.05 is not section 105).
export function normaliseSectionNo(no: string): string {
  return no
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^(?:ss?|sect(?:ion)?|reg(?:ulation)?|r|cl(?:ause)?)\.?(?=\d|Schedule)/i, '')
    .toUpperCase();
}

export function findProvision(act: ActText, sectionNo: string): Provision | null {
  const want = normaliseSectionNo(sectionNo);
  return act.provisions.find((p) => normaliseSectionNo(p.no) === want) ?? null;
}

export function nearest(act: ActText, sectionNo: string, count = 3): Provision[] {
  const want = normaliseSectionNo(sectionNo);
  const wantNum = parseFloat(want);
  if (Number.isNaN(wantNum)) return act.provisions.slice(0, count);
  return [...act.provisions]
    .map((p) => {
      const n = parseFloat(normaliseSectionNo(p.no));
      return { p, distance: Number.isNaN(n) ? Infinity : Math.abs(n - wantNum) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((x) => x.p);
}

export interface DiffLine {
  kind: ' ' | '-' | '+';
  text: string;
}

// The LCS table is quadratic, so it gets a cell budget. 12M cells is ~48 MB of
// Int32Array held for the length of one call.
const MAX_CELLS = 12_000_000;

function lcsDiff(al: string[], bl: string[]): DiffLine[] {
  const w = bl.length + 1;
  const lcs = new Int32Array((al.length + 1) * w);
  for (let i = al.length - 1; i >= 0; i--) {
    for (let j = bl.length - 1; j >= 0; j--) {
      lcs[i * w + j] =
        al[i] === bl[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < al.length && j < bl.length) {
    if (al[i] === bl[j]) {
      out.push({ kind: ' ', text: al[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      out.push({ kind: '-', text: al[i]! });
      i++;
    } else {
      out.push({ kind: '+', text: bl[j]! });
      j++;
    }
  }
  while (i < al.length) out.push({ kind: '-', text: al[i++]! });
  while (j < bl.length) out.push({ kind: '+', text: bl[j++]! });
  return out;
}

// Past the budget, fall back to attributing each line to the version that
// holds it. Not a minimal edit script, but no line is credited to the wrong
// version, which is the property that matters for legal text. Reached only by
// provisions like ITAA 1997 s 995-1, which is 3,000 lines of definitions.
function coarseDiff(al: string[], bl: string[]): DiffLine[] {
  const spare = new Map<string, number>();
  for (const line of bl) spare.set(line, (spare.get(line) ?? 0) + 1);
  const out: DiffLine[] = [];
  const shared = new Map<string, number>();
  for (const line of al) {
    const left = spare.get(line) ?? 0;
    if (left > 0) {
      spare.set(line, left - 1);
      shared.set(line, (shared.get(line) ?? 0) + 1);
      out.push({ kind: ' ', text: line });
    } else {
      out.push({ kind: '-', text: line });
    }
  }
  for (const line of bl) {
    const claimed = shared.get(line) ?? 0;
    if (claimed > 0) shared.set(line, claimed - 1);
    else out.push({ kind: '+', text: line });
  }
  return out;
}

export function diffLines(a: string, b: string): DiffLine[] {
  const al = a.split('\n');
  const bl = b.split('\n');
  // An amendment touches a small part of a long provision, so trimming the
  // identical head and tail usually brings the table under budget on its own.
  let head = 0;
  while (head < al.length && head < bl.length && al[head] === bl[head]) head++;
  let tail = 0;
  while (
    tail < al.length - head &&
    tail < bl.length - head &&
    al[al.length - 1 - tail] === bl[bl.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = al.slice(head, al.length - tail);
  const midB = bl.slice(head, bl.length - tail);
  const middle = midA.length * midB.length > MAX_CELLS ? coarseDiff(midA, midB) : lcsDiff(midA, midB);
  return [
    ...al.slice(0, head).map((text): DiffLine => ({ kind: ' ', text })),
    ...middle,
    ...al.slice(al.length - tail).map((text): DiffLine => ({ kind: ' ', text })),
  ];
}
