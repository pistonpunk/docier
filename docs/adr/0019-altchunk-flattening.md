# 0019 - `altChunk` flattening

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER ·
**Blocks:** `SC-07`, and the template import pipeline it would require

## Context

`w:altChunk` is a reference to an external fragment - a whole HTML document, RTF file or even another DOCX -
that Word merges into the document when it opens it. Word's behaviour is to import the referenced content
into the body on save, replacing the reference. Our behaviour is specified as the opposite: `altChunk` is
preserved as opaque markup, "never flatten implicitly", because flattening it means running a full import
pipeline (parse HTML or RTF into our model, with all the fidelity questions that implies) and because an
implicit flatten changes the document's bytes and content in a way the user did not ask for.

The document layer records the resulting question as open, and frames it as a product question rather than a
technical one: "whether the template product needs it at all ... If yes, it is a whole import pipeline
(SC-07) that must be scoped separately."

This matters more than it looks, because `altChunk` is the standard mechanism a document-generation pipeline
uses to inject generated content - a letter assembled from a template plus a body produced by another system.
If the customer's templates use it, then a document that opens with a preserved `altChunk` renders in our
editor **without** the content Word would show, which is not a fidelity gap the user will tolerate: the
content is simply missing from their view.

## Options

| Option | Tradeoff |
|---|---|
| Preserve as opaque, never flatten (the specified default) | No new bug class, no import pipeline, byte-exact round trip, and Word still merges the content when the customer opens the file. Cost: our editor shows a document that is missing content Word would display, so the on-screen document and the exported PDF differ from Word's rendering - and the user sees a hole with no explanation. |
| Preserve, but render a visible, named placeholder where a chunk sits | The user is told the content exists and is not shown it, and the loss ledger records it. Cost: it is still missing, and a placeholder in the middle of a contract is alarming; but it is honest, which the "nothing silently dropped" rule requires. |
| Flatten on load (Word's behaviour) | The editor shows what Word shows, and the template workflow is complete. Cost: a full HTML/RTF import pipeline (`SC-07`), a second parse-and-map layer whose fidelity questions are as hard as DOCX's, and an implicit content change that violates the "never flatten implicitly" rule unless it is opt-in. |
| Flatten on demand: a `flattenAltChunks()` command, never automatic | The capability exists, is explicit, and is one undo entry; the default remains lossless. Cost: the user must know to invoke it, and the pipeline still has to be built. |
| Flatten only the formats we can do well (HTML), preserve the rest | Proportional effort and a real capability. Cost: a chunk that is RTF silently stays unflattened while an HTML one works, so the behaviour depends on a format the user cannot see. |

## Decision

**Recommended: preserve by default with a visible, named placeholder, plus an explicit
`flattenAltChunks()` command; do not flatten implicitly and do not flatten on load.** The placeholder names
the chunk's target part and its type, appears in the loss ledger, and is never printed into the exported PDF
as content - an export that cannot represent a chunk records it and warns, it does not silently omit it. The
implicit-flatten rule stays absolute, because a load that rewrites document content is exactly what rule R3
forbids.

If flattening is enabled, it is a one-way import into the model with its own fidelity level (FL3, declared
lossy, opt-in) and its own loss-ledger entries, and it is a **separate scheduled feature** - a whole import
pipeline, not a refinement of the DOCX parser.

**This is a product decision** because the answer depends entirely on whether the customer's templates use
`altChunk`: if they do not, the placeholder is enough and no pipeline is needed; if they do, the pipeline is
on the critical path for the template product and must be scoped and scheduled as its own phase. The
question to put to the owner is concrete: *do the templates we must support contain `w:altChunk`, or content
injected by a document-generation pipeline?* If the answer is unknown, the placeholder ships and the question
is asked again when a real template arrives - which is the cheap direction, because the placeholder is also
what makes the situation diagnosable.

## Consequences

- A document containing a chunk opens without corrupting anything, and the user is told what is not shown
  instead of seeing a silent gap; the divergence detector does not treat the placeholder as a layout
  difference from Word, because it is not one.
- Exporting such a document records the chunk in the loss ledger at every format, and a PDF that omits it
  says so - the "never silently dropped" rule applied to an export we cannot fully honour.
- If the pipeline is scheduled, its scope is bounded by the formats the customer actually uses; HTML first
  (the common case and the one Word uses for generated content), RTF only if a real template demands it, and
  a chunk-of-DOCX case treated as a nested document import with its own id remapping problem.
- Preserving rather than flattening keeps the door open in both directions: a chunk we preserved can be
  flattened later by the customer in Word or by us with a command, but a chunk we flattened cannot be
  un-flattened.
