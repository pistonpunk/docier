# 0011 - Where image compression runs, and its defaults

**Status:** accepted for the mechanism; **proposed, awaiting a product decision** for the defaults ·
**Decided by:** engineering (mechanism) and PRODUCT OWNER (quality, PPI ladder, codec matrix) ·
**Blocks:** `OBJ-14`, `MED-01`, `TOK-14`

## Context

The objects draft specifies a compression dialog (apply to this picture only, a target PPI choice, "delete
cropped areas", a before/after size estimate) and assumes compression runs in the browser on a worker with
`OffscreenCanvas`, with a host hook for cases it cannot handle. It then records the open question: in-browser
`OffscreenCanvas`/`WebCodecs` versus a host-provided endpoint, and states that the quality and PPI defaults
and the codec matrix are not settled. The API draft independently lists `OffscreenCanvas` as an **optional**
platform feature with a graceful fallback, and the token module has its own image path (`config.units.imageDpi`
default 96, `config.images.maxPixels` default 8 MP) that must agree with it. So three drafts touch image
handling and only one of them specifies it.

The constraints that decide the mechanism are already fixed elsewhere and are not negotiable: re-encoding on
*resize* is forbidden because it destroys quality and breaks byte equality; a URL is never stored in the
document, because OOXML has no remote-image reference and the file must be self-contained; dropping an
EMF/WMF relationship is forbidden because it silently corrupts the file for Word users; and TIFF, EMF and WMF
are skipped and reported rather than being silently converted to a lossy format.

## Options

| Option | Tradeoff |
|---|---|
| In-browser only (`OffscreenCanvas` + workers) | No server, works offline, no data leaves the machine - which matters for a contract containing personal data. Cost: codec availability differs by browser (WebP is broad, AVIF is not), quality tuning is per-engine and therefore non-deterministic, and a 40-image document is a real CPU burst even on a worker. |
| Host-provided endpoint only | Best quality and codec control, and the server can do batch work. Cost: requires a server, breaks the offline claim, and sends document images to a third party - a compliance question for the customer, not a technical one. |
| In-browser by default, with an injected host endpoint and an explicit policy | Offline by default, escalatable when a host wants server-side quality or batch throughput. Cost: two code paths, so the test matrix doubles and the defaults must be expressible in both. |
| Defer compression entirely to v2 (insert at original size) | Removes a whole risk area from v1. Cost: a 12 MP phone photo in a contract is a 4 MB DOCX, which the customer will notice immediately; the draft has this as `core`. |

## Decision

**Mechanism: in-browser by default, on a worker, via `OffscreenCanvas` and `WebCodecs` where available, with
an injected host endpoint for batch and server paths.** The endpoint is a port on `config.transport` (not
`config.storage`), so a host that provides nothing gets the browser path and a host that provides an endpoint
gets it for the operations it opts into. Without `OffscreenCanvas` the work runs on the main thread in time
slices and the operation is visibly slower and reported as degraded in diagnostics; it never fails because a
platform feature is missing.

The invariants that bound any implementation: compression is **explicit** (a command or a dialog), never
implicit on insert or save; deleting cropped areas is destructive, irreversible, rewrites the media part to
the cropped region and resets `a:srcRect`, and is one undo entry holding a **media reference** rather than a
copy; PNG alpha never converts to JPEG; the default output format equals the input format; TIFF, EMF and WMF
are skipped and reported; the size estimate comes from decoded pixel dimensions and is labelled an estimate,
not a promise.

**The defaults are a product decision and are left open here.** The recommended values are: a PPI ladder of
330 / 220 / 150 / 96 with **220 as the default** for a document destined for print and screen, quality
targeted at "visually lossless at 100% zoom" rather than a numeric knob, JPEG for opaque photographs and PNG
for anything with alpha or few colours, and AVIF/WebP output deferred until the floor browsers (ADR-0008)
all encode them. The owner must confirm these, because they decide what a customer's printed contract looks
like and how large a mailed file is; engineering cannot choose a quality level on the customer's behalf.

## Consequences

- A host that never sets the compression endpoint pays no cost and needs no server, which keeps the offline
  guarantee intact.
- Compression results are **not** byte-identical across browsers, and this is the one place in the
  specification where that is true. It is contained: compressed images are new content the user created by
  asking for them, so determinism is claimed only for the export of a given model, and the model records the
  bytes, not the recipe. A document that is opened and saved without compression is unaffected.
- The `config.images` and `config.units.imageDpi` keys resolve three drafts' worth of loose references, and
  the token module's image path uses the same ingest and de-duplication machinery as a manually inserted
  image, so a company logo appearing in a token and in the body is one media part.
- Because the defaults are open, the `core` priority for `OBJ-14` is not a licence to ship a default nobody
  chose: until the owner decides, the dialog opens with the recommended values shown and no default
  preselected, which is annoying enough to force the decision and honest enough not to bake one in.
