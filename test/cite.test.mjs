import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCitations } from '../dist/cite.js';

test('section-of-act citation', () => {
  const [c] = parseCitations('Under s 3A of the Income Tax Rates Act 1986 a working holiday maker is taxed at 15%.');
  assert.equal(c.act, 'Income Tax Rates Act 1986');
  assert.deepEqual(c.sections, ['3A']);
});

test('act-then-sections citation with a list', () => {
  const [c] = parseCitations('The Tax Agent Services Act 2009, ss 50-5 and 90-5, defines the service.');
  assert.equal(c.act, 'Tax Agent Services Act 2009');
  assert.deepEqual(c.sections.sort(), ['50-5', '90-5']);
});

test('act names that start with an article are kept whole', () => {
  const [c] = parseCitations('See the A New Tax System (Goods and Services Tax) Act 1999 for GST.');
  assert.equal(c.act, 'A New Tax System (Goods and Services Tax) Act 1999');
});

test('multiple acts keep their own sections', () => {
  const cites = parseCitations(
    'Section 6 of the Fair Work Act 2009 differs from section 7 of the Privacy Act 1988.',
  );
  const byAct = Object.fromEntries(cites.map((c) => [c.act, c.sections]));
  assert.deepEqual(byAct['Fair Work Act 2009'], ['6']);
  assert.deepEqual(byAct['Privacy Act 1988'], ['7']);
});

test('plain prose has no citations', () => {
  assert.deepEqual(parseCitations('Nothing legal to see here, move along.'), []);
});
