// Pulls Australian statute citations out of free text so they can be checked
// against the register. Heuristic by design: it aims at the citation shapes
// LLMs actually emit ("s 3A of the Income Tax Rates Act 1986", "Tax Agent
// Services Act 2009 ss 50-5 and 90-5"), not at parsing every drafting style.
//
// A section is only attached to an act when nothing but connective words sit
// between them. Binding a section to the wrong act would make the verifier
// report a real provision as missing, which is worse than not checking it.

export interface Citation {
  act: string;
  sections: string[];
}

const JURISDICTION = String.raw`\s+\((?:Cth|NSW|Vic|Qld|SA|WA|Tas|NT|ACT)\)`;
const WORD = String.raw`[A-Z][\w'’()–-]*,?`;
const ACT_NAME = new RegExp(
  String.raw`\b((?:A |An |The )?(?:${WORD}(?:\s+(?:[a-z]{1,3}|${WORD}|\([^)]{1,60}\)))*?)\s+(?:Act|Regulations?|Rules|Code|Determination)\s+\d{4})(?:${JURISDICTION})?`,
  'g',
);

// Inside a provision number the dash is a hyphen (ITAA style, "50-5"); an
// en dash or em dash between two numbers is a range instead.
const NUM = String.raw`\d+[A-Z]{0,3}(?:[-‐‑.]\d+[A-Z]{0,3})?`;
const LABEL = String.raw`sections?|ss?|§|regulations?|regs?|rules?|clauses?|cls?`;
const SECTION_REF = new RegExp(
  String.raw`\b(?:${LABEL})\s*\.?\s*(${NUM})(?:\s*[–—]\s*(${NUM}))?`,
  'gi',
);
const SECTION_MORE = new RegExp(String.raw`^\s*(?:,|and|or)\s*(${NUM})\b`, 'i');

interface Span {
  start: number;
  end: number;
  value: string;
}

function actSpans(text: string): Span[] {
  const spans: Span[] = [];
  ACT_NAME.lastIndex = 0;
  for (let m = ACT_NAME.exec(text); m; m = ACT_NAME.exec(text)) {
    const value = (m[1] ?? '').replace(/^(?:(?:the|of|under|in|by|to|and|or|see|also|per)\s+)+/i, '').trim();
    spans.push({ start: m.index, end: m.index + m[0].length, value });
  }
  return spans;
}

function sectionSpans(text: string): Span[] {
  const spans: Span[] = [];
  SECTION_REF.lastIndex = 0;
  for (let m = SECTION_REF.exec(text); m; m = SECTION_REF.exec(text)) {
    const start = m.index;
    let end = m.index + m[0].length;
    spans.push({ start, end, value: m[1] ?? '' });
    if (m[2]) spans.push({ start, end, value: m[2] });
    let rest = text.slice(end);
    for (let extra = SECTION_MORE.exec(rest); extra; extra = SECTION_MORE.exec(rest)) {
      spans.push({ start, end: end + extra[0].length, value: extra[1] ?? '' });
      end += extra[0].length;
      rest = rest.slice(extra[0].length);
    }
    SECTION_REF.lastIndex = end;
  }
  return spans;
}

// "s 3A and s 999 of the Act" binds both sections, so sibling references are
// stripped out of the gap before it is judged.
const SIBLING = new RegExp(String.raw`\b(?:${LABEL})\s*\.?\s*${NUM}(?:\s*[–—]\s*${NUM})?`, 'gi');
const AFTER_SECTION = /^[\s,]*(?:(?:and|or)[\s,]*)*(?:of|under|in|from)?\s*(?:the\s+)?$/i;
const AFTER_ACT = /^[\s,;:]*$/;

function bridges(gap: string, sectionFirst: boolean): boolean {
  if (!sectionFirst) return AFTER_ACT.test(gap);
  return AFTER_SECTION.test(gap.replace(SIBLING, ' '));
}

export function parseCitations(text: string): Citation[] {
  const acts = actSpans(text);
  if (acts.length === 0) return [];
  // "Regulations 2001" inside a title looks exactly like a provision
  // reference, so anything falling inside an act name is not a citation.
  const sections = sectionSpans(text).filter(
    (sec) => !acts.some((act) => sec.start >= act.start && sec.start < act.end),
  );
  const byAct = new Map<string, Set<string>>();
  for (const act of acts) {
    if (!byAct.has(act.value)) byAct.set(act.value, new Set());
  }
  for (const sec of sections) {
    let best: Span | null = null;
    let bestDistance = Infinity;
    for (const act of acts) {
      const sectionFirst = sec.end <= act.start;
      const gap = sectionFirst ? text.slice(sec.end, act.start) : text.slice(act.end, sec.start);
      if (!bridges(gap, sectionFirst)) continue;
      if (gap.length < bestDistance) {
        best = act;
        bestDistance = gap.length;
      }
    }
    if (best) byAct.get(best.value)?.add(sec.value);
  }
  return [...byAct.entries()].map(([act, secs]) => ({ act, sections: [...secs] }));
}
