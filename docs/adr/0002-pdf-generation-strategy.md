# 0002 — PDF generation strategy

**Status:** accepted · **Decided by:** engineering · **Blocks:** every PDF target (`EXP-01`, `EXP-03`,
`EXP-11`)

## Context

We need PDF output that is deterministic, works offline in a browser with no server, honours an annotation
policy, and can carry tagged structure and an archival profile. Four candidate strategies were considered by
the export draft and three were rejected: LibreOffice headless (a server, non-deterministic, a huge
dependency, version drift between environments), HTML plus `window.print()` (the browser decides
pagination, so the PDF cannot match the engine's layout, and there is no tagged-structure or PDF/A path),
Chromium headless (same server and determinism problems), and a third-party assembler such as pdf-lib or
jsPDF (they have no layout engine, weak or absent font subsetting, and no PDF/A or tagging support — and
adopting one puts our determinism claim at the mercy of their release schedule). MuPDF, PDFium and Poppler
WASM are viable renderers but not producers, and are useful only for verification.

## Options

| Option | Tradeoff |
|---|---|
| Server-side rendering service only | Simplest client, but breaks the offline and no-server requirement, and makes "print to PDF" a network round trip. Kept as an option (`docier-render`), not as the primary. |
| Own writer from our own layout result | Full control of determinism, tagging, archival and the loss ledger. Cost: we own the object/stream layer, font embedding, subsetting and colour management — a substantial, low-glamour, high-precision body of work. |
| Own writer, but adopt an assembler for the object/stream layer | Less code to write and a smaller surface to get wrong. Cost: their object ordering and compression choices become ours, which is exactly the determinism we cannot delegate. |
| Own writer plus a vendored pure-TypeScript DEFLATE | Removes the last non-deterministic dependency (see ADR-0003) at the cost of one vendored, pinned, tested dependency. |

## Decision

**We write the PDF ourselves, from our own `LayoutResult`.** The writer is pure TypeScript over
`Uint8Array`, has no DOM dependency, and runs in a browser, a worker and Node. It consumes the same
immutable millipoint layout result the on-screen renderer consumed and re-shapes and re-breaks nothing, so
PDF parity is by construction and a feature that "works on screen but not in the PDF" is a renderer bug by
definition.

We may borrow a low-level object/stream writer if it earns its place, on the condition that it lets us fix
object numbering and ordering ourselves. A pinned pure-TypeScript DEFLATE is vendored for the compression
path (ADR-0003). `@docier/pdf`'s server path (`docier-render`) reuses the same writer rather than
substituting LibreOffice.

Layout is not a precondition for export: when no layout result exists, PDF export computes one on demand
rather than refusing with `LAYOUT_REQUIRED`.

## Consequences

- The PDF path cannot diverge from the screen, because there is only one set of numbers. This is the main
  reason the strategy was chosen, and it is what makes the divergence detector's PDF-parity assertion
  (SPEC §1.2) meaningful.
- We own font embedding, subsetting (ADR-0004), colour, tagging, PDF/A (ADR-0006) and encryption. Each is
  its own risk with its own ADR; the estimate for `EXP-01` to `EXP-10` is correspondingly large.
- Determinism is achievable and testable: `/ID` is a content hash, object order comes from a deterministic
  traversal, and the module carries a lint rule banning `Date.now`, `Math.random` and `crypto.randomUUID`
  outside an allowlisted function.
- A byte-identical-output test across Chrome, Firefox, Safari, Node and a worker becomes a CI gate.
- We must maintain a PDF validator in CI (veraPDF for the archival profiles, and a rasterising comparator
  for the visual check).
