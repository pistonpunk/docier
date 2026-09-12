# 0015 — Table-style versus paragraph-style precedence in the cascade

**Status:** accepted for the structure; the exact order is pinned by fixture, per the decision below ·
**Decided by:** engineering · **Blocks:** `LE-008`, `FM-021`, `FM-022`, `FM-016`, `NUM-01`, `STY-02`

## Context

The consolidated cascade resolves once, in pass P0, to flat bags with no inheritance left (SPEC §1.3, §1.4).
The layer order is specified by ECMA-376 §17.7.2 and reproduced by the document layer: `docDefaults` → table
style (with `w:tblStylePr` conditional formatting) → numbering level → paragraph style chain → the
paragraph-mark run properties → character style chain → the run's own `w:rPr`, with paragraph properties
resolving analogously.

Two things are genuinely unresolved in the drafts, and both are recorded as open items:

- **Where table styles sit relative to paragraph styles.** The editing draft's `OI-1` states that sources
  disagree, and that a wrong choice makes a table style either unable to override `Normal` (which is the
  observed Word behaviour in practice) or unable to be overridden by a style. These are opposite failures and
  both are visible.
- **Whether `w:keepNext`, `w:keepLines` and `w:contextualSpacing` are toggle properties.** The document layer
  lists the toggle set and does not include them; the editing draft's `OI-1` flags them as uncertain. A
  toggle resolved as an override produces a different line-break and page-break pattern, so this is a
  pagination-visible difference, not a cosmetic one.

A third question, from `OI-8`, sits at the same seam: space-before suppression at the top of a page is
controlled by `w:compat` settings (`suppressTopSpacing` and the hard-break variant), but the rule that
implements it is a pagination decision. The right resolution is that the property is owned by the formatting
layer and the pagination-time rule is implemented by the layout engine, covered by fixtures on both sides.

None of these can be settled by reading the specification again. They are settled by a fixture and by Word's
observable behaviour.

## Options

| Option | Tradeoff |
|---|---|
| Pick an order from the ECMA-376 text and implement it | Fast, and probably right. Cost: the drafts already found that "sources disagree", and a plausible-but-wrong order is a silent, document-wide formatting difference that no unit test will catch because the test would encode the same wrong assumption. |
| Implement the order as a configurable ordered list of levels | Trivially re-orderable once the right order is known. Cost: a configurable cascade means the resolved bag (and therefore layout) depends on configuration, so `documentHash` must include it, every fixture must be run under every order, and a host can produce documents that disagree with Word. |
| Build the cascade as an ordered list of levels **internally**, verify the order with a fixture, then pin it | Re-orderable during development without being configurable in production. Cost: one fixture-authoring cycle against Word before the affected features can be called done. |
| Defer the question and ship the ECMA-376 order, marking the feature unverified | Ships sooner. Cost: `FM-021`/`FM-022` are `core` and the whole toolbar, reveal-formatting and every style-driven paragraph depends on them; shipping them unverified means shipping the most likely-wrong thing in the system as its foundation. |

## Decision

**Build the cascade as an ordered list of levels, verify the order against Word with a fixture, then pin the
order and lock it with that fixture.** The cascade is internal and **not** host-configurable: a configurable
cascade would make `documentHash` and therefore layout depend on configuration, which is incompatible with
the determinism rule R6. The verification fixture must contain, at minimum: a table style setting one font
and a paragraph style setting another; a table style setting a font that `Normal` also sets; a paragraph
style overriding a table style and vice versa; a conditional `w:tblStylePr` (first row, last row, banded)
competing with a paragraph style; and a paragraph inside a table cell with `keepNext`/`keepLines`/
`contextualSpacing` set at both the table-style and paragraph-style levels, taking a document that must then
break across a page so the toggle question is answered by a page break rather than by a resolved value.

The toggle set is fixed as the document layer listed it — `b`, `bCs`, `i`, `iCs`, `caps`, `smallCaps`,
`strike`, `dstrike`, `outline`, `shadow`, `emboss`, `imprint`, `vanish`, `webHidden`, `specVanish` XOR —
and `keepNext`, `keepLines` and `contextualSpacing` are **overrides, not toggles**, unless the fixture shows
Word treating them otherwise, in which case the fixture wins and this ADR is amended. The toggle rule
matters beyond correctness: the model tracks accumulated state per layer, not a boolean, because an override
model cannot represent a toggle and would produce a wrong resolved value for any run that inherits a toggle
from a style.

Space-before suppression at the top of a page is owned here as a property (including its `w:compat` flags)
and implemented as a pagination rule by the layout engine, with fixtures on both sides.

## Consequences

- The cascade's cost is real and was under-estimated by one draft and correctly estimated by another; the
  consolidated effort is XL, and this ADR is the reason (SPEC §1.6 conflict 14).
- The formatting toolbar, the Font and Paragraph dialogs, reveal-formatting and style queries all consume the
  resolved bags and the provenance chain; **there is exactly one cascade implementation**, which is the
  single largest correctness win in the consolidation, because a second one is how the toolbar and the page
  come to disagree.
- Resolved values are memcached per (paragraph, run) with transitive invalidation through `basedOn` and
  `link` chains, and `w:basedOn` cycles are broken deterministically; the memo key and the cycle-breaking
  rule are part of `documentHash`'s inputs.
- Derived state is never written back, with one exception: applying "bold" to already-bold styled text writes
  explicit `w:b w:val="0"`, because that is the only way to express "not bold" against a style.
- A word-processing behaviour we get wrong here is wrong everywhere at once. That is the risk this ADR
  accepts in exchange for one implementation, and the fixture corpus is the mitigation.
