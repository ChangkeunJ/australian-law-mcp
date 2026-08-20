// Turns an FRL epub into provision-level text.
//
// The register serves whole-document epubs only (no provision endpoint), but
// the generated XHTML is regular: every piece of content is a <p> whose class
// says what it is.
//
// Quirks that the parsing has to survive, all confirmed against live epubs:
// - a section number is split across consecutive <span class="CharSectno">
//   spans, so "50-5" arrives as "50", U+2011, "5" and must be rejoined
// - the dash inside a section number is a non-breaking hyphen (U+2011), not
//   the hyphen a caller will type
// - Schedules carry operative content (the rate tables live there) under
//   ActHead1/ActHead2 headings with no section numbers at all
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
  const re = /<p\b([^>]*?)(?:\/>|>([\s\S]*?)<\/p>)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
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

const SKIP = /^(TOC\d*|Header|ShortT|Tabbing)$/;
const SCHEDULE = /^(Schedule\s*[\w]+)\s*(?:[—–-]\s*)?(.*)$/i;

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
    if (block.cls.startsWith('ENote')) {
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

export function parseAct(html: string | string[]): ActText {
  const provisions: Provision[] = [];
  const endnoteLines: string[] = [];
  for (const doc of Array.isArray(html) ? html : [html]) {
    parseDocument(doc, provisions, endnoteLines);
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

// Plain LCS over lines. Sections are at most a few hundred lines, so the
// quadratic table is fine; compare_versions never diffs whole acts with this.
export function diffLines(a: string, b: string): DiffLine[] {
  const al = a.split('\n');
  const bl = b.split('\n');
  if (al.length * bl.length > 1_000_000) {
    throw new Error('diff too large; compare a single section instead');
  }
  const lcs: number[][] = Array.from({ length: al.length + 1 }, () => new Array<number>(bl.length + 1).fill(0));
  for (let i = al.length - 1; i >= 0; i--) {
    for (let j = bl.length - 1; j >= 0; j--) {
      lcs[i]![j] = al[i] === bl[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
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
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
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
