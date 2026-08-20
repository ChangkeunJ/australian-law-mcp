# Tools

Every example below is real output from the Federal Register of Legislation,
captured by running the server. Long passages are cut with `...` and the
attribution paragraph that closes every response is shown as `[attribution]`
after the first example rather than repeated.

The tools chain in one direction. `search_law` gives you a register title id;
everything else takes that id. Register ids look like `C2004A03348` for an act
and `F2019L00196` for a legislative instrument.

| tool | takes |
| --- | --- |
| `search_law` | `query`, optional `limit` (1–50, default 10) |
| `search_full_text` | `phrase`, optional `match` (`exact`/`all`/`any`, default `exact`), optional `limit` |
| `get_law_text` | `titleId`, optional `section`, `full`, `page` |
| `get_law_as_at` | `titleId`, `date` (yyyy-mm-dd), optional `section`, `full`, `page` |
| `get_amendment_status` | `titleId` |
| `compare_versions` | `titleId`, `dateA`, `dateB`, optional `section`, `page` |
| `verify_citations` | `text` |
| `check_frl_health` | nothing |

## search_law

Finds acts and instruments by title. Use it first — the other tools need the
id it returns, not a name.

```
search_law {"query": "income tax rates", "limit": 3}

39 titles match "income tax rates" (showing 3):
C2004A03348  Income Tax Rates Act 1986  [Act, principal, in force]
C2004A02664  Income Tax (Rates) Act 1982  [Act, principal, REPEALED]
C2004A01488  Income Tax (Rates) Act 1976  [Act, principal, REPEALED]

Based on content from the Federal Register of Legislation at 2026-08-20. For
the latest information on Australian Government legislation please go to
https://www.legislation.gov.au. Licence: CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). Not legal advice; the
authorised version is the one published on the register.
```

A one-word query pulls in every instrument made under the act as well. The
principal act is ranked first, but read the status labels before picking an id
— most of what follows is repealed.

```
search_law {"query": "migration"}

2453 titles match "migration"; ranked the 197 the register returned first (showing 10):
C1958A00062  Migration Act 1958  [Act, principal, in force]
F2006B00365  Migration Act 1958 - Notice under section 306AD - May 2004  [LegislativeInstrument, principal, REPEALED]
F2006B00548  Migration Regulations 1994 - Specification of Designated Securities - June 2001  [LegislativeInstrument, principal, REPEALED]
F2013L00850  Migration Act 1958 - Determination under section 175A - Eligible Passports - May 2013  [LegislativeInstrument, principal, REPEALED]
...

[attribution]
```

The count line is precise about what was ranked. The register orders a name
search by a relevance that is flat across every title containing the words, so
only the page it returns first can be ranked locally. `2453 titles match ...;
ranked the 197 the register returned first` means what it says.

Nothing found is stated plainly, not as an empty list:

```
search_law {"query": "zzqq nonexistent statute"}

No titles match "zzqq nonexistent statute" on the register.
```

## search_full_text

Searches the body text of every title on the register. Slower and broader than
`search_law`. Use it when you know a phrase from the law but not its name.

```
search_full_text {"phrase": "working holiday maker", "limit": 5}

72 matches (showing 5 of 72; the register caps how many exact matches it will rank at once):
F2019L00196  Migration Amendment (Working Holiday Maker) Regulations 2019  [LegislativeInstrument, REPEALED]  relevance 44.9 — matched in F2019L00196 (latest version)
C2016A00092  Income Tax Rates Amendment (Working Holiday Maker Reform) Act 2016  [Act, in force]  relevance 42.9 — matched in C2016A00092 (latest version)
F2026L00876  Migration Amendment (Working Holiday Maker Age Criteria) Regulations 2026  [LegislativeInstrument, in force]  relevance 42.5 — matched in F2026L00876 (latest version)
C2016A00089  Treasury Laws Amendment (Working Holiday Maker Reform) Act 2016  [Act, in force]  relevance 41.9 — matched in C2016A00089 (latest version)
F2017L00576  Migration Amendment (Working Holiday Maker Visa Application Charges) Regulations 2017  [LegislativeInstrument, REPEALED]  relevance 40.8 — matched in F2017L00576 (latest version)

[attribution]
```

`match` defaults to `exact`, which means the phrase verbatim. `all` requires
every word anywhere in the text, `any` requires one of them. Widen it when
`exact` returns nothing.

The relevance figure is the register's own score, and it drifts by a few
tenths between calls, so titles scoring close together can come back in a
different order from one run to the next. Rank it as a rough signal, not a
stable ordering.

A match can be in a historical version of a title rather than the current one;
the `matched in ...` note says which, so a hit on repealed text is not mistaken
for current law.

## get_law_text

The current compilation. Without a `section` it returns the table of sections,
which is the cheap way to find the provision you want.

