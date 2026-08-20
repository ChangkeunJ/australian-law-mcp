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
  // Sections cited as living inside a Schedule of the act (e.g. "s 18 of Sch 2
  // to the Competition and Consumer Act 2010"). Kept apart from `sections`
  // because they are not the act's own numbered sections, so checking them
  // against the principal act would report a real provision as missing.
  scheduled?: string[];
}

const JURISDICTION = String.raw`\s+\((?:Cth|NSW|Vic|Qld|SA|WA|Tas|NT|ACT)\)`;
const WORD = String.raw`[A-Z][\w'’()–-]*,?`;
// "(No. 2)" between the keyword and the year is a naming convention the
// register uses heavily (Appropriation Act (No. 3) 2003-2004).
const SERIAL = String.raw`(?:\s+\(No\.?\s*\d+\))?`;
const ACT_NAME = new RegExp(
  String.raw`\b((?:A |An |The )?(?:${WORD}(?:\s+(?:[a-z]{1,3}|${WORD}|\([^)]{1,60}\)))*?)\s+(?:Act|Regulations?|Rules|Code|Determination)${SERIAL}\s+\d{4})(?:${JURISDICTION})?`,
  'g',
);

// Inside a provision number the dash is a hyphen (ITAA style, "50-5"); an
// en dash or em dash between two numbers is a range instead. The letter suffix
// runs long in practice — Crimes Act "3ZQZB", ITAA 1936 "159GZZZZH".
const NUM = String.raw`\d+[A-Z]{0,8}(?:[-‐‑.]\d+[A-Z]{0,8})?`;
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
const SIBLING_TEST = new RegExp(SIBLING.source, 'i');
const AFTER_SECTION = /^[\s,]*(?:(?:and|or)[\s,]*)*(?:of|under|in|from)?\s*(?:the\s+)?$/i;
// Act-first, plain adjacency: "... Act 1997 s 8-1".
const AFTER_ACT = /^[\s,;:]*$/;
// Act-first, a further section after one already bound to this act:
// "... Act 1997 s 8-1; see also s 6-5". Only reached when a sibling reference
// sits in the gap, so "Rules 2011 and clause 4 of the Fair Work Act" cannot
// let the Rules swallow a section that belongs to the next act.
const AFTER_ACT_MORE = /^[\s,;:]*(?:(?:and|or|see|also)[\s,;:]*)+$/i;
// "s 18 of Sch 2 to the <Act>": the section is inside a schedule.
const SCHEDULE_OF = /^[\s,]*of\s+sch(?:edule)?\.?\s*\w+\s+(?:to\s+)?(?:the\s+)?$/i;

function bridges(gap: string, sectionFirst: boolean): boolean {
  if (sectionFirst) return AFTER_SECTION.test(gap.replace(SIBLING, ' '));
  if (AFTER_ACT.test(gap)) return true;
  return SIBLING_TEST.test(gap) && AFTER_ACT_MORE.test(gap.replace(SIBLING, ' '));
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
  const scheduledByAct = new Map<string, Set<string>>();
  for (const act of acts) {
    if (!byAct.has(act.value)) byAct.set(act.value, new Set());
  }
  for (const sec of sections) {
    let best: Span | null = null;
    let bestDistance = Infinity;
    let bestScheduled = false;
    for (const act of acts) {
      const sectionFirst = sec.end <= act.start;
      const gap = sectionFirst ? text.slice(sec.end, act.start) : text.slice(act.end, sec.start);
      let scheduled = false;
      if (!bridges(gap, sectionFirst)) {
        if (sectionFirst && SCHEDULE_OF.test(gap)) scheduled = true;
        else continue;
      }
      if (gap.length < bestDistance) {
        best = act;
        bestDistance = gap.length;
        bestScheduled = scheduled;
      }
    }
    if (!best) continue;
    const bucket = bestScheduled ? scheduledByAct : byAct;
    if (!bucket.has(best.value)) bucket.set(best.value, new Set());
    bucket.get(best.value)?.add(sec.value);
  }
  return [...byAct.entries()].map(([act, secs]) => {
    const scheduled = scheduledByAct.get(act);
    return scheduled && scheduled.size > 0
      ? { act, sections: [...secs], scheduled: [...scheduled] }
      : { act, sections: [...secs] };
  });
}
