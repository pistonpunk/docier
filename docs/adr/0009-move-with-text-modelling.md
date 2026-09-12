# 0009 - Modelling "Move with text"

**Status:** accepted · **Decided by:** engineering · **Blocks:** `OBJ-25`, `OBJ-23`, `OBJ-35`

## Context

"Move with text" is a checkbox in Word's Layout Options. Checked (the default), a floating object travels
with its anchor paragraph as the text reflows; unchecked, the object stays at a fixed position on the page
while the text moves around it.

**OOXML has no `moveWithText` attribute.** This is the one place in the objects draft where a Word UI state
has no direct attribute, and the draft correctly refuses to invent one and asks for an ADR before
implementation. Word derives the checkbox from the vertical reference frame: `wp:positionV/@relativeFrom`
values `paragraph` and `line` behave as "move with text", while `page` and `margin` behave as "fixed".

A second, separate checkbox exists in the table-cell case: `wp:anchor/@layoutInCell` - `"1"` (the default)
means the object moves with the cell, `"0"` means it is positioned relative to the page and does not move
with the cell. Word calls the latter "Fix position on page". It coexists with "Move with text" and maps to a
real attribute, so it is a distinct control, not a derivation.

## Options

| Option | Tradeoff |
|---|---|
| Store our own flag in a custom part or an extension attribute | The checkbox round-trips through us exactly. Cost: it is invisible to Word, so a file we save and Word re-saves loses it, and the document gains a proprietary part that other tools drop - the worst outcome for a format we claim to round-trip. |
| Derive the checkbox from `wp:positionV/@relativeFrom` on read and rewrite it on toggle | No proprietary storage, and the state is exactly what Word itself would show for the file. Cost: it is a derived view, so it cannot represent a state the frame cannot express, and a toggle must rewrite the frame without moving the object on screen. |
| Derive on read, and refuse the toggle when the frame is ambiguous | Safer against surprise. Cost: refuses a control Word offers, for a case that is real but rare, and a disabled control with no explanation is worse than a rewrite that preserves position. |
| Model the frame as the only state, with no checkbox concept at all | Honest and minimal. Cost: the host UI then has to re-derive the notion of "move with text" itself, so the derivation moves into every host - the same bug, multiplied. |

## Decision

**Derive it, and make the derivation a documented part of the public API.** "Move with text" is a derived
view over `wp:positionV/@relativeFrom`: `paragraph`/`line` are checked, `page`/`margin` are unchecked.
Toggling rewrites `relativeFrom` **and preserves the object's resolved on-screen position** by recomputing
`wp:posOffset` against the new frame, so a toggle moves the frame and not the object.

`object.anchor.set({ ids, moveWithText })` performs the toggle and `object.anchor.set({ ids, locked })` sets
`wp:anchor/@locked="1"`; both emit `object.changed`. The table-cell case is exposed separately as
"Fix position on page" over `wp:anchor/@layoutInCell`, with `wp:anchor/@allowOverlap` governing overlap when
`layoutInCell="0"`, because it is a real attribute and must not be conflated with the derived checkbox.

The round-trip fidelity of this feature is a **fixture-tested claim, not an assumption**: a document with an
object anchored to `paragraph`, to `page` and to `margin` must survive us opening and saving it unchanged,
and the case that must be verified against Word is which frame Word writes when it re-saves a file we
produced. That verification is the implementation's exit criterion, and until it passes the feature is
marked as unverified in the fidelity ledger rather than claimed as FL1.

Anchoring is forbidden in specific places and the model enforces them: never in a field instruction, never
in tracked-deleted text, never in comment or footnote content, and never in an empty paragraph before a
section break.

## Consequences

- A host shows the checkbox from the derived value and never stores one, so the state cannot drift from the
  file.
- A toggle is a two-step mutation (rewrite frame, recompute offset) that must be one transaction and one
  undo entry, or the editing draft's one-gesture-one-entry invariant is broken.
- A file whose frame is something other than the four known values (a future or producer-specific
  `relativeFrom`) degrades to "unchecked, frame preserved", and the object does not move on toggle; this is
  reported as a diagnostic rather than silently guessed.
- `object.anchor.moved` is emitted internally when text reflow moves the anchor, so the object layer can
  reposition without re-anchoring - anchor maintenance is a text-engine responsibility and the object layer
  must not re-anchor on its own.
- The feature is testable without Word for the read path, and requires Word only for the re-save direction,
  so the risk is bounded and visible.
