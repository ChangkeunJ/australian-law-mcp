// Live smoke test against the real FRL API. Not part of CI; run before a
// release: node scripts/smoke.mjs
import assert from 'node:assert/strict';
import * as frl from '../dist/frl.js';
import { epubDocuments, findProvision, parseAct } from '../dist/text.js';

const ok = (label) => console.log(`ok  ${label}`);

const search = await frl.searchTitles('Income Tax Rates Act 1986', 'name', 'exact', 5);
assert.ok(search.count >= 1);
const itra = search.titles.find((t) => t.name === 'Income Tax Rates Act 1986');
assert.ok(itra, 'Income Tax Rates Act 1986 in exact name-search results');
ok(`search: ${search.count} matches, found ${itra.id}`);

const broad = await frl.searchTitles('income tax rates act', 'name', 'all', 50);
assert.ok(broad.titles.some((t) => t.id === itra.id), 'principal act present in broad results');
ok(`broad name search: ${broad.count} matches include the principal act`);

const latest = await frl.findVersion(itra.id);
assert.ok(latest.registerId.startsWith('C'));
ok(`latest compilation: No. ${latest.compilationNumber} (${latest.registerId}) from ${latest.start.slice(0, 10)}`);

const act = parseAct(epubDocuments(await frl.getEpub(itra.id)));
assert.ok(act.provisions.length > 10);
const s3a = findProvision(act, '3A');
assert.ok(s3a, 's 3A exists');
assert.match(s3a.heading + s3a.body, /working holiday/i);
ok(`text: ${act.provisions.length} provisions, s 3A "${s3a.heading}"`);

// The operative rate tables live in a Schedule, not in the numbered sections.
const schedule7 = findProvision(act, 'Schedule 7');
assert.ok(schedule7, 'Schedule 7 must be addressable');
assert.match(schedule7.body, /exceeds \$45,000/);
assert.match(schedule7.body, /working holiday/i);
ok(`schedules: "${schedule7.no}—${schedule7.heading}" carries the rate table`);

// Modern acts number sections with a non-breaking hyphen split across spans.
const tasa = parseAct(epubDocuments(await frl.getEpub('C2009A00013')));
const unique = new Set(tasa.provisions.map((p) => p.no));
assert.equal(unique.size, tasa.provisions.length, 'section numbers must not collide');
for (const no of ['50-5', '90-5']) {
  assert.ok(findProvision(tasa, no), `Tax Agent Services Act s ${no} must resolve`);
}
ok(`dashed numbering: ${tasa.provisions.length} unique provisions, s 50-5 and s 90-5 resolve`);

assert.throws(() => frl.assertDate('2017-13-45'), /not a real calendar date/);
assert.throws(() => frl.assertDate('1800-01-01'), /predates federation/);
ok('calendar-impossible dates are rejected rather than reported as "no version in force"');

const earliest = await frl.earliestVersion('C1936A00027');
assert.ok(earliest && Number(earliest.start.slice(0, 4)) < 2000, 'earliest version must not be a page artefact');
ok(`earliest version of ITAA 1936: ${earliest.start.slice(0, 10)}`);

const historic = await frl.findVersion(itra.id, '2017-01-05');
assert.ok(historic);
assert.notEqual(historic.registerId, latest.registerId);
ok(`as at 2017-01-05: Compilation No. ${historic.compilationNumber} (${historic.registerId})`);

const amending = await frl.amendingTitles(itra.id, 5);
assert.ok(amending.count > 50);
ok(`amended by ${amending.count} titles`);

const fullText = await frl.searchTitles('working holiday taxable income', 'nameAndText', 'exact', 3);
assert.ok(fullText.count >= 1);
ok(`full-text search: ${fullText.count} matches`);

const { ms } = await frl.ping();
ok(`ping ${ms} ms`);

console.log('smoke passed');
