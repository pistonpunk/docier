# 0016 — Strict OOXML: support or detect-and-preserve

**Status:** accepted · **Decided by:** engineering, with a product input on archival customers ·
**Blocks:** `SER-04`, `MOD-01`, and the `document.ooxmlConformance` option

## Context

WordprocessingML exists in two dialects. Transitional (the `w:` namespace as everyone writes it) is what
essentially every producer emits. Strict (ISO/IEC 29500-1 Strict, a different namespace and a different
element-name vocabulary in places) is what some government and archival bodies require on output.

The document layer states the trade-off and leaves it open: whether the initial release supports Strict-mode
input and output or only detects and preserves it, noting that this affects archival customers. The layout
and editing layers are unaffected in principle — they read the model, not the dialect — but a second dialect
does reach into the model, because element names differ and a normalising parser is exactly what rule R3
("untouched bytes stay bytes") forbids doing implicitly.

The relevant fact for the decision is that **detect-and-preserve is nearly free and full support is not**.
Preserving means: recognise the Strict namespace, parse it with the same structural parser, treat the
vocabulary differences as opaque where we do not model them, report the dialect in the loss ledger, and write
back exactly what we read. Supporting means: a bidirectional dialect mapping over every modelled element, a
decision about which dialect we emit when the input was Strict, and a conformance test matrix in both
directions.

## Options

| Option | Tradeoff |
|---|---|
| Full Strict support in the initial release | Archival customers get a first-class path, and we can produce Strict output on demand. Cost: a mapping layer over the entire model, a second conformance matrix, and a new class of bug (a property that maps correctly in one direction and not the other) in the layer everything else depends on. |
| Detect and preserve only (recommended) | Near-zero cost, no new bug class, and a Strict file opens, renders, edits and saves with its dialect intact — because untouched bytes stay bytes and touched elements are mapped on demand. Cost: a document we *edit* in Strict mode may end up with a mixture, since newly written elements are Transitional unless mapped; and we cannot claim Strict output conformance. |
| Reject Strict input with a clear error | Simple and honest. Cost: refuses to open a file the customer is required to use, which is a product failure, and it is strictly worse than preserving because preserving already works. |
| Detect, preserve, and map only the elements we actually write when the input was Strict | The middle path: correct output for the edited parts, no mapping for what we never touch. Cost: the mapping is still per-element work, but it is proportional to the features we implement rather than to the whole of OOXML. |

## Decision

**Detect and preserve in the initial release, with a per-element mapping for elements we newly write when the
input dialect was Strict.** The config key is `document.ooxmlConformance: 'preserve' | 'transitional' |
'strict'`, default `'preserve'`, which is the honest default: we do not change the dialect of a document we
were given, and we report the dialect we detected in the loss ledger and in diagnostics.

The per-element mapping is scoped to the elements the writer can produce, and it is verified in the direction
we actually write (our output must be valid Strict when the input was Strict). Strict output is a separate
claim and is not made until the archival question (ADR-0006) is answered, because a Strict claim and a PDF/A
claim are usually demanded by the same authority.

**The product input is one sentence, and it is a question rather than a decision:** does any target customer
*require* Strict output, as opposed to requiring that we not corrupt a Strict file? The recommendation assumes
the latter, which is what detect-and-preserve satisfies. If the former, this becomes a scheduled feature with
its own matrix, and the archival authority answers it, not engineering.

## Consequences

- A Strict file opens, renders, round-trips and edits without the model needing a dialect abstraction, which
  keeps the layer everything else depends on simple.
- Mixed-dialect risk is contained by the per-element mapping and reported: if a document was Strict and we
  wrote a Transitional element that has a Strict counterpart we have not mapped, the writer reports it as a
  fidelity item rather than silently mixing dialects.
- `mc:Ignorable` handling, namespace-prefix preservation and the schema-order table (shared between insertion
  and `validate()`) already do the heavy lifting, so this decision adds almost no new machinery.
- The conformance test matrix has one direction today; it gains the second direction only if Strict output is
  ever claimed, and that is a deliberate gate rather than an oversight.
