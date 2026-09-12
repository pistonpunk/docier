# 0008 — Browser support floor

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER · **Blocks:** `QUA-21`,
`NOT_SUPPORTED_BROWSER`, and the CSS and API surface the layout engine may rely on

## Context

The API draft states a floor and justifies it: **Chromium (Chrome, Edge) current and previous major;
Firefox current and previous; Safari 16.4+ and iOS Safari 16.4+; Android Chrome current; no IE, no legacy
Edge, no Opera Mini.** Safari 16.4 is chosen specifically because it is the release where `Intl.Segmenter`,
`structuredClone` and the required CSS `:has()` and container-query features are all present together — and
the layout engine leans on those CSS features for the paint layer.

The editing draft states no floor at all, and the layout draft requires behaviour (`Intl.Segmenter` must
**not** be used directly for word segmentation, because Word's word model is not the platform's) that is
adjacent to it. So the floor exists, it is well-reasoned, and it has never been confirmed as a product
constraint — which matters because the floor is what excludes a customer's older browser, and because a
mobile floor is a statement about which workflows are supported on a phone.

The API draft also fixes a startup probe: the required features are `contenteditable` with a working
`beforeinput`, the `Intl` formatting and segmentation APIs, `ResizeObserver`, `IntersectionObserver`,
`structuredClone`, async clipboard and `AbortController`; a missing item refuses to mount with
`NOT_SUPPORTED_BROWSER` rather than failing in a confusing way later. Optional, with graceful fallback:
`OffscreenCanvas`, the File System Access API, workers for export, `navigator.storage.persist` and
`CompressionStream`. And `document.execCommand` is banned outright — deprecated, inconsistent across
browsers, and it silently rewrites undo history, which would violate the editing draft's invariant I1.

## Options

| Option | Tradeoff |
|---|---|
| Accept the stated floor (Safari 16.4) | Everything the layout engine needs is present together, so the paint layer can use container queries and `:has()`; the floor is roughly the last two years of evergreen browsers. Cost: an institutional customer on an older managed Safari or an older Firefox is excluded, and the exclusion is a hard mount failure rather than a degraded mode. |
| Raise the floor to the latest two versions of each engine | Simplest CSS and API story, no polyfills, smallest test matrix. Cost: excludes more real customers for no functional gain the floor does not already give us. |
| Lower the floor and ship fallbacks (polyfills for `structuredClone`, `:has()` workarounds, a `ResizeObserver` shim) | Wider reach. Cost: a fallback for a *layout-participating* feature is a second rendering path, and a second rendering path is precisely the divergence this specification exists to prevent; it also inflates the bundle the customer pays for. |
| Keep the floor, and treat a phone as a viewing/filling device only | Honest about what is not tested: viewing, filling and light editing work; heavy template authoring on a phone is documented as unsupported. Cost: the `touch` density target and the on-screen keyboard interaction still need to be tested on real devices, and "documented as unsupported" must be visible to the user, not only in a README. |

## Decision

**Recommended: adopt the floor as stated** — Chromium current and previous, Firefox current and previous,
Safari and iOS Safari 16.4+, Android Chrome current; no IE, no legacy Edge, no Opera Mini; `execCommand`
banned; a startup probe that refuses to mount with `NOT_SUPPORTED_BROWSER` and names the missing capability.
Optional features degrade silently and are recorded in `getDiagnostics().browser.features`. Mobile is a
supported **viewing, filling and light-editing** target and an unsupported template-authoring target, and
that is stated in the customer-facing documentation rather than only internally.

**The product decision is not the engine list but its two consequences**, which only the owner can accept:
(1) whether excluding pre-16.4 Safari is acceptable for the target customers — if a significant customer runs
an older managed browser, that is a product constraint that must be discovered now rather than at
acceptance time; and (2) whether the mobile story above is what we are willing to tell customers, because it
commits us to testing touch interaction and the on-screen keyboard on real devices.

If no decision is made, **the stated floor ships**, because it is the only configuration the layout engine's
CSS dependencies have been justified against, and a floor change after the paint layer is written is a
re-verification of the whole visual corpus.

## Consequences

- The layout engine's paint layer may use `:has()` and container queries, and the divergence detector runs on
  every floor browser in CI — which is what turns the floor from a claim into a tested boundary.
- A missing optional feature degrades rather than failing: without `OffscreenCanvas`, image compression runs
  on the main thread in chunks; without a worker, pagination runs in time slices on the main thread. Both are
  slower and both are reported.
- The banned-API list is enforced by lint, not by convention, because `execCommand` is the path of least
  resistance and would silently break undo.
- Rasteriser parity for the visual corpus is required per browser, because anti-aliasing differs between
  engines; the tolerance in the divergence detector is per-run and deliberately loose enough for that while
  still catching a real layout difference.