```
get_law_text {"titleId": "C2004A03348"}

Income Tax Rates Act 1986 [C2004A03348]
Compilation No. 66 (register id C2026C00300), in force from 2026-07-01. Status: InForce.
Source: https://www.legislation.gov.au/C2004A03348

Table of sections (pass section="..." for text):
s 1  Short title
s 2  Commencement
s 3  Interpretation
s 3A  Working holiday makers and working holiday taxable income
s 4  Incorporation
s 5  Interpretation
s 12  Rates of tax and notional rates
...

[attribution]
```

With a `section`, the provision itself:

```
get_law_text {"titleId": "C2004A03348", "section": "3A"}

Income Tax Rates Act 1986 [C2004A03348]
Compilation No. 66 (register id C2026C00300), in force from 2026-07-01. Status: InForce.
Source: https://www.legislation.gov.au/C2004A03348

Part I—Preliminary
s 3A  Working holiday makers and working holiday taxable income

(1) An individual is a working holiday maker at a particular time if the individual holds at that time:
(a) a Subclass 417 (Working Holiday) visa; or
(b) a Subclass 462 (Work and Holiday) visa; or
(c) a bridging visa permitting the individual to work in Australia if:
...

[attribution]
```

Schedules are addressable the same way — `section="Schedule 7"` — which matters
because rate tables and forms usually live in a schedule rather than in the
sections.

`full: true` returns the whole text, paginated; pass `page` for the rest.

A section that does not exist says so, with the shape of the act and the
nearest numbers, so the answer can be distinguished from a lookup failure:

```
get_law_text {"titleId": "C2004A03348", "section": "999"}

Provision 999 was not found in this compilation. It has 28 sections and 6
schedules. Closest by number: s 30 (Rate of tax payable by sovereign
entities), s 29 (Rate of tax on no‑TFN contributions income), s 28 (Rates of
tax payable by certain trustees to whom section 98 of the Assessment Act
applies).
```

## get_law_as_at

The same act as it stood on a past date. The register keeps every compilation
with exact in-force windows, so this is the text that applied that day rather
than a reconstruction. Use it for anything historical — a tax year, a visa
decision, conduct under a contract.

```
get_law_as_at {"titleId": "C2004A03348", "date": "2017-01-05", "section": "3A"}

As at 2017-01-05:
Income Tax Rates Act 1986 [C2004A03348]
Compilation No. 48 (register id C2016C01138), in force from 2016-12-02 to 2017-05-19. Status: InForce.
Source: https://www.legislation.gov.au/C2004A03348

Part I—Preliminary
s 3A  Working holiday makers and working holiday taxable income

(1) An individual is a working holiday maker at a particular time if the individual holds at that time:
...

[attribution]
```

The header carries the compilation number and the window it covers, which is
what makes the answer checkable against the register.

Older versions exist as records without retrievable text. The tool says that
rather than returning nothing or falling back to current law:

```
get_law_as_at {"titleId": "C1958A00062", "date": "2001-09-27", "section": "5"}

As at 2001-09-27: Migration Act 1958 [C1958A00062] was in force (from
2001-09-27 to 2001-09-28), but the register holds no electronic text for this
version, so it cannot be shown here. Read it on the register:
https://www.legislation.gov.au/C1958A00062
```

If the date precedes anything the register holds, the reply names the earliest
version instead of guessing.

## get_amendment_status

Whether a title is in force, what its latest compilation incorporates, whether
commenced amendments are still missing from it, and what has amended it.

```
get_amendment_status {"titleId": "C2004A03348"}

Income Tax Rates Act 1986 [C2004A03348] — Act, principal, in force
  1986-11-04: InForce

Latest compilation: No. 66 (C2026C00300), in force from 2026-07-01.
  Incorporates: sch 1 (item 1) of Income Tax Rates Amendment (Tax Reform No. 1) Act 2026 [C2026A00050]

Amended by 86 titles. Most relevant:
  C2017A00015  Tax and Superannuation Laws Amendment (2016 Measures No. 2) Act 2017
  C2018A00047  Treasury Laws Amendment (Personal Income Tax Plan) Act 2018
  C2018A00094  Treasury Laws Amendment (Enterprise Tax Plan Base Rate Entities) Act 2018
...

Source: https://www.legislation.gov.au/C2004A03348
[attribution]
```

Watch for the unincorporated-amendments warning. When it appears, an amendment
has commenced but the compilation you are reading does not yet contain it, so
the current text on the register is not the current law.

## compare_versions

What changed between two dates. Without a `section` it is a section-level
summary: `+` added, `-` removed, `~` reworded.

