# australian-law-mcp

MCP server for the [Federal Register of Legislation](https://www.legislation.gov.au).
Ask what Australian law said on any date, and check citations against the
official register before you rely on them. No API key, nothing to sign up for.

Everything is served live from the Commonwealth's own legislation API:
130,000+ acts and legislative instruments, every compilation of each one, back
to 1901. That register is the authorised source of Commonwealth law, and it
publishes point-in-time versions natively — so `get_law_as_at` returns the
text that was actually in force on the date you name, not a reconstruction.

## Quick start

Claude Code:

```
claude mcp add australian-law -- npx -y australian-law-mcp
```

Claude Desktop, Cursor, or any other stdio MCP client:

```json
{
  "mcpServers": {
    "australian-law": {
      "command": "npx",
      "args": ["-y", "australian-law-mcp"]
    }
  }
}
```

Requires Node 20 or newer. The `npx` recipes above resolve the package once it
is on npm; until then, clone this repository, run `npm install && npm run build`,
and point the client's `command` at `node` with `args` `["/path/to/dist/index.js"]`.

## Tools

| tool | what it does |
| --- | --- |
| `search_law` | Find acts and instruments by name. Returns the title ids the other tools take. |
| `get_law_text` | The current compilation: the table of provisions, one section, or the full text paginated. Schedules are addressable too (`section="Schedule 7"`), which is where rate tables and forms actually live. |
| `get_law_as_at` | The same, but as the law stood on any past date. |
| `verify_citations` | Pull statute citations out of text and check each against the register: does the act exist, is it in force, does the cited section exist. Upstream failures come back as UNVERIFIED, never as a missing law. |
| `get_amendment_status` | In force or repealed, what the latest compilation incorporates, whether commenced amendments are still unincorporated, and what has amended it. |
| `compare_versions` | What changed between two dates: sections added, removed, reworded — or a line diff of one section. |
| `search_full_text` | Relevance-ranked search over the body text of every title on the register. |
| `check_frl_health` | Ping the register API so failures elsewhere can be attributed. |

## Why point-in-time matters

Tax disputes, visa decisions, contracts and court matters turn on the law as
it stood on a past day, and models reliably answer with today's law instead.
The register keeps every compilation with exact in-force windows:

```
get_law_as_at titleId=C2004A03348 date=2017-01-05 section=3A
→ As at 2017-01-05: Income Tax Rates Act 1986, Compilation No. 48
  s 3A  Working holiday makers and working holiday taxable income ...
```

And `verify_citations` is the guard rail for the other direction — models
inventing sections that were never enacted:

```
verify_citations text="See s 3A and s 999 of the Income Tax Rates Act 1986."
→ [OK] Income Tax Rates Act 1986 [C2004A03348] — in force.
    [OK] s 3A exists: "Working holiday makers and working holiday taxable income"
    [NOT FOUND] s 999 — Provision 999 was not found in this compilation. It has
      28 sections and 6 schedules. Closest by number: s 30, s 29, s 28
```

A real law reported missing is the worst failure a tool like this can have, so
network and API errors are always reported as UNVERIFIED rather than NOT FOUND,
and a section is only checked against an act when the citation actually binds
the two together.

The same rule governs the text itself. The register has published in three
different formats since 1901, and the oldest of them — as-made scans of acts
from the federation era — carries no structural markup at all, only the
numbering in the prose. Those are read from their own numbering, and the
result is accepted only when the section numbers it recovers run in order from
section 1. When they do not, the tool says the compilation could not be read
rather than reporting an act with no sections or filing one section's words
under another's number.

## Scope

Commonwealth legislation only, by design. State registers either have no open
API (Vic), sit behind bot challenges (NSW), or require registration (Qld).
Case law databases (AustLII, Jade) do not permit automated access, so there is
no case-law tool. ATO rulings are not machine-accessible. If any of that
changes, the scope can grow.

## Data source and licence

Legislative content comes from the Federal Register of Legislation API and is
licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) by the
Commonwealth of Australia; every response that reproduces register content
carries the register's required attribution. This project is independent: not
affiliated with or endorsed by
the Office of Parliamentary Counsel or the Australian Government. Output is
legal information, not legal advice — the authorised version of any law is the
one published on the register.

Code is MIT.

## Development

```
npm install
npm test                        # build + unit tests (offline)
node scripts/smoke.mjs          # live API smoke test
node scripts/protocol-test.mjs  # stdio round trip against the live API
```
