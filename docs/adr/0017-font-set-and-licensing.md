# 0017 — The bundled font set and its licensing

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER, with licensing review ·
**Blocks:** `LE-012`, `LE-013`, `FM-025`, `QUA-20`, every metrics-dependent test, and PDF font embedding

## Context

Fonts are a layout input and are part of `documentHash`, so the bundled set is not a cosmetic choice: it
decides what a document looks like when the customer's own font is absent, and it decides whether our golden
layout tests are stable across machines. Two drafts specify a set and they overlap only partly:

- The layout draft bundles DejaVu Sans/Serif, Liberation Serif/Sans/Mono and a Cyrillic-complete serif.
- The API draft's fixtures pin Carlito, Caladea and Liberation as the metric-compatible set.

Both requirements are real and they are different requirements. **Metric compatibility** is what makes a
substituted font lay out like the one it replaces: Carlito is metric-compatible with Calibri, Caladea with
Cambria, and Liberation Serif/Sans/Mono with Times New Roman, Arial and Courier New. **Coverage** is what
keeps Romanian and Russian from rendering tofu: DejaVu and a Cyrillic-complete serif. A set that satisfies
one and not the other either lays out a substituted Calibri document wrongly or renders Cyrillic as boxes —
and the product's scripts are Latin and Cyrillic (SPEC §1.6 conflict 8), so coverage is not optional.

Licensing is the other half of the decision, and it is why this cannot be an engineering call. Embedding and
**subsetting** a font in a PDF (ADR-0004) is precisely the use a font licence restricts, and the licence
bits in the font binary are a technical expression of the licence, not a substitute for reading it. A font
whose licence forbids subsetting, or requires a notice we do not ship, or is GPL, cannot be bundled in an
MIT-licensed library regardless of what it renders.

## Options

| Option | Tradeoff |
|---|---|
| Bundle metric-compatible fonts only (Carlito, Caladea, Liberation) | Substituted documents lay out correctly, which is the largest visible fidelity win. Cost: Cyrillic coverage is uneven, so Russian text falls back to something else and the fallback differs by platform — breaking layout determinism exactly where it matters most for this product. |
| Bundle coverage fonts only (DejaVu family and a Cyrillic serif) | Romanian and Russian always render. Cost: every Calibri- and Times-authored document reflows on substitution, so a document opened on a machine without Calibri looks different from the same document in Word — the difference the customer notices first. |
| Bundle both families and a documented substitution table | Both requirements met, plus a deterministic substitution chain, at the cost of bundle weight and of a substitution rule that must be maintained. | 
| Bundle neither, require the host to supply fonts (`FontProvider`) | Zero licensing exposure and the smallest bundle. Cost: the editor does not work out of the box, and a headless server fill has no fonts at all, so `fillTemplate` produces documents with different metrics from the preview — the divergence the whole specification exists to prevent. |
| Bundle both, and additionally ship a **metrics-only** fallback (widths without outlines) for families we cannot license | Layout is deterministic and correct even for families we cannot embed, and PDF export embeds only what it may. Cost: we ship a second data format (metrics) and must maintain the extraction; but the exported PDF then embeds a *substitute* for a font we may not embed, which is a fidelity item the ledger must record. |

## Decision

**Recommended: one bundled set covering both requirements** — **Carlito** (Calibri metrics), **Caladea**
(Cambria metrics), **Liberation Serif / Sans / Mono** (Times New Roman, Arial, Courier New metrics),
**DejaVu Sans** and a Cyrillic-complete serif for coverage — plus a substitution table that maps DOCX font
names onto this set, records every substitution as a diagnostic, and is part of `documentHash`. The set is
loaded as a layout input, never as a platform font, so layout does not depend on what the machine has
installed: this is what makes the golden corpus and the divergence detector meaningful across machines and in
CI.

Font licence bits are honoured at embed time: `0x0002` (restricted) fails with a named font, `0x0200` (no
subsetting) embeds the full font, `0x0100` embeds and flags. Barcode fonts hard-fail when absent rather than
substituting, because a wrong barcode is worse than a failed export.

**This needs a product and licensing decision**, and it has two parts: (1) **licensing sign-off** on every
font we bundle *and embed*, including the right to subset in a PDF and the notice obligations, which is a
legal review and not an engineering one; and (2) whether the bundle weight this adds is acceptable for the
customer's distribution, since a full coverage set is measured in megabytes. If no decision is made, **the
recommended set ships** for development and internal testing, and the release is blocked on the licensing
review rather than assuming it will pass — shipping a font we cannot licence is not a defect we can fix after
release.

## Consequences

- A substituted document lays out the way Word would layout it with the real font, and the substitution is
  visible in diagnostics rather than invisible in the pixels.
- Cyrillic and Romanian never fall back to a platform font, so the divergence detector's tolerance is
  meaningful and the golden corpus is stable in a container with no fonts installed.
- Bundle size grows, and the font data must be optionally droppable in a build a host configures — a host
  that supplies its own `FontProvider` can exclude the bundle entirely, at the cost of determinism across
  machines, which is a documented trade rather than a hidden one.
- PDF export embeds only what the licence permits, and a font that may not be embedded produces a substitute
  plus a ledger entry (or a hard failure for a barcode), never a silently wrong or unreadable PDF.
- Any change to the bundled set or the substitution table invalidates every golden layout fixture, so the set
  is versioned as part of the layout data and changing it is treated as a breaking change to the corpus.
