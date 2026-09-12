# 0003 - DEFLATE determinism

**Status:** accepted · **Decided by:** engineering · **Blocks:** `EXP-08`, `PKG-02`, the R6 determinism rule

## Context

Rule R6 promises that the same model, config and library version produce byte-identical export bytes. PDF
streams and zip entries are both DEFLATE-compressed, and the platform compressors are not
determinism-neutral: `CompressionStream('deflate')` in a browser and `zlib` in Node differ in match-finding
and block splitting, and even zlib's output changes between versions and compression levels. Compressing the
same input with different implementations produces different bytes, so a hash-based `/ID` (ADR-0002) and any
byte-comparison test would fail across environments.

The two drafts that touch this disagree in emphasis: the document layer requires a pinned compressor for the
PDF writer (default `pdf.deflate: 'pinned'`) and explicitly rejects native `CompressionStream` for the
deterministic path; the API draft lists `CompressionStream` among optional platform features with a
graceful fallback, treating it as a performance nicety.

## Options

| Option | Tradeoff |
|---|---|
| Native `CompressionStream` everywhere | Fastest, zero bundle cost, no vendored code. Cost: destroys the determinism claim, so `/ID` cannot be a content hash, cross-environment byte comparison is impossible, and the FL0 guarantee becomes a lie. |
| Native for DOCX, pinned for PDF | DOCX output is expected to match Word's own bytes closely (Word uses its own deflate), so a pinned implementation buys less there - but it means two compression behaviours, two test matrices, and a DOCX that differs between a browser and Node, which is exactly the class of bug R6 exists to prevent. |
| Pinned pure-TypeScript DEFLATE everywhere on the export path | One implementation, byte-identical everywhere, no platform variance. Cost: slower than native (measurable but acceptable against the export budgets), plus one vendored dependency to pin and audit. |
| Pinned for export, native for decompression | A read path has no determinism requirement - inflating a file we were given is not an output. Gets the fast path where it is safe. |

## Decision

**Pinned pure-TypeScript DEFLATE on every write path that produces bytes a caller keeps** - PDF streams,
DOCX zip entries, HTML with embedded assets, and any clip reading. Native `CompressionStream` is used only
for **decompression** on the read path and for transient buffers that never leave memory as output bytes.

The config surface is `pdf.deflate: 'pinned' | 'native'`, default `'pinned'`, and `'native'` is documented
as **voiding the determinism guarantee**, not as an equivalent choice. When `'native'` is selected,
`/ID` falls back to a content hash over the *uncompressed* document content so the identifier stays stable
even though the compressed bytes are not, and `export()` reports `deterministic: false` in its result rather
than claiming otherwise.

The vendored implementation is version-pinned, licence-checked (permissive), and covered by a fixture that
compresses the same input on every supported platform and asserts identical output bytes.

## Consequences

- Byte-identical export across Chrome, Firefox, Safari, Node and a worker is achievable and is a CI gate.
- Export is slower than a native path. The budgets allow it: the DOCX save target is under 150 ms for a
  5 MB document and PDF export under 1.5 s, both of which the pinned implementation meets on the reference
  runner; if it ever does not, the fix is a faster pinned implementation, not a native one.
- Encryption is mutually exclusive with determinism (random keys), and the combination is rejected
  explicitly rather than silently degraded.
- A host that explicitly wants speed over reproducibility can have it, and gets a result object that says
  what it gave up.
