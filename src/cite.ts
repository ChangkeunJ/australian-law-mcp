// Pulls Australian statute citations out of free text so they can be checked
// against the register. Heuristic by design: it aims at the citation shapes
// LLMs actually emit ("s 3A of the Income Tax Rates Act 1986", "Tax Agent
// Services Act 2009 ss 50-5 and 90-5"), not at parsing every drafting style.

export interface Citation {
  act: string;
  sections: string[];
}

const ACT_NAME =
  /\b((?:A |An |The )?(?:[A-Z][\w'’()–-]*(?:\s+(?:[a-z]{1,3}|[A-Z][\w'’()–-]*|\([^)]{1,60}\)))*?)\s+(Act|Regulations?|Rules|Code|Determination)\s+(\d{4})\b(?:\s+\((?:Cth|NSW|Vic|Qld|SA|WA|Tas|NT|ACT)\))?)/g;

const SECTION_REF = /\b(?:ss?|sections?|§)\s*\.?\s*(\d+[A-Z]{0,3}(?:[-.]\d+[A-Z]{0,3})?)/gi;
const SECTION_MORE = /^\s*(?:,|and|or)\s*(\d+[A-Z]{0,3}(?:[-.]\d+[A-Z]{0,3})?)/i;

interface Span {
  start: number;
  end: number;
  value: string;
}

function actSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (let m = ACT_NAME.exec(text); m; m = ACT_NAME.exec(text)) {
    const value = (m[1] ?? '').replace(/^(?:(?:the|of|under|in|by|to|and|or|see|also|per)\s+)+/i, '').trim();
    spans.push({ start: m.index, end: m.index + m[0].length, value });
  }
  ACT_NAME.lastIndex = 0;
  return spans;
}

function sectionSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (let m = SECTION_REF.exec(text); m; m = SECTION_REF.exec(text)) {
    spans.push({ start: m.index, end: m.index + m[0].length, value: m[1] ?? '' });
    let rest = text.slice(m.index + m[0].length);
    let offset = m.index + m[0].length;
    for (let extra = SECTION_MORE.exec(rest); extra; extra = SECTION_MORE.exec(rest)) {
      spans.push({ start: offset, end: offset + extra[0].length, value: extra[1] ?? '' });
      offset += extra[0].length;
      rest = rest.slice(extra[0].length);
    }
  }
  SECTION_REF.lastIndex = 0;
  return spans;
}

export function parseCitations(text: string): Citation[] {
  const acts = actSpans(text);
  if (acts.length === 0) return [];
  const sections = sectionSpans(text);
  const byAct = new Map<string, Set<string>>();
  for (const act of acts) {
    if (!byAct.has(act.value)) byAct.set(act.value, new Set());
  }
  for (const sec of sections) {
    let best: Span | null = null;
    let bestDistance = Infinity;
    for (const act of acts) {
      const distance = sec.end <= act.start ? act.start - sec.end : sec.start - act.end;
      if (distance >= 0 && distance < bestDistance && distance < 200) {
        best = act;
        bestDistance = distance;
      }
    }
    if (best) byAct.get(best.value)?.add(sec.value);
  }
  return [...byAct.entries()].map(([act, secs]) => ({ act, sections: [...secs] }));
}
