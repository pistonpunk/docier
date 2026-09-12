# 0005 — EMF and WMF handling in PDF export

**Status:** accepted · **Decided by:** engineering · **Blocks:** `EXP-06`, and the fidelity level claimed
for documents that contain pasted charts or signatures

## Context

PDF cannot embed EMF or WMF. Both are metafiles — recorded sequences of drawing operations — that Word
documents carry for pasted charts, pasted Visio or CAD fragments, and, importantly, **signature images and
stamps**, which are vector and are the artefacts a customer cares about most. The document layer's format
table lists two strategies and no third: (a) a record-replay vector path that parses the metafile and
re-emits its operations as PDF vector operators, which is higher quality and much larger effort, or
(b) rasterise to a bitmap at a chosen DPI and embed that. The draft's recommendation is "ship (b) first,
(a) later", noting that this is the biggest quality-versus-size lever in PDF export.

Two constraints shape the answer. Determinism: rasterisation must produce identical pixels on every platform,
which means our own rasteriser or a pinned one, not a platform codec. Layout: the object's intrinsic size and
therefore its placement is the same either way, so this decision does not put pressure on the layout
pipeline — unlike the PDF/A-1 transparency question (ADR-0006).

## Options

| Option | Tradeoff |
|---|---|
| Rasterise at print DPI (300) always | Correct, simple, deterministic, and visually identical to the screen at normal zoom. Cost: a signature embedded at 300 DPI is a large lossless-or-JPEG bitmap, and zooming a printed page shows soft edges. Size grows with the object's placed size. |
| Rasterise at screen DPI (150) | Smaller files. Cost: visibly soft for a signature or a fine chart, and the default screen rendering in a browser is lossy in a way a printed contract is not. |
| Record-replay vector path | Perfect print quality, tiny files, zoom-independent. Cost: a metafile interpreter (EMF and WMF both), a mapping from GDI-style operations to PDF operators, font handling for text in the metafile, and a large test matrix — realistically an XL feature on its own. |
| Convert EMF/WMF to SVG once at ingest and reuse | One conversion, two consumers (screen and PDF), and SVG can be vector. Cost: the conversion is the same interpreter as the option above, plus an SVG-to-PDF vector bridge; it does not remove the work, it moves it. |

## Decision

**Rasterise first, at print DPI by default, and schedule the record-replay path as a separate feature.**
Rasterisation runs through a deterministic rasteriser at a placement-derived DPI, capped by the object's
intrinsic resolution so we never upscale a low-resolution source. The chosen DPI is recorded per object and
reported in the loss ledger, so a customer can see which images were rasterised and at what resolution.

The rasterisation is cached by content hash in the media registry, so the same metafile placed twice — a
company logo on every page — is rasterised once and embedded once as a shared `/XObject`. That is the same
"images embedded once, shared across `/XObject`s" rule the format table already states for bitmaps, and it
is what keeps the size cost of this decision acceptable.

The record-replay path is scoped as its own feature with its own ADR **before** it is implemented. It is not
a background improvement: it needs a metafile interpreter and a font story, and pretending it is a
refinement of rasterisation is how it never gets scheduled honestly.

## Consequences

- Documents with a vector signature print at 300 DPI rather than infinitely sharp. This is a customer-visible
  quality difference and should be stated to the owner, but it is honest: the alternative is shipping
  nothing for those documents, or shipping the interpreter late and untested.
- File size grows with the number of distinct metafiles, not with the number of placements, because of the
  content-hash cache.
- Determinism is preserved only if the rasteriser is ours or pinned; a platform canvas is not acceptable for
  the export path, because it varies by GPU, driver and browser version.
- A metafile that fails to rasterise produces a visible placeholder plus a loss-ledger entry and a
  diagnostic — never a silently missing image, which is the failure the document layer's R2 forbids.
- The same rasterised bitmap is reused for screen rendering where the object is displayed at a size that
  does not justify vector, which keeps the renderer simple.
