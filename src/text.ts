// Turns an FRL epub into provision-level text.
//
// The register serves whole-document epubs only (no provision endpoint), but
// the generated XHTML is regular: every piece of content is a <p> whose class
// says what it is. Sections start at <p class="ActHead5"> with the section
// number in <span class="CharSectno">; parts/divisions/chapters use
// ActHead1-4 with CharPartNo/CharDivNo/CharChapNo spans. Endnotes (ENote*)
// carry the amendment history tables and end the operative text.

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
  return decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

interface Block {
  cls: string;
  sectNo: string | null;
  text: string;
}

export function htmlBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const sect = /<span class="CharSectno">([\s\S]*?)<\/span>/.exec(inner);
    const text = textOf(inner);
    if (!text && !sect) continue;
    blocks.push({ cls, sectNo: sect ? textOf(sect[1] ?? '') || null : null, text });
  }
  return blocks;
}

export function epubToHtml(epub: Uint8Array): string {
  const files = unzipSync(epub);
  const docs = Object.keys(files)
    .filter((n) => /^OEBPS\/document_\d+\/document_\d+\.html$/.test(n))
    .sort((a, b) => Number(/_(\d+)\//.exec(a)?.[1]) - Number(/_(\d+)\//.exec(b)?.[1]));
  if (docs.length === 0) throw new Error('no document html found inside the epub');
  const decoder = new TextDecoder();
  return docs.map((n) => decoder.decode(files[n])).join('\n');
}

const HEAD_CONTEXT = /^ActHead[1-4]$/;
const SKIP = /^(TOC\d*|Header|ShortT|Tabbing)$/;

export function parseAct(html: string): ActText {
  const provisions: Provision[] = [];
  const endnoteLines: string[] = [];
  const context: string[] = [];
  let current: Provision | null = null;
  let inEndnotes = false;

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
    if (HEAD_CONTEXT.test(block.cls)) {
      const depth = Number(block.cls.slice(-1));
      context.length = depth - 1;
      context[depth - 1] = block.text;
      current = null;
      continue;
    }
    if (block.cls === 'ActHead5' && block.sectNo) {
      const heading = block.text.replace(block.sectNo, '').replace(/^\s*/, '').trim();
      current = {
        no: block.sectNo,
        heading,
        context: context.filter(Boolean).join(' > '),
        body: '',
      };
      provisions.push(current);
      continue;
    }
    if (current && block.text) {
      current.body += (current.body ? '\n' : '') + block.text;
    }
  }
  return { provisions, endnotes: endnoteLines.join('\n') };
}

export function normaliseSectionNo(no: string): string {
  return no.replace(/[\s.]+/g, '').replace(/^s(?=\d)/i, '').toUpperCase();
}

export function findProvision(act: ActText, sectionNo: string): Provision | null {
  const want = normaliseSectionNo(sectionNo);
  return act.provisions.find((p) => normaliseSectionNo(p.no) === want) ?? null;
}

export function nearest(act: ActText, sectionNo: string, count = 3): Provision[] {
  const want = normaliseSectionNo(sectionNo);
  const wantNum = parseInt(want, 10);
  if (Number.isNaN(wantNum)) return act.provisions.slice(0, count);
  return [...act.provisions]
    .sort((a, b) => {
      const an = Math.abs(parseInt(normaliseSectionNo(a.no), 10) - wantNum);
      const bn = Math.abs(parseInt(normaliseSectionNo(b.no), 10) - wantNum);
      return (Number.isNaN(an) ? 1e9 : an) - (Number.isNaN(bn) ? 1e9 : bn);
    })
    .slice(0, count);
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
