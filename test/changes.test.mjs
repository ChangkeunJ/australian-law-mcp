import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderChanges, selectChanges } from '../dist/changes.js';

const version = (registerId, start, end, compilationNumber, extra = {}) => ({
  titleId: 'C2004A03348',
  name: 'Income Tax Rates Act 1986',
  status: 'InForce',
  start: `${start}T00:00:00`,
  end: end ? `${end}T00:00:00` : null,
  registerId,
  compilationNumber,
  ...extra,
});
const amend = (titleId, name, provisions) => ({ affect: 'Amend', affectedByTitle: { titleId, name, provisions } });

// Newest first, as the register returns them.
const versions = [
  version('C2017C00189', '2017-05-20', null, '50', {
    reasons: [amend('C2017A00015', 'Tax and Superannuation Laws Amendment (2016 Measures No. 2) Act 2017', 'Sch 1')],
  }),
  version('C2016C01138', '2016-12-02', '2017-05-19', '48', {
    reasons: [amend('C2016A00092', 'Income Tax Rates Amendment (Working Holiday Maker Reform) Act 2016', 'Sch 1')],
  }),
  version('C2015C00323', '2015-07-01', '2016-12-01', '47'),
];

test('compilations after the date are listed oldest first with the baseline named', () => {
  const c = selectChanges(versions, [], '2016-01-01');
  assert.equal(c.baseline.registerId, 'C2015C00323');
  assert.deepEqual(
    c.changes.map((v) => v.registerId),
    ['C2016C01138', 'C2017C00189'],
  );
  assert.equal(c.truncated, false);
  const text = renderChanges(c, '2016-01-01');
  assert.match(text, /In force on 2016-01-01: Compilation No\. 47 \(register id C2015C00323\)/);
  assert.match(text, /Compilation No\. 48 \(register id C2016C01138\), in force from 2016-12-02 to 2017-05-19\./);
  assert.match(text, /Incorporates: Sch 1 of Income Tax Rates Amendment \(Working Holiday Maker Reform\) Act 2016 \[C2016A00092\]/);
  assert.match(text, /Amending titles in this window:\n  C2016A00092 /);
});

test('a compilation that commenced on the date itself is the baseline, not a change', () => {
  const c = selectChanges(versions, [], '2016-12-02');
  assert.equal(c.baseline.registerId, 'C2016C01138');
  assert.deepEqual(
    c.changes.map((v) => v.registerId),
    ['C2017C00189'],
  );
});

test('until closes the window and later compilations are counted, not listed', () => {
  const c = selectChanges(versions, [], '2016-01-01', '2017-01-01');
  assert.deepEqual(
    c.changes.map((v) => v.registerId),
    ['C2016C01138'],
  );
  assert.equal(c.afterUntil, 1);
  assert.match(renderChanges(c, '2016-01-01', '2017-01-01'), /1 later compilation commenced after 2017-01-01\./);
});

test('no change in the window is stated, naming the compilation still in force', () => {
  const c = selectChanges(versions, [], '2017-06-01');
  assert.equal(c.changes.length, 0);
  assert.match(
    renderChanges(c, '2017-06-01'),
    /No new compilation since 2017-06-01; Compilation No\. 50 \(C2017C00189\) is still the one in force\./,
  );
});

test('a version without electronic text is listed as such', () => {
  const c = selectChanges([version(null, '2016-06-01', null, null), ...versions.slice(2)], [], '2016-01-01');
  const text = renderChanges(c, '2016-01-01');
  assert.match(text, /Compilation No\. \? \(no electronic text on the register\), in force from 2016-06-01\./);
  assert.match(text, /records no amending title/);
});

test('a status change in the window is reported with its reason', () => {
  const history = [
    { status: 'InForce', start: '1986-11-04T00:00:00', reasons: [] },
    {
      status: 'Repealed',
      start: '2017-01-01T00:00:00',
      reasons: [{ affect: 'Repeal', affectedByTitle: { titleId: 'C2016A00099', name: 'Repealing Act 2016' } }],
    },
  ];
  const c = selectChanges(versions, history, '2016-01-01');
  assert.equal(c.statusChanges.length, 1);
  assert.match(
    renderChanges(c, '2016-01-01'),
    /Status change 2017-01-01: Repealed \(Repeal by Repealing Act 2016 \[C2016A00099\]\)/,
  );
});

test('a full page that all postdates the date is reported as incomplete, not as the whole story', () => {
  const many = Array.from({ length: 100 }, (_, i) =>
    version(`C2020C${String(i).padStart(5, '0')}`, `2020-${String(1 + (i % 12)).padStart(2, '0')}-01`, null, String(i)),
  );
  const c = selectChanges(many, [], '2019-01-01');
  assert.equal(c.truncated, true);
  assert.equal(c.baseline, null);
  assert.match(renderChanges(c, '2019-01-01'), /newest 100 compilations and all of them postdate 2019-01-01/);
});

test('a date before the title commenced reports the commencement rather than guessing a baseline', () => {
  const c = selectChanges(versions, [], '2010-01-01');
  assert.equal(c.baseline, null);
  assert.equal(c.truncated, false);
  assert.match(renderChanges(c, '2010-01-01'), /The title commenced on 2015-07-01, after 2010-01-01\./);
});
