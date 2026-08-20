import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCitations } from '../dist/cite.js';

const one = (text) => {
  const cites = parseCitations(text);
  assert.equal(cites.length, 1, `expected one citation from: ${text}`);
  return cites[0];
};

test('section-of-act citation', () => {
  const c = one('Under s 3A of the Income Tax Rates Act 1986 a working holiday maker is taxed at 15%.');
  assert.equal(c.act, 'Income Tax Rates Act 1986');
  assert.deepEqual(c.sections, ['3A']);
});

test('act-then-sections citation with a list', () => {
  const c = one('The Tax Agent Services Act 2009, ss 50-5 and 90-5, defines the service.');
  assert.equal(c.act, 'Tax Agent Services Act 2009');
  assert.deepEqual(c.sections.sort(), ['50-5', '90-5']);
});

test('a sibling reference does not detach the first section from its act', () => {
  const c = one('See s 3A and s 999 of the Income Tax Rates Act 1986.');
  assert.deepEqual(c.sections.sort(), ['3A', '999']);
});

test('the jurisdiction suffix is dropped so the register can find the title', () => {
  const c = one('Corporations Act 2001 (Cth) s 181 imposes duties.');
  assert.equal(c.act, 'Corporations Act 2001');
  assert.deepEqual(c.sections, ['181']);
});

test('act names that start with an article are kept whole', () => {
  const c = one('See the A New Tax System (Goods and Services Tax) Act 1999 for GST.');
  assert.equal(c.act, 'A New Tax System (Goods and Services Tax) Act 1999');
});

test('act names containing a comma survive', () => {
  const c = one('the Safety, Rehabilitation and Compensation Act 1988 covers it.');
  assert.equal(c.act, 'Safety, Rehabilitation and Compensation Act 1988');
});

test('multiple acts keep their own sections', () => {
  const byAct = Object.fromEntries(
    parseCitations('Section 6 of the Fair Work Act 2009 differs from section 7 of the Privacy Act 1988.').map((c) => [
      c.act,
      c.sections,
    ]),
  );
  assert.deepEqual(byAct['Fair Work Act 2009'], ['6']);
  assert.deepEqual(byAct['Privacy Act 1988'], ['7']);
});

test('a section is never bound to an act it is not attached to', () => {
  // Reporting s 51 as missing from the Corporations Act would be a false
  // negative about a real provision of a different instrument.
  const c = one('Section 51(xx) of the Constitution is exercised in the Corporations Act 2001 (Cth).');
  assert.deepEqual(c.sections, []);
  const d = one('s 18 of the Australian Consumer Law. The directors also face duties under the Corporations Act 2001.');
  assert.deepEqual(d.sections, []);
});

test('an en dash range yields both endpoints', () => {
  const c = one('See sections 6–8 of the Privacy Act 1988 (Cth).');
  assert.deepEqual(c.sections.sort(), ['6', '8']);
});

test('regulation and rule references are extracted', () => {
  assert.deepEqual(one('regulation 7 of the Renewable Energy (Electricity) Regulations 2001 applies.').sections, ['7']);
  const cites = parseCitations('rule 12 of the Federal Court Rules 2011 and clause 4 of the Fair Work Act 2009.');
  assert.deepEqual(cites.map((c) => c.sections), [['12'], ['4']]);
});

test('the year inside an instrument title is not read as a provision number', () => {
  assert.deepEqual(one('See the Renewable Energy (Electricity) Regulations 2001.').sections, []);
});

test('long letter suffixes on section numbers survive', () => {
  // Crimes Act 3ZQZB and ITAA 1936 159GZZZZH are real provisions; a cap on the
  // suffix length would drop them and verify_citations would call them missing.
  assert.deepEqual(one('Crimes Act 1914 (Cth), ss 3ZQU–3ZQZB apply.').sections.sort(), ['3ZQU', '3ZQZB']);
  assert.deepEqual(one('s 159GZZZZH of the Income Tax Assessment Act 1936').sections, ['159GZZZZH']);
});

test('"see also s X" after the act binds the further section', () => {
  const c = one('Income Tax Assessment Act 1997 (Cth) s 8-1; see also s 6-5');
  assert.deepEqual(c.sections.sort(), ['6-5', '8-1']);
});

test('a connective after an act does not steal the next act\'s section', () => {
  // "rule 12 of the Rules and clause 4 of the Act": 4 belongs to the Act.
  const byAct = Object.fromEntries(
    parseCitations('rule 12 of the Federal Court Rules 2011 and clause 4 of the Fair Work Act 2009.').map((c) => [
      c.act,
      c.sections,
    ]),
  );
  assert.deepEqual(byAct['Federal Court Rules 2011'], ['12']);
  assert.deepEqual(byAct['Fair Work Act 2009'], ['4']);
});

test('a section inside a schedule is kept apart, not bound as a plain section', () => {
  // s 18 of the ACL is s 18 of Schedule 2 to the CCA; binding it to the act
  // would make the verifier report a real provision as missing.
  const c = one('s 18 of Sch 2 to the Competition and Consumer Act 2010.');
  assert.deepEqual(c.sections, []);
  assert.deepEqual(c.scheduled, ['18']);
});

test('plain prose has no citations', () => {
  assert.deepEqual(parseCitations('Nothing legal to see here, move along.'), []);
});
