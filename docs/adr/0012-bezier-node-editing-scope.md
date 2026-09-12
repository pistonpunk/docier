# 0012 - Bézier node editing scope in v1

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER · **Blocks:** `OBJ-17`,
`OBJ-09`, `OBJ-16` (gradients)

## Context

The objects draft places freeform drawing in v1: click-to-place or drag to draw a curve or scribble, close
the path, fill closed paths and stroke open ones, store the geometry as `a:custGeom` with
`a:pathLst`/`a:path` (`a:moveTo`, `a:lnTo`, `a:cubicBezTo`, `a:close`) and `@w`/`@h` written equal to the
extent in EMU so the mapping to path space is the identity. Freehand input is simplified with
Ramer-Douglas-Peucker at a zoom-scaled EMU tolerance before conversion to cubic Béziers.

Within that, the draft distinguishes two levels and marks them differently:

- **Node editing - `important`:** drag a vertex, add or remove a vertex, convert a corner to a smooth node.
- **Bézier handle editing - `later`:** drag the control handles themselves, which is what makes a curve's
  *shape* adjustable rather than only its points.

The draft then states the problem plainly: "the boundary between 'node editing' and 'handle editing' is not
fixed", and adds that the context menu for a node offers whichever subset exists. So the feature is
committed, the line inside it is not, and the cost of getting it wrong is user-visible: a curve editor that
lets you move points but not shape the curve beside them feels broken in a way that a curve editor with no
node editing at all does not.

There is a related deferred item (`OBJ-09`, "Crop to Shape", `later`) that shares the same path model and the
same `a:custGeom` handling on `pic:spPr`, so whatever is decided here also decides how much of that path
model is exposed.

## Options

| Option | Tradeoff |
|---|---|
| Ship node editing and handle editing together in v1 | The curve editor is coherent and complete, and no user hits a wall. Cost: handle editing is a genuinely larger UI problem (two control points per node, real-time constraint solving for smooth nodes, hit targets at high zoom) and it is the part most likely to slip and delay the `core` freeform feature it lives inside. |
| Ship node editing only, defer handles | The `important` line the draft already drew, so v1 matches the plan. Cost: a user can move a point but cannot adjust the curve between points, and the context menu must present a visibly incomplete tool - which the draft anticipates and accepts. |
| Ship neither in v1 (draw and edit only by deleting and redrawing) | Smallest v1, and freeform still round-trips exactly. Cost: abandons a feature the draft marked `important` and makes a drawn scribble effectively immutable, which the customer will report as a bug. |
| Ship node editing, and expose the handle *data* read-only so the model round-trips it | v1 is coherent, and a future handle editor is additive because the model already carries handles. Cost: nothing is gained for the user in v1; the value is purely architectural. |

## Decision

**Recommended: node editing in v1 as `important`; Bézier handle editing deferred behind an explicit scope
decision, with the model carrying handles from day one so the editor is additive.** The path model is the
single source of truth for both freeform shapes and `pic:spPr/a:custGeom`, and it stores full cubics with
their control points, so deferring the handle *editor* does not mean deferring the handle *data* - a curve we
produce from a mouse or a stylus already has meaningful handles, and Word renders it correctly whether or not
we let the user drag them.

The node context menu offers only what exists (drag, add, remove, corner↔smooth) and states it is a subset
rather than showing disabled handle controls, because a disabled control the user cannot ever enable is worse
than no control.

**This is a product decision** because it is a user-visible capability boundary in a feature the owner asked
for: the question is whether "draw and adjust a curve" must be complete in v1 or whether "draw a curve, and
adjust its points" is enough for the customer's use of shapes. The engineering recommendation is the latter,
because handle editing is the part that can be added later without changing the file format, whereas the path
model must be right in v1 whichever way the answer goes. If no decision is made, **node editing ships and
handles do not**, and the round-trip path for handles is verified by fixture so the deferral is reversible.

## Consequences

- Freeform geometry round-trips exactly even when we produced it, which is the `core` requirement the whole
  feature exists to satisfy, and it is unaffected by this decision.
- `<2` points at commit is discarded; preset and custom geometry are mutually exclusive; a freeform shape
  drawn on a cropped picture uses the same path model as "Crop to Shape", so the two features share their
  tests and their bugs.
- Freehand simplification tolerance scales with zoom, so the same stroke drawn at two zoom levels produces
  the same geometry only within tolerance - a fixture must pin this, because it is a determinism-adjacent
  surface (`documentHash` must not depend on the zoom the user happened to be at).
- If the owner asks for handle editing in v1, the estimate for `OBJ-17` roughly doubles and it should be
  scheduled as its own feature rather than absorbed silently into freeform.
