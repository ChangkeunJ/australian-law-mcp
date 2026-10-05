# Security

## Reporting

Report a vulnerability through GitHub's private vulnerability reporting at
https://github.com/ChangkeunJ/australian-law-mcp/security/advisories/new
rather than in a public issue. Expect an acknowledgement within a week.

Only the latest release on npm is supported.

## What this server is

A stdio MCP server. It opens no network listener, has no authentication
because it has nothing to authenticate, and holds no secrets: the Federal
Register of Legislation API needs no key. The only hosts it ever contacts are

- `api.prod.legislation.gov.au`, for everything the tools answer, and
- `registry.npmjs.org`, once at start-up, to say whether a newer release
  exists (`AUSTRALIAN_LAW_MCP_NO_UPDATE_CHECK=1` turns that off).

A response that a redirect carried to any other host is refused, not read.

The trust boundary is the MCP client. Whoever can send it tool calls can make
it read legislation; they cannot make it do anything else. Legislation text
is returned to the model verbatim. It is the authorised record of
Commonwealth law, but to the model it is data, not instructions, and clients
should treat it as such.

## Resource bounds

| what | bound |
| --- | --- |
| `verify_citations` text | 50,000 characters; the first 25 citations are checked and the rest named |
| `search_law` query, `search_full_text` phrase | 500 characters |
| section numbers | 100 characters |
| title ids | letters and digits only, checked before any request is made |
| JSON from the register | 10 MB per response, 64 MB held in cache |
| epub from the register | 300 MB per download; only the document entries are inflated, at most 256 MB each and 512 MB together; images and fonts never are |
| parsed compilations | 8 held in cache, 12 million characters together |
| one register request | 30 seconds, retried once except after a timeout |
| a cancelled tool call | its register requests stop as well |
| one stdio message | 10 MB, the SDK's own limit |

The pattern that pulls citations out of text is bounded to twenty tokens per
act name, so a long run of capitalised words costs linear time.

## Supply chain

- Three production dependencies, locked, audited in ci at high severity and
  checked against the registry's signatures.
- GitHub Actions are pinned to commit shas; dependabot moves the pins weekly.
- Releases are published from a tag by GitHub Actions with OIDC trusted
  publishing, so every version on npm carries provenance. The registry
  publisher is a pinned release verified by sha256 before it runs.
- The Docker image is built in two stages from a digest-pinned base, runs as
  the node user and holds only the production modules.

## Accepted risks

- The XHTML inside the register's epubs is read with a regular expression
  that, on a paragraph never closed, scans to the end of that document. The
  register generates well-formed XHTML and serves it over TLS, so this is
  accepted rather than bounded further.
- The update notice trusts registry.npmjs.org over TLS to say what the latest
  version is. It only ever produces a line of advice; it never installs
  anything.
