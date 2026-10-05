// What a title has been through since a date: which compilations commenced,
// what each one incorporated, and whether the title's status changed. Built on
// the version list and status history the register already serves, so it
// reports the register's own records and never infers anything about the text.

import type { StatusEntry, Version } from './frl.js';

export interface Changes {
  // The compilation in force on `since`, when the list reaches back that far.
  baseline: Version | null;
  // Compilations that commenced after `since` (and on or before `until`),
  // oldest first.
  changes: Version[];
  // Status entries (repeal, cessation) dated inside the same window.
  statusChanges: StatusEntry[];
  // The list held the register's maximum and every entry postdated `since`,
  // so what was in force on `since` and older changes in the window are
  // unknown rather than absent.
  truncated: boolean;
  // Compilations that commenced after `until`.
  afterUntil: number;
}

// The register caps $top at this; listVersions asks for exactly this many.
const PAGE = 100;

function day(iso: string): string {
  return iso.slice(0, 10);
}

export function selectChanges(
  versions: Version[],
  statusHistory: StatusEntry[] | undefined,
  since: string,
  until?: string,
): Changes {
  const ordered = [...versions].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  // A compilation that commenced on `since` is the law as at that day, so it
  // is the baseline rather than a change.
  const inWindow = (start: string) => day(start) > since && (!until || day(start) <= until);
  const before = ordered.filter((v) => day(v.start) <= since);
  const baseline = before.length > 0 ? before[before.length - 1]! : null;
  return {
    baseline,
    changes: ordered.filter((v) => inWindow(v.start)),
    statusChanges: (statusHistory ?? []).filter((s) => inWindow(s.start)),
    truncated: versions.length >= PAGE && baseline === null,
    afterUntil: until ? ordered.filter((v) => day(v.start) > until).length : 0,
  };
}

function describe(v: Version): string {
  const id = v.registerId ? `register id ${v.registerId}` : 'no electronic text on the register';
  const window = `${day(v.start)}${v.end ? ` to ${day(v.end)}` : ''}`;
  return `Compilation No. ${v.compilationNumber ?? '?'} (${id}), in force from ${window}.`;
}

export function renderChanges(c: Changes, since: string, until?: string): string {
  const window = `since ${since}${until ? ` up to ${until}` : ''}`;
  const lines = [`Changes ${window}:`];
  if (c.truncated) {
    lines.push(
      `The register returned its newest ${PAGE} compilations and all of them postdate ${since}, so what was in ` +
        `force on ${since}, and any older change in the window, is not shown here.`,
    );
  } else if (c.baseline) {
    lines.push(`In force on ${since}: ${describe(c.baseline)}`);
  } else if (c.changes.length > 0) {
    lines.push(`The title commenced on ${day(c.changes[0]!.start)}, after ${since}.`);
  } else {
    lines.push(`The register holds no compilation of this title on or before ${since}${until ? ` or up to ${until}` : ''}.`);
  }

  if (c.changes.length === 0) {
    if (!c.truncated && c.baseline) {
      lines.push(
        `No new compilation ${window}; Compilation No. ${c.baseline.compilationNumber ?? '?'} ` +
          `(${c.baseline.registerId ?? 'no electronic text'}) is still the one in force.`,
      );
    }
  } else {
    lines.push('');
    for (const v of c.changes) {
      lines.push(describe(v));
      const amending = (v.reasons ?? []).filter((r) => r.affectedByTitle);
      for (const r of amending) {
        const by = r.affectedByTitle!;
        lines.push(`  Incorporates: ${by.provisions ?? r.affect} of ${by.name} [${by.titleId}]`);
      }
      if (amending.length === 0) lines.push('  The register records no amending title for this compilation.');
      if (v.hasUnincorporatedAmendments) {
        lines.push('  Warning: commenced amendments are not yet incorporated in this compilation.');
      }
    }
  }

  for (const s of c.statusChanges) {
    const why = s.reasons
      .map((r) => `${r.affect}${r.affectedByTitle ? ` by ${r.affectedByTitle.name} [${r.affectedByTitle.titleId}]` : ''}`)
      .join('; ');
    lines.push(`Status change ${day(s.start)}: ${s.status}${why ? ` (${why})` : ''}`);
  }
  if (c.afterUntil > 0) {
    lines.push(`${c.afterUntil} later compilation${c.afterUntil === 1 ? '' : 's'} commenced after ${until}.`);
  }

  const amendingTitles = new Map<string, string>();
  for (const v of c.changes) {
    for (const r of v.reasons ?? []) {
      if (r.affectedByTitle) amendingTitles.set(r.affectedByTitle.titleId, r.affectedByTitle.name);
    }
  }
  if (amendingTitles.size > 0) {
    lines.push('', 'Amending titles in this window:');
    for (const [id, name] of amendingTitles) lines.push(`  ${id}  ${name}`);
  }
  return lines.join('\n');
}
