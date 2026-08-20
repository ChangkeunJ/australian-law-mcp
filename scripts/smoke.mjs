// Live smoke test against the real FRL API. Not part of CI; run before a
// release: node scripts/smoke.mjs
import assert from 'node:assert/strict';
import * as frl from '../dist/frl.js';
import { epubToHtml, findProvision, parseAct } from '../dist/text.js';

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

const act = parseAct(epubToHtml(await frl.getEpub(itra.id)));
assert.ok(act.provisions.length > 10);
const s3a = findProvision(act, '3A');
assert.ok(s3a, 's 3A exists');
assert.match(s3a.heading + s3a.body, /working holiday/i);
ok(`text: ${act.provisions.length} sections, s 3A "${s3a.heading}"`);

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
