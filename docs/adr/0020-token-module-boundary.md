# 0020 — The tokenization module's interface boundary

**Status:** accepted · **Decided by:** engineering · **Blocks:** `TOK-01` through `TOK-27`, `API-21`,
`API-22`, and the core's weight budget

## Context

The tokenization module is optional, and "optional" has to mean something measurable or it becomes a
dependency with extra steps. Three drafts state the boundary and they agree on the principle while differing
on the mechanism:

- The document layer requires that the tokenizer "never sees markup" and consumes rendered-text positions —
  it recommends the tokenizer work from rendered-text offsets only, and records the alternative (element-level
  addressing) as an open question.
- The API draft requires that nothing in the library may depend on the module, enforced by an import-boundary
  lint rule, that `docier.tokens` is `null` when it is off, that no token command is registered, that `w:sdt`
  in an opened file is preserved verbatim as opaque content, and that the module's bundle weight is reported
  separately so it stays optional.
- The editing draft requires that when the module is not installed every trigger is inert and no token
  command exists, and that recognition must never mutate a field code, a locked or module-reserved `w:sdt`, a
  comment author field, or deleted revision text.

The unresolved part is narrower than it appears, and it is worth separating: **where the module reads its
positions from** (rendered text) and **how the core stays unaware of it** (a `TokenController | null`
interface plus a lint rule) are both settled. What was open is whether the tokenizer needs element-level
addressing in addition to text offsets — because a token that spans a run boundary, sits inside a table cell,
or appears in a header is a *markup* reality, and a text-offset-only interface must still be able to insert a
content control at the right place.

## Options

| Option | Tradeoff |
|---|---|
| Text-offset addresses only, with the core performing the insertion | The tokenizer sees a pure string model, which is the property that makes it testable and keeps it out of OOXML. Cost: every token operation becomes "tell the core to do this at this range", so the core gains a general-purpose range-insertion API that must exist anyway — and it does, in the form of the editing commands. |
| Both text and element addresses | Maximum flexibility for the tokenizer. Cost: it makes the module markup-aware, which is exactly the coupling the boundary exists to prevent, and it would let the tokenizer build `w:sdt` itself — a second writer of the model. |
| A token-specific element API on the core (`insertContentControlAt(range, tag)`) | The module stays markup-free and the core owns the OOXML. Cost: a public API that exists for one consumer, which is a smell unless that consumer is shipped — it is, so the boundary is defensible, but the API must be general enough to be honest. |
| The module owns its own part and relationships entirely | Clean separation of storage. Cost: tokens are inline content in the body, not a separate part, so this does not model the problem; and it would put a second part-store writer in the library. |

## Decision

**The boundary is: rendered-text positions in, commands out, and the core owns all markup.** Concretely:

- The module reads text positions of the form `(story, blockPath, offsetInBlockText, affinity)` — the same
  addressing the editing layer uses — and never parses, constructs or mutates OOXML.
- The module acts through commands and the transaction controller: inserting a token issues a command, and
  the core writes the `w:sdt`. The core exposes exactly one token-aware insertion surface, and it is
  general-purpose (`insertContentControlAt`), not token-specific, so the API is defensible as a public
  feature rather than a private favour.
- Storage is `w:sdt` with `w:tag` and `w:alias`, which is the content-control model the document layer
  already specified, so a tokenised document is a normal document with content controls and survives a round
  trip through Word as such.
- The core knows only `TokenController | null`. `src/tokens/**` is imported by nothing in the core, and the
  import-boundary lint rule fails the build if that changes; the module's weight is reported separately in
  the bundle-size gate.
- With the module absent: no token command is registered, no trigger fires, `docier.tokens` is `null`, and
  existing `w:sdt` content is preserved verbatim as opaque content — so a document with tokens opens
  correctly in a build without the module, which is what makes the module genuinely optional rather than
  nominally so.
- Recognition is undo-transparent: it may not create a history entry, and it is cached per paragraph revision
  and invalidated by `docier:doc:change`. Background recognition that mutated history would break the
  "one gesture, one undo entry" invariant from a place the user cannot see.

A block-level `w:sdt` may not span table rows, because OOXML cannot represent it, so block insertion inside a
table is confined to a single `w:tc`; this is a hard rule the module must respect and the core must enforce,
not a limitation to be worked around later.

## Consequences

- The module is testable as a pure function of text and data, with no document fixture required for its
  logic, which is why its unit-test cost is low relative to its size.
- `docier/server` can fill templates with the module present and no DOM, because the fill engine, the token
  parser and the formatting layer are the same modules the browser uses — the split is at the layout and
  render boundary, not at the token boundary.
- The `insertContentControlAt` command is public API and therefore stable: it must be general enough to be
  documented on its own merits (inserting a content control bound to a tag), which is a benefit rather than a
  cost, because a host building its own templating will want it.
- Because the module cannot see markup, it cannot silently corrupt a document: every mutation goes through a
  command with an inverse, and the module's own bug surface is limited to text offsets and data — the two
  things its tests cover directly.
- The `docier/tokens` entry is excluded from the core bundle by construction, and the CI size gate fails if
  the core ever imports it, which is the only way "optional" stays true after a year of maintenance.