```
compare_versions {"titleId": "C2004A03348", "dateA": "2016-01-01", "dateB": "2018-01-01"}

Income Tax Rates Act 1986 [C2004A03348]
2016-01-01: Compilation No. ? (C2015C00323)
2018-01-01: Compilation No. 50 (C2017C00189)

+ s 3A  Working holiday makers and working holiday taxable income
+ s 23AA  Meaning of base rate entity
+ s 28A  Rates of tax payable by trustees of AMITs under paragraph 276‑105(2)(b) or (c) of the Income Tax Assessment Act 1997
+ Schedule 10A  Rates of tax payable by an AMIT trustee under paragraph 276‑105(2)(a) of the Income Tax Assessment Act 1997
- s 12C  Rate of temporary flood and cyclone reconstruction levy
- s 24  Rate of tax payable by trustees of corporate unit trusts
~ s 3  Interpretation
~ s 5  Interpretation
~ s 12  Rates of tax and notional rates
~ s 23  Rates of tax payable by companies
~ s 25  Rate of tax payable by trustees of public trading trusts
~ s 35  Temporary budget repair levy for other income tax rates
~ Schedule 7  General rates of tax

Pass section="..." for a line-by-line diff.

[attribution]
```

With a `section`, a line diff of that provision — including the case where it
did not exist on one side:

```
compare_versions {"titleId": "C2004A03348", "dateA": "2016-01-01", "dateB": "2018-01-01", "section": "3A"}

Income Tax Rates Act 1986 [C2004A03348]
2016-01-01: Compilation No. ? (C2015C00323)
2018-01-01: Compilation No. 50 (C2017C00189)

Section 3A did not exist on 2016-01-01; on 2018-01-01:

(1) An individual is a working holiday maker at a particular time if the individual holds at that time:
(a) a Subclass 417 (Working Holiday) visa; or
...

[attribution]
```

`dateA` must be on or before `dateB`; reversing them is an error rather than a
diff reported backwards. When the same compilation covers both dates the answer
says so, which is a stronger statement than an empty diff:

```
compare_versions {"titleId": "C2004A03348", "dateA": "2018-01-01", "dateB": "2018-02-01"}

Income Tax Rates Act 1986 [C2004A03348]
2018-01-01: Compilation No. 50 (C2017C00189)
2018-02-01: Compilation No. 50 (C2017C00189)

Same compilation was in force on both dates — no textual change between them.
```

If either side has no electronic text, no comparison is offered and no
conclusion about whether the law changed is drawn.

## verify_citations

Pulls Australian statute citations out of a block of text and checks each one:
does the act exist, is it in force, does the cited section exist. Run it before
presenting statute citations to a user.

```
verify_citations {"text": "See s 3A and s 999 of the Income Tax Rates Act 1986."}

[OK] Income Tax Rates Act 1986 [C2004A03348] — in force.
  [OK] s 3A exists: "Working holiday makers and working holiday taxable income"
  [NOT FOUND] s 999 — Provision 999 was not found in this compilation. It has 28 sections and 6 schedules. Closest by number: s 30 (Rate of tax payable by sovereign entities), s 29 (Rate of tax on no‑TFN contributions income), s 28 (Rates of tax payable by certain trustees to whom section 98 of the Assessment Act applies).

[attribution]
```

The labels are not interchangeable:

- `OK` — found on the register and in force.
- `NOT FOUND` — checked, and it is not there.
- `NO MATCH` — no such title on the register at all.
- `REPEALED` — it existed and was repealed. A citation to it can only be
  historical, which is different from being wrong.
- `UNVERIFIED` — the register could not be reached or the compilation could not
  be read. This is unknown, not confirmation, and never means the law is
  missing.
- `NOT CHECKED` — the citation points into a Schedule, which this tool does not
  index.

```
verify_citations {"text": "See the Widget Standards Act 1999."}

[NO MATCH] Widget Standards Act 1999 — no such title found on the Federal Register of Legislation.
```

```
verify_citations {"text": "Under the Sea Carriage of Goods Act 1924."}

[REPEALED] Sea-Carriage of Goods Act 1924 [C1924A00022] (closest register title, not an exact name match) — no longer in force by Carriage of Goods by Sea Act 1991. A citation to it can only be historical.
```

The `closest register title, not an exact name match` note appears whenever the
name in the text differs from the name on the register, so a near miss is never
presented as a confirmed citation.

```
verify_citations {"text": "s 18 of Schedule 2 to the Competition and Consumer Act 2010 applies."}

[OK] Competition and Consumer Act 2010 [C2004A00109] — in force.
  [NOT CHECKED] s 18 is cited as being in a Schedule of this act. This tool checks the act's own sections, not provisions within a schedule; read it on the register.
```

This is the Australian Consumer Law case. Section 18 is a provision of Schedule
2, not a section of the principal act, so checking it against the act's own
sections would report a real provision as missing.

Citations are recognised by act names ending in `Act`, `Regulations` or `Rules`
followed by a year. A reference by short form alone, such as "the Australian
Consumer Law", is not recognised as a citation and is not reported at all.

## check_frl_health

Pings the register API. Use it to attribute a failure rather than guessing
whether the upstream or the query was at fault.

```
check_frl_health {}

Federal Register of Legislation API is up: 254 ms round trip, release 2026.08.13-releaseyaml.1+196e8e595528bb8e0d8f473387d92ad1f7907f05.
```

## Attribution

Every response that reproduces register content ends with the attribution the
register's CC BY 4.0 licence requires, and a note that the authorised version
is the one published on the register. Keep it attached when you reproduce the
content further.
