# 0004 - CFF and OpenType font subsetting

**Status:** accepted · **Decided by:** engineering · **Blocks:** `EXP-04`, `EXP-05`, every PDF target

## Context

Every font used in a PDF must be embedded - there is no "standard 14" reliance, and Identity-H encoding
with a CID font and a `ToUnicode` CMap is mandatory because WinAnsi cannot represent `U+0218`-`U+021B`
(Ș ș Ț ț) or Cyrillic at all. Embedding the full font is correct but large: a Cyrillic-complete serif or a
Calibri-metric font is several hundred kilobytes, and a 40-page document with three families and four styles
pays that repeatedly in a file that is mailed to a customer.

TrueType (`glyf`-based) subsetting is well-trodden: keep the used glyphs, `.notdef`, composite components
and reachable glyphs, rebuild `loca`, `glyf`, `hmtx` and `cmap`, keep `head`, `hhea`, `maxp`, `OS/2`, `name`
and `post`, and 4-byte-align the `glyf` offsets. CFF and OpenType-with-CFF outlines are the hard case: it
requires rewriting the CharStrings index, rebuilding the charset and the private dict, and re-indexing, and a
subtlty broken CFF subset renders as garbage in some viewers and fine in others - the worst failure mode,
because it passes a spot check.

The export draft recommends embedding full CFF at first and subsetting later, with an explicit rule: do not
ship a CFF subsetter that has not been verified.

## Options

| Option | Tradeoff |
|---|---|
| Subset CFF and TrueType together from day one | Smallest output immediately. Cost: the CFF path is the one most likely to be subtly wrong, and a wrong subset is a corrupted document that our own tests may not catch. |
| Full CFF, subset TrueType | TrueType gets the size win (the common case for body text), CFF stays correct. Cost: an OpenType/CFF family used heavily still bloats the file. |
| Full embed for both, subset both later | Maximum safety, maximum size. Cost: unacceptable for the mailed-contract use case where size matters to the customer. |
| Full CFF, subset TrueType, and **verify** a CFF subsetter against a corpus before enabling it | Same as option 2 plus a path to the size win. Cost: the verification corpus and the CFF subsetter itself are real work that must be scheduled rather than assumed. |

## Decision

**Subset TrueType; embed full CFF until a CFF subsetter has passed a verification corpus.** The subsetter,
when it lands, is gated behind a flag that defaults to full embedding, and the gate is lifted only when the
corpus passes across the reference viewers.

The glyph set is computed before subsetting and must include **generated** content, not only text the model
contains: bullet characters, list numbers in every numbering format we support (including `russianLower`),
page-number and field-result digits, and `w:sym` symbol glyphs. Missing a generated glyph is how a subset
silently loses a bullet.

Subset glyph order is sorted **by glyph id, not by first use**, because first-use ordering depends on layout
traversal and would break determinism (ADR-0003). Licence bits are honoured: `0x0002` (restricted) fails
with a named font rather than producing an unusable file, `0x0200` (no subsetting) embeds the full font, and
`0x0100` embeds and flags it. `ToUnicode` is emitted for every font, including private-use characters.

## Consequences

- PDF size is acceptable for TrueType text and larger than it could be for a CFF-heavy document. The loss
  ledger records which fonts were embedded in full and why, so the cost is visible rather than mysterious.
- Barcode fonts hard-fail when absent rather than substituting a lookalike, because a wrong barcode is worse
  than a failed export.
- Fonts must be resolved and loaded **before** emission (the two-phase writer of ADR-0002), because
  subsetting cannot happen while objects are being written.
- Licensing review of the bundled font set is a prerequisite (ADR-0017), since embedding and subsetting a
  font is what its licence actually restricts.
