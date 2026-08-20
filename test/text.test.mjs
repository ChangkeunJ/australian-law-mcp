import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLines, findProvision, htmlBlocks, normaliseSectionNo, parseAct } from '../dist/text.js';

const FIXTURE = `
<p class="TOC2"><span>Part I—Preliminary</span></p>
<p class="TOC5"><span>1 Short title</span></p>
<p id="navPoint_1" class="ActHead2"><a id="_Toc1"><span class="CharPartNo">Part</span><span class="CharPartNo">&#xa0;</span><span class="CharPartNo">I</span><span>&#8212;</span><span class="CharPartText">Preliminary</span></a></p>
<p class="Header"><span class="CharDivNo">&#xa0;</span></p>
<p id="navPoint_2" class="ActHead5"><a id="_Toc2"><span class="CharSectno">1</span><span>&#xa0; </span><span>Short title</span></a></p>
<p class="subsection"><span>This Act may be cited as the </span><span style="font-style:italic">Example Act 1986</span><span>.</span></p>
<p id="navPoint_3" class="ActHead5"><a id="_Toc3"><span class="CharSectno">3A</span><span>&#xa0; </span><span>Working holiday makers</span></a></p>
<p class="subsection"><span>(1)</span><span>An individual is a </span><span>working holiday maker</span><span> at a particular time if the individual holds a Subclass 417 visa.</span></p>
<p class="paragraph"><span>(a)</span><span>a Subclass 417 (Working Holiday) visa; or</span></p>
<p id="navPoint_4" class="ActHead2"><a id="_Toc4"><span class="CharPartNo">Part</span><span>&#xa0;</span><span class="CharPartNo">II</span><span>&#8212;</span><span class="CharPartText">Rates</span></a></p>
<p id="navPoint_5" class="ActHead5"><a id="_Toc5"><span class="CharSectno">12</span><span>&#xa0; </span><span>Rates of tax</span></a></p>
<p class="subsection"><span>The rates are as set out in Schedule 7.</span></p>
<p class="ENoteTableHeading"><span>Endnote 1&#8212;About the endnotes</span></p>
<p class="ENoteTableText"><span>Amendment history for section 12.</span></p>
`;

test('htmlBlocks extracts classes, section numbers and text', () => {
  const blocks = htmlBlocks(FIXTURE);
  const head = blocks.find((b) => b.sectNo === '3A');
  assert.ok(head);
  assert.equal(head.cls, 'ActHead5');
  assert.match(head.text, /Working holiday makers/);
});

test('parseAct groups body under sections with part context', () => {
  const act = parseAct(FIXTURE);
  assert.deepEqual(
    act.provisions.map((p) => p.no),
    ['1', '3A', '12'],
  );
  const s3a = findProvision(act, '3a');
  assert.ok(s3a);
  assert.equal(s3a.heading, 'Working holiday makers');
  assert.match(s3a.body, /Subclass 417/);
  assert.match(s3a.body, /\(a\) ?a Subclass 417 \(Working Holiday\) visa; or/);
  assert.equal(s3a.context, 'Part I—Preliminary');
  const s12 = findProvision(act, '12');
  assert.equal(s12.context, 'Part II—Rates');
});

test('TOC lines are skipped and endnotes are separated', () => {
  const act = parseAct(FIXTURE);
  const s12 = findProvision(act, '12');
  assert.ok(!s12.body.includes('Amendment history'));
  assert.match(act.endnotes, /Amendment history/);
});

test('normaliseSectionNo treats 3A, 3a and "s 3A" alike', () => {
  assert.equal(normaliseSectionNo('3a'), normaliseSectionNo('3A'));
  assert.equal(normaliseSectionNo('s 3A'), '3A');
  assert.equal(normaliseSectionNo('90-5'), '90-5');
});

test('diffLines marks additions and removals', () => {
  const diff = diffLines('one\ntwo\nthree', 'one\ntwo changed\nthree\nfour');
  assert.deepEqual(
    diff.map((d) => d.kind + d.text),
    ['one', '-two', '+two changed', 'three', '+four'].map((s) => (s[0] === '-' || s[0] === '+' ? s[0] + s.slice(1) : ' ' + s)),
  );
});
