# 0007 - Whether PDF export belongs in docier at all

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER · **Blocks:** `EXP-01`
through `EXP-11`, the packaging of `docier/pdf`, and the P1 and P5 phases in SPEC §4

## Context

The export draft did not ask this question - it asserts that we write the PDF ourselves and treats the
strategy as settled - and the API draft never mentions PDF export as a product feature at all, listing PDF
only as a test-harness detail (a headless LibreOffice conversion used for interop comparison). So two of the
five drafts disagree about whether PDF is in scope, and the disagreement is invisible in either document
taken alone.

PDF is the most expensive single line of work in the specification. It brings font embedding and subsetting
(ADR-0004), a deterministic DEFLATE implementation (ADR-0003), an EMF/WMF story (ADR-0005), a whole archival
branch (ADR-0006), tagging and PDF/UA, encryption, and a two-phase writer whose correctness is measured
against the screen. It is also, for the HR contract/order/letter persona, plausibly the **primary** output:
the artefact the customer sends to a counterparty is a PDF, not a DOCX.

Three scoping answers are defensible, and the drafts support all three:

## Options

| Option | Tradeoff |
|---|---|
| PDF is core, written by us, with no server | The offline browser requirement is met, parity with the screen is by construction, and the customer's primary artefact is produced by the product. Cost: the largest single engineering commitment in the specification, sustained, and it is the part with the least room for a "good enough" release. |
| PDF is out of core and lives only behind `docier/pdf` / `docier-render` | Core stays small and the weight budget stays honest; a host that does not need PDF pays nothing. Cost: "export to PDF" stops being a library feature and becomes a deployment decision, so a browser-only customer cannot produce the artefact they need. This is what the API draft's silence implies. |
| PDF via the drafting service (`docier-render`) only, office-server style | Fastest to a plausible-looking output and reuses a mature engine. Cost: it contradicts the offline requirement, makes determinism and the loss ledger unverifiable, and turns a document library into a client for someone else's renderer - and the export draft rejected exactly this after analysis. |
| Core writes PDF, but the archival and tagged tiers are deferred behind their own ADRs | The primary artefact works early; the expensive branches (PDF/A, PDF/UA, encryption, EMF vector) are additive and are scheduled on their own merits. |

## Decision

**Recommended: PDF export is in scope, written by us, in `docier/pdf`, with the archival, tagged, encryption
and EMF-vector tiers deferred behind ADR-0006 and ADR-0005.** The initial tier is a plain, deterministic,
font-embedded PDF with correct text positions - which is what the customer's contracts and letters need -
and everything above that tier is additive because the writer's structure (two phases, deterministic
traversal, a resource registry) is chosen to accommodate it.

`docier/pdf` is a separate entry with its own weight budget, dynamically imported by `export('pdf')`, and
never imported by the core. A host that only needs DOCX carries none of it, which is how the cost is
contained even though the feature is in scope. `docier-render` remains available as a server-side reuse of
the same writer for bulk jobs, not as a substitute for it.

**This needs the owner's confirmation**, because it is a scope and priority decision, not an engineering
one: the question is whether shipping a DOCX-plus-PDF library is the product, or whether PDF is a separate
deployment the customer is expected to provide. The recommendation is that it is the product - a contract
workflow that cannot produce the final PDF has not finished the job, and every alternative we analysed
either needs a server or gives up determinism. If the owner declines, the honest consequence is that
`export('pdf')` is removed from the core API rather than shipped as a thin wrapper over someone else's
renderer, and the P1 phase in SPEC §4 loses its PDF exit criterion.

## Consequences

- If accepted: the P1 phase ships a PDF, the divergence detector asserts PDF parity, and the PDF writer's
  cost is carried from P1 onwards rather than at the end. The font and determinism decisions (ADR-0003,
  ADR-0004) become load-bearing from the first release rather than later.
- If declined: `ExportFormat` drops `'pdf'`, `docier/pdf` is not published, `PDF_*` error codes and the
  archival ADR are withdrawn, and the customer needs an external conversion step whose fidelity we cannot
  measure - a real product loss that should be stated to the customer rather than discovered.
- Either way, the layout result stays PDF-ready: it is immutable, in millipoints, and has a single pt
  conversion, so a future PDF writer is not foreclosed. That is deliberate - it is the one decision here
  that does not have to be made before the work starts.
