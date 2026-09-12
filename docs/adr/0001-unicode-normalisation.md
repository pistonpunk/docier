# 0001 — Unicode normalisation of document text

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER · **Blocks:** plain-text,
HTML and Markdown export (`EXO-01`), typing and paste (`ED-015`), find and proofing (`ED-032`, `ED-036`)

## Context

Romanian can be written either precomposed (`ș` U+0219) or as a base letter plus a combining mark
(`s` U+0326), and both appear in real documents. Normalising to NFC changes the document's bytes. The
document layer's rule R3 ("untouched bytes stay bytes") and its round-trip guarantee FL1 make normalising
loaded text a fidelity regression, but comparing text without normalising makes find, spellcheck and
collation miss matches: the same word can sit in one document in two byte sequences.

The editing draft already chose an asymmetry — text **typed or pasted** is normalised to NFC, text **loaded
from a DOCX** is preserved byte-for-byte — and recorded it as an open item (`OI-2`) needing confirmation.
The export draft recommends the same asymmetry for export with an opt-in normalise, and states plainly that
this is a legal text-fidelity question, not a technical one.

## Options

| Option | Tradeoff |
|---|---|
| Always preserve, never normalise | Lossless and legally safest. Find, spellcheck and collation must normalise their own operands, so their behaviour differs from the stored bytes; a hand-typed word may not match an identical-looking word in a template. |
| Always normalise to NFC | Consistent comparison everywhere with no special cases. Silently rewrites document bytes on load, changes a contract number if the customer's validator is byte-sensitive, and breaks FL0/FL1 on files we did not otherwise touch. |
| **Normalise on input, preserve on load** (typed and pasted → NFC; loaded → byte-for-byte) | The customer's stored documents are untouched, so a round trip is lossless; new typing is clean, so newly authored text has one form. Cost: a document can contain two spellings of one word, so every comparison path must normalise its operands anyway, and the asymmetry must be documented or it looks like a bug. |
| Never normalise, and additionally refuse to store combining sequences we generate | A subset of preserve, and it makes correct Romanian typing impossible with a combining-mark keyboard layout. Rejected. |

## Decision

**Adopt the asymmetry.** Typed and pasted text is normalised to NFC; loaded text is preserved byte-for-byte.
All comparison paths — find, replace, proofing, collation, token matching — normalise their **operands**
rather than the stored text, and never write back what they normalised. The pipeline order for input is
fixed as composition → NFC → combine with the previous character if the platform delivered a standalone
combining mark → insert.

The default is therefore `document.textNormalization: 'preserve'`. An opt-in `'nfc'` mode exists for a host
that wants it, and it is documented as changing document bytes and voiding FL0/FL1 for the affected runs.

Because this decides what constitutes a legally identical string, the customer's archiving and legal
review must confirm it. **The engineering recommendation is `preserve`; if no decision is made, `preserve`
ships, because it is the reversible choice — a host can normalise afterwards, and nobody can un-normalise a
document we already rewrote.**

## Consequences

- Round-trip fidelity is unaffected for files the user only opened and saved, which is what makes FL0/FL1
  claims honest.
- Find, replace and proofing carry a normalisation step on the query and on the candidate, and the
  performance budget must account for it; the comparison path is the only place `String.prototype.normalize`
  is called.
- A Romanian fixture with `s`+U+0326 and a twin with U+0219 must match in find and must not be silently
  rewritten; this is a required test for `ED-032` and `ED-036`.
- Export in plain-text, HTML and Markdown follows the same rule: preserve by default, with a normalise
  option that is off unless asked for.
- Token keys and catalogue keys are compared in NFC on both sides so a template authored on macOS and a
  catalogue generated on Windows agree.
