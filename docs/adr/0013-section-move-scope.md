# 0013 - Section move by dragging a heading in the navigation pane

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER ·
**Blocks:** `UI-30`, and the section model's move semantics (`SEC-01`-`SEC-05`)

## Context

The objects draft specifies a navigation pane that lists headings and lets a user reorder a document by
dragging a heading. Dragging a heading moves everything under it, which means moving a span of blocks **that
may contain a section break** - and a section break carries `w:sectPr`: page size, margins, columns, headers
and footers, page borders, line numbering and vertical alignment.

Moving a block range across a section boundary is therefore not a pure block move. It changes which `sectPr`
governs which content, can orphan a header or footer part (a header referenced only by the moved section
becomes dangling, or becomes newly needed by the section that now follows it), and can leave the last section
without its invariant body-level `sectPr`. The draft marks the feature `important` but states the condition:
it ships only if the `sectPr`-carrying move can be **proven correct**; otherwise the pane is navigate-only in
v1, and the trade-off is explicitly not the spec author's to make.

There is a second, quieter correctness constraint from the document layer: `w:sectPr` for the last section
must be a body child while earlier ones live inside a paragraph's `w:pPr`. A move that relocates the final
section's properties into the middle of the document, or vice versa, produces a file Word repairs - which the
document layer's repair-safe rule (`EXD-03`) forbids.

## Options

| Option | Tradeoff |
|---|---|
| Ship drag-to-move for headings, including spans that contain section breaks | The feature is genuinely useful and matches what users expect from a navigation pane. Cost: the hard case is the section-carrying one, and getting it wrong produces a file Word offers to repair - the worst failure class in the whole specification, because it is the customer's file that breaks. |
| Ship drag-to-move, but only for spans that contain **no** section break | Safe by construction and covers the common case, because most documents have one section. Cost: a document with sections gets a control that refuses to move the thing the user is dragging, which must be explained clearly at the moment of refusal, not silently disabled. |
| Navigate-only in v1; no dragging at all | Zero risk, and `core` navigation still ships. Cost: loses an `important` feature the owner asked for, and the pane feels like a table of contents rather than an outliner. |
| Navigate-only in v1, then a dedicated "Move section" command with a confirm step | The semantics are explicit and the user sees the consequences (page setup travels too). Cost: not what the draft's drag interaction describes, so it is a different (and arguably better) feature, and it still needs the same `sectPr` correctness proof. |

## Decision

**Recommended: ship navigate-only in v1, and promote drag-to-move only when the section-carrying move passes
a fixture corpus.** Concretely, the promotion criterion is a corpus that proves, for each of: a move within
one section, a move across a section boundary, a move that carries the final section's `sectPr` into the
middle, a move that carries a middle section's `sectPr` to the end, and a move of a span containing headers,
footers and footnotes, that the resulting file (a) is repair-safe (`EXD-03`), (b) preserves every
`sectPr`-referenced part or reports the orphaning in the loss ledger, and (c) keeps the `w:sectPr` placement
invariant. Until that corpus is green, the pane does not accept a drop on a section-carrying span.

The refusal must be **specific and visible**: not a disabled drag handle, but a drop indicator that turns
negative with the reason ("This heading contains a section break with its own page setup"), because a
navigation pane that silently refuses a drop is read as broken.

**This is a product decision** because it trades a feature the owner asked for against a file-corruption
risk, and the customer's tolerance for the second is not an engineering judgement. Engineering's position:
the risk is real but bounded, the promotion criterion above is objective, and the recommendation is to ship
the safe version and promote it when the corpus passes rather than holding the whole pane back. If no
decision is made, **navigate-only ships**, and the drag interaction is not implemented at all rather than
implemented and restricted, so no user forms an expectation we then refuse.

## Consequences

- The navigation pane is useful in v1 (outline, jump to heading, move within a section if the promotion
  passes) and cannot corrupt a sectioned document.
- The section model must expose "does this block range contain a section break" cheaply, which is a
  `DocumentController` query and therefore public API surface that must exist from the start even if the
  feature that uses it ships later.
- A future promotion is additive: the drop handling and the indicator are chrome, the validation is a model
  query, and the corpus is a test asset - none of it requires reworking the pane.
- If the corpus proves harder than expected, the honest outcome is a documented limitation, not a relaxable
  check; the file-repair failure mode is the one thing this specification will not trade for a feature.
