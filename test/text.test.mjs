import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLines, findProvision, htmlBlocks, nearest, normaliseSectionNo, parseAct } from '../dist/text.js';

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
<p id="navPoint_9" class="ActHead5"><a id="_Toc9"><span class="CharSectno">50</span><span class="CharSectno">&#x2011;</span><span class="CharSectno">5</span><span>&#xa0; </span><span>Providing services if unregistered</span></a></p>
<p class="subsection"><span>You must not provide a service if you are unregistered.</span></p>
<p class="subsection2"><img src="image.007.png" alt="Start formula A over B end formula" /></p>
<p id="navPoint_4" class="ActHead2"><a id="_Toc4"><span class="CharPartNo">Part</span><span>&#xa0;</span><span class="CharPartNo">II</span><span>&#8212;</span><span class="CharPartText">Rates</span></a></p>
<p id="navPoint_5" class="ActHead5"><a id="_Toc5"><span class="CharSectno">12</span><span>&#xa0; </span><span>Rates of tax</span></a></p>
<p class="subsection"><span>The rates are as set out in Schedule 7.</span></p>
<p class="ActHead1"><a id="_Toc7"><span>Schedule 7</span><span>&#8212;</span><span>General rates of tax</span></a></p>
<p class="notemargin"><span>Subsection 12(1)</span></p>
<p class="ActHead2"><span>Part III—Working holiday makers</span></p>
<p class="Tabletext"><span>exceeds $45,000 but does not exceed $135,000</span></p>
<p class="Tabletext"><span>30%</span></p>
<p class="ENoteTableHeading"><span>Endnote 1&#8212;About the endnotes</span></p>
<p class="ENoteTableText"><span>Amendment history for section 12.</span></p>
`;

test('htmlBlocks extracts classes, section numbers and text', () => {
  const blocks = htmlBlocks(FIXTURE);
  const head = blocks.find((b) => b.sectNo === '3A');
  assert.ok(head);
  assert.equal(head.cls, 'ActHead5');
  assert.equal(head.heading, 'Working holiday makers');
});

test('a section number split across CharSectno spans is rejoined', () => {
  const act = parseAct(FIXTURE);
  const p = findProvision(act, '50-5');
  assert.ok(p, 'section 50-5 must be addressable with an ordinary hyphen');
  assert.equal(p.heading, 'Providing services if unregistered');
  assert.equal(findProvision(act, '50'), null, 'the number must not be truncated at the dash');
});

test('parseAct groups body under sections with part context', () => {
  const act = parseAct(FIXTURE);
  const s3a = findProvision(act, '3a');
  assert.ok(s3a);
  assert.match(s3a.body, /Subclass 417/);
  assert.match(s3a.body, /\(a\) ?a Subclass 417 \(Working Holiday\) visa; or/);
  assert.equal(s3a.context, 'Part I—Preliminary');
  assert.equal(findProvision(act, '12').context, 'Part II—Rates');
});

test('schedules are captured as addressable provisions, not dropped', () => {
  const act = parseAct(FIXTURE);
  const sch = findProvision(act, 'Schedule 7');
  assert.ok(sch, 'schedule content carries the rate tables and must survive parsing');
  assert.equal(sch.heading, 'General rates of tax');
  assert.match(sch.body, /exceeds \$45,000/);
  assert.match(sch.body, /Part III—Working holiday makers/);
});

test('formula images keep their alt text', () => {
  const act = parseAct(FIXTURE);
  assert.match(findProvision(act, '50-5').body, /Start formula A over B end formula/);
});

test('TOC lines are skipped and endnotes are separated', () => {
  const act = parseAct(FIXTURE);
  assert.ok(!findProvision(act, '12').body.includes('Amendment history'));
  assert.match(act.endnotes, /Amendment history/);
});

test('the endnote latch resets between documents of a multi-volume epub', () => {
  const volume1 = `<p class="ActHead5"><span class="CharSectno">99</span><span>Old</span></p>
    <p class="ENoteTableText"><span>endnotes for volume one</span></p>`;
  const volume2 = `<p class="ActHead5"><span class="CharSectno">1</span><span class="CharSectno">.</span><span class="CharSectno">03</span><span>Interpretation</span></p>
    <p class="subsection"><span>Definitions live here.</span></p>`;
  const act = parseAct([volume1, volume2]);
  assert.ok(findProvision(act, '1.03'), 'a later volume must not be swallowed by an earlier volume endnotes');
  assert.match(act.endnotes, /volume one/);
});

test('normaliseSectionNo folds dashes but keeps dots significant', () => {
  assert.equal(normaliseSectionNo('50‑5'), normaliseSectionNo('50-5'));
  assert.equal(normaliseSectionNo('s 3A'), '3A');
  assert.equal(normaliseSectionNo('section 90-5'), '90-5');
  assert.notEqual(normaliseSectionNo('1.05'), normaliseSectionNo('105'));
});

test('nearest ranks by numeric distance', () => {
  const act = parseAct(FIXTURE);
  assert.deepEqual(
    nearest(act, '13', 2).map((p) => p.no),
    ['12', '3A'],
  );
});

test('a self-closing paragraph does not steal the next block class', () => {
  const blocks = htmlBlocks('<p class="a"/><p class="b">x</p>');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].cls, 'b');
  assert.equal(blocks[0].text, 'x');
});

test('diffLines marks additions and removals', () => {
  const diff = diffLines('one\ntwo\nthree', 'one\ntwo changed\nthree\nfour');
  assert.deepEqual(
    diff.map((d) => d.kind + d.text),
    [' one', '-two', '+two changed', ' three', '+four'],
  );
});
