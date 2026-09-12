# 0006 — Which PDF/A profile to target

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER, with the customer's
archiving authority · **Blocks:** `EXP-09`, and the layout pipeline if A-1b is chosen

## Context

The customer's market implies archival PDF, and the specific profile is a regulatory question, not an
engineering one. The three candidates differ in ways that reach back into the renderer:

- **PDF/A-1b** (ISO 19005-1, PDF 1.4) requires device-independent colour and **forbids transparency**.
  Transparency must be flattened, and the export draft states the consequence precisely: flattening "must be
  decided before layout, because flattening changes what layout renders". In practice that means the layout
  pipeline must either avoid producing overlapping translucent content or carry enough information to
  flatten it, which is a layout input and part of `documentHash`.
- **PDF/A-2b** (ISO 19005-2, PDF 1.7) permits transparency, permits JPEG2000, and permits embedded files.
  It requires no flattening, so the layout pipeline is untouched.
- **PDF/A-3b** (ISO 19005-3) is A-2b plus arbitrary embedded files, which is the shape Factur-X and the
  e-Factura-style e-invoicing formats need. If the product ever needs to attach an XML payload to the PDF,
  A-3 is the only profile that allows it.
- **PDF/A-2u** and **A-3u** add Unicode-mapping requirements on top of the "-b" baseline. The export draft
  notes A-2u is "nearly free for us", because we already emit `ToUnicode` for every embedded font
  (ADR-0004). "Nearly free" is the operative phrase: it is not literally free, and it buys nothing unless
  the authority asks for it.

The draft also flags that the national regimes (Romanian and Russian) differ on whether an embedded XML
payload is expected and whether a **qualified signature** is required, and that the specific profile "must be
confirmed with the customer's archiving authority before we claim compliance".

## Options

| Option | Tradeoff |
|---|---|
| A-1b | The most widely accepted profile and the strictest, so it satisfies every other profile's consumers. Cost: transparency flattening becomes a **pre-layout input**, adding coupling to the layout pipeline and a constraint the renderer must respect forever; and it forbids embedded files, so no Factur-X path. |
| A-2b (recommended) | Satisfies modern archiving requirements, permits transparency, so layout is untouched and the coupling disappears. Cost: older validators and a few archival regimes accept only A-1b; and it still forbids embedded files. |
| A-2u | Adds Unicode-map conformance on top of A-2b at near-zero cost, because our fonts already carry `ToUnicode`. Cost: only worth claiming if the authority asks, and claiming more than is needed invites a stricter review. |
| A-3b or A-3u | The e-invoicing shape: embedded XML is permitted. Cost: only justified if the product must attach a payload; otherwise it is a broader claim than needed. |
| Ship A-2b now, add A-1b if the authority requires it | Defers the layout coupling until it is proven necessary. Cost: if A-1b is required later, the flattening constraint lands retroactively in the layout pipeline, which is the expensive moment to add it. |

## Decision

**Recommended: PDF/A-2b as the default archival profile, with A-2u offered as an option and A-3b used only
when an embedded payload is required.** Verification runs in CI with veraPDF, and the profile is recorded in
the XMP metadata with a well-formed `pdfaExtension`.

A-1b is supported as a target only behind an explicit decision, because choosing it is a decision about the
layout pipeline, not just about the writer: it must be made **before the layout result is frozen**, and it
adds a permanent constraint to every pass that can produce overlapping content. It must not be enabled by a
config flag at export time as if it were free.

**This is a product decision, and it cannot be closed by engineering.** The questions that must be answered
by the owner, with the customer's archiving authority, are: (1) which profile is accepted in the Romanian
and Russian regimes the product targets; (2) whether an embedded XML payload is expected, which forces A-3;
and (3) whether a qualified signature is required, which is a separate signing project and not a profile
question. Until answered, **A-2b ships**, with the profile configurable, and we claim no compliance for any
regime we have not verified.

## Consequences

- If A-2b is accepted, transparency is unrestricted and the layout pipeline is unchanged, which is the
  cheapest and most likely outcome.
- If A-1b is required, the flattening rule must be added to the layout specification as an input, the
  affected features re-estimated, and every fixture re-verified; the divergence detector gains a check that
  the flattened output still matches the engine's numbers.
- A claimed profile that fails verification is worse than an unclaimed one, so veraPDF in CI gates the claim
  and a failure fails the build rather than emitting a warning.
- Encryption and PDF/A are mutually exclusive, so an archival mode and an encrypted mode are separate paths
  and the combination is rejected explicitly.
- The `pdfa` option lives in `docier/pdf`, so a host that never exports an archival PDF carries none of it.
