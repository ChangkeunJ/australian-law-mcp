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

// Compilations from before about 2005 carry no ActHead classes at all: the
// heading levels are bare <hN> tags. Reading only <p> silently returned an act
// with no sections, which is a false statement about the law rather than a
// gap in coverage.
const OLD_FIXTURE = `
<p class="TOC2"><span>Part I—Preliminary</span></p>
<h2 id="navPoint_2"><a id="_Toc1"><span class="CharPartNo">Part</span><span class="CharPartNo">&#xa0;</span><span class="CharPartNo">I</span><span>&#8212;</span><span class="CharPartText">Preliminary</span></a></h2>
<h5 id="navPoint_3"><a id="_Toc2"><span class="CharSectno">3</span><span>&#xa0; </span><span>Interpretation</span></a></h5>
<p class="subsection"><span>In this Act, unless the contrary intention appears.</span></p>
<h1 id="navPoint_9"><a id="_Toc9"><span class="CharChapNo">Schedule</span><span class="CharChapNo">&#xa0;7</span><span>&#8212;</span><span>General rates of tax</span></a></h1>
<p class="Tabletext"><span>exceeds $45,000 but does not exceed $135,000</span></p>
<p class="NotesSection"><span>Notes to the Example Act 1986</span></p>
<p class="TableOfActs1"><span>Example Act 1986</span></p>
`;

test('a pre-2005 compilation using <hN> headings still yields provisions', () => {
  const act = parseAct(OLD_FIXTURE);
  const s3 = findProvision(act, '3');
  assert.ok(s3, 'an act whose headings are <h5> must not parse to zero sections');
  assert.equal(s3.heading, 'Interpretation');
  assert.equal(s3.context, 'Part I—Preliminary');
  const sch = findProvision(act, 'Schedule 7');
  assert.ok(sch, '<h1> carries the schedules in this generation');
  assert.match(sch.body, /exceeds \$45,000/);
});

test('the older generation ends its text at "Notes to the ..."', () => {
  const act = parseAct(OLD_FIXTURE);
  assert.ok(!findProvision(act, 'Schedule 7').body.includes('Example Act 1986'));
  assert.match(act.endnotes, /Notes to the Example Act 1986/);
});

// As-made scans from 1901 into the 1970s have no structural markup whatsoever.
const FLAT_FIXTURE = `
<p><span>INSURANCE.</span></p>
<p><span>No. 4 of 1932.</span></p>
<p><span>Short title.</span></p>
<p><span>1. This Act may be cited as the Insurance Act 1932.</span></p>
<p><span>Definitions.</span></p>
<p><span>3.&#8212;(1.) In this Act, unless the contrary intention appears&#8212;</span></p>
<p><span>&#8220;Accident insurance business&#8221; means the issue of policies.</span></p>
<p><span>THE SCHEDULE.</span></p>
<p><span>Form of application.</span></p>
`;

test('an as-made scan with no markup is read from its own numbering', () => {
  const act = parseAct(FLAT_FIXTURE);
  const s1 = findProvision(act, '1');
  assert.ok(s1);
  assert.equal(s1.heading, 'Short title');
  const s3 = findProvision(act, '3');
  assert.match(s3.body, /Accident insurance business/);
  assert.equal(s3.heading, 'Definitions');
  assert.ok(!s1.body.includes('Definitions'), 'a marginal note belongs to the section below it, not above');
  assert.match(findProvision(act, 'Schedule').body, /Form of application/);
});

// From about 2004 the section-number span carries a style attribute, so the
// class is no longer immediately followed by ">".
test('a styled CharSectno span is still read', () => {
  const styled =
    '<p class="ActHead5"><span class="CharSectno" style="font-size:12pt">7</span>' +
    '<span>&#xa0; </span><span>Powers</span></p>' +
    '<p class="subsection"><span>The body.</span></p>';
  const p = findProvision(parseAct(styled), '7');
  assert.ok(p, 'a CharSectno span with a style attribute must not be missed');
  assert.equal(p.heading, 'Powers');
});

// The agency-template generation marks structure with LI-Heading classes and
// no CharSectno; the number is the first token of the heading text.
test('the agency-template (LI-Heading) generation is parsed', () => {
  const li = `<p class="LI-Title"><span>ASIC Instrument 2023/956</span></p>
    <p class="LI-Heading1"><span>Part 1—Preliminary</span></p>
    <p class="LI-Heading2"><span>1 Name of legislative instrument</span></p>
    <p class="LI-BodyTextUnnumbered"><span>This is the ASIC ... Instrument 2023/956.</span></p>
    <p class="LI-Heading2"><span>4 Terms of declaration</span></p>
    <p class="LI-BodyTextUnnumbered"><span>The terms are as follows.</span></p>`;
  const act = parseAct(li);
  assert.ok(findProvision(act, '1'), 'a numbered LI-Heading2 must become an addressable section');
  assert.equal(findProvision(act, '1').heading, 'Name of legislative instrument');
  assert.equal(findProvision(act, '1').context, 'Part 1—Preliminary');
  assert.match(findProvision(act, '4').body, /terms are as follows/);
});

test('a statutory-rules banner "YYYY. No. N." is not read as section YYYY', () => {
  const sr = `<p><span>ELECTION RULES.</span></p>
    <p><span>1904. No. 2.</span></p>
    <p><span>Short title.</span></p>
    <p><span>1. These Rules may be cited as the Election Rules.</span></p>
    <p><span>Interpretation.</span></p>
    <p><span>2. In these Rules a word means a thing.</span></p>`;
  const act = parseAct(sr);
  assert.equal(act.provisions[0]?.no, '1', 'the year banner must not lock in as section 1904');
  assert.ok(findProvision(act, '2'), 'the real sections must survive');
});

test('unstructured text that does not open at section 1 is declined, not guessed', () => {
  // Compilation notes: numbers that look like sections but are not.
  const notes = `<p><span>Schedule................</span></p>
    <p><span>am. No. 141, 1987</span></p>
    <p><span>17. Repealed by No. 73, 1988</span></p>
    <p><span>19. Repealed by No. 8, 1979</span></p>`;
  assert.deepEqual(parseAct(notes).provisions, [], 'a wrong guess would file notes under section numbers');
});

test('diffLines marks additions and removals', () => {
  const diff = diffLines('one\ntwo\nthree', 'one\ntwo changed\nthree\nfour');
  assert.deepEqual(
    diff.map((d) => d.kind + d.text),
    [' one', '-two', '+two changed', ' three', '+four'],
  );
});
