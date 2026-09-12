# 0014 — Connector re-routing scope

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER ·
**Blocks:** `OBJ-38`, `OBJ-16`, and the layout engine's exposure of connection-site geometry

## Context

Connectors (straight, elbow, curved) can be attached to two shapes; when an attached shape moves or resizes,
a connector that re-routes stays attached at its chosen connection site. The objects draft ships connectors
in v1 (`OBJ-16`, `core`) as **drawn geometry that round-trips exactly**, which preserves the file and lets a
user draw a connector, and defers live re-routing (`OBJ-38`, `later`, effort L). Its reasoning is stated and
worth repeating: re-routing is a genuine layout-engine feature, because it needs the connection-site geometry
of each preset and it must move connectors during the **drag preview**, not only on commit — and shipping it
half-done leaves connectors that visibly detach, which is worse than connectors that simply stay put.

The draft also fixes the storage contract, which is what makes the deferral safe and what makes a partial
implementation dangerous: attachment is stored as `wps:cNvCnPr/a:stCxn` and `a:endCxn` (`@id` referencing the
shape's `wp:docPr/@id`, `@idx` the site index) **plus** the connector's own `a:xfrm` and path geometry. Both
must stay consistent. A re-route that updates the geometry but not `stCxn`/`endCxn`, or the reverse, produces
a file that Word re-routes differently from how we rendered it — the one outcome that is worse than not
re-routing at all, because it makes our own preview a lie. Related rules: a connector attached to a deleted
shape becomes free-floating and the dangling `stCxn`/`endCxn` must be **removed**, not left pointing at a
dead id; a connector inside a group attaches within the group's coordinate space and cannot attach to a shape
in a different group; and re-routing must be a preview during a drag with no undo entries mid-drag.

## Options

| Option | Tradeoff |
|---|---|
| Ship re-routing in v1 | Connectors behave the way users expect from a drawing tool. Cost: it pulls connection-site geometry out of the layout engine early, and it is the feature the draft judged most likely to ship in a state where connectors visibly detach. |
| Ship connectors as static geometry, defer re-routing (`OBJ-38`, `later`) as drafted | The file is preserved, drawing works, and the deferred feature is genuinely additive because the attachment data is already stored correctly. Cost: a moved shape leaves its connector behind, which is a **deliberate, user-visible limitation** and must be documented as one rather than presented as a bug. |
| Ship re-routing on commit only, not during the drag preview | Half the implementation cost and no preview lie after the drop. Cost: the connector visibly detaches while dragging and snaps on release, which the draft explicitly calls worse than not doing it. |
| Drop connectors from v1 entirely | Removes the whole risk. Cost: contradicts `OBJ-16` being `core`, and connectors appear in real documents we must still preserve and render, so "drop" means "preserve but cannot draw", which the draft already rejected. |

## Decision

**Recommended: adopt the draft's position — static connectors in v1, re-routing deferred, with the
no-party-left-detached invariant enforced in v1 even though no re-routing happens.** Specifically, in v1:
attaching or detaching via `object.connector.attach({ id, end, targetId, siteIndex })` writes `stCxn`/`endCxn`
and keeps them consistent with the geometry at all times; deleting an attached shape **removes** the dangling
`stCxn`/`endCxn` and leaves the connector free-floating; and a moved shape leaves its connector where it was,
with the limitation stated in the UI rather than silently surprising the user.

Promotion of `OBJ-38` requires the layout engine to expose connection-site geometry (preset `a:cxnLst` with
`a:cxn/@ang,@w,@h` and `a:pos/@x,@y`, plus a computed four-edge-midpoint fallback for custom geometry, which
has no `cxnLst`) **and** a preview path that re-routes without undo entries. Both are prerequisites, and the
promotion is a scheduling decision, not a refinement.

**This is a product decision because the draft says it is** — it declares the trade-off "not mine to make"
— and because the question is what we tell the customer about a visible limitation. Engineering's position:
the limitation is acceptable and honest for v1, and the attachment model is already correct, so nothing is
foreclosed; but the owner should decide whether "shapes and connectors" is a selling point of v1 (in which
case re-routing must be scheduled with the layout-engine prerequisite named) or an incidental capability (in
which case the documented limitation is fine). If no decision is made, **static connectors ship**, because
that is the smaller commitment and the additive path is preserved.

## Consequences

- Connector attachment round-trips exactly through us and through Word, because storage is the real
  `stCxn`/`endCxn` pair plus consistent geometry — no proprietary state, no derivation.
- The dangling-`stCxn` cleanup on shape deletion is in v1 even though re-routing is not, because leaving a
  dead reference is a file-integrity bug independent of re-routing, and Word would silently drop it while we
  would not.
- A group's coordinate space (`a:chOff`/`a:chExt`) governs attachment, so grouping and ungrouping must
  preserve site indices; this is a fixture requirement for `OBJ-38`'s prerequisites and is testable today.
- If the owner promotes re-routing, the layout engine's connection-site work is the critical path and must
  be scheduled before the connector UI, not alongside it.
