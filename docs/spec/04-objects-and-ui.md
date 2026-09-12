# 04 - Objects and UI Chrome

**Status:** draft · **Domain:** floating/inline objects, and all user-interface chrome
**Depends on:** `01-document-model-and-ooxml.md` (parts, relationships, EMU/twip units), `02-editing-and-text.md` (runs, selection, find/replace substrate), `03-layout-and-pagination.md` (page geometry, floats placement, line breaking)
**Consumed by:** `05-persistence-and-embedding.md` (serialisation, host API surface)

---

## 1. Purpose and scope

This spec covers everything the user *sees* and *manipulates* beyond text: pictures, shapes, text
boxes, their geometry, their relationship to text, and the chrome that exposes them (ribbon,
rulers, status bar, dialogs, context menus, panels, view modes).

Two properties govern every feature below:

1. **Everything is a command, every state change is an event.** No UI control may mutate the
   document directly. A control invokes a command; the command produces events; the view
   re-renders from the event stream. This is what makes the chrome replaceable.
2. **Everything round-trips through OOXML.** Every object property has a defined OOXML
   representation and a defined lossy/unsupported path. No property may exist only in memory.

### Unit and coordinate rules (apply to every feature)

- The document model stores geometry as **integer EMU** (1 in = 914400, 1 pt = 12700, 1 cm =
  360000, 1 px @96dpi = 9525, 1 twip = 635). Floats appear only at the render boundary.
- OOXML *drawing* properties are EMU (`wp:extent/@cx`, `a:ext/@cx`, `wp:posOffset`).
- OOXML *text/section* properties are twips (`w:ind/@w`, `w:tab/@pos`, `w:pgMar`).
  Conversion is centralised in one module; a conversion in the wrong direction is a bug class we
  must not create twice.
- Percentages inside DrawingML are **1/1000 of a percent** (`a:srcRect/@l="25000"` = 25% crop,
  `a:alphaModFix/@amt="50000"` = 50% opacity). Never store these as 0-1 floats.

### Priority and effort

**Priority:** `core` (round-trip correctness or a stated product complaint - must ship in v1),
`important` (needed for the product to feel finished), `later` (deliberately deferred).
**Effort:** `S` ≈ ≤3 days · `M` ≈ 1-2 weeks · `L` ≈ 3-5 weeks · `XL` ≈ 6+ weeks or more than one
engineer.

### Complaint traceability

The five complaints about the previous attempt map to features as follows. Any change that
removes one of these features requires a new ADR.

| Complaint | Prevented by |
|---|---|
| Images could not be resized or moved | OBJ-05, OBJ-06, OBJ-07, OBJ-08, OBJ-23, OBJ-26, OBJ-30, OBJ-31 |
| No bring forward / send backward | OBJ-29, OBJ-32 |
| No right-click menus anywhere | UI-27, UI-28 |
| Menus felt like a web form, not Word | UI-02…UI-07, UI-18…UI-24, UI-25, UI-26 |
| Rulers repeated on every page | UI-08 (single sticky ruler), UI-09…UI-14 |

---

## 2. Command and event contract for this domain

Command envelope (shared across all specs):

```ts
{ id: string, args: T, source: 'ui' | 'api' | 'undo' | 'collab', transient?: boolean }
```

- Every command returns `Result<Event[]>`. A command that changes the document must emit at least
  one `object.changed` / `ui.*` event. Commands are the only mutation path.
- **Transient commands** (live drag) emit `*.preview` events that are **not** pushed onto the undo
  stack. The gesture ends with exactly one non-transient commit command, producing **one** undo
  entry. A 200-frame drag is one `Ctrl+Z`. This is non-negotiable and is the most common place a
  previous implementation got the feel wrong.
- Commands are addressed by **stable object id**, never by DOM node, never by index in a
  collection that may have changed.
- Event names used below: `object.created`, `object.changed`, `object.removed`,
  `object.selection.changed`, `object.zorder.changed`, `object.transform.preview`,
  `object.transform.commit`, `ui.chrome.mounted`, `ui.chrome.unmounted`, `view.changed`,
  `zoom.changed`, `status.changed`.

Command namespaces: `object.*` (this spec, objects), `view.*` (view modes, zoom, panels),
`ui.*` (chrome-only state such as ribbon tab selection). `ui.*` commands never touch the document
and never enter the undo stack.

---

## 3. Chrome replaceability contract

The library ships chrome **and** must let a host replace any part of it. The contract:

- `new Docier(container, { chrome: 'full' | 'minimal' | 'none' | ChromeSlots })`.
  - `full` - the library renders menu bar, ribbon, ruler, status bar, context menus, dialogs,
    panels, mini-toolbar.
  - `minimal` - ruler, status bar and context menus only (for embedding in a host that has its
    own toolbar).
  - `none` - headless. Zero chrome DOM. Every command remains available; the host renders
    whatever it likes from the event stream.
- `ChromeSlots` names: `menuBar`, `ribbon`, `quickAccess`, `ruler`, `statusBar`, `miniToolbar`,
  `floatingControls`, `contextMenu`, `dialogs`, `panels`, `navigationPane`, `placeholder`.
  Each slot accepts a host-provided renderer (a function receiving `{ commands, state, subscribe }`)
  or `null` to suppress. **A slot and the library's default implementation are interchangeable**;
  the default implementation uses only the same public contract, so a host can copy it.
- Chrome DOM carries `data-docier="<slot>"` and `data-docier-part="<name>"` attributes, and
  chrome-internal state changes are also dispatched as DOM `CustomEvent`s
  (`docier:command`, `docier:state`) so a non-TypeScript or different-framework host can integrate
  without importing our types.
- **Rule:** if a chrome feature cannot be expressed as a command + state subscription, it is
  designed wrong. There is no chrome-only document mutation anywhere in this spec.
- Theming: all visual values come from CSS custom properties on the container
  (`--docier-*`). The library ships **no brand palette of its own** - a framework-agnostic library
  must not impose one. A host theme overrides the property block. `--docier-density`
  (`compact` / `comfortable` / `touch`) changes hit-target and control sizes; `touch` is required
  for the tablet use case (see OBJ-06 hit targets).

---

# Part A - Objects

## OBJ-01 · Insert image from file
**Priority** core · **Effort** M

- **Behaviour.** Ribbon `Insert > Pictures > This Device` (or the command directly) opens the
  host file picker with `accept="image/*"` and `multiple`. Chosen files are inserted at the
  caret as **inline** pictures (`wp:inline`), one after another in selection order, each in its
  own paragraph if more than one file is selected.
- **States.** picker-open → decoding → inserting → inserted, or `error` per file.
- **Rules & edge cases.**
  - Natural size: the picture's intrinsic pixel dimensions are converted to EMU at the image's
    declared DPI (`pHYs` chunk in PNG, JFIF density in JPEG, default 96). If the resulting width
    exceeds the column width, scale down to fit and **preserve the aspect ratio** - this is Word's
    behaviour and prevents the single most common "why is my image off the page" complaint.
  - Inserting inside a table cell fits to the cell content width, not the page column.
  - Multi-file insert is one undo entry, not N.
  - A file that fails to decode inserts nothing and reports `error` with the filename; it must not
    abort the rest of the batch.
  - Formats: PNG, JPEG, GIF, BMP, TIFF, WEBP, SVG accepted. EMF/WMF are detected and handled per
    OBJ-15 (inserted as unrenderable fallback, never silently dropped).
- **OOXML.** `w:r/w:drawing/wp:inline` → `wp:extent/@cx,@cy` (EMU) · `wp:docPr/@id,@name,@descr`
  · `a:graphic/a:graphicData[@uri="…/picture"]/pic:pic` with `pic:nvPicPr/pic:cNvPr`,
  `pic:blipFill/a:blip/@r:embed`, `pic:spPr/a:xfrm/a:off,@a:ext`, `a:prstGeom[@prst="rect"]`.
  Media stored at `word/media/imageN.<ext>`, registered in `word/_rels/document.xml.rels` and
  `[Content_Types].xml`.
- **Commands / events.** `object.image.insert({ source: 'file', files })` → `object.created` (one
  per image), `object.selection.changed`.

## OBJ-02 · Insert image by drag and drop
**Priority** core · **Effort** M

- **Behaviour.** Dragging files over the editor shows a drop indicator (a caret bar when the drop
  point resolves to a text position, a rectangle outline when it resolves to a page/margin area).
  On drop at a text position → inline; on drop over a page's margin area with the "float on drop"
  modifier (or the host's `dropMode: 'float'` option) → floating anchor at the drop point.
- **States.** `dragenter` (counter-based, so nested elements don't flicker the overlay) →
  `dragover` → `drop` / `dragleave` (counter reaches zero).
- **Rules & edge cases.**
  - Must call `preventDefault()` on `dragover` or the browser navigates to the file. Non-file
    drags (text, HTML, internal object drags) must be distinguished by `dataTransfer.types` and
    routed to their own handlers, not swallowed.
  - Dragging from the OS is only observable at `drop` in some browsers; the overlay must therefore
    be driven by `dragenter`/`dragleave` counts, never by reading file names during `dragover`.
  - Dropping a *directory* is rejected with a message; we do not recurse.
  - Drop while in `read` view mode is refused (view mode is not editable) and the drop target
    outline is not shown.
  - Dropping onto an existing object with `Alt` held inserts *into* the group if it is a group
    (OBJ-21), matching Word's behaviour.
- **OOXML.** Identical to OBJ-01, except that a floating drop adds the `wp:anchor` form (OBJ-05).
- **Commands / events.** `object.image.insert({ source: 'drop', files, at })` → `object.created`.

## OBJ-03 · Insert image by paste
**Priority** core · **Effort** M

- **Behaviour.** `Ctrl+V` with `image/*` on the clipboard inserts at the caret. Order of
  preference in `paste`: `image/png` → `image/jpeg` → `image/svg+xml` → `image/gif` →
  `text/html` with a single `<img>` → `text/uri-list` (OBJ-04) → `text/plain`.
- **States.** paste with a multi-item clipboard (we support the async Clipboard API
  `clipboard.read()` where permitted) inserts all images in order as one undo entry.
- **Rules & edge cases.**
  - Pasting an image **over a selection** replaces the selection (Word behaviour), it does not
    insert before it.
  - Pasting a screenshot while a *shape* is selected pastes the image as the shape's fill, not as a
    new object - Word does this and users rely on it.
  - `paste` from the library's own clipboard (a copied object) must paste as an object, not as a
    flattened image. The internal clipboard MIME type is `application/x-docier-object+json`;
    round-tripping through it preserves the full OOXML fragment.
  - Browser permission denial (`clipboard-read`) degrades to the `paste` event path with no error
    surfaced to the user; only a genuine decode failure is an error.
- **OOXML.** As OBJ-01. Internal clipboard payload is the serialised `w:drawing` XML fragment plus
  the media part bytes, so paste-across-documents works without re-encoding.
- **Commands / events.** `object.image.insert({ source: 'paste', blob })` → `object.created`.

## OBJ-04 · Insert image from URL
**Priority** important · **Effort** M

- **Behaviour.** `Insert > Pictures > Online Pictures` opens a dialog with a URL field and a
  preview thumbnail. Confirming fetches the URL, stores the bytes as a media part, and inserts.
- **States.** idle → fetching (spinner, cancellable) → preview → inserted · `error`
  (HTTP status, CORS, not-an-image, too large).
- **Rules & edge cases.**
  - **A URL is never stored in the document.** OOXML has no remote-image reference; the bytes must
    be fetched and embedded, or the document is not self-contained. This is a hard rule.
  - CORS failure in the browser is expected and common; the dialog must explain it and offer the
    local-file fallback rather than showing a raw network error.
  - Fetch timeout 15 s, hard size cap 25 MB (configurable). Redirects followed; `https` upgraded.
  - Relative URLs are resolved against the host page and the resolved absolute URL is shown in the
    dialog so the user can see what will be embedded.
  - Animated GIF/SVG from a URL is embedded as-is (animation is preserved in the DOCX but only the
    first frame is shown if the host sets `animateMedia: false`).
- **OOXML.** As OBJ-01. The source URL is **not** persisted. Optionally recorded in
  `docProps/app.xml` `<Company>`-adjacent custom properties only if the host opts in - never in
  the drawing.
- **Commands / events.** `object.image.insert({ source: 'url', url })` → `object.created`.

## OBJ-05 · Inline vs floating placement, and conversion between them
**Priority** core · **Effort** L

- **Behaviour.** Every object is either **inline** (behaves as a character in the text flow) or
  **floating** (anchored to a paragraph but positioned independently). The Layout Options panel
  (OBJ-36) and the object context menu expose "In Line with Text" / "Wrap Text → …" which convert
  between the two. Conversion preserves size, rotation, crop and all other visual properties.
- **States.** `inline` · `floating` with a wrap mode (OBJ-28) and a relativeFrom pair (OBJ-23).
- **Rules & edge cases.**
  - Inline → floating: the object is removed from its run and re-inserted as an anchor *in the same
    position in the paragraph*, so the paragraph does not reflow in a surprising way. Default wrap
    on conversion is Square, default relativeFrom `column`/`paragraph` - matching Word.
  - Floating → inline: the anchor's position is discarded; the object joins the text flow at the
    anchor's offset. Its z-order and wrap settings are **retained in memory but inert**, and are
    written back if it is converted to floating again in the same session.
  - An inline object inside a run **breaks the run** into up to three runs (`w:r` before,
    `w:r` containing `w:drawing`, `w:r` after). Character formatting must be cloned onto the new
    runs so the text around the image does not change appearance. This is a frequent source of
    silent formatting loss.
  - Inline objects are valid in: body paragraphs, table cells, text boxes, headers/footers,
    footnotes/endnotes, comments. Floating objects are **not** valid inside a footnote/endnote -
    the UI must refuse the conversion there and explain why.
  - Inline objects affect the paragraph's line height. A tall inline image in a paragraph with
    `w:spacing/@lineRule="exact"` is clipped; we must reproduce that clipping rather than
    overflowing (Word behaviour).
- **OOXML.** Inline = `w:r/w:drawing/wp:inline` (`wp:extent`, `wp:effectExtent`, `wp:docPr`,
  `wp:cNvGraphicFramePr`, `a:graphic`). Floating = `w:r/w:drawing/wp:anchor` with the same children
  plus `wp:simplePos`, `wp:positionH`, `wp:positionV`, a wrap element, and attributes
  `simplePos="0" relativeHeight behindDoc locked layoutInCell allowOverlap`.
- **Commands / events.** `object.placement.set({ ids, placement: 'inline' | 'floating' })` →
  `object.changed` · `object.placement.preview` during the Layout Options live preview.

## OBJ-06 · Object selection: handles, hit targets, cursors
**Priority** core · **Effort** L

- **Behaviour.** Clicking an object selects it and draws the selection frame: 8 resize handles
  (4 corners + 4 edge midpoints), 1 rotation handle 24 px above the top-centre handle, and a
  dashed frame. A second click enters **text edit mode** for text-bearing objects (text box,
  shape with text, group member). Escape steps back one level (text edit → object selected →
  object deselected → text caret restored).
- **States.** `none` · `selected(single)` · `selected(multi)` · `textEditing` · `cropping` ·
  `dragging` · `rotating`.
- **Rules & edge cases.**
  - **Handles are constant size in device pixels regardless of zoom** (8 px visual, 12 px hit
    radius, 20 px in `touch` density). A handle must never scale with the document - this is the
    single most common way a web editor feels wrong versus Word.
  - Hit testing order at a point: rotation handle → resize handles (topmost first) → object body
    (topmost z-order first) → text anchor. Overlapping objects resolve by `relativeHeight`,
    descending; a `behindDoc` object is only hit when nothing in front contains the point.
  - Rotation handle hit area is enlarged (16 px) and offset outward so it does not overlap the
    top-centre resize handle.
  - Clicking a handle of an already-locked object (`object.locked`) shows the lock cursor and
    selects without allowing a transform.
  - `Ctrl+click` (macOS `Cmd+click`) toggles an object in/out of a multi-selection; `Shift+click`
    extends. A rubber-band marquee selects every object whose **bounding box intersects** the
    band (Word's rule, not containment).
  - Clicking an inline object selects it as an object; the text caret is not moved. Clicking
    *beside* it places the caret. `Tab` at the start of a paragraph containing an inline object
    moves the selection into the object (Word behaviour, and required for keyboard reachability -
    OBJ-37).
  - Selection frame for a rotated object is the rotated rectangle, not its axis-aligned bounds.
  - A selected object inside a table cell uses `layoutInCell` semantics for hit testing so it does
    not "leak" over the cell boundary in a way that makes it unselectable.
- **OOXML.** No direct representation (UI state). Geometry derived from `wp:extent/@cx,@cy`,
  `a:xfrm/@rot,@flipH,@flipV`, `a:srcRect`, and for group members the group's `a:chOff`/`a:chExt`
  child coordinate space (`wpg:grpSpPr/a:xfrm`).
- **Commands / events.** `object.selection.set({ ids, mode: 'replace' | 'add' | 'toggle' })` →
  `object.selection.changed` (with the full resolved selection: ids, bounds, capabilities).

## OBJ-07 · Resize - aspect-locked
**Priority** core · **Effort** M

- **Behaviour.** Corner-handle drag resizes while preserving the aspect ratio. `Shift` while
  dragging an edge handle converts it to a locked resize; `Shift` while dragging a corner
  **unlocks** it (Word's model, and the opposite of many web editors - we follow Word).
- **States.** idle → dragging (preview events) → committed (single undo entry). Live size readout
  shown in the status bar or a floating badge while dragging.
- **Rules & edge cases.**
  - Locked corner resize uses the **opposite corner as the fixed origin** - the object grows away
    from the anchor you are not holding. Getting this wrong makes objects "walk" across the page.
  - Minimum size 1 pt (12700 EMU) in each axis; a drag that would invert the object is clamped, not
    flipped (flipping is OBJ-11, an explicit command - a drag must never flip).
  - Snapping applies during resize unless `Alt` is held (OBJ-30).
  - For pictures, an aspect-locked resize changes `wp:extent` only and **must not** rewrite the
    media bytes or `a:srcRect`. Re-encoding on resize is forbidden - it destroys quality and
    breaks round-trip byte equality.
  - For a **group**, the group's `a:ext` scales and every child's `a:off`/`a:ext` in the group
    child space is scaled by the same factors; the group's `a:chExt` is scaled to match. A child
    with `a:ext` scaled non-uniformly when the group is locked is not reachable - locked group
    resize is always uniform.
  - A text box resized smaller than its content shows the overflow indicator (OBJ-20) rather than
    silently clipping.
  - Resizing below the intrinsic pixel size of an image is allowed (Word allows it) but the
    properties panel shows the effective DPI and warns below 96 DPI.
- **OOXML.** `wp:extent/@cx,@cy` and `wp:effectExtent` for inline; additionally
  `wp:positionH/wp:posOffset` / `wp:positionV/wp:posOffset` for floating when the fixed origin is
  not the top-left (the offset is recomputed, not the extent alone). For `pic:pic`,
  `pic:spPr/a:xfrm/a:ext/@cx,@cy`. Group: `wpg:grpSpPr/a:xfrm/@ext` + children `a:off`/`a:ext`.
- **Commands / events.** `object.transform.preview({ ids, extent })` (transient) →
  `object.transform.commit({ ids, extent })` → `object.changed`.

## OBJ-08 · Resize - free (aspect unlocked)
**Priority** important · **Effort** S

- **Behaviour.** Edge-handle drag resizes one axis; corner-handle drag with `Shift` resizes both
  axes independently.
- **Rules & edge cases.**
  - Pictures distorted by a free resize keep their natural aspect in the media part; the distortion
    is purely `a:ext`. The "Reset" item in the context menu (OBJ-32) restores the natural aspect
    ratio and original size.
  - A free-resized picture's crop rectangle is unaffected by the distortion (crop is applied before
    the extent in the rendering model). Verify both orders in the layout tests.
  - Text boxes and shapes free-resize without distortion because their content re-flows or scales
    per OBJ-20.
  - `wps:bodyPr` `normAutofit` font scale is **not** recalculated on a free resize; only
    `spAutoFit` shapes change size, and those refuse a manual resize until autofit is turned off
    (with an explanatory notice) - matching Word.
- **OOXML.** As OBJ-07.
- **Commands / events.** As OBJ-07, with `lockAspect: false`.

## OBJ-09 · Crop
**Priority** core · **Effort** L

- **Behaviour.** `Crop` (ribbon Picture Format, or object context menu) enters crop mode: black
  crop bars appear on the four edges and four corners, the picture dims outside the crop area, the
  rest of the chrome is disabled, and `Esc` or a click outside exits **keeping** the crop.
  `Ctrl+click` a crop handle crops symmetrically about the centre.
- **States.** `cropping` with per-edge live offsets; committed on exit = one undo entry.
- **Rules & edge cases.**
  - Crop is **non-destructive**: `a:srcRect` changes, media bytes never do. Cropping must never
    trigger a re-encode.
  - Cropped-away areas remain visible as ghosted content while cropping (so the user can crop back
    out later) and the crop can be dragged *outward* to restore, up to the original bounds.
  - Crop offsets clamp so that `l + r < 100000` and `t + b < 100000`; a fully-cropped picture is
    refused with a minimum of 1% remaining in each axis.
  - Crop and rotation compose: crop is in image space, rotation in shape space. Cropping a rotated
    picture must not shift it visually. Covered by an explicit test.
  - "Crop to Shape" (fill a shape with the picture, cropped to the preset geometry) is `later` but
    the data model must already support `a:prstGeom` on `pic:spPr`.
  - `Crop > Fit` / `Fill` / `Aspect Ratio` (1:1, 4:3, 16:9, original) are menu items that compute
    `a:srcRect` for the target ratio, preserving the centre.
  - Crop applies to `pic:pic` only; a shape's `a:blipFill/a:srcRect` uses the same mechanism for
    pictures used as shape fills.
- **OOXML.** `pic:blipFill/a:srcRect/@l,@t,@r,@b` in 1/1000 percent. The **displayed** extent
  (`a:ext`) is the cropped extent; the *effective* source rectangle is derived from `srcRect`. If
  a picture is cropped and then its extent is changed, `srcRect` is unchanged.
- **Commands / events.** `object.image.crop.preview({ id, srcRect })` (transient) →
  `object.image.crop({ id, srcRect })` → `object.changed`.

## OBJ-10 · Rotate
**Priority** important · **Effort** M

- **Behaviour.** Drag the rotation handle; `Shift` snaps to 15° increments. Ribbon
  `Rotate > Rotate Right 90° / Rotate Left 90° / Flip Vertical / Flip Horizontal` and a numeric
  angle field in the properties panel (0-359.9°, tenths of a degree).
- **States.** rotating → committed. Live angle badge next to the handle.
- **Rules & edge cases.**
  - Rotation is **clockwise positive**, matching `a:xfrm/@rot` and Word's UI.
  - Rotation pivots about the object's **centre**, not its top-left. For a non-centred pivot the
    offsets must be recomputed; we never write a pivot, since OOXML has none.
  - Rotating a floating object can push it outside the page; the object is not clamped or moved
    (Word allows off-page objects and users use this for bleed). The pasteboard must therefore
    render objects outside the page bounds.
  - Rotating an inline object is allowed and affects line height via the rotated bounding box.
  - Rotating a group rotates the group as a unit; children's `a:rot` values are unchanged and the
    group's `a:xfrm/@rot` carries the rotation. Rotating a *child* inside a group is refused
    (Word requires ungrouping) with an explanatory notice.
  - Rotation is preserved exactly through a JSON round-trip: `rot` is an integer count of 60000ths
    of a degree, and 90° is 5400000. Never store degrees as a float in the model.
- **OOXML.** `a:xfrm/@rot` (ST_Angle, 60000ths of a degree, clockwise). For pictures:
  `pic:spPr/a:xfrm/@rot`. For shapes: `wps:spPr/a:xfrm/@rot`.
- **Commands / events.** `object.transform.preview` → `object.rotate({ ids, rot })` →
  `object.changed`.

## OBJ-11 · Flip
**Priority** important · **Effort** S

- **Behaviour.** `Flip Horizontal` / `Flip Vertical` from the Rotate menu and the context menu.
- **Rules & edge cases.**
  - Flip is **not** a 180° rotation for asymmetric content and is stored separately, so the two
    must never be conflated.
  - Flip on a shape with text flips the geometry only; the text is **not** mirrored. Word behaviour:
    text in a flipped shape stays readable. If a host needs mirrored text we do not provide it.
  - Flip composes with rotation in the order flip-then-rotate (OOXML applies `flipH`/`flipV`
    before `rot`). Document this in code as it is easy to get backwards.
  - Flip on a group flips the group's transform; children's own flips are unchanged.
- **OOXML.** `a:xfrm/@flipH="1"` / `@flipV="1"`. Note the boolean form: the attribute is present
  with `1`, absent (not `0`) in most Word output - we write `1` and omit otherwise, and accept
  `0`/`false` on read.
- **Commands / events.** `object.flip({ ids, axis: 'h' | 'v' })` → `object.changed`.

## OBJ-12 · Alt text, title, and object name
**Priority** core · **Effort** S

- **Behaviour.** The object context menu's "Alt Text" opens the Alt Text panel: a description
  (multiline), a title (single line), and a decorative checkbox. The object name is editable in
  the Selection pane (OBJ-33).
- **States.** Description empty → the panel shows a warning badge in the accessibility summary.
- **Rules & edge cases.**
  - **Accessibility is a core requirement**, not a later nicety: an inserted image with no alt text
    is flagged in the Selection pane and in the accessibility check, because the product's output
    is HR documents that may be published.
  - "Decorative" writes an **empty** `@descr` (`descr=""`), which is the OOXML idiom for
    decorative - distinct from an absent `@descr`. Absent means "not yet described"; empty means
    "intentionally decorative". Do not collapse these two states.
  - The default `@name` on insert is `Picture N` / `Shape N` / `Text Box N`, monotonically
    increasing per part, never reusing a number after a delete (Word's rule; users see these names
    in the Selection pane and in the alt-text panel).
  - `@descr` is limited to 32 767 characters by the schema; we enforce the limit in the UI.
- **OOXML.** `wp:docPr/@descr` (description), `@title`, `@name`, `@id`. Inside a group, the
  picture's own `pic:cNvPr/@descr,@name` is the effective one for the picture and `wp:docPr`
  applies to the group - both must be written, and the UI edits whichever the selection resolves to.
- **Commands / events.** `object.describe({ ids, descr?, title?, decorative? })` →
  `object.changed`.

## OBJ-13 · Replace image (keep formatting)
**Priority** important · **Effort** S

- **Behaviour.** `Change Picture > From a File` and `> From Clipboard` replace the media of the
  selected picture while **preserving size, crop, rotation, flips, borders, effects, wrap,
  position, and alt text**.
- **Rules & edge cases.**
  - The old media part is removed only if no other relationship references it (images are shared
    when a picture is copied - a naive delete corrupts the other copy). Reference counting across
    `document.xml.rels`, header/footer rels, and footnote rels is required.
  - The new image's natural aspect ratio differs: we keep the existing `wp:extent` (Word keeps the
    frame and stretches) but show a "Reset Size" affordance and a one-click fix in the properties
    panel.
  - `a:srcRect` is **retained**, which can produce a surprising crop on the new image; Word does the
    same, so we match it, and expose "Reset Crop" right next to it.
  - Replacing with an SVG uses the SVG path (OBJ-15) and writes both the SVG blip and a raster
    fallback so older readers still render something.
  - Replace is one undo entry and keeps the same `wp:docPr/@id` so selection and any references
    stay stable.
- **OOXML.** `pic:blipFill/a:blip/@r:embed` retargeted to a new relationship id; new part in
  `word/media/`; `[Content_Types].xml` default/override added; old part and rel removed if
  unreferenced.
- **Commands / events.** `object.image.replace({ id, source })` → `object.changed`.

## OBJ-14 · Image compression
**Priority** important · **Effort** M

- **Behaviour.** `Compress Pictures` dialog: "Apply only to this picture" checkbox, target PPI
  (330 / 220 / 150 / 96), "Delete cropped areas of pictures" checkbox, and a computed
  before/after size estimate for the document.
- **States.** idle → estimating → compressing (progress, cancellable) → done with a size report.
- **Rules & edge cases.**
  - **Deleting cropped areas is destructive and irreversible.** It rewrites media bytes to the
    cropped region and resets `a:srcRect` to `0`. The dialog must say so in plain words, and the
    operation must be a single undo entry that restores the original media from the undo payload.
    For a 25 MB document, holding the original media in the undo stack is expensive - the undo
    entry stores the media *reference*, not a copy, and the media part is only released from the
    part store when it leaves the undo history.
  - Compression runs off the main thread (Worker + `OffscreenCanvas` where available) so the UI
    does not freeze on a 40-image document.
  - Formats that cannot be re-encoded in-browser (TIFF, EMF, WMF) are skipped and reported, never
    silently converted to a lossy format.
  - Transparency is preserved: PNG with alpha is never converted to JPEG. If the target PPI
    requires lossy compression and the image has alpha, we keep PNG and downscale only.
  - AVIF/WEBP output is `later`; the default output format is the input format.
  - The size estimate is computed from the decoded pixel dimensions before encoding; it is labelled
    as an estimate.
- **OOXML.** No dedicated element - the operation rewrites `word/media/imageN.*` and adds a
  `[Content_Types].xml` entry if the extension changed. `a:srcRect` reset to absent (or all-zero).
  Document size is the sum of all parts plus the zip container, so the report is computed from the
  actual part sizes.
- **Commands / events.** `object.image.compress({ ids, ppi, deleteCroppedAreas })` →
  `object.changed` + `document.stats.changed`.

## OBJ-15 · Media parts and round-trip fidelity
**Priority** core · **Effort** L

- **Behaviour.** The part store owns every media part and its relationships. Reading and writing
  are byte-preserving for parts we do not modify.
- **Rules & edge cases.**
  - **Unmodified media is written back byte-identical.** Re-encoding a JPEG on save (a classic
    round-trip bug) loses generations of quality and breaks any byte-comparison test. The test
    suite must include open→save→byte-compare for a document with JPEG, PNG and SVG.
  - **SVG** is written the way Word writes it: a raster fallback in `a:blip/@r:embed` plus
    `<a:extLst><a:ext uri="{96DAC541-7BDC-4B1C-B6D6-0C4A0FB4A2F0}"><asvg:svgBlip r:embed="rIdN"/>`.
    Reading must prefer `svgBlip` and fall back to the raster. Round-tripping an SVG document must
    not lose the vector.
  - **EMF/WMF** cannot be rendered in a browser. We preserve the part and its `a:blip` exactly, and
    render the placeholder in UI-32's error surface with the correct extent. We never drop the
    relationship - that would silently corrupt the file for Word users, and this product's output
    is opened in Word.
  - **Duplicate media** (the same image inserted twice) must reference one part. On read, identical
    parts across relationships are de-duplicated by content hash only if the host enables
    `dedupeMedia`; by default we preserve exactly what was in the file, because some documents
    intentionally ship two parts with the same bytes.
  - Media part naming: `word/media/imageN.ext` with N chosen to avoid collisions with existing
    names in the part (never assume the existing images are numbered 1..N - real documents have
    gaps and out-of-order names).
  - Media inside headers/footers/footnotes lives in that part's rels; the object model must resolve
    a `r:embed` **scoped to the owning part**, not globally. A global rel map is a known source of
    "wrong image appears" bugs.
  - Animated GIF/WEBP: preserved; the editor shows the animated preview in print layout and a
    static first frame in draft/web layout.
  - Missing or corrupt media part (`r:embed` points at nothing): the object still renders with its
    `wp:extent` as a broken-media placeholder, and the relationship is preserved so saving does not
    destroy the reference. This is a **data-preservation** rule: never write a document that is
    *worse* than the one we opened.
- **OOXML.** `word/media/*`, `word/_rels/*.rels`, `[Content_Types].xml` (`<Default Extension>`
  and `<Override PartName>` for SVG `image/svg+xml`, EMF `image/x-emf`, WMF `image/x-wmf`).
- **Commands / events.** `document.media.add({ bytes, mime })` (internal) → `object.changed`.

## OBJ-16 · Insert shapes and format them
**Priority** core · **Effort** L

- **Behaviour.** `Insert > Shapes` opens the shape gallery grouped as in Word: Lines (line, arrow,
  double arrow, elbow connector, curve), Rectangles (rectangle, rounded rectangle), Basic Shapes
  (ellipse, triangle, diamond, pentagon, hexagon, star, callout, heart, …), Block Arrows,
  Equation Shapes, Flowchart, Stars and Banners. Selecting a type enters **draw mode** (crosshair
  cursor, drag to draw, `Shift` for a square/circle, `Esc` cancels); a plain click inserts a
  default-sized shape at the click point.
- **States.** gallery → draw-armed → drawing → inserted → selected. Draw mode is sticky only for
  the "lock drawing mode" affordance (double-click in the gallery).
- **Formatting** (ribbon Shape Format tab and the object context menu): shape fill (solid, gradient,
  picture, texture, no fill), shape outline (colour, weight, dash, join, arrowheads), shape effects
  (shadow, glow, reflection, soft edge, 3-D rotation), and `Shape Styles` presets.
- **Rules & edge cases.**
  - A newly drawn shape gets a style derived from the theme (`wps:style` referencing
    `a:fillRef`/`a:lnRef`/`a:effectRef`/`a:fontRef` with `idx`) so it inherits the document theme
    rather than hard-coding a colour. Hard-coding a colour is how a library ends up looking like a
    different product inside the host's documents.
  - A line/connector drawn with zero length is discarded (a zero-length line is invisible and
    unselectable - a stuck object).
  - Connectors attach to shape connection sites. We store the attachment as the drawn geometry plus
    the connector's `stCxn`/`endCxn` if present; automatic re-routing when an attached shape moves
    is deferred to OBJ-38 - until then a moved shape leaves the connector where it was, and the
    spec must not pretend otherwise.
  - Gradient fills are `later`; the model round-trips `a:gradFill` losslessly on read and marks it
    read-only in the UI until the gradient editor ships.
  - Picture fill on a shape stores the image as a media part and uses `a:blipFill` in `wps:spPr`.
  - The shape catalogue maps to `a:prstGeom/@prst` names; the spec's gallery and the mapping table
    live in one module so a new preset is one entry. Preset list is versioned; an unknown `@prst`
    on read is preserved untouched and rendered with the fallback bounding box.
- **OOXML.** `w:drawing/wp:anchor` (or `wp:inline`) → `a:graphic/a:graphicData[@uri="…/wordprocessingShape"]/wps:wsp`
  containing `wps:cNvSpPr` (with `a:spLocks`), `wps:spPr` (`a:xfrm`, `a:prstGeom[@prst]` or
  `a:custGeom`, fills, `a:ln`, `a:effectLst`), optional `wps:txbx`, `wps:bodyPr`, `wps:style`.
  Word writes a legacy VML fallback in `mc:Fallback`; we must **read** it (older documents have
  only VML) and may omit it on write for new shapes.
- **Commands / events.** `object.shape.insert({ preset, bounds })`, `object.format.set({ ids, fill,
  line, effects })` → `object.created` / `object.changed`.

## OBJ-17 · Freeform shapes
**Priority** important · **Effort** L

- **Behaviour.** `Insert > Shapes > Lines > Freeform` (and `Curve`, `Freeform Scribble`). Draw by
  clicking to place vertices, or dragging for a freehand path. `Esc` or a double-click closes the
  path. A closed path takes a fill; an open path takes only a stroke.
- **States.** drawing (live preview polyline) → closed/open → inserted → node editing.
- **Rules & edge cases.**
  - Freeform geometry is stored as `a:custGeom` with `a:pathLst/a:path` and explicit
    `a:moveTo`/`a:lnTo`/`a:cubicBezTo`/`a:close`, plus `a:pathLst/@w,@h` defining the path
    coordinate space. **The path coordinate space is independent of `a:ext`** - a common bug is to
    write path coordinates in EMU when the space is declared as a different size, producing shapes
    that shrink on round-trip. We always write `@w`/`@h` equal to the extent in EMU so the mapping
    is identity, and we normalise on read.
  - Freehand input is simplified (Ramer-Douglas-Peucker, tolerance in EMU scaled by zoom so the
    result is zoom-independent) before being converted to cubic Béziers. Unsimplified freehand
    produces thousands of nodes and bloats the file.
  - Node editing (drag a vertex, add/remove a vertex, convert a corner to a smooth node) is
    `important`; bezier handle editing is `later`. The context menu for a node offers the subset
    that exists.
  - Freeform is the one object type where the `wps:spPr/a:custGeom` and the `pic:spPr/a:custGeom`
    (for "crop to shape") share code; keep one path model.
  - A freeform with fewer than 2 points at commit is discarded.
- **OOXML.** `wps:spPr/a:custGeom/a:pathLst/a:path/@w,@h` with `a:moveTo`/`a:lnTo`/`a:cubicBezTo`/
  `a:close` and `a:pt/@x,@y`. Preset geometry is absent when custom geometry is present (they are
  mutually exclusive in `CT_CustomGeometry2D` vs `CT_PresetGeometry2D`).
- **Commands / events.** `object.freeform.insert({ path })`, `object.freeform.node.move(...)` →
  `object.created` / `object.changed`.

## OBJ-18 · Text boxes
**Priority** core · **Effort** L

- **Behaviour.** `Insert > Text Box > Draw Text Box` (drag a box) or `Insert Text Box` (click for a
  default box). The box enters text edit mode immediately with the caret in the first paragraph.
- **States.** drawing → textEditing → selected → formatted.
- **Rules & edge cases.**
  - The text box's **default paragraph formatting comes from the `Default Paragraph Font` /
    `Normal` style plus Word's built-in text-box defaults** - Word applies the host theme's body
    font, not the surrounding paragraph's formatting. Inheriting the surrounding paragraph's
    formatting produces text boxes that change appearance when moved, which is wrong.
  - A text box has its own `<w:txbxContent>` body: paragraphs, runs, tables (nested tables
    allowed), lists, fields, even inline pictures. It is **not** a rich-text `<div>` - it is a
    full WordprocessingML body, and the text engine operates on it identically. Reusing the
    document's text engine rather than a browser `contenteditable` is required for Word-faithful
    layout.
  - Direction (`wps:bodyPr/@vert`: `horz`, `vert`, `vert270`, `eaVert`) and text anchoring
    (`@anchor` `t|ctr|b`, `@anchorCtr`).
  - A text box with no fill and no outline is still selectable via its border hit area (a 1 px
    frame), and shows a dashed frame only when selected - Word behaviour. An unfilled text box
    must not swallow clicks meant for the text behind it *when not selected*: hit testing for an
    unfilled shape uses its **outline and text only**, not its interior. This single rule prevents
    a document becoming unclickable.
  - Text inside a text box participates in find/replace and the navigation pane (UI-30) with its
    location shown as "Text Box N".
  - Rotation and vertical text compose; the text baseline must follow `@vert`.
- **OOXML.** `wps:wsp` with `wps:txbx/w:txbxContent` (a `CT_TxbxContent` body), `wps:bodyPr` with
  `@lIns,@tIns,@rIns,@bIns` (default 91440 EMU = 0.1", matching Word), `@anchor`, `@vert`,
  `@wrap`, plus an autofit child (OBJ-20) and `wps:style`.
- **Commands / events.** `object.textbox.insert({ bounds })`, then the standard text commands from
  spec 02 addressed into the text box's paragraph scope → `object.created`, `text.changed`.

## OBJ-19 · Text inside shapes
**Priority** important · **Effort** M

- **Behaviour.** Any shape (except lines and connectors) accepts text: typing while a shape is
  selected starts text edit mode; the shape's context menu has "Add Text" / "Edit Text".
- **Rules & edge cases.**
  - Text uses the same `w:txbxContent` machinery as OBJ-18. One code path.
  - Text wraps to the shape's **inset rectangle** (`wps:bodyPr` insets), and for non-rectangular
    presets Word wraps to the text rectangle defined by the preset's `a:rect`-equivalent
    (`wps:spPr/a:prstGeom/a:avLst` guides). Correct irregular wrapping (e.g. inside a triangle) is
    **`later`**; v1 wraps to the bounding inset rectangle and this is a documented fidelity gap,
    not a silent one.
  - Vertical anchoring (top/middle/bottom) maps to `wps:bodyPr/@anchor`; "centre horizontally"
    maps to `@anchorCtr="1"`.
  - A line or connector refuses text; the UI does not offer it.
  - A shape's text is part of the shape's `wps:wsp`, so deleting the shape deletes the text; there
    is no separate object.
- **OOXML.** `wps:wsp/wps:txbx/w:txbxContent`, `wps:bodyPr/@anchor,@anchorCtr,@lIns…`.
- **Commands / events.** `object.shape.setTextTarget({ id })` (enters edit mode) → standard text
  commands → `object.changed`.

## OBJ-20 · Text autofit and overflow
**Priority** important · **Effort** M

- **Behaviour.** Shape Format `Text > Autofit`: `Do Not Autofit`, `Shrink Text on Overflow`,
  `Resize Shape to Fit Text`. Plus `Wrap Text in Shape` and the Text Direction gallery.
- **States.** `noAutofit` · `normAutofit` (with computed `fontScale` and `lnSpcReduction`) ·
  `spAutoFit`.
- **Rules & edge cases.**
  - `Do Not Autofit` with overflowing text must show the **overflow indicator** (Word shows a small
    marker) and render the text overflowing, not clipped, in print layout. Silently clipping is a
    data-loss illusion: the text is still in the file.
  - `Shrink Text on Overflow` computes `fontScale` (1000ths of a percent) and `lnSpcReduction`
    and **writes them into the file**, so Word shows the same rendered size. Computing the scale
    but not writing it means the document looks different in Word - an unacceptable round-trip
    difference for this product.
  - The autofit computation runs against the layout engine's text measurement, must converge in a
    bounded number of iterations (binary search on scale, max 30 iterations, 0.5% tolerance), and
    must not oscillate.
  - `Resize Shape to Fit Text` makes the shape's `a:ext` follow its content, so a manual resize is
    refused until autofit is switched off (with a notice) - Word's behaviour.
  - Changing the shape's font invalidates a cached `fontScale`. Invalidation must be explicit; a
    stale `fontScale` renders text at the wrong size forever.
- **OOXML.** `wps:bodyPr` children: `<a:noAutofit/>` · `<a:normAutofit fontScale="…"
  lnSpcReduction="…"/>` · `<a:spAutoFit/>`. Plus `wps:bodyPr/@wrap="none|square"` and
  `@vert`, and `wps:spPr/a:xfrm/a:ext` for `spAutoFit`.
- **Commands / events.** `object.autofit.set({ ids, mode })` → `object.changed` ·
  `layout.textbox.overflow` event when a shape overflows.

## OBJ-21 · Group and ungroup
**Priority** core · **Effort** L

- **Behaviour.** `Group` (`Ctrl+G`) with 2+ objects selected; `Ungroup` (`Ctrl+Shift+G`). A group
  behaves as one object for selection, move, resize, rotate and z-order; double-click enters the
  group to select a child; `Esc` leaves.
- **States.** `none` · `group selected` · `child selected (inside group)` · `group text edit`.
- **Rules & edge cases.**
  - **Grouping writes a new child coordinate space.** `wpg:grpSpPr/a:xfrm` carries `a:off`/`a:ext`
    (the group on the page) **and** `a:chOff`/`a:chExt` (the child space). Every child's `a:off`
    is re-expressed in the child space. Getting this wrong makes objects jump or shrink on the
    first re-open in Word - the single most common grouping bug.
  - Grouping objects with **different `relativeFrom`** values normalises all children to the
    group's space; the children's original anchors are preserved in memory so ungrouping restores
    them (Word does not restore them; we do, and document the difference as an improvement).
  - Group members may themselves be groups (`wpg:wgp` nests). Depth is unbounded by the schema but
    the UI refuses past 10 levels with a notice, and the renderer has no depth limit.
  - A group may contain a floating-only member? No - **a group is itself one object** and has a
    single wrap and a single anchor. Members do not have their own wrap. The UI must not offer wrap
    controls for a child inside a group.
  - Grouping objects that span page boundaries is allowed (Word allows it) but a group whose
    children are on different pages cannot be split; we anchor the group to the paragraph of the
    topmost child and note the case in the layout spec.
  - Ungrouping restores each child's absolute position **such that nothing moves on screen** - the
    visual position is the invariant, and the anchor offsets are recomputed.
  - Grouping objects with different rotations bakes nothing: child `a:rot` is kept and the group's
    rotation is the identity unless the user rotates the group.
  - Ungroup with a single object selected is disabled; `Group` with one object is disabled.
  - A group cannot be converted to inline if any child would be invalid inline (e.g. it lives in a
    footnote).
- **OOXML.** `a:graphicData[@uri="…/wordprocessingGroup"]/wpg:wgp` containing `wpg:cNvGrpSpPr`,
  `wpg:grpSpPr/a:xfrm` (`a:off`, `a:ext`, `a:chOff`, `a:chExt`, `@rot`, `@flipH`, `@flipV`), and
  children (`wps:wsp`, `pic:pic`, nested `wpg:wgp`). Wrapped in `wp:anchor`/`wp:inline` with
  `wp:docPr` for the group. Legacy `v:group` read support required.
- **Commands / events.** `object.group({ ids })`, `object.ungroup({ id })` → `object.created` /
  `object.removed` / `object.selection.changed`.

## OBJ-22 · Align and distribute
**Priority** important · **Effort** M

- **Behaviour.** Shape Format `Align`: Align Left / Center / Right / Top / Middle / Bottom;
  Distribute Horizontally / Vertically; Align to Page / Align to Margin / Align to Selected
  Objects. Enabled only with 2+ objects selected (align) or 3+ (distribute).
- **States.** The "Align to" choice persists per session and is shown as a checkmark.
- **Rules & edge cases.**
  - **"Align to Page/Margin/Selected Objects" is not a modality - it changes the anchor.** Aligning
    to page sets each object's `wp:positionH/@relativeFrom="page"` and recomputes `posOffset`;
    aligning to margin uses `relativeFrom="margin"`; aligning to selected objects uses the
    selection's bounding box and preserves each object's existing `relativeFrom`. Users must not
    see their relativeFrom silently change when they align to each other, so the third mode
    explicitly preserves it, and the properties panel shows the value so the difference is visible.
  - Aligning writes integer EMU offsets. Rounding is applied once, at the end, with a documented
    rule (round half away from zero) so repeated aligns in a row do not drift. Drift after ten
    aligns is the classic symptom of per-step rounding.
  - Align uses the **rotated bounding box** for rotated objects, not the unrotated extent.
  - Distribute divides the *free space* equally between objects' near edges, not their centres
    (Word's rule): the first and last objects stay put and the gaps between adjacent bounding boxes
    are equalised. Centre-based distribution is a different operation and is not what users expect.
  - Aligning a child inside a group aligns within the group's coordinate space, not the page.
  - Align is refused when a selected object is locked (`object.locked`) with a notice naming it.
  - Text-alignment commands (paragraph alignment) and object-alignment commands must never share a
    command id or a ribbon control; the ribbon shows the object Align group only with objects
    selected (contextual tab, UI-04).
- **OOXML.** `wp:positionH/@relativeFrom,@wp:posOffset` and `wp:positionV/@relativeFrom,@wp:posOffset`;
  for group members, `a:off/@x,@y` in the group child space.
- **Commands / events.** `object.align({ ids, edge, relativeTo })`,
  `object.distribute({ ids, axis })` → `object.changed` (one event carrying all moved ids).

## OBJ-23 · Position relative to page / margin / paragraph / character / line
**Priority** core · **Effort** L

- **Behaviour.** The Layout Options panel (OBJ-36) exposes a "Position" section with horizontal
  ("Alignment", "Book Layout", "Relative to") and vertical controls, plus a "Move with text" and
  "Lock anchor" checkbox (OBJ-24, OBJ-25), matching Word's Layout dialog exactly.
- **Values.**
  - Horizontal `relativeFrom`: `page` · `margin` · `column` · `character` · `leftMargin` ·
    `rightMargin` · `insideMargin` · `outsideMargin`.
  - Vertical `relativeFrom`: `page` · `margin` · `paragraph` · `line` · `topMargin` ·
    `bottomMargin` · `insideMargin` · `outsideMargin`.
  - The non-mirrored values are the ones the UI offers by default; the margin-variant values are
    presented only for mirrored-margin documents (they are shown as "Inside/Outside").
- **Rules & edge cases.**
  - Changing `relativeFrom` must **preserve the on-screen position**: we read the object's
    resolved absolute position under the old reference frame, change the reference, and recompute
    `posOffset` in the new frame. Naively rewriting only the attribute makes every object jump -
    the most visible possible bug in this area.
  - `character` anchors the object horizontally to the character at the anchor's run offset and is
    the only mode that makes a floating object track a specific glyph. It is what "position
    relative to character" means and must be round-tripped even though writing `character` is
    rare in Word output.
  - Alignment-based positioning (`wp:align` with `left|center|right|top|inside|outside`) is
    preserved on read and preferred on write for page/margin-centre presets from the position
    gallery, because it survives margin changes. A `posOffset` computed at one margin is wrong
    after the margin changes; `wp:align` is not. Where a preset implies alignment, we write
    `wp:align`, not an offset.
  - `wp:posOffset` may be negative (objects above/left of the reference). The UI shows negative
    values, not clamped zeroes.
  - `wp:positionH` and `wp:positionV` are both required inside `wp:anchor` and must appear in that
    order.
- **OOXML.** `wp:anchor/wp:positionH[@relativeFrom]/wp:posOffset|wp:align`,
  `wp:anchor/wp:positionV[@relativeFrom]/wp:posOffset|wp:align`, `wp:simplePos[@x,@y]` (written as
  `x="0" y="0"` with `wp:anchor/@simplePos="0"` - the simple position must be present and ignored).
- **Commands / events.** `object.position.set({ ids, horizontal, vertical })` →
  `object.changed` · `object.position.preview` during a Layout panel edit.

## OBJ-24 · Anchor locking
**Priority** important · **Effort** S

- **Behaviour.** "Lock anchor" in the Layout Options panel pins the object's anchor to its current
  paragraph: the object can still be dragged, but the anchor does not move to a new paragraph when
  the object is dragged near a different one.
- **Rules & edge cases.**
  - `locked="1"` means the anchor paragraph does not change; it does **not** mean the object cannot
    be moved. UI language must not say "lock position" - users confuse the two, and Word's own
    label ("Lock anchor") is what they expect.
  - With `locked="1"`, dragging the object far from its anchor leaves the object visually detached
    from the paragraph that owns it, and moving that paragraph moves the object. This is Word
    behaviour and must be reproduced, including the visual anchor marker when "Show anchors" is on.
  - A locked anchor is released by unchecking, by converting to inline, or by cutting and pasting.
  - `object.locked` (a separate library-level flag preventing *any* edit) is a different concept
    with a different name (`editable: false`), and the two must not share a name in the API.
  - "Show anchors" (an editor option, and a status-bar-adjacent view toggle) draws the anchor
    glyph in the margin for the selected object and, optionally, all objects.
- **OOXML.** `wp:anchor/@locked="1"`. Anchor position in the file is the position of the run
  containing `w:drawing` within its paragraph.
- **Commands / events.** `object.anchor.set({ ids, locked })` → `object.changed`.

## OBJ-25 · Move with text
**Priority** core · **Effort** M

- **Behaviour.** The "Move with text" checkbox in Layout Options. Checked (default) - the object
  travels with its anchor paragraph as the text reflows. Unchecked - the object stays at a fixed
  position on the page while the text moves.
- **Rules & edge cases.**
  - **Encoding note (open decision - see §5).** OOXML has no `moveWithText` attribute. Word
    derives the checkbox from the vertical reference frame: `paragraph`/`line` behave as "move with
    text"; `page`/`margin` behave as fixed. We therefore model the checkbox as a **derived view**
    over `wp:positionV/@relativeFrom`, and toggling it rewrites `relativeFrom` while preserving the
    resolved on-screen position (per OBJ-23). This is a modelling decision that must be captured in
    an ADR before implementation, because it is the one place in this spec where a Word UI state has
    no direct OOXML attribute.
  - Toggling to "fixed" on a paragraph that later moves to another page must leave the object on
    the original page - verify this in tests, since it is the whole point of the feature.
  - Anchoring in a table cell adds a second axis: `wp:anchor/@layoutInCell="1"` means the object
    moves with the cell (default), `"0"` means it is positioned relative to the page and does not
    move when the cell moves. This is Word's "Fix position on page" for objects in tables and is a
    *separate* checkbox from "Move with text" in the cell case; both must be exposed and both map
    to real attributes (`layoutInCell`, `relativeFrom`).
- **OOXML.** `wp:anchor/@layoutInCell`, `wp:positionV/@relativeFrom`, `wp:anchor/@allowOverlap`
  (with `layoutInCell="0"`, `allowOverlap` governs whether the object may overlap other objects).
- **Commands / events.** `object.anchor.set({ ids, moveWithText })` → `object.changed`.

## OBJ-26 · Position gallery (presets)
**Priority** important · **Effort** M

- **Behaviour.** The Layout Options / Position gallery shows a 3×3 grid of preset thumbnails
  labelled "Position in Top Left with Square Text Wrapping" … "Position in Bottom Right with Square
  Text Wrapping", plus "More Layout Options…". Each preset is a single command that sets wrap +
  relativeFrom + alignment together.
- **States.** The active preset is highlighted when the object's current properties match it
  exactly; a partial match highlights nothing and the panel shows the explicit values instead.
- **Rules & edge cases.**
  - Presets are **not** stored in the file - only their resolved properties are. The "which preset
    is active" state is derived by matching, and the matcher must be tolerant of the ±1 EMU
    rounding that Word itself produces, or the highlight will flicker.
  - Applying a preset that changes wrapping changes the layout of surrounding text; the change must
    be a single undo entry and must re-run layout for the affected paragraphs only, not the whole
    document (a full re-layout on every preset click makes the feature feel broken on long
    documents).
  - The gallery's thumbnails are rendered from the live theme, not from static bitmaps, so they
    match the document's fonts and colours.
  - Keyboard: the gallery is a grid with arrow-key navigation (UI-06 vocabulary).
- **OOXML.** A preset writes a combination of `wp:anchor/@relativeHeight,behindDoc`,
  `wp:positionH[@relativeFrom]/wp:align`, `wp:positionV[@relativeFrom]/wp:align`,
  `wp:wrapSquare/@wrapText="bothSides"`. Word's nine Square presets all use
  `wrapSquare` with `wrapText="bothSides"` and `relativeFrom="margin"`/`"paragraph"`; the two
  tight presets use `wp:wrapTight`.
- **Commands / events.** `object.position.preset({ ids, preset })` → `object.changed`.

## OBJ-27 · Wrapping modes
**Priority** core · **Effort** L

- **Behaviour.** Wrap Text gallery: `In Line with Text`, `Square`, `Tight`, `Through`, `Top and
  Bottom`, `Behind Text`, `In Front of Text`, and `Edit Wrap Points`. `In Line with Text` converts
  to inline (OBJ-05).
- **Rules & edge cases.**
  - `Behind Text` and `In Front of Text` both use `wp:wrapNone`; they differ only in
    `wp:anchor/@behindDoc`. The UI must show them as two separate choices (they are, visually) even
    though they share a wrap element.
  - `Square` wraps to the object's bounding box; `Tight`/`Through` wrap to the shape outline
    (`wp:wrapPolygon`). For a picture, Tight uses the picture's rectangle unless wrap points have
    been edited; Word generates a polygon from the alpha channel only on explicit request. We do
    **not** auto-generate alpha-based wrap polygons - it is slow, and it surprises users.
  - `Edit Wrap Points` enters a mode where the wrap polygon vertices are draggable; the polygon is
    stored in `wp:wrapPolygon/wp:start` and `wp:lineTo` with coordinates in the
    **wrap polygon coordinate space** (a 0-21600 grid relative to the object's extent, matching
    `wp:wrapPolygon/@edited`). Writing those coordinates in EMU is a round-trip bug we must test
    for explicitly.
  - Text must not be laid out on top of a Square-wrapped object; the wrap distances (OBJ-28) are
    part of the exclusion rectangle. The layout engine owns this; the object layer only supplies
    geometry.
  - An object with `wp:wrapNone` does not affect line breaking at all - no reflow on insert, which
    is why "Behind Text" feels instant. Do not re-run layout for it.
  - `Top and Bottom` moves the whole object above or below the line, whichever side has more room
    at the anchor - Word's rule; the object does not split text mid-line.
  - Wrapping is inert for objects in a text box (they wrap to the box, not the page) and for group
    children (only the group wraps).
- **OOXML.** `wp:wrapNone` · `wp:wrapSquare[@wrapText="bothSides|largest|left|right"]/@distT,@distB,@distL,@distR`
  · `wp:wrapTight[@wrapText]/wp:wrapPolygon[@edited]/wp:start,@wp:lineTo` · `wp:wrapThrough` (same
  as tight) · `wp:wrapTopAndBottom/@distT,@distB`. Plus `wp:anchor/@behindDoc`.
- **Commands / events.** `object.wrap.set({ ids, mode })`, `object.wrap.polygon.set({ id, points })`
  → `object.changed`, plus `layout.reflow` for the affected paragraphs.

## OBJ-28 · Wrap distances
**Priority** important · **Effort** M

- **Behaviour.** Numeric fields for "Distance from text" top / bottom / left / right, shown in the
  Layout Options panel for Square, Tight, Through and Top-and-Bottom wraps. Hidden (disabled) for
  `wrapNone` and inline.
- **Rules & edge cases.**
  - Values are EMU in OOXML but the UI shows them in the document's ruler unit (OBJ-11); the
    conversion is the same module as §1.
  - Negative distances are schema-valid but produce nonsense; the UI clamps to ≥ 0 and reports if a
    file contained a negative value on read (preserved in the model, corrected on edit).
  - Default on conversion to a wrap mode is 0 for Square (Word writes 114300 EMU = 0.125" in some
    versions; we write 0 and accept any value on read). **Do not** invent a non-zero default: the
    rendered gap must match what Word would render for the same file, and Word's own default is
    inconsistent across versions.
  - Changing a wrap distance re-runs layout for the affected paragraphs (the exclusion rectangle
    changed).
  - `wrapTight`'s polygon already insets the shape; distances then apply to the polygon bounds. Both
    apply, and the order matters: the polygon defines the region, the distances expand it.
- **OOXML.** `wp:wrapSquare/@distT,@distB,@distL,@distR` and the same on `wp:wrapTight`,
  `wp:wrapThrough`, `wp:wrapTopAndBottom`. Note the attributes are on the **wrap element**, not on
  `wp:anchor` - but `wp:anchor` *also* carries `@distT,@distB,@distL,@distR` (the "distance from
  text" for the anchor as a whole). Both exist; the wrap element's values win where they are
  present, and we must write both consistently to avoid Word showing different values in its dialog
  than we show.
- **Commands / events.** `object.wrap.distances.set({ ids, dist })` → `object.changed`.

## OBJ-29 · Z-order operations
**Priority** core · **Effort** M

- **Behaviour.** `Bring Forward` / `Send Backward` (one step), `Bring to Front` / `Send to Back`
  (all the way), `Bring in Front of Text` / `Send Behind Text`, from the ribbon (Shape Format >
  Arrange) and the object context menu. `Bring in Front of Text` / `Send Behind Text` are the
  "relative to text" pair and set `behindDoc`.
- **States.** The four step/absolute commands are disabled when the object is already at the
  extreme; the text pair shows as a toggle.
- **Rules & edge cases.**
  - **Z-order among floating objects is `wp:anchor/@relativeHeight`**, an unsigned integer where
    **higher is in front**. Stepping forward swaps `relativeHeight` with the next-highest object
    that **overlaps** it - not with the globally next value, which would appear to do nothing when
    the neighbour is elsewhere on the page. Word compares against overlapping objects; matching
    that is what makes the buttons feel like they work.
  - To front / to back is max+1 / min−1 over the overlapping set, clamped at 0 (values are
    unsigned; sending to back when a value is already 0 requires renumbering the whole overlapping
    set downward - renumbering must be a single atomic operation, and it must not change the
    relative order of any other pair).
  - `behindDoc` is **independent of `relativeHeight`**: a behind-text object is behind all text but
    still ordered against other behind-text objects. Two behind-text objects keep their relative
    order. The UI must never imply that "Send to Back" means "behind the text" - those are different
    commands and conflating them is exactly the complaint we are preventing.
  - A group's children are ordered by **document order within `wpg:wgp`**, not by `relativeHeight`.
    Bring Forward on a group child reorders the child within the group; it must not touch the
    group's `relativeHeight`.
  - Inline objects have no z-order; the commands are disabled with a tooltip explaining that the
    object is in the text flow (and offering "Wrap Text" as the fix). A disabled button with no
    explanation is the failure mode we are avoiding.
  - Z-order changes never affect layout (no reflow) - a pure re-render.
- **OOXML.** `wp:anchor/@relativeHeight` (unsigned int, higher = in front), `wp:anchor/@behindDoc`.
  Group members: document order inside `wpg:wgp`.
- **Commands / events.** `object.zorder({ ids, op: 'forward' | 'backward' | 'front' | 'back' |
  'inFrontOfText' | 'behindText' })` → `object.zorder.changed` → `object.changed`.

## OBJ-30 · Move by drag, snapping and smart guides
**Priority** core · **Effort** L

- **Behaviour.** Dragging an object's body moves it. During the drag, smart guides appear: dashed
  lines when the object's edges or centre align with the page centre, a margin, another object's
  edge, or another object's centre, with distance labels between objects (Word 2013+ behaviour).
  Releasing commits one undo entry.
- **Snap sources (in order of strength):** page edges and page centre · margin and column edges ·
  other objects' edges (left/right/top/bottom) and centres (h/v) · the object's own starting
  position · the drawing grid (if "Snap to grid" is on, `w:displayVerticalDrawingGridEvery` etc.).
- **Rules & edge cases.**
  - Snap threshold is **6 device pixels**, converted to document units at the current zoom so the
    feel is constant across zoom levels. A fixed document-unit threshold makes snapping unusable at
    low zoom and overpowering at high zoom.
  - `Alt` held at drag start disables snapping entirely (Word behaviour); the guides disappear
    immediately and the object moves freely. The modifier must be sampled continuously during the
    drag, not only at `pointerdown`.
  - Smart guides are drawn in **screen space** on an overlay layer, never inside the page DOM, so
    they do not affect layout, hit testing, or printing.
  - Dragging an object out of the page is allowed (off-page positioning is legitimate for bleed);
    the page boundary shows a stronger guide when the object's edge aligns with it.
  - Dragging an **inline** object is not a move - it re-orders the anchor within the text flow
    (drag to reposition between characters), showing a caret rather than a move cursor. This is a
    different operation with a different visual language; do not show the move cursor.
  - Dragging a **child inside a group** moves it within the group's coordinate space and shows the
    group's guides, not the page's.
  - Dragging a floating object near a different paragraph moves its **anchor** to that paragraph
    unless the anchor is locked (OBJ-24). The anchor marker is shown during the drag so this is
    visible rather than mysterious.
  - Dragging an object in a table cell must respect `layoutInCell` (OBJ-25) - with
    `layoutInCell="1"` the object cannot be dragged outside its cell without converting to
    `layoutInCell="0"`, which we offer as an explicit "Fix position on page" action instead of
    doing silently.
  - `Ctrl+drag` copies the object (Word's behaviour); the copy is a new object with a new
    `wp:docPr/@id` and all media relationships re-pointed. `Shift+drag` constrains to horizontal or
    vertical.
  - Threshold-exceeding drags do not fire on a simple click: a 3 px dead zone before a drag starts,
    so selecting an object never nudges it by a pixel. Nudging a carefully placed object by
    accident is one of the most infuriating small bugs in a web editor.
- **OOXML.** Result is `wp:positionH/wp:posOffset` + `wp:positionV/wp:posOffset`; if the drag
  crossed a paragraph boundary and the anchor moved, the `w:drawing` is removed from the old run
  and re-inserted in the new run (with the runs split and reformatted per OBJ-05). The anchor
  paragraph change is a real document edit, not a property tweak.
- **Commands / events.** `object.move.preview({ ids, delta })` (transient, emits guide events) →
  `object.position.set(...)` → `object.changed`.

## OBJ-31 · Nudge and precise positioning
**Priority** important · **Effort** S

- **Behaviour.** Arrow keys nudge the selected object(s); `Shift+arrow` by 10×; `Ctrl+arrow` by a
  single CSS pixel (9525 EMU at 96 dpi); the Layout Options panel and a "Size and Position"
  dialog accept exact numeric values with a unit selector.
- **Rules & edge cases.**
  - Arrow-key nudge is one undo entry per key *sequence* (coalesced with a 500 ms idle or any other
    command, matching the text-caret behaviour in spec 02), not one per keypress. 40 arrow presses
    must not be 40 undos.
  - Nudge uses the same snapping-disabled path as `Alt+drag`; it never snaps.
  - Numeric fields commit on blur and on `Enter`, reject invalid input by reverting and showing an
    inline message (never silently clamping to 0 - silently turning a typed "abc" into 0 destroys
    the object's position).
  - The dialog exposes position `relativeFrom` so a user typing "2 cm from margin" can express it
    exactly (OBJ-23).
  - Nudging with multiple objects selected moves all of them by the same delta, relative to the
    primary selection's snap position.
- **OOXML.** `wp:posOffset`; for group children, `a:off`.
- **Commands / events.** `object.nudge({ ids, dx, dy })` → `object.changed`.

## OBJ-32 · Object context menu
**Priority** core · **Effort** M

- **Behaviour.** Right-click (or `Shift+F10` / the context-menu key) on a selected or unselected
  object opens the object context menu, which **first selects the object under the pointer** so the
  menu's actions apply to what was clicked - Word's behaviour and the reason a context menu
  feels right.
- **Contents** (sections separated by rules, in this order, with priority-ordered trimming when
  space is short):
  1. `Cut` · `Copy` · `Paste`
  2. `Edit Text` / `Edit Picture` (only when the host supports it; hidden otherwise, not disabled)
  3. `Bring to Front` ▸ / `Send to Back` ▸ (submenu with the four + two text-relative commands)
  4. `Wrap Text` ▸ (the wrap gallery as a submenu with live thumbnails)
  5. `Position` ▸ (the 3×3 preset gallery + `More Layout Options…`)
  6. `Align` ▸ · `Group` ▸ · `Rotate` ▸ · `Flip` ▸
  7. `Crop` · `Compress Pictures` · `Change Picture` · `Reset Picture`
  8. `Alt Text…`
  9. `Format Object…` (opens the properties panel / Format Shape task pane)
- **Rules & edge cases.**
  - Menu items are **generated from the same registry that drives the ribbon**, so an item cannot
    exist in one and not the other, and enablement/labels are identical. Two hand-maintained lists
    drift within a month.
  - Items are disabled with a **reason**, not hidden, when the object type does not support them -
    except items that make no sense at all for the type (e.g. `Crop` on a text box), which are
    hidden. Disabled-with-reason is shown on hover.
  - Submenus open on hover after 300 ms or immediately on click, and flip to the left when they
    would overflow the viewport.
  - The menu must open at the pointer and stay fully on screen, flipping vertically/horizontally at
    the edges; it must not be clipped by the editor container (rendered in a top-layer portal).
  - Right-clicking an **unselected** object selects it; right-clicking **inside the current
    multi-selection** keeps the multi-selection so align/distribute/group apply to all of them;
    right-clicking **outside** it selects only the object under the pointer.
  - Right-clicking a group child does **not** enter the group - the menu applies to the group
    (Word behaviour), with `Ungroup` available.
  - Right-clicking a field or on an image inside a text box routes to the correct menu (UI-28).
  - Keyboard: the menu is reachable without a mouse, and its accessible name is the object type
    ("Picture menu", "Shape menu"). This is part of UI-27's framework.
- **OOXML.** None (chrome). The selection change it causes emits `object.selection.changed`.
- **Commands / events.** Opens via `ui.contextMenu.open({ surface: 'object', at, targetId })`;
  items dispatch their normal commands with `source: 'ui'`.

## OBJ-33 · Multi-select, Selection pane, and keyboard reachability
**Priority** important · **Effort** M

- **Behaviour.** `Ctrl+click`/marquee multi-select (OBJ-06); the **Selection pane**
  (`Home > Select > Selection Pane`, and `Select Objects`) lists every object on the current page
  in z-order (front at top) with its name and a show/hide eye toggle. Clicking a row selects;
  `Ctrl+click` adds; double-clicking the name renames; the eye toggles visibility; drag reorders
  z-order. `Show All` / `Hide All` buttons.
- **States.** A hidden object renders nothing and is not hit-testable, but **remains in the
  document and in the file**. Hiding is an editing convenience, not a deletion.
- **Rules & edge cases.**
  - **Hidden state must be written to the file or it is a lie.** `wp:anchor/@hidden="1"` (or
    `wp:inline`'s absence - inline objects cannot be hidden, so hiding an inline object converts it
    to floating with `hidden="1"`, and unhiding restores inline placement). Alternatively the host
    may configure `hideMode: 'session'` (hidden only in this session, nothing written to the file),
    which must then be visibly labelled in the pane, because every other editor writes it to the
    file and a user moving between them will be confused. `hideMode` default: `'file'`.
  - The pane lists objects **per page** (Word lists per page), with a page selector when the
    document has more than one; objects in headers/footers appear under a separate section.
  - Accessibility: **the editor must be fully operable from the keyboard for objects.** `Tab`/
    `Shift+Tab` cycle object-by-object *within the body text flow* when in "object navigation"
    mode (`F6`-style region cycling or the pane), arrow keys move the selected object, `Enter`
    enters text edit, `Delete` removes, `Shift+F10` opens the context menu, `Esc` exits. Every one
    of these must have a discoverable equivalent in the ribbon or the pane, because a
    keyboard-only user cannot drag a resize handle.
  - A "size and position" numeric dialog (OBJ-31) is the keyboard path to resizing; the pane's
    context menu exposes it.
  - Selected-object announcements go to an ARIA live region ("Picture 3 selected, 2 of 5 objects").
  - The pane is a chrome slot (`panels`) and is fully replaceable.
- **OOXML.** `wp:anchor/@hidden`, `wp:docPr/@name` (rename), document order + `relativeHeight`
  (reorder). The pane's section for headers/footers reflects that those objects live in
  `word/headerN.xml`, not `document.xml` - the pane must say so rather than appearing to show an
  object that is not in the body.
- **Commands / events.** `object.visible.set({ ids, visible })`, `object.rename({ id, name })`,
  `object.selection.set(...)` → `object.changed`, `object.selection.changed`.

## OBJ-34 · Object clipboard: cut, copy, paste, duplicate, delete
**Priority** core · **Effort** M

- **Behaviour.** `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+D` (duplicate) / `Delete` for objects, in
  both the ribbon and the context menu. Paste places the object at the pointer position (Word
  pastes a *copy* slightly offset from the original; we paste at the pointer when the paste is
  pointer-initiated, and offset by 0.1" when it is keyboard-initiated).
- **Rules & edge cases.**
  - Cut/copy serialises the object to the internal clipboard as the OOXML fragment **plus** its
    media parts, so pasting into another document works and pasting back is lossless. Copying must
    deep-copy the `w:drawing` XML; a shallow copy produces two objects sharing mutable state - the
    classic "editing one changes the other" bug.
  - New `wp:docPr/@id` and `@name` on paste (ids must be unique per part); rel ids re-pointed to
    newly added media parts or to existing parts when the media already exists in the target
    document.
  - Deleting a floating object deletes its anchor run; if that leaves an empty run, the run is
    removed, and if that leaves an empty paragraph, the paragraph **stays** (Word keeps it) unless
    the host opts into `cleanupEmptyParagraphs`. Removing a paragraph the user did not ask to
    remove silently changes pagination.
  - Delete with multiple objects selected deletes all, as one undo entry.
  - Duplicating a floating object inherits `relativeHeight` shifted to just in front of the
    original, so the copy is visible rather than hidden behind it.
  - Cutting an inline object and pasting into a different document must bring the media with it -
    tested explicitly, since a copied `r:embed` pointing at a missing rel is the most common
    cross-document paste corruption.
  - Paste of a `data:` URI image or an image from HTML is handled by OBJ-03's preference order.
  - Undo of a delete restores the object to its exact z-order, anchor, and selection.
- **OOXML.** `w:drawing` fragment + `word/media/*` + rels; `wp:docPr/@id` uniqueness per part.
- **Commands / events.** `object.cut/copy/paste/duplicate/delete({ ids })` → `object.removed`,
  `object.created`, `object.selection.changed`.

## OBJ-35 · Anchor placement and the anchor marker
**Priority** important · **Effort** M

- **Behaviour.** A floating object's anchor is a run position inside a paragraph, and moving text
  moves the anchor with it. "Show anchors" draws the anchor glyph in the left margin beside the
  anchor's line, for the selected object (default) or all objects.
- **Rules & edge cases.**
  - Several objects may share one anchor position; the marker shows a stack indicator and the
    context menu lists them.
  - The anchor must be maintained through edits: if the anchor paragraph is deleted, the object is
    deleted with it; if the anchor's text is cut and pasted elsewhere, the object moves with it
    (Word behaviour). This is a **text-engine responsibility** and the object layer must not
    re-anchor on its own.
  - An anchor in a deleted section/header/footer takes the object with it; undo restores both.
  - Anchors are never allowed in: field instruction text, deleted (tracked) text, comment
    footnote content, or an empty paragraph immediately before a section break in a way that would
    detach the object - each case enumerated in the text spec and tested.
  - The anchor marker is chrome and must not appear in print, in the printed preview, or in the
    exported PDF.
- **OOXML.** The position of the `w:r` containing `w:drawing/wp:anchor` within its `w:p`; no
  dedicated element. `<w:bookmarkStart>`-style anchors do not exist for drawings.
- **Commands / events.** Internal `object.anchor.moved` event (not a user command) →
  `object.changed`, `layout.reflow`.

## OBJ-36 · Object-related panels (Layout Options, Alt Text, Format)
**Priority** important · **Effort** L

- **Behaviour.** Three panel surfaces, all usable both docked in the sidebar (UI-29) and as the
  library's floating "Layout Options" popover next to the selected object (the button Word shows
  to the right of a selected object):
  - **Layout Options** - the §OBJ-23/24/25/26/27/28 controls in four collapsed sections
    (Position · Text Wrapping · Size · Arrange), laid out exactly as Word's Layout dialog is,
    because that layout is what users have learned.
  - **Alt Text** - OBJ-12.
  - **Format Object** - fill/line/effects/size/position/alt-text tabs for pictures and shapes,
    equivalent to Word's Format Shape task pane, including a Size section with locked/unlocked
    aspect ratio and a numeric rotation.
- **Rules & edge cases.**
  - The floating Layout Options button appears to the right of the selection frame, vertically
    centred, offset 8 px, and flips to the left when it would leave the container. It is
    `contenteditable="false"`, non-focusable, and never captures the selection (UI-26's rules apply
    to it too).
  - Panels are read-only in `read` view mode; controls are disabled with a reason rather than
    hidden, so a user can see what a document contains.
  - Every panel control is a command with a live preview; `Esc` reverts the panel's pending
    previews and closes it (Word's Layout dialog has no preview, but a floating panel must, since it
    sits over the document - and every preview must be revertible).
  - Panel state (open/closed, docked/floating, scroll position) persists per session and is
    host-overridable.
  - The Size section's numeric fields accept unit-suffixed input (`1.5cm`, `0.6in`, `42pt`, `120px`)
    and show the unit the document is configured for by default.
- **OOXML.** None directly (each control maps per its own feature).
- **Commands / events.** `ui.panel.open/close({ id })` (no undo), plus each panel's own commands.

## OBJ-37 · Object accessibility and non-visual operation
**Priority** core · **Effort** M

- **Behaviour.** Objects are exposed as real, keyboard-reachable items with names derived from
  `wp:docPr/@name` and `@descr`, navigable without a pointer, and operable by every command that
  exists for them.
- **Rules & edge cases.**
  - Every object renders a focusable DOM node with `role="img"` (pictures) or `role="group"`
    (shapes/groups) and `aria-label` = name + description + a short type, plus `aria-roledescription`
    ("picture", "shape", "text box", "group").
  - Handles are exposed as `role="button"` with names ("Resize top left", "Rotate") and are reachable
    by `Tab` **within** the selection frame; they are decorative-but-operable, and each has a
    keyboard path to the equivalent numeric value (OBJ-31) for users who cannot drag.
  - The accessibility check (a ribbon item and an event) reports: images with no alt text, the
    total image count, merged table cells (spec 02's table section), and objects hidden behind
    text with content that is invisible to a screen reader user. It emits
    `accessibility.report.changed` so a host can surface it in its own UI.
  - Alt text is never used as the visible label in the Selection pane (users type long descriptions
    there); the pane shows `@name`, as Word does.
  - Reduced motion: smart-guide animations and the floating panel's fade honour
    `prefers-reduced-motion`.
  - Colour is never the only signal for selection or for a locked/read-only object: a lock glyph and
    a distinct frame style accompany it.
- **OOXML.** `wp:docPr/@name,@descr,@title`, `pic:cNvPr`, `wps:cNvSpPr`. Groups: `wp:docPr` on the
  group and `pic:cNvPr` on members (OBJ-12).
- **Commands / events.** `object.focus({ id })`, `accessibility.check()` →
  `accessibility.report.changed`, `object.focus.changed`.

## OBJ-38 · Connector attachment and re-routing
**Priority** later · **Effort** L

- **Behaviour.** A connector (straight, elbow, curved) can be attached to two shapes; when an
  attached shape is moved or resized, the connector re-routes to stay attached at the chosen
  connection site. Connection sites are highlighted on hover while a connector tool is armed.
- **States.** free-floating connector · attached both ends · attached one end · re-routing.
- **Rules & edge cases.**
  - **Why this is `later` and not core:** OBJ-16 ships connectors as drawn geometry that round-trips
    exactly, which preserves the file and lets users draw a connector - the v1 requirement. Live
    re-routing is a genuine layout-engine feature (it needs shape connection-site geometry per
    preset, and it must move connectors during the *drag preview*, not only on commit), and
    shipping it half-done would leave connectors that visibly detach, which is worse than
    connectors that simply stay put.
  - Connection sites come from the preset geometry's `a:cxnLst` (`a:cxn/@ang,@w,@h` with
    `a:pos/@x,@y`) for preset shapes, and from a computed fallback (the four edge midpoints) for
    custom geometry, which has no `cxnLst`.
  - Attachment is stored as `wps:cNvCnPr/a:stCxn` and `a:endCxn` (`@id` referencing the shape's
    `wp:docPr/@id`, `@idx` the site index) **plus** the connector's own `a:xfrm`/path geometry. Both
    must be kept consistent: a re-route that updates the geometry but not `stCxn`/`endCxn` (or vice
    versa) produces a file that Word re-routes differently than we rendered it.
  - A connector attached to a shape that is deleted becomes free-floating; the dangling
    `stCxn`/`endCxn` must be **removed**, not left pointing at a dead id (Word removes it).
  - Grouped shapes: a connector inside a group attaches within the group's coordinate space; a
    connector cannot attach to a shape in a different group.
  - Re-routing must be a preview during a drag (no undo entries mid-drag), matching OBJ-30's rule.
- **OOXML.** `wps:cNvCnPr/a:stCxn[@id,@idx]`, `a:endCxn[@id,@idx]`; preset geometry
  `a:prstGeom/a:avLst/a:gd/a:cxnLst`; connector shape `a:prstGeom[@prst="straightConnector1" |
  "bentConnector2..5" | "curvedConnector2..5"]`.
- **Commands / events.** `object.connector.attach({ id, end, targetId, siteIndex })` →
  `object.changed` · `object.connector.reroute.preview` (transient).

---

# Part B - UI chrome

## UI-01 · Chrome mounting and slot contract
**Priority** core · **Effort** L

- **Behaviour.** `new Docier(container, { chrome })` mounts the requested chrome into a stable
  layout: `[menuBar][quickAccess?][ribbon] / [ruler-corner][h-ruler] / [v-ruler][canvas][panels] /
  [statusBar]`. Regions are CSS-grid areas named `docier-<region>`; a host can restyle the grid or
  supply its own element per region.
- **States.** `full` · `minimal` · `none` · custom slots (see §3). Mount/unmount is idempotent and
  emits `ui.chrome.mounted` / `ui.chrome.unmounted` with the slot list.
- **Rules & edge cases.**
  - Chrome elements are created in the container, never appended to `document.body` - except
    portals (context menus, dialogs, floating panels, tooltips) which mount to a portal root that
    the host can specify (`portalRoot`), defaulting to the container. Portals outside the container
    are required for correct stacking but must be cleaned up on destroy.
  - `destroy()` removes every listener, portal, observer and worker; a leaked `ResizeObserver` on a
    destroyed editor is a known failure mode in this class of library and is tested.
  - Chrome never reads the document model directly - it subscribes to state and dispatches commands.
    Enforceable by lint rule: chrome modules may not import the document model module.
  - The layout must not be a fixed pixel size: the canvas fills its grid area, and the chrome
    measures with `ResizeObserver` and re-lays out. `ResizeObserver` loops (chrome height change →
    layout change → chrome height change) must be broken with a measured-height cache.
- **OOXML.** None.
- **Commands / events.** `ui.chrome.set({ mode, slots })` → `ui.chrome.mounted`.

## UI-02 · Menu bar and backstage
**Priority** core · **Effort** L

- **Behaviour.** A Word-shaped menu bar: `File · Home · Insert · Draw · Design · Layout ·
  References · Mailings · Review · View · Help`. Clicking a menu **tab** switches the ribbon; the
  `File` tab opens the **backstage** (a full-area view, not a dropdown) with `New · Open · Save ·
  Save As · Print · Share · Export · Close` down the left and contextual content on the right.
- **States.** backstage open (the editor is inert behind it; `Esc` or `Back` returns to the
  document); a tab is `active`; a tab is `disabled` when the feature set it belongs to is not
  available in this host.
- **Rules & edge cases.**
  - Tabs the host does not support are **removed**, not shipped broken. A visible `Mailings` tab
    with nothing in it is exactly the "web form" impression we are trying to avoid.
  - The backstage `Print` item shows a real print preview rendered by the layout engine at page
    scale, with page navigation and print/page-setup controls - not a browser print dialog passthrough.
    `Export` offers DOCX (native), PDF (via the layout engine's own PDF writer or the host), and
    HTML (`later`).
  - Menu bar items are keyboard operable and expose `aria-keyshortcuts` for the Alt+letter tips
    (UI-07).
  - The menu bar collapses into the ribbon's tab row on narrow widths - there is exactly one tab
    strip in the chrome at any width, never two.
  - "Recent files" in the backstage is host-provided or absent; the library does not own storage.
- **OOXML.** None. `Save` writes the OPC package (spec 05); `Print` uses `<w:savePreviewPicture>`-
  adjacent settings only insofar as it renders from the live layout.
- **Commands / events.** `ui.ribbon.setTab({ tab })`, `ui.backstage.open({ page })`,
  `document.save()`, `document.print()` (host-overridable) → `ui.chrome.state.changed`.

## UI-03 · Ribbon structure: tabs, groups, control vocabulary, dialog launchers
**Priority** core · **Effort** XL

- **Behaviour.** Each tab is a set of **groups** (named, with a bottom label and a thin separator,
  as in Word), each group a horizontal set of controls with at most one "large" control on the
  left. Every group has an optional **dialog launcher** (the small arrow in its bottom-right
  corner) opening the corresponding dialog (UI-19…UI-24).
- **Organisation (v1 groups).**
  - **Home** - Clipboard · Font · Paragraph · Styles · Editing
  - **Insert** - Pages · Tables · Illustrations · Add-ins(host) · Media · Links · Header & Footer ·
    Text · Symbols
  - **Draw** - Pens(host-enabled) · Convert · Insert Shapes · Shape Styles
  - **Design** - Document Formatting · Document Elements(host) · Page Background
  - **Layout** - Page Setup · Paragraph · Arrange
  - **References** - Table of Contents · Footnotes · Citations(host) · Captions · Index · Table of
    Authorities
  - **Review** - Proofing · Accessibility · Language · Comments · Tracking · Changes · Compare(host)
  - **View** - Views · Show · Zoom · Window(host) · Macros(host)
- **Control vocabulary** (the whole ribbon is built from exactly these, so nothing looks like a
  web form):
  - **button**, **toggle** (pressed state, e.g. Bold), **split button** (main action + dropdown),
    **dropdown menu**, **gallery** (visual previews, inline expanded or collapsed - used for
    Styles, Shapes, Wrap Text, Position, Table Styles, Shape Styles), **combo box** (font, size,
    style name - editable with free text), **spinner** (numeric, with unit), **checkbox**,
    **radio group**, **colour picker** (theme colours row + standard colours + recent + custom +
    "No Colour"), **numeric slider** (zoom, indent), **text field**.
  - Galleries render **live previews** using the real document content where feasible (Styles,
    Shape Styles) and honour the theme. A gallery of grey boxes is the web-form look we are
    avoiding.
  - Controls show a **tooltip with the keyboard shortcut** in the form `Bold (Ctrl+B)`, and screens
    beyond the first show the full label.
  - Controls that operate on the selection are enabled/disabled from the same **command registry**
    that the context menus use (UI-27), including the disabled reason.
  - Overflow: a group that does not fit collapses to its large button with a dropdown of the rest
    (UI-05).
- **Rules & edge cases.**
  - Keyboard: each group is a `role="toolbar"` with a **roving tabindex**; `Tab` moves between
    groups, arrow keys within; `Home`/`End` jump; `Space`/`Enter` invokes; `Down` opens a dropdown.
    Roving tabindex (not "every control is a tab stop") is required or the ribbon becomes 150 tab
    presses - the single biggest keyboard failure of web ribbons.
  - The ribbon must be **data-driven**: a `RibbonModel` (tabs → groups → controls → command ids)
    so the host can remove, reorder or add groups, and so the same model feeds the context menus
    and the QAT.
  - Commands not applicable to the current selection render disabled with a reason; commands
    removed by the host render as nothing at all.
  - Live preview (e.g. hovering a font in the Font combo applies it temporarily) uses transient
    commands and is fully reverted on `Esc` or on leaving the control. Preview must never enter the
    undo stack.
  - Touch: at `density: touch` the ribbon's controls grow to ≥44 px and galleries become sheets.
  - Screen readers announce group labels and control names; the ribbon is not a `<table>` (Word's
    real ribbon is, but ours must be semantic).
- **OOXML.** None (every control dispatches a command that maps per its feature).
- **Commands / events.** `ui.ribbon.setTab`, `ui.ribbon.setCollapsed`, and each control's own
  command → `ui.chrome.state.changed`.

## UI-04 · Contextual tabs
**Priority** core · **Effort** M

- **Behaviour.** Selecting an object, a table cell, a header/footer, a picture, a chart or a text
  box adds a coloured contextual tab set that is **selected automatically** on the first selection:
  `Picture Format` · `Shape Format` · `Drawing Tools > Format` · `Table Tools > Design | Layout` ·
  `Header & Footer Tools > Design` · `Chart Tools` (later). Deselecting removes the tabs and returns
  the ribbon to the previously active tab.
- **Rules & edge cases.**
  - The tab **stack is recalled**: selecting a picture, switching to `Home`, then selecting the same
    picture again returns to `Picture Format` - Word's behaviour; users notice immediately when it
    is missing.
  - Multiple different object types selected simultaneously shows the tab for the **dominant type**
    (picture > shape > text box) and the operations that apply to all of them (Arrange, Size); the
    others are disabled with a reason.
  - Contextual tabs animate open (respecting `prefers-reduced-motion`) so the user sees where the
    ribbon changed; appearing instantly is a known discoverability problem.
  - The tab appears and disappears as part of one chrome state change; it must never push a group of
    the active tab off-screen (observe the overflow rules of UI-05).
  - A host may suppress contextual tabs entirely (`chrome.contextualTabs: false`) and surface the
    same commands in its own UI; the tab model is exposed as state either way.
- **OOXML.** None. The triggering conditions are derived from the selection: `w:drawing` type
  (`pic:pic`, `wps:wsp`, `wpg:wgp`), `w:tbl`, header/footer part identity.
- **Commands / events.** `object.selection.changed` drives it; `ui.ribbon.setTab` responds.

## UI-05 · Ribbon collapsing and responsive behaviour
**Priority** important · **Effort** M

- **Behaviour.** Three collapse states: **full** (labels + buttons), **collapsed** (tabs only; the
  ribbon expands on tab click or hover and collapses after use), **hidden**. Toggled by
  double-clicking a tab, `Ctrl+F1`, the collapse chevron, or the `Show Ribbon` item in the View tab.
  Automatic: below a width threshold the ribbon collapses to tabs; below a lower threshold the
  menu bar merges into the tab strip.
- **Rules & edge cases.**
  - Collapse state persists per session and is host-overridable.
  - When collapsed-and-expanding, the ribbon **overlays** the document rather than pushing it down
    (no layout jump, no scroll position loss), and collapses again after a command or on `Esc` or on
    focus leaving it.
  - Group overflow within a tab: groups are dropped into a right-hand overflow dropdown in
    **reverse priority order** defined in the ribbon model (not by DOM order), so `Font` never
    disappears before `Clipboard`.
  - An expanded collapsed-ribbon must be focus-trapped only long enough to be keyboard-operable;
    `Esc` returns focus to the document. Focus must never be trapped in the ribbon - a keyboard user
    who tabs into a collapsed ribbon and cannot get out has lost the document.
  - Resizing while collapsed must not thrash the overflow computation: measure once per frame.
- **OOXML.** None.
- **Commands / events.** `ui.ribbon.setCollapsed({ collapsed })` → `ui.chrome.state.changed`.

## UI-06 · Keyboard access and Alt key tips
**Priority** core · **Effort** L

- **Behaviour.** Pressing `Alt` (or `F10`) overlays **key tips** (small letter badges) on every
  visible tab; pressing a tab's letter opens it and shows key tips on its groups and controls; a
  further letter sequence invokes the control. `Esc` backs out one level; a second `Esc` or any
  click dismisses. `Alt` alone does not open a menu until a second key is pressed (Word behaviour).
- **Rules & edge cases.**
  - Key tips are **assigned per control in the ribbon model**, and the allocator resolves collisions
    deterministically (first-come by model order), so a host-added control cannot break the default
    letters. Duplicate letters within the same scope are an error caught at model-build time, not
    at runtime.
  - Standard Word assignments are honoured where the command exists (`H` Home, `N` Insert, `F`
    File, `S` Layout, `A` Review, `W` View, `M` Mailings, `R` References, `G` Design, `J` Draw)
    because muscle memory is the whole point.
  - Key tips work when the document has focus and when chrome has focus; `Alt` while a dialog is
    modal applies to the dialog.
  - Key tips are disabled in `read` view mode (nothing to invoke) except the view-mode toggles.
  - Key tips render in a top-layer portal with `aria-hidden="true"` (they are visual hints; the
    control's own accessible name already exists).
  - Full keyboard map is published as data (`keymap`) and is host-overridable; a host can add
    bindings, and a binding conflict is reported, not silently resolved.
  - The key tip overlay must be legible in both light and dark host themes and at
    `density: touch` (larger badges).
- **OOXML.** None.
- **Commands / events.** `ui.keytips.show/hide`, plus the invoked command → `ui.chrome.state.changed`.

## UI-07 · Quick Access Toolbar
**Priority** important · **Effort** S

- **Behaviour.** A small toolbar of the most-used commands, above the ribbon (default) or below it,
  with `Save · Undo · Redo · Print Preview · Quick Print · Spelling · Touch/Mouse Mode · Open`.
  A customise dropdown lets the user add any command from a categorised list, remove items, reorder
  with up/down, reset to default, and choose "Show Below the Ribbon".
- **Rules & edge cases.**
  - Undo and Redo are **split buttons** with a dropdown list of the last N undo entries by name
    ("Undo Typing", "Undo Compress Pictures"), clicking an entry undoes back to that point. Word
    has this and its absence in a web editor is immediately noticed.
  - The QAT is the one chrome surface a host most often replaces; it is a slot (`quickAccess`) and
    its contents are a plain list of command ids in host configuration.
  - Command names come from the registry, so a QAT entry and its ribbon tooltip say the same thing.
  - `Touch/Mouse Mode` toggles `density` between `comfortable` and `touch` (a real Word QAT item).
  - Customisations persist per user; the library provides the state model and a serialisation
    format, and the host owns storage.
  - Disabled state mirrors the registry (Undo disabled with an empty stack).
- **OOXML.** None. (Word stores QAT customisation in the user profile, not the document - we do the
  same, via host storage.)
- **Commands / events.** `ui.qat.set({ items, position })` → `ui.chrome.state.changed`.

## UI-08 · Ruler framework: one ruler for a multi-page document
**Priority** core · **Effort** L

**This is the direct fix for the "rulers repeated on every page" complaint.**

- **Behaviour.** There is **exactly one horizontal ruler and at most one vertical ruler in the
  entire chrome**, mounted in the chrome grid (not inside any page). They are **sticky**: they stay
  at the top/left of the viewport while pages scroll under them. They **re-scope** to the page that
  owns the caret (or, with no caret, the page whose top edge is nearest the top of the viewport),
  and this is invisible to the user except that the markers move when the section changes.
- **Rules & edge cases.**
  - **A page never renders its own ruler.** Not in print layout, not in web layout. If a ruler
    appears inside `docier-page` in the DOM, that is a bug by definition.
  - The ruler reflects the **section** of the scoped page: `w:sectPr/w:pgMar` and `w:pgSz` of that
    page's section, so a document with a landscape section mid-file shows different margin markers
    while scrolled to that section - correctly, because it is showing that page's geometry.
  - Since pages can have different widths (mixed orientation), the ruler's zero point is the scoped
    page's left page edge, and the ruler's own width matches the scoped page's width so the mapping
    from ruler x to document x stays linear and obvious.
  - The ruler scrolls horizontally with the canvas when zoomed in beyond the viewport width, but
    vertically it is fixed. Both rulers share the scroll origin calculation; a mismatch of one axis
    puts markers a pixel or two off at high zoom, which users perceive as "wrong".
  - Zoom scaling: ruler tick spacing adapts (≥ 8 px between minor ticks), so the labels never
    overlap; at very low zoom the ruler shows only major ticks and section-level marks.
  - The ruler is hidden in `read` view mode and in `web layout`, and shown in `print layout` and
    `draft` (draft shows a single ruler spanning the text column, as Word does).
  - "Show ruler" is a View-tab toggle, a context-menu item on the ruler area, and a status-bar
    toggle; all three write the same state.
  - Ruler drags are pointer-capture based and survive the pointer leaving the window; a drag that
    leaves the window vertically must not cancel (users drag to the top of the screen).
  - The ruler is a chrome slot (`ruler`); a host may replace it, and the library's implementation
    uses only the public contract, so it is replaceable in practice.
  - Accessibility: the ruler is `role="toolbar"` with each marker a focusable element with an
    accessible name, value and keyboard inc/dec - a mouse-only ruler locks keyboard users out of
    indents and tab stops (OBJ-37's rule, applied to chrome).
- **OOXML.** Read: `w:sectPr/w:pgSz/@w,@h,@orient`, `w:sectPr/w:pgMar/@left,@right,@gutter`,
  `w:sectPr/@w:rsid` scoping. Written by the marker commands.
- **Commands / events.** `view.ruler.set({ horizontal, vertical, units })` →
  `ui.chrome.state.changed` · `ruler.scope.changed({ pageIndex, sectionIndex })`.

## UI-09 · Ruler: units and origin
**Priority** important · **Effort** S

- **Behaviour.** A small unit selector at the ruler's left end (or the ruler corner) switches
  between `cm · mm · inch · pt · pica · px`; also settable by right-clicking the ruler (a context
  menu with unit choices and `Show ruler`).
- **Rules & edge cases.**
  - OOXML has **no ruler-unit setting** - Word keeps it in the user profile. We therefore keep it in
    library settings (host-persisted), and the value is shown in the unit selector so it is never a
    mystery why a number appears in an unexpected unit.
  - Sub-unit precision: cm to 0.1 cm, inch to 1/16 in fractional or 0.1 in decimal (host option),
    pt to whole points, px to whole pixels.
  - The origin is the **page's left edge** (not the margin), and 0 is labelled at the page edge, with
    the margin marker offset from it - Word's convention, and the reason a user can read the left
    margin directly off the ruler.
  - Negative values are never shown; content in the gutter is shown by the gutter marker instead.
  - The unit change re-renders the ruler and all numeric fields that display ruler-unit values
    (indents, tab stops, wrap distances if the host opts in), through one shared formatting
    function. Two independent unit formatters will disagree.
- **OOXML.** None (settings only). Marker *values* are twips (`w:ind/@w`).
- **Commands / events.** `view.ruler.setUnits({ units })` → `ui.chrome.state.changed`.

## UI-10 · Ruler: margin markers
**Priority** core · **Effort** M

- **Behaviour.** The horizontal ruler shows the left margin, right margin and (for mirrored
  documents) inside/outside margins as draggable markers; the vertical ruler shows top and bottom
  margins plus the header/footer distances. Dragging a margin marker changes the section's margins.
- **States.** idle · dragging (live page re-layout, one undo entry on release) · `Alt`-dragging for
  fine control (0.01 in steps, snapping off).
- **Rules & edge cases.**
  - Dragging a margin marker changes `w:pgMar` for the **scoped section only**. If the document has
    multiple sections, a confirmation affordance appears offering "This section only" /
    "This section forward" / "Whole document" - the same choice the Page Setup dialog offers. Making
    this implicit is how a user silently reformats 40 pages.
  - Live re-layout during the drag runs at a **throttled rate** (once per animation frame) and
    performs incremental layout for affected paragraphs; a full document re-layout per pointer move
    makes the drag unusable past ~30 pages.
  - While dragging, the ruler shows the numeric value in a badge and a dashed line in the canvas at
    the resulting text boundary, so the user sees the effect before releasing.
  - The text area indicator (the white region between margin markers) is a distinct surface: dragging
    inside it does nothing, right-clicking it opens the ruler context menu, double-clicking it opens
    Page Setup (UI-21).
  - Margin markers cannot cross each other; the minimum text width is 1 in (or the host's
    `minTextWidth`), enforced during the drag with the marker stopping, not jumping.
  - Gutter: shown as an additional marker between the left page edge and the left margin when
    `w:pgMar/@gutter > 0`; dragging it changes the gutter only. Gutter position (left/top) changes
    which ruler shows it.
- **OOXML.** `w:sectPr/w:pgMar/@top,@right,@bottom,@left,@gutter,@header,@footer` in twips; mirror
  margins via `w:sectPr/w:pgMar/@left/@right` plus the mirrored-margin document setting. Page size is
  `w:sectPr/w:pgSz/@w,@h,@orient`.
- **Commands / events.** `section.margins.preview({ sectionIndex, margins })` (transient) →
  `section.margins.set({ ... , applyTo })` → `section.changed` + `layout.reflow`.

## UI-11 · Ruler: indent markers
**Priority** core · **Effort** M

- **Behaviour.** Four markers on the horizontal ruler at the left (and one at the right), matching
  Word exactly:
  - **First Line Indent** - the inverted triangle on top; drags `w:ind/@firstLine`.
  - **Hanging Indent** - the triangle below it; drags `w:ind/@hanging`.
  - **Left Indent** - the rectangle at the bottom; dragging it moves **both** the first-line and
    hanging markers with it.
  - **Right Indent** - the triangle at the right edge; drags `w:ind/@right`.
  - **Mirror Indents** support (for facing pages) moves the left markers to the right side of the
    ruler when the scoped page is an even/verso page, per `w:ind/@start`/`@end` (the bidi-safe
    forms) when the host enables it.
- **States.** Each marker has `idle`, `hover`, `dragging` states with distinct visual weight; the
  numeric value appears in a badge during the drag and on hover.
- **Rules & edge cases.**
  - `w:ind/@firstLine` and `w:ind/@hanging` are **mutually exclusive** in OOXML: setting one removes
    the other, and the ruler must never write both. The markers' visual relationship (one above the
    other, both relative to the left indent) is exactly what Word shows, and the conversion between
    them must be exact: dragging the first-line marker from +1 cm to −0.5 cm converts to
    `hanging = 0.5 cm` with `firstLine` removed, and vice versa, with no visual jump at the crossing
    point. **A jump at the zero crossing is the classic bug here** and is explicitly tested.
  - Markers apply to **all paragraphs in the selection**; with a mixed selection the marker sits at
    the first paragraph's value and shows a "mixed" indicator (Word shows the first paragraph's
    value with no indicator; we add the indicator because it prevents accidental flattening of a
    mixed selection, and it is a documented improvement).
  - With no selection, the marker edits the paragraph containing the caret.
  - Markers apply to the **current list level** when the caret is in a list - Word uses independent
    indents per list level; writing to `w:pPr/w:ind` instead of the numbering definition's level is
    a real and visible error. Where the indent comes from the numbering definition, the ruler shows
    the marker in a **locked style** and the drag opens "Adjust List Indents" instead of writing a
    direct indent. This distinction is subtle and must not be skipped.
  - Alt-drag for fine control, snapping to the ruler's minor ticks otherwise (UI-13).
  - Indents are clamped so the text area does not invert; a hanging indent greater than the left
    indent is allowed (it hangs into the margin) but the ruler shows it clearly.
  - Changing indents for a large selection applies **once per distinct `w:pPr`** and reuses
    paragraph-property objects; it is one undo entry regardless of paragraph count.
  - Keyboard: markers are focusable with arrow-key inc/dec (UI-08's accessibility rule), in units of
    one minor tick, `Shift` for one major tick.
- **OOXML.** `w:pPr/w:ind/@left,@right,@firstLine,@hanging` (twips), `@start,@end` for bidi, and the
  numbering-definition equivalent `w:numPr → w:abstractNum/w:lvl/w:pPr/w:ind`.
- **Commands / events.** `paragraph.indent.preview({ ranges, ind })` (transient) →
  `paragraph.indent.set({ ranges, ind })` → `paragraph.changed` + `layout.reflow`.

## UI-12 · Ruler: tab stops
**Priority** core · **Effort** L

- **Behaviour.** The tab selector button at the ruler's left end cycles the tab type to be placed:
  **Left ⌐** · **Centre ⊥** · **Right ⌐** · **Decimal** · **Bar |**. Clicking the ruler places a tab
  stop of the selected type; dragging an existing stop moves it; dragging a stop vertically off the
  ruler deletes it; double-clicking a stop (or double-clicking below the ruler) opens the **Tabs**
  dialog with a stop list, per-stop leader (none/dots/dashes/line/heavy/middle dot) and a `Clear
  All` button.
- **States.** placing · dragging · deleting (drag-off, with a distinct cursor/fade as the stop
  leaves the ruler) · hover with value badge.
- **Rules & edge cases.**
  - Tab stops live in `w:pPr/w:tabs` and apply to the paragraphs in the selection, per the
    UI-11 selection rules (and the list-level rule: tab stops from a numbering level are shown
    locked).
  - Placement position is snapped to the ruler's minor tick unless `Alt`; the stop's position is
    measured from the **left text margin** (word convention: `w:tab/@pos` is from the left margin,
    not the page edge) while the ruler's zero is the page edge - the difference between those two
    origins is a classic off-by-the-margin bug. Stated here explicitly because it must be.
  - Tab stops are **relative to `w:ind/@left`**, not to the margin, in Word's model; the ruler must
    draw them at their absolute position (indent + pos) and the conversion must be exact.
  - Ordering: `w:tabs` children must be in the schema's sequence and are kept sorted by `@pos` on
    write; duplicate positions are merged (last wins) rather than written twice (a schema
    violation Word tolerates but which some consumers reject).
  - Default tab stops: when no custom stop exists, the ruler shows faint marks every
    `w:settings/w:defaultTabStop/@val` twips (default 708 twips = 0.49 in); these are not
    draggable and setting a custom stop within 0.1 in of a default suppresses the default mark
    visually.
  - `Bar` tab stops have no `@leader` and do not consume a tab character position; the ruler draws
    them as a vertical bar and the Tabs dialog hides the leader dropdown for them.
  - Decimal tab alignment uses the document's locale decimal separator (from `w:lang`); with
    `de-DE`, alignment is on the comma. Getting this wrong silently misaligns every number column in
    a German HR contract, which is this product's core use case.
  - Leader characters are rendered in the canvas, not just the ruler, and must use the paragraph's
    font.
  - Deleting the last tab stop is fine; `w:tabs` with zero children is removed entirely (an empty
    `w:tabs` is schema-valid but noisy, and some validators object).
  - The tab selector's current type persists per session and is shown pressed.
- **OOXML.** `w:pPr/w:tabs/w:tab[@w:val="left|center|right|decimal|bar|clear|num"][@w:pos][@w:leader="none|dot|hyphen|underscore|heavy|middleDot"]`,
  sorted by `@pos`. Default from `w:settings/w:defaultTabStop/@val`. Numbering-level tabs in
  `w:abstractNum/w:lvl/w:pPr/w:tabs`.
- **Commands / events.** `paragraph.tabs.set({ ranges, tabs })` →
  `paragraph.changed` + `layout.reflow`.

## UI-13 · Ruler: drag behaviour, snapping and the canvas link
**Priority** important · **Effort** M

- **Behaviour.** All ruler drags share one interaction model: `pointerdown` on a marker captures the
  pointer, shows a dashed alignment line in the canvas, and a value badge on the ruler; motion maps
  screen x → document x through the canvas transform; `pointerup` commits one undo entry;
  `Esc` cancels and restores the pre-drag value.
- **Rules & edge cases.**
  - **The mapping uses the scoped page's left edge and the current zoom**, with sub-pixel accuracy
    (the drag is tracked in EMU, then rounded once at commit). Accumulating rounding during the drag
    is what makes a marker creep away from the cursor.
  - Snapping: to the major/minor ruler ticks, to the margins, to existing indents, to the page
    centre, and to the column boundaries - in that priority order, 6 px threshold, `Alt` to disable.
  - `Esc`-cancel must also revert the live layout preview, not only the marker position.
  - Dragging a margin marker over another section's text re-scopes the ruler only after commit; the
    drag must not re-scope mid-gesture (the geometry would change under the cursor).
  - The canvas shows the resulting boundary as a persistent thin dashed guide while any ruler drag
    is in progress, in the same visual language as object smart guides (OBJ-30). One guide visual,
    defined once.
  - Touch: markers get a 20 px hit area at `density: touch` and the ruler grows to 28 px.
  - Every ruler gesture has a keyboard equivalent and a dialog equivalent (Tabs dialog, Paragraph
    dialog): the ruler is an accelerator, never the only path.
- **OOXML.** None (behaviour); results written by UI-10 / UI-11 / UI-12.
- **Commands / events.** Transient `ruler.*.preview` commands → one commit command → the owning
  feature's events.

## UI-14 · Ruler: vertical ruler
**Priority** important · **Effort** M

- **Behaviour.** A vertical ruler down the left of the canvas, with the same origin convention
  (zero at the top page edge), showing top/bottom margin markers, header and footer distance markers
  (`w:pgMar/@header,@footer`), and, in Word's newer behaviour, appearing **only while the pointer is
  in the left margin area** (option `verticalRuler: 'always' | 'onMarginHover' | 'never'`, default
  `onMarginHover` to match current Word, with `always` for users who prefer Word 2010 behaviour).
- **Rules & edge cases.**
  - The vertical ruler **restarts at each page** because it measures one page's height - but it is
    still a single sticky chrome element that re-scopes (UI-08). The distinction matters: one
    element, page-scoped values.
  - It stays in sync with the horizontal ruler's scoped page; both come from one
    `ruler.scope.changed` event, never from two independent calculations.
  - Vertical margin markers change `w:pgMar/@top,@bottom` (and header/footer distances); dragging
    them runs the same section-scope confirmation as UI-10.
  - Hidden in `web layout` (no page height) and in `read` mode.
  - The header/footer markers are only shown when the caret is in the header/footer area or the
    "show header/footer" affordance is on; otherwise they are hidden for a clean ruler.
- **OOXML.** `w:sectPr/w:pgMar/@top,@bottom,@header,@footer`, `w:pgSz/@h`.
- **Commands / events.** `section.margins.set(...)` → `section.changed`.

## UI-15 · Status bar
**Priority** core · **Effort** M

- **Behaviour.** A bottom bar, left to right: **page `n` of `m`** · **word count** (click for the
  Word Count dialog: pages, words, characters with/without spaces, paragraphs, lines, and an
  "Include textboxes, footnotes and endnotes" checkbox) · **language** · **save state** ·
  **view toggles** (print layout / web layout / draft / read) · **zoom slider with −/+ and a percent
  label** (UI-16). Each item is a clickable control with a tooltip, not a static label.
- **Rules & edge cases.**
  - Page number reflects the **layout engine's** pagination with the caret's page; `m` is the
    **document's** total pages (Word's status bar shows `n of m` where m is the total, not a
    filtered view). Clicking it opens Go To (Page) - same dialog as Find's `Go To` tab.
  - Word count is computed from the document model (spec 02's counting rules: CJK counted by
    character, hyphenated words as one, text boxes and footnotes included only when the checkbox is
    on). It is **live**, not the cached value from `docProps/app.xml` - but on save we write the
    live statistics back into `docProps/app.xml` so Word shows the same numbers.
  - **Language** shows the proofing language at the caret, resolved through the full cascade
    (direct `w:rPr/w:lang` → character style → paragraph style → `w:docDefaults`), with the format
    `English (United Kingdom)`. Clicking it opens the Language dialog (Set Proofing Language,
    "Do not check spelling or grammar", "Detect language automatically"), which writes
    `w:lang/@val,@eastAsia,@bidi` and `w:settings/w:proofState`. Any non-default language is shown
    in a distinct style because an unnoticed wrong proofing language is a real correctness problem
    for multi-language HR contracts.
  - **Save state** is `Saved` · `Unsaved changes` · `Saving…` · `Save failed (retry)` · `Autosaved
    12:04`. It is library state driven by the command pipeline's dirty flag, and it emits
    `status.changed`. A failed autosave is surfaced here and as an event, never swallowed.
  - **View toggles** mirror the View tab's view modes and are pressed-state buttons.
  - Every status item is individually hideable by the host and by the user (the right-click context
    menu on the status bar lists all items with checkmarks - this is a **required context menu**,
    not a nice-to-have, because the owner's complaint was that right-click did nothing anywhere).
  - Items that are not applicable (words count in `read` mode is still shown; page count in a
    single-page draft view is shown as `1 of 1`) are never blank.
  - Live-updating counters must not re-render the whole bar per keystroke: word count recomputes on
    a 200 ms debounce and on layout completion.
- **OOXML.** Read/write `docProps/app.xml` (`<Pages>`, `<Words>`, `<Characters>`,
  `<CharactersWithSpaces>`, `<Paragraphs>`, `<Lines>`) and `docProps/core.xml`
  (`<dcterms:modified>`, `<cp:lastModifiedBy>`). Language: `w:rPr/w:lang/@val,@eastAsia,@bidi`,
  `w:settings/w:proofState/@w:spelling,@w:grammar`, `w:settings/w:themeFontLang`.
- **Commands / events.** `view.statusBar.set({ items })`, `document.stats.recount()`,
  `language.set({ ranges, lang })`, `document.save()` → `status.changed`, `document.stats.changed`.

## UI-16 · Zoom controls and fit modes
**Priority** core · **Effort** M

- **Behaviour.** Zoom slider (10 %-500 %, logarithmic feel with 100 % at the centre detent),
  `−`/`+` buttons, a percent label that opens the **Zoom** dialog (`Zoom to: 200/100/75/50 %` or a
  custom percent, `Many pages: 1×1 … 2×2`, `Page width`, `Text width`, `Whole page`, `Percent`), and
  `Ctrl+scroll` zooming about the pointer. Fit commands in the View tab: `Page Width`, `One Page`,
  `Two Pages`, `Page Width`, `100 %`.
- **Rules & edge cases.**
  - `Ctrl+scroll` zooms about the **pointer position** (the document point under the cursor stays
    under the cursor); the status bar's `±` buttons zoom about the viewport centre. Different
    anchors, both intentional.
  - `Ctrl+=` / `Ctrl+-` step through the zoom ladder (10/25/50/75/100/125/150/200/300/400/500).
  - The zoom is clamped to the min/max and the slider saturates visibly rather than silently.
  - Zoom persists in `w:settings/w:zoom` on save, including the fit mode
    (`w:zoom/@w:val="bestFit|fullPage|textFit|none"`), so re-opening in Word restores the view.
  - "Many pages" zoom tiles N×M pages with `w:zoom/@w:val="fullPage"` semantics.
  - Zoom is a **view-only** command: it never enters the undo stack and never marks the document
    dirty. A zoom that marks a document dirty is a bug users report as "it keeps asking me to save".
  - At extreme zoom-out the page thumbnails render simplified (no text, just block shapes) to keep
    the frame budget; at high zoom the renderer draws only the visible tile.
  - Touch: pinch zoom about the pinch centre, two-finger pan, and a two-finger-drag-to-scroll mode
    that does not fight the pinch recogniser.
- **OOXML.** `w:settings/w:zoom/@w:percent,@w:val`.
- **Commands / events.** `view.zoom.set({ percent, mode, anchor })` → `zoom.changed`.

## UI-17 · Zoom versus layout: the invariant
**Priority** core · **Effort** L

- **Behaviour.** **Pagination and line breaking are computed at 100 % and are invariant under
  zoom.** Changing zoom never changes which page a paragraph is on, never changes a line break,
  never changes wrap distances or object positions. This is Word's single most important layout
  behaviour and the most common way a web editor betrays itself.
- **Rules & edge cases.**
  - Implementation: layout runs in **document units (EMU/twips)** at all times; zoom is applied as a
    transform from document units to screen pixels at the render and hit-test boundaries. There is
    no "layout at zoom" code path. A layout pass must be forbidden from reading the zoom value
    (enforced by the layouter's input type not containing zoom).
  - Text is rasterised at the effective device scale (crisp text at 400 %) via one transform on the
    page container plus `devicePixelRatio`-aware rendering for canvases. Blurry text at high zoom is
    a "web toy" signal we must not emit.
  - Hit testing converts screen → document with the exact inverse transform, in double precision,
    then rounds to integer EMU **once**. Repeated conversions must be idempotent within 1 EMU.
  - Guideline positions, handle geometry, hit-target sizes and stroke widths are in **screen space**
    (OBJ-06's constant-handle rule) while object geometry stays in document space. Mixing the two is
    the bug this feature exists to prevent; the rule is stated once here and referenced by the
    object features.
  - Font hinting differences at fractional zoom must not cause a line to wrap differently: line
    breaking measures with the document's font metrics at 100 % and scales, never by measuring the
    rendered DOM at the current zoom. DOM-measured line breaking is banned outright.
  - Zooming while a drag is in progress is refused (or cancels the drag with a notice) - the
    gesture's coordinate space would change mid-gesture.
  - A single "zoom" numeric field in settings, one transform, one inverse: there must be no second
    place in the codebase that knows the zoom level except the renderer and the input mapper.
  - Regression test: for a fixed document, pagination after a 100 % → 250 % → 50 % → 100 % zoom
    cycle is byte-identical, and every object's resolved position is unchanged.
- **OOXML.** None (pure behaviour). The persisted value is `w:settings/w:zoom`.
- **Commands / events.** `zoom.changed` triggers a **re-render, never a re-layout**.

## UI-18 · Dialog framework
**Priority** core · **Effort** L

- **Behaviour.** One base implementation for every dialog in this spec, in a top-layer portal:
  title bar (draggable, with a close button), tabbed or single-page body, a footer with
  `OK` · `Cancel` · optional `Apply` · optional `Set as Default…`, and a scrollable body when the
  content exceeds the viewport.
- **Rules & edge cases.**
  - **Modal semantics:** focus moves into the dialog on open and is trapped; `Esc` cancels;
    `Enter` activates the default button; `Tab` never leaves; on close, focus returns to the control
    that opened it. `role="dialog"` `aria-modal="true"` with a labelled title.
  - **Unit fields accept unit suffixes** (`0.5cm`, `12pt`, `1"`, `18px`) and display the document's
    configured unit by default; invalid input is flagged inline and blocks OK - never silently
    coerced (the same rule as OBJ-31).
  - Dialogs that change the document **open with a live preview** where Word has one (Font and
    Paragraph dialogs both have preview panes) and every such dialog supports "preview → OK/Cancel"
    with exactly one undo entry. Preview uses transient commands and is reverted on cancel,
    including partially typed values.
  - `Apply` exists only where Word has it and commits a discrete undo entry, letting the user apply
    several times before closing.
  - `Set as Default` writes to `w:styles/w:docDefaults/w:rPrDefault|w:pPrDefault` - a document-wide
    change that the dialog must label clearly ("Default for this document only").
  - Dialogs are host-replaceable: `dialogs` slot, with a per-dialog id (`paragraph`, `font`,
    `pageSetup`, `insertField`, `findReplace`, `tableProperties`, `tabs`, `zoom`, `wordCount`,
    `compressPictures`, `language`, `altText`, `sizePosition`, `bulletsNumbering`, `bordersShading`,
    `watermark`, `lineNumbers`, `properties`). A host replacing one dialog leaves the others intact.
  - Keyboard-only operation is a requirement for every dialog: no drag-only or pointer-only control
    inside a dialog (drag handles in the Borders dialog get numeric alternatives).
  - The dialog must be usable at 400 px viewport width: fields stack, the body scrolls, the footer
    stays fixed.
  - Dialog size is remembered per dialog id per session.
  - Theme: dialogs use the same `--docier-*` tokens and density setting as the chrome.
- **OOXML.** None directly.
- **Commands / events.** `ui.dialog.open({ id, args })`, `ui.dialog.close({ id, result })` →
  `ui.chrome.state.changed`; the dialog's OK dispatches the feature's command.

## UI-19 · Paragraph dialog
**Priority** core · **Effort** L

- **Behaviour.** A tabbed dialog exactly as Word: **Indents and Spacing** and **Line and Page
  Breaks**, with a Preview pane.
- **Indents and Spacing tab.** General (Alignment left/centred/right/justified; Outline level
  body text / level 1-9) · Indentation (Left, Right; Special: `(none)` / First line / Hanging with
  a `By` value; Mirror indents checkbox) · Spacing (Before, After; "Don't add space between
  paragraphs of the same style"; Line spacing: Single / 1.5 lines / Double / At least / Exactly /
  Multiple with an `At` value) · Preview.
- **Line and Page Breaks tab.** Pagination (Widow/Orphan control, Keep with next, Keep lines
  together, Page break before, Suppress line numbers) · Formatting exceptions (Don't hyphenate,
  Text alignment left/centred/right, "Don't snap to grid") · the `Tabs…` button opening the Tabs
  dialog.
- **Rules & edge cases.**
  - Every field maps 1:1 to a `w:pPr` child (see OOXML below) and unchecking a checkbox **removes**
    the element rather than writing `w:val="0"` - the difference is visible in Word's UI, which
    shows tri-state for inherited properties. A property inherited from a style shows as **blank**,
    not as the inherited value, with an indicator that it is inherited; typing a value writes a
    direct override. This distinction is what makes the dialog feel like Word rather than like a
    form.
  - Mixed selections show blank; editing sets the value for all.
  - "Special: First line / Hanging" is a single dropdown whose value converts between
    `w:firstLine` and `w:hanging` (UI-11's exact conversion rule).
  - Line spacing `Multiple` permits decimals (e.g. 0.9) and writes `w:line` as 240ths of a line with
    `w:lineRule="auto"`; `Exactly` writes `w:lineRule="exact"` and clips tall content (OBJ-05's rule).
    The dialog warns when switching to `Exactly`.
  - Outline level writes `w:outlineLvl` and interacts with the navigation pane (UI-30); setting a
    level on a body paragraph makes it appear in the outline - the dialog says so.
  - The dialog is one undo entry (or one per `Apply`); live preview is on by default with a
    checkbox.
- **OOXML.** `w:pPr` children: `w:jc/@val` · `w:outlineLvl/@val` · `w:ind/@left,@right,@firstLine,
  @hanging,@start,@end,@mirror` · `w:spacing/@before,@after,@beforeLines,@afterLines,@line,@lineRule`
  · `w:contextualSpacing` · `w:widowControl` · `w:keepNext` · `w:keepLines` · `w:pageBreakBefore` ·
  `w:suppressLineNumbers` · `w:suppressAutoHyphens` · `w:textAlignment/@val` · `w:snapToGrid`.
  Defaults from `w:styles/w:docDefaults/w:pPrDefault` and the paragraph style chain.
- **Commands / events.** `paragraph.format.set({ ranges, props })` → `paragraph.changed` +
  `layout.reflow`.

## UI-20 · Font dialog
**Priority** core · **Effort** L

- **Behaviour.** Tabs: **Font**, **Advanced** (Character Spacing), and `Text Effects…` (hidden
  until text effects ship), with a Preview pane.
- **Font tab.** Font (western / "Complex scripts" / "Asian" family lists, with theme fonts at the
  top as they appear in the font combo) · Font style (Regular/Italic/Bold/Bold Italic derived from
  the actual family's available faces - a family without a true italic must not offer one
  misleadingly) · Size (with the same ladder of sizes as Word, including the halved sizes) · Font
  colour (theme + standard + custom) · Underline style and underline colour · Effects
  (Strikethrough, Double strikethrough, Superscript, Subscript, Small caps, All caps, Hidden) ·
  Preview of a live sample using the selected run's text · `Set As Default`.
- **Advanced tab.** Character Spacing (Scale %, Spacing: Normal/Expanded/Condensed with a `By`
  value, Position: Normal/Raised/Lowered with a `By` value) · Kerning ("Kerning for fonts" ≥ N pt)
  · OpenType features (Ligatures, Number spacing, Number forms, and Stylistic sets) - the OpenType
  section may be `later` but the model must round-trip `w14:ligatures`, `w14:numSpacing`,
  `w14:numForm`, `w14:stylisticSet`.
- **Rules & edge cases.**
  - Hidden text (`w:vanish`) is **preserved and round-tripped even though it is invisible** in the
    normal view; the View tab's "Show hidden text" reveals it with a dotted underline. Silently
    dropping hidden text on save is data loss and must be impossible.
  - Small caps (`w:smallCaps`) vs All caps (`w:caps`) are separate properties with separate
    rendering (small caps synthesise reduced capitals); never map one to the other.
  - Superscript/subscript write `w:vertAlign` and **must not** be implemented as a raised font size.
  - Font size is stored in **half-points** (`w:sz/@val="24"` = 12 pt); the dialog shows points. A
    factor-of-two error here is the single most visible possible bug, so the conversion lives in
    one function with a test.
  - Size accepts free-typed values between 1 and 1638 pt (schema bounds) and reports out-of-range
    input rather than clamping.
  - Underline has ~17 distinct styles in `w:u/@val`; the dialog shows them all and the renderer must
    support each (a web editor that only supports single/double underline is immediately obvious to
    an HR user who uses dotted underline for signature lines - a core template pattern for this
    product).
  - `Set As Default` writes `w:docDefaults/w:rPrDefault/w:rPr` and confirms explicitly.
  - The Font dialog's changes apply to the **runs in the selection**; with a caret and no selection
    they set the "pending" formatting for subsequent typing, which must behave identically to the
    ribbon's font controls (one command, two surfaces).
- **OOXML.** `w:rPr` children: `w:rFonts/@w:ascii,@w:hAnsi,@w:cs,@w:eastAsia,@w:asciiTheme…` ·
  `w:b`, `w:bCs` · `w:i`, `w:iCs` · `w:sz`, `w:szCs` (half-points) · `w:color/@w:val,@w:themeColor` ·
  `w:u/@w:val,@w:color` · `w:strike`, `w:dstrike` · `w:vertAlign/@w:val` · `w:smallCaps` · `w:caps` ·
  `w:vanish` · `w:spacing/@w:val` (twips, character spacing) · `w:w/@w:val` (percent scale) ·
  `w:position/@w:val` (half-points, raise/lower) · `w:kern/@w:val` · `w:highlight/@w:val` ·
  `w:shd/@w:fill` · `w14:*` OpenType.
- **Commands / events.** `text.format.set({ ranges, props })` → `text.changed` + `layout.reflow`.

## UI-21 · Page Setup dialog
**Priority** core · **Effort** L

- **Behaviour.** Tabs: **Margins**, **Paper**, **Layout**, and (in Word) `Print Options`.
  - **Margins** - Top, Bottom, Left, Right, Gutter, Gutter position (Left/Top), Orientation
    (Portrait/Landscape), Pages: Multiple pages (`Normal`, `Mirror margins`, `2 pages per sheet`,
    `Book fold`), Preview, `Set As Default`, `Apply to:` (`This section`, `This point forward`,
    `Whole document`).
  - **Paper** - Paper size (a full list including the ISO A/B series, US sizes, and `Custom size`
    with width/height fields), Paper source, Preview, `Apply to`.
  - **Layout** - Section start (New page/Continuous/Even page/Odd page/New column), Suppress
    endnotes, Vertical alignment (Top/Center/Justified/Bottom), Headers and footers (Different odd
    and even, Different first page, From edge: Header/Footer), Preview, `Apply to`.
- **Rules & edge cases.**
  - `Apply to` is the crux: `This section` edits that `w:sectPr`; `This point forward` **inserts a
    new `w:sectPr`** at the caret and edits it (a real structural edit); `Whole document` edits
    every section's `w:sectPr`. The dialog must show how many sections are affected ("This will
    change 4 sections") before applying, because this is a destructive-looking operation and users
    are right to be nervous.
  - Orientation swaps `w:pgSz/@w,@h` and sets `@orient="landscape"`; it does **not** rotate the
    content, and the dialog says so. Users expect a rotation; Word does not do it.
  - Changing paper size does not rescale content; margins are re-validated against the new page size
    and a warning is shown if the text area becomes impossibly narrow.
  - `Mirror margins` interacts with the ruler's inside/outside markers (UI-10) and with
    `w:ind/@start,@end` (UI-11) - all four surfaces must agree.
  - `Set As Default` writes the section properties into the **template's** defaults
    (`w:docDefaults` cannot hold `sectPr`; Word writes it to the attached template's first
    section). We write it to the document's default section stored in library settings and state
    plainly that it applies to new documents in this session - a documented divergence, not a
    silent one.
  - Section start values map to `w:sectPr/w:type/@val` (`nextPage`, `continuous`, `evenPage`,
    `oddPage`, `nextColumn`); `Continuous` on the first section is meaningless and is disabled.
  - Different first page / different odd and even write `w:titlePg` and
    `w:settings/w:evenAndOddHeaders` and **create the corresponding header/footer parts**
    (`w:headerReference/@w:type="first|even|default"`) with empty content, because Word requires the
    parts to exist for the setting to be usable. Creating empty parts is a structural edit and must
    be undoable with everything else.
  - Gutter creates an extra margin; the Preview shows it and the ruler shows the gutter marker
    (UI-10).
  - Live preview is on: the whole document re-lays-out on field change (throttled).
  - The dialog is reachable from three places (ribbon launcher in Layout > Page Setup, double-click
    on the ruler's text area, `File > Print > Page Setup`) - all open the same dialog.
- **OOXML.** `w:sectPr/w:pgSz/@w,@h,@orient,@code` · `w:sectPr/w:pgMar/@top,@right,@bottom,@left,
  @gutter,@header,@footer` · `w:sectPr/w:type/@val` · `w:sectPr/w:titlePg` ·
  `w:sectPr/w:vAlign/@val` · `w:sectPr/w:headerReference/@w:type,@r:id` ·
  `w:sectPr/w:footerReference/@w:type,@r:id` · `w:sectPr/w:pgNumType` ·
  `w:settings/w:evenAndOddHeaders` · `w:settings/w:mirrorMargins` · `w:settings/w:printTwoOnOne`.
- **Commands / events.** `section.setup.set({ sectionIndexes, applyTo, props })` →
  `section.changed` + `layout.reflow` (full, since page geometry changed).

## UI-22 · Insert Field dialog
**Priority** core · **Effort** M

- **Behaviour.** Category and Field name lists, a description line, and a properties grid that
  changes per field, plus `Field codes` and `Options…` buttons. Categories: Date and Time, Document
  Automation, Document Information, Equations and Formulas, Index and Tables, Links and References,
  Mail Merge, Numbering, User Information.
- **Fields required by this product** (explicitly, because HR templates use them): `PAGE`,
  `NUMPAGES`, `DATE \@ "dd MMMM yyyy"`, `TIME`, `CREATEDATE`, `SAVEDATE`, `PRINTDATE`, `FILENAME`,
  `MERGE FIELD` / `MERGEFIELD`, `REF` (bookmark), `DOCPROPERTY`, `AUTHOR`, `TITLE`, `SUBJECT`,
  `IF`, `NEXT`, `SET`/`ASK` (later), `FORMTEXT`/`FORMCHECKBOX` (later, legacy forms), `TOC` (via
  References, not this dialog), `INCLUDEPICTURE` (later, security-sensitive).
- **States.** The dialog edits either a **new** field (inserted with a result placeholder computed
  by the field evaluator where possible) or an **existing** field (its instruction is parsed into
  the property grid; unknown or hand-written instructions show the raw `Field codes` view instead
  of an empty grid).
- **Rules & edge cases.**
  - Fields are written in the **complex form** (`w:fldChar begin` / `w:instrText` / `w:fldChar
    separate` / result runs / `w:fldChar end`) whenever the field has or may have a result, because
    a `w:fldSimple` has a fixed single-paragraph result and cannot hold multi-paragraph or
    multi-run formatted results. `w:fldSimple` is read and preserved but written only for simple
    cases to match Word's output for those cases. **Fields are never flattened to text on save.**
  - A new field's result is computed by the field evaluator (spec 03's layout context supplies page
    numbers; `MERGE FIELD`s come from the host's data) and inserted between `separate` and `end`.
    If no result can be computed, the field is inserted with the placeholder `1` or an empty result
    and marked dirty so the next update fills it.
  - `w:settings/w:updateFields/@w:val="true"` is set when the document gains a field that could not
    be evaluated, so Word updates it on open. Without this, an HR manager opens the document in Word
    and sees stale values.
  - Nested fields (a field inside another field's instruction, e.g. `IF { MERGEFIELD x } = "y"`) are
    supported in the model and the dialog refuses to edit a nested instruction with a plain grid
    (it falls back to field-code editing). Nesting depth is not limited by us but is limited by the
    editor to a sane depth with a notice.
  - Field shading: a view option (`Never` / `Always` / `When selected` - Word's default is "When
    selected") renders fields with a grey background; the shading is chrome and never printed. The
    option is in `View` and in the field's context menu (UI-28).
  - Field results carry formatting; updating a field preserves the formatting of the result runs
    where the field type permits, and the dialog has "Preserve formatting during updates".
  - Toggling `Alt+F9` shows all field codes as text in the document; this is a view state, not a
    document edit, and the caret/selection must survive the toggle.
  - A field's instruction text is **not** searched by find/replace by default (UI-23).
- **OOXML.** `w:fldChar[@w:fldCharType="begin|separate|end"][@w:fldLock][@w:dirty]` ·
  `w:instrText[@xml:space="preserve"]` · `w:fldSimple[@w:instr]` (with `w:fldData` for legacy form
  fields) · `w:settings/w:updateFields` · `w:settings/w:fldMapType` (rare).
- **Commands / events.** `field.insert({ category, name, properties, at })`,
  `field.update({ ids })`, `field.toggleCodes()` → `field.changed`, `layout.reflow`.

## UI-23 · Find and Replace dialog
**Priority** core · **Effort** L

- **Behaviour.** A non-modal, dockable panel/dialog with three tabs: **Find**, **Replace**, **Go To**.
  `Find` has `Find what`, `Reading Highlight`, `Find In` (`Main Document`, `Headers/Footers`,
  `Text Boxes`, `Comments`, `Footnotes/Endnotes`), `Find Next`, `Find All`, `More >>`. `Replace`
  adds `Replace with`, `Replace`, `Replace All`, `Find Next`. `More` reveals: Match case,
  Find whole words only, Use wildcards, Sounds like (English), Find all word forms (English),
  Match prefix, Match suffix, Ignore punctuation characters, Ignore white-space characters,
  Format ▾, Special ▾, `No Formatting`.
- **States.** The find bar appears as a floating bar (`Ctrl+F`) with incremental highlighting and a
  match counter (`3 of 17`), and expands to the full dialog (`Ctrl+H` / `Ctrl+G`). `Esc` closes and
  restores the selection.
- **Rules & edge cases.**
  - **Matches may span runs.** A phrase like "HR Manager" is frequently three `w:r` elements with
    different formatting. The implementation searches a **flattened logical text index** with a
    mapping back to (part, paragraph, run, offset) and highlights by splitting runs at match
    boundaries **only when the document is actually modified**. Highlighting must never mutate the
    document - a read-only find that mutates runs will dirty the document and break undo.
  - Replace splits runs at boundaries and applies the replacement using the formatting of the first
    matched run unless a `Replace with` format is specified; the surrounding runs' formatting is
    untouched. Getting this wrong restyles half the paragraph on every replace.
  - `Replace All` is **one undo entry** and reports `N replacements made`. It also must not
    re-search replaced text (infinite-loop protection: advance past the replacement, and the
    counter has a hard cap with a clear message).
  - Use wildcards enables a defined subset (Word's regex dialect: `?`, `*`, `[]`, `{n,m}`, `@`,
    `\<`, `\>`, `( )`, `\n`, `\t`). We document our supported subset explicitly and mark
    unsupported constructs as an error in the dialog rather than silently treating them as literals.
    Word's dialect is **not** JavaScript regex; translating is done by an explicit translator with
    tests, not by passing the pattern to `new RegExp`.
  - Format-based find/replace (`Format ▾`: font, paragraph, style, language, highlight) works on the
    run's **resolved** properties (through the style cascade), not only on direct formatting, or a
    user searching for "italic" finds nothing in italic-styled text.
  - Default search scope is the main document body; text boxes are included by default (Word's
    behaviour in recent versions) but headers/footers are not, and the dialog makes the scope
    visible. A user who cannot find text that is in a header must be able to discover why.
  - `Find In > Main Document` with a multi-selection searches only the selection.
  - `Go To` supports Page, Section, Line, Bookmark, Comment, Footnote, Endnote, Field, Table,
    Graphic, Equation, Heading, and `+`/`−` relative navigation. Go To a Page scrolls and places the
    caret at the page start without changing the layout.
  - CJK and combining characters: match positions use grapheme-cluster boundaries so a highlight
    never splits a grapheme; searching never breaks a surrogate pair.
  - Search over a **large document is incremental** (chunked over animation frames, cancellable with
    a progress indicator past 5 000 paragraphs) and must not freeze the editor.
  - Search results feed the **Navigation pane's Results tab** (UI-30) so `Find All` shows a
    result list with context snippets.
- **OOXML.** Read-only over `w:t`, `w:delText`, `w:instrText` (excluded by default), `w:tab`,
  `w:br`, `w:noBreakHyphen`, `w:sym`; scoped per part (`document.xml`, `headerN.xml`, `footerN.xml`,
  `footnotes.xml`, `comments.xml`, `w:txbxContent` inside `document.xml`). Replacement writes
  `w:r`/`w:t` splits; `xml:space="preserve"` is set on any `w:t` whose text has leading or trailing
  whitespace - omitting it silently trims the user's spaces, a classic OOXML bug.
- **Commands / events.** `find.start({ query, options })`, `find.next()`, `find.replaceAll({ ... })`,
  `find.goto({ what, which })` → `find.state.changed`, `find.results.changed`, and document edit
  events for replacements.

## UI-24 · Table properties dialog
**Priority** important · **Effort** L

- **Behaviour.** Tabs: **Table**, **Row**, **Column**, **Cell**, **Alt Text**.
  - **Table** - Size (Preferred width with a units dropdown: Auto/Percent/`cm`/`in`; Measure in
    percent/cm), Alignment (Left/Center/Right), Text wrapping (None/Around), Indent from left,
    Borders and Shading… (a sub-dialog: Borders tab with preset/settings/style/colour/width, Page
    Border tab, Shading tab with fill and patterns), Options… (Default cell margins top/bottom/
    left/right, Default cell spacing, Allow spacing between cells, Automatically resize to fit
    contents, Set as default for all tables in this document), `Alt Text`.
  - **Row** - Size (Row height, `At least`/`Exactly`, "Allow row to break across pages"),
    Options (Repeat as header row at the top of each page).
  - **Column** - Column width in the document's unit.
  - **Cell** - Size (Preferred width), Vertical alignment (Top/Center/Bottom), Options (Cell margins
    with "Same as the whole table", Wrap text, Fit text), `Borders and Shading…`.
- **Rules & edge cases.**
  - **Table width, column widths and cell widths interact**, and OOXML's contract is: `w:tblW` is a
    preferred width, `w:tblLayout/@type="fixed"` makes `w:tblGrid/w:gridCol/@w:w` authoritative, and
    `autofit` lets content drive it. The dialog must write `w:tblLayout` explicitly whenever the user
    asks for an exact width, or Word will happily resize the table on open and the carefully set
    widths will be gone. This is one of the most common "the library lost my formatting" reports and
    the spec must prevent it.
  - Setting column widths updates `w:gridCol` **and** every `w:tcPr/w:tcW` in that column, keeping
    `w:tblW` = the sum, or the table renders differently in Word.
  - "%" widths write `w:w/@w:type="pct"` where the value is **fiftieths of a percent**
    (`2500` = 50 %) - not hundredths, not a fraction. Verified in a test; this is a notorious
    conversion.
  - `Repeat as header row` writes `w:trPr/w:tblHeader` and takes effect on the layout engine's
    continuation pages. The dialog warns that the row must be the table's first row (or a
    contiguous set from the top) for Word to honour it.
  - Row height `Exactly` clips tall cell content; the dialog warns, and the layout engine must clip
    rather than expand (matching Word).
  - "Allow row to break across pages" off writes `w:trPr/w:cantSplit`; a row taller than a page then
    overflows a page rather than splitting, which is what Word does and what users want for
    signature blocks.
  - Cell margins (`w:tcMar`) are set per cell; "Same as the whole table" clears them so the table
    default applies - the dialog shows the resolved value in grey so the user is not editing blind.
  - Borders: per-edge style/colour/width in `w:tcBorders`/`w:tblBorders`, with the "inside/outside"
    distinction and the `w:tcBorders` per-cell overrides. A border set on the table but overridden on
    a cell must be shown as overridden, not as the table value.
  - Table Alt Text writes `<w:tblPr><w:tblCaption>` and `<w:tblDescription>` (the table equivalents
    of alt text); a table with a caption is flagged in the accessibility check.
  - Merged cells (`w:gridSpan`, `w:vMerge`) make a column's cells non-uniform; the Column tab shows a
    mixed state and the width change applies to the grid column, which is the only coherent
    interpretation.
  - The dialog is one undo entry per OK/Apply, covering grid, cells, rows and the table properties
    as one atomic structural change.
- **OOXML.** `w:tblPr` (`w:tblW/@w:w,@w:type`, `w:jc`, `w:tblLayout/@w:type`, `w:tblInd/@w:w`,
  `w:tblBorders`, `w:tblCellMar`, `w:tblCellSpacing`, `w:tblCaption`, `w:tblDescription`,
  `w:tblStyle`, `w:tblLook`) · `w:tblGrid/w:gridCol/@w:w` · `w:trPr` (`w:trHeight/@w:val,@w:hRule`,
  `w:tblHeader`, `w:cantSplit`) · `w:tcPr` (`w:tcW`, `w:gridSpan`, `w:vMerge/@w:val`,
  `w:tcBorders`, `w:shd`, `w:vAlign`, `w:tcMar`, `w:textDirection`, `w:noWrap`, `w:tcFitText`) ·
  `w:tblPrEx` (row-level overrides).
- **Commands / events.** `table.properties.set({ cellRange, props })` →
  `table.changed` + `layout.reflow`.

## UI-25 · Selection mini-toolbar
**Priority** important · **Effort** M

- **Behaviour.** Selecting text with the pointer shows the Word mini-toolbar floating above the
  selection, containing: font family, font size, grow font / shrink font, bold, italic, underline,
  strikethrough (optional), highlight colour, font colour, format painter, and (in the second
  layout) alignment, bullets and indents - with a `…` opening the full Font/Paragraph dialogs.
- **States.** appears after pointer selection ends (never during the drag); fades out after
  `idleTimeout` (default 4 s) of no hover and no change; suppressed entirely by
  `miniToolbar: 'off'` or by the View-tab toggle; never appears for a caret-only selection unless the
  host opts in.
- **Rules & edge cases.**
  - **It must not steal the selection.** The toolbar is `contenteditable="false"`, all its elements
    handle `pointerdown` with `preventDefault()` so the document selection is never collapsed, and it
    is rendered in a portal outside the editable root. Focus is not moved into it on hover; keyboard
    users reach it with `Ctrl+F1`-style binding or via the ribbon. Losing the selection when the mini
    toolbar appears is the single most damaging bug this feature can have.
  - Positioning: horizontally centred on the selection's first line, 8 px above the selection top;
    flips below when it would leave the viewport above; clamped horizontally; follows the selection
    on scroll (repositioned on the layout/scroll event, not per animation frame).
  - Over a selection spanning multiple lines, it anchors to the **first line** (Word) rather than the
    bounding box centre, so it stays near where the user's pointer was.
  - It reflects the selection's formatting state with the same toggle/mixed semantics as the ribbon
    (mixed shows an indeterminate state).
  - Touch: replaced by **floating text controls** (UI-26) anchored to the selection handles, since a
    hover toolbar is meaningless on touch.
  - `Esc` dismisses it without clearing the selection.
  - Screen readers: `role="toolbar"` with an accessible name ("Text formatting"), and its buttons are
    not announced as part of the document content.
- **OOXML.** None (its commands write `w:rPr`/`w:pPr` per UI-19/UI-20).
- **Commands / events.** `ui.miniToolbar.show/hide({ anchor })` → `ui.chrome.state.changed`; its
  controls dispatch `text.format.set` etc.

## UI-26 · Floating text controls over a selection
**Priority** core · **Effort** M

- **Behaviour.** In addition to the mini toolbar, a **selection action chip** floats at the
  selection's end handle (bottom-right): a small circular button that expands into a compact
  control strip (bold · italic · underline · highlight · link · comment · clear formatting). On
  touch it is the primary formatting affordance. It is separately configurable from the mini toolbar
  (`floatingControls: 'chip' | 'strip' | 'off'`).
- **States.** `collapsed (chip)` · `expanded (strip)` · `hidden` (during a selection drag, while a
  context menu or dialog is open, in `read` mode, and when the selection is empty).
- **Rules & edge cases.**
  - The same **no-focus-steal / no-selection-loss** rules as UI-25 apply verbatim; they are
    implemented once in a shared `floatingControls` primitive and both surfaces use it. Two separate
    implementations of "don't lose the selection" will diverge and one of them will break.
  - Over a selection that ends near the bottom of the viewport, the chip flips above the end handle;
    near the right edge it shifts left. It never covers the selection's own text (the "never cover
    the selection" rule, tested with a selection filling the viewport).
  - The chip is not shown for a collapsed caret (it would be noise), and not for a selection made
    entirely by keyboard (the ribbon is the keyboard path).
  - Drag handles on the touch selection (the two grab handles Word shows on mobile) are part of this
    primitive: dragging them extends the selection; releasing shows the chip.
  - Long-press on a selection opens the **text context menu** (UI-28) on touch, which is the touch
    equivalent of right-click, so the two features agree on gesture.
  - `Esc` or a tap outside collapses the strip and keeps the selection.
  - The strip's controls are reached by keyboard through the ribbon's equivalents; the chip itself is
    `tabindex="-1"` and `aria-hidden="true"` for screen readers (it is a pointer affordance, and
    duplicating the ribbon's controls in the tab order would be harmful).
- **OOXML.** None.
- **Commands / events.** `ui.floatingControls.set({ mode, anchor, actions })` →
  `ui.chrome.state.changed`.

## UI-27 · Context menu framework
**Priority** core · **Effort** L

- **Behaviour.** One menu primitive used by **every** context menu in the library (object, text,
  table, field, page, header/footer, ruler, status bar, ribbon, tab, navigation pane, spelling).
  It renders in a top-layer portal and supports: sections separated by rules, items (label,
  optional icon, shortcut hint, disabled-with-reason, checked/radio state), submenus (open on hover
  after 300 ms or on click), a scrollable overflow when the menu exceeds the viewport, and a
  "recently used" ordering option (`menus.adaptive: false` by default, since adaptive menus
  annoy users - Word made them optional for that reason).
- **Invocation.** `contextmenu` event (right-click), `Shift+F10`, the dedicated context-menu key,
  a long-press (500 ms, < 10 px movement) on touch, and a two-finger tap on some trackpads. Also
  invoked programmatically for the "floating text controls" gesture (UI-26).
- **States.** `opening` (positioning before paint, never a flash at 0,0) · `open` · `submenu open` ·
  `closing` (with a short exit animation honouring `prefers-reduced-motion`).
- **Rules & edge cases.**
  - **Every menu is built from the command registry.** An item's label, enabled state, checked
    state and shortcut are the registry's; the menu contributes only ordering and grouping. This is
    what keeps a menu item from disagreeing with the ribbon button for the same command.
  - Opening on `pointerdown` vs `pointerup`: the menu opens on **`pointerup` with no preceding
    drag** for pointer input, so a right-drag does not open it mid-gesture; the browser's native
    `contextmenu` event is always `preventDefault()`ed within the editor, or the host page's menu
    appears over ours. **`preventDefault()` on `contextmenu` everywhere the editor owns the surface**
    - the previous attempt's "right-click does nothing" complaint is often this one missing call.
  - Positioning: at the pointer, offset 2 px; flip up when there is not room below, left when there
    is not room to the right; the menu is never clipped by an ancestor (portal) and never scrolls
    the page when it opens (no `scrollIntoView` on the container).
  - Keyboard: the first item is focused on open (or focused at the pointer for pointer-opened
    menus), arrows navigate, `→` opens a submenu, `←` closes it, `Enter`/`Space` invoke, `Esc`
    closes and returns focus to the surface, and typing a letter jumps to the next item starting
    with it.
  - Dismissal: `Esc`, a click anywhere outside, scroll, window blur, or a document change that
    invalidates the target (if the target object is deleted by another action, the menu closes -
    never leaves a menu pointing at a dead id).
  - The menu is announced with the correct `role="menu"`/`menuitem`/`menuitemcheckbox` and a
    `aria-label` naming the surface ("Picture menu", "Table menu", "Text menu").
  - Menus never contain a control that cannot be a menu item; anything more complex (a colour
    picker, a gallery) opens a **submenu containing the gallery**, as Word does for Wrap Text and
    Shape Fill.
  - The primitive is exposed as a command (`ui.contextMenu.open`) so a host can open the library's
    menu for a surface from its own gesture, and as a slot so a host can replace it entirely.
  - A menu with zero enabled items is not shown at all (rather than an empty box).
- **OOXML.** None.
- **Commands / events.** `ui.contextMenu.open/close({ surface, at, target })` →
  `ui.chrome.state.changed`; item invocation dispatches the item's command with `source: 'ui'`.

## UI-28 · Context menu surfaces
**Priority** core · **Effort** XL

Every surface below has a real context menu with the items listed. **A missing menu on any of these
surfaces is a defect against the original complaint.** All items come from the command registry
(UI-27) and are trimmed by section priority when there is not enough vertical room.

- **Text (in a paragraph, selection or caret).** Cut · Copy · Paste · Paste Options ▸ (Keep Source
  Formatting / Merge Formatting / Keep Text Only) - separator - Font… · Paragraph… · Bullets ▸ ·
  Numbering ▸ · Styles ▸ (the styles gallery as a submenu) - separator - Synonyms ▸ · Translate ▸
  (host-provided; hidden when unavailable) - separator - Link (`Ctrl+K`) · Comment · New Comment -
  separator - Insert ▸ (the Insert tab's most-used groups) · Delete · Select All - separator -
  Format Painter · Clear Formatting.
  *Load-bearing rules:* the selection under the pointer is **preserved** (right-clicking inside a
  selection keeps it; right-clicking outside moves the caret there first, matching Word); the menu
  is not shown for a right-click on a read-only region without disabling everything - in `read`
  mode a reduced menu (Copy · Select All · Find · Translate) is shown instead.
- **Image.** OBJ-32's list, plus OBJ-13's Change Picture ▸ and OBJ-14's Compress Pictures, and
  `Save as Picture…` (host hook), `Insert Caption…` (later), `Size and Position…`, `Wrap Text ▸`,
  `Format Picture…`.
- **Shape / text box.** OBJ-32's list, plus `Add Text` / `Edit Text`, `Shape Fill ▸`,
  `Shape Outline ▸`, `Shape Effects ▸`, `Edit Points` (freeform only), `Set as Default Shape`, and
  for a connector `Re-route Connector` (later).
- **Table.** Insert ▸ (Rows Above/Below, Columns Left/Right) · Delete ▸ (Cells, Rows, Columns,
  Table) · Select ▸ (Cell, Row, Column, Table) - separator - Merge Cells · Split Cells… ·
  Split Table - separator - Cell Alignment ▸ (a 3×3 grid submenu with live mini-previews) ·
  Cell Margins ▸ · Text Direction ▸ · Distribute Rows Evenly · Distribute Columns Evenly -
  separator - Borders and Shading… · Table Properties… - separator - Repeat Header Rows ·
  Allow Row to Break Across Pages - separator - Table Alt Text…, plus `AutoFit ▸` (Contents /
  Window / Fixed Column Width).
  *Rules:* the menu is shown only when the pointer is inside a table; the `Insert`/`Delete`
  submenus operate on the **current cell/row/column of the pointer**, which is highlighted before
  the menu opens so the target is unambiguous. Nested tables resolve to the innermost table.
- **Field.** Update Field (`F9`) · Edit Field… · Toggle Field Codes (`Shift+F9`) · Toggle All Field
  Codes (`Alt+F9`) - separator - Cut · Copy · Paste - separator - Font… · Paragraph… -
  separator - Convert Field to Text (destructive; requires confirmation and is one undo entry) -
  separator - Field Shading ▸ (Never/Always/When selected) - separator - Lock Field · Unlink Field.
  *Rules:* right-clicking a field targets the whole field, not the run under the pointer; a field in
  a `w:fldSimple` and a complex field present the same menu; `Convert Field to Text` keeps the
  **result** and removes the instruction, and it is the one place where a field is deliberately
  flattened.
- **Page background** (the empty area around/below the page, and the page's own background).
  Paste · Select All - separator - `Page Color ▸` · `Fill Effects…` · `Watermark ▸` (Custom
  Watermark…, Remove Watermark, a gallery) - separator - `Page Borders…` - separator - Zoom ▸
  (the zoom presets) · `Show Ruler` · `Show Gridlines` · `Show Navigation Pane` - separator -
  `Paragraph…` (when the pointer is over a page but outside the text, the caret is placed at the
  nearest text position so the command has a target).
  *Rules:* right-clicking the page's own background (outside the text area but on the page) is a
  distinct surface from right-clicking the pasteboard, and both are distinct from the text menu.
  Page colour and borders write `w:background/@w:color` and `w:sectPr/w:pgBorders` - both must
  round-trip, and neither is printed by default (the dialog says so).
- **Header / footer.** Edit Header / Edit Footer · Close Header and Footer - separator -
  Insert ▸ (Page Number, Date & Time, Quick Parts, Picture, Field…) - separator - Header & Footer
  ▸ (the built-in header/footer gallery) - separator - Different First Page · Different Odd & Even
  Pages (checkboxes writing `w:titlePg` and `w:settings/w:evenAndOddHeaders` plus the part
  references) - separator - Link to Previous (writes/removes `w:headerReference` so the section
  inherits the previous section's header - the concept HR users actually need when a contract has
  a different first page) - separator - `Show Header/Footer Boundaries` - separator - Cut · Copy ·
  Paste · Select All.
  *Rules:* right-clicking inside the header/footer area targets that part (`word/headerN.xml`); the
  ruler re-scopes to the header/footer's own margins; edits to a header are ordinary text edits and
  go through the normal text commands. A header with no part yet offers "Edit Header" which
  **creates** the part (`r:id` in `w:headerReference/@w:type="default"` plus a new part and rel) -
  creating structure is a real edit and must be written to the file.
- **Also required, though not in the original list** (each is cheap once UI-27 exists and their
  absence is felt): **ruler** (units, show ruler, tabs dialog), **status bar** (item visibility
  toggles), **ribbon/tab** (Customize the Ribbon, Collapse the Ribbon, Add to Quick Access Toolbar),
  **navigation pane item** (Go To, Delete Heading, Select Heading and Content, Promote/Demote),
  **spelling error underline** (suggestions, Ignore Once, Ignore All, Add to Dictionary,
  Spelling…), **comment/selection handle**, and **image inside a text box** (routes to the image
  menu with the text-box items appended, since the object is the target, not the box).
- **OOXML.** Each item maps per the feature it invokes. Surface detection: `w:tbl` ancestry (table),
  `w:fldChar`/`w:fldSimple` ancestry (field), part identity (`word/headerN.xml` etc.), a `w:drawing`
  ancestor (`pic:pic` / `wps:wsp` / `wpg:wgp`), and geometry for the page-background/pasteboard
  distinction.
- **Commands / events.** All items dispatch their own commands → the owning feature's events.

## UI-29 · Panels and sidebar framework
**Priority** important · **Effort** L

- **Behaviour.** A sidebar region that hosts docked panels (right by default, left by host option),
  plus floating panels that can be dragged out, resized (min 200 px, max 600 px or 50 % of the
  editor), collapsed to a rail of icons, closed, and re-docked. Panels: **Navigation** (UI-30),
  **Styles**, **Format Object** (OBJ-36), **Alt Text**, **Selection**, **Find**, **Comments**,
  **Properties** (document metadata: title, author, subject, keywords, category, status, comments;
  custom properties), **Bookmarks**, **Spelling**.
- **States.** docked · floating · collapsed-rail · hidden. State (which panels are open, widths,
  order, docked/floating) persists per session and is serialisable for the host.
- **Rules & edge cases.**
  - Panels never take the document selection away; interacting with a panel does not blur the
    editor's selection, and the editor's commands target the last document selection. Every panel
    that shows a document range keeps its **last valid** range and shows it as inactive when the
    selection moves - a panel that silently acts on a stale range is dangerous.
  - Panel resizing uses pointer capture and a keyboard alternative (`Tab` to the splitter, arrows to
    resize) - required for accessibility, and cheap.
  - Multiple panels in the sidebar have a tabbed or stacked layout (host option
    `sidebar: 'tabs' | 'stack'`); the default is `stack` with collapsible headers, which is what
    Word's task panes do.
  - At narrow widths (≤ 900 px) the sidebar becomes an overlay sheet over the canvas rather than
    squeezing it, because a squeezed page at 400 px viewport is unusable.
  - Panels are chrome slots: `panels: { navigation: renderer | null, styles: … }`. Replacing one is
    independent of the others.
  - Panels re-render from events, never poll the model; a panel's render must be O(changed) not
    O(document) - the Styles panel on a 400-style document must open in < 100 ms.
  - Panel content inherits `--docier-*` tokens and density.
- **OOXML.** The Properties panel reads/writes `docProps/core.xml` (`dc:title`, `dc:creator`,
  `cp:lastModifiedBy`, `dc:subject`, `cp:keywords`, `dc:description`, `cp:category`, `cp:contentStatus`,
  `dcterms:created`, `dcterms:modified`) and `docProps/custom.xml` (`property` elements with
  `fmtid`/`pid`/`name`). Writing core properties must preserve the existing `<dcterms:created>`
  and only update `<dcterms:modified>` - resetting the created date on every save is a real and
  common bug.
- **Commands / events.** `ui.panel.open/close/setWidth({ id, ... })` → `ui.chrome.state.changed`;
  `document.properties.set({ props })` → `document.properties.changed`.

## UI-30 · Navigation pane and document outline
**Priority** important · **Effort** L

- **Behaviour.** The Navigation pane (`View > Navigation Pane`, `Ctrl+F` opens it on the Results
  tab) has three tabs: **Headings** (the document outline as a collapsible tree), **Pages** (page
  thumbnails), **Results** (find results with context snippets, grouped by part). Clicking a heading
  scrolls the document to it; the outline highlights the heading of the currently visible page as
  the user scrolls.
- **Rules & edge cases.**
  - The outline is built from **two** sources, and both must be read: `w:pStyle` referencing a
    heading style (whose `w:pPr/w:outlineLvl` gives the level) and a direct
    `w:pPr/w:outlineLvl` on a body-styled paragraph. A paragraph with a heading style but an
    overridden direct `outlineLvl` of 9 (body text) is **not** in the outline - Word's rule, and the
    reason a naive "styles named Heading*" implementation produces a wrong outline.
  - The outline must also include paragraphs whose `outlineLvl` is set without a heading style (Word
    does), and must not include paragraphs hidden with `w:vanish` or inside deleted revisions.
  - Heading text is the paragraph's **flattened text**; a heading containing a field or an inline
    picture shows a readable placeholder; a heading with a `w:numPr` shows the computed list number
    as part of the label (Word does), since HR documents use numbered headings.
  - Dragging a heading in the pane **moves the whole section** (the heading and its content up to the
    next heading of the same or higher level) - this is a real, very useful Word behaviour and it is
    one of the few places where a drag in chrome changes the document. It must be one undo entry
    and must carry the moved paragraphs' `sectPr` correctly (a moved section must not lose its
    section properties or the page geometry changes unexpectedly). **If this cannot be made correct
    in v1, the pane is read-only** (click to navigate only) rather than shipping a broken move -
    `priority: important`, with the move itself `later` if it cannot be validated.
  - The **Pages** tab renders page thumbnails from the layout engine at a fixed small scale, lazily
    as they scroll into view, re-rendered on layout invalidation with a debounce (a thumbnail
    re-render per keystroke is a performance trap).
  - The **Results** tab groups matches by part ("Main Document", "Header 1", "Text Box 3") - this is
    how a user discovers that the text they cannot replace is in a text box.
  - The pane is resizable, closable, and its width and active tab persist.
  - Selecting a heading in the pane selects the heading's text in the document (so a subsequent
    formatting command applies), matching Word; the pane's selection is kept in sync with the
    document's caret position.
  - Keyboard: the outline is a tree (`role="tree"`, `role="treeitem"`, `aria-expanded`,
    `aria-level`), navigable with arrows, `Enter` to navigate, `Ctrl+click`-equivalent for
    multi-select not supported (single selection only).
  - Accessibility: this pane is the primary navigation mechanism for a screen-reader user in a long
    document; it must announce levels and the current position.
- **OOXML.** `w:pPr/w:pStyle/@w:val` → `w:styles/w:style/w:pPr/w:outlineLvl` (style-derived level) ·
  direct `w:pPr/w:outlineLvl/@w:val` (0-8 = levels 1-9, 9 = body text) · `w:pPr/w:numPr` for the
  number label · page list from the layout engine's page map (spec 03).
- **Commands / events.** `view.navigation.set({ visible, tab })`, `navigation.goToHeading({ id })`,
  `navigation.moveSection({ fromId, toIndex })` → `view.changed`, `document.structure.changed`.

## UI-31 · View modes
**Priority** important · **Effort** L

- **Behaviour.** Four modes, in the status bar and the View tab:
  - **Print Layout** - pages with margins, headers/footers, floating objects at their true position,
    the ruler, and full pagination. The default and the one the product's documents are authored in.
  - **Web Layout** - a single continuous column the width of the editor, no page breaks, no
    margins, no ruler, no header/footer areas; wrapping objects still float but relative to the
    column. For on-screen reading and for hosts that embed the editor in a narrow container.
  - **Draft** - a single column of text with a simplified layout: no floating objects (they are
    listed as an inline marker "▣ Picture" at the anchor), no page breaks except explicit ones
    shown as a labelled line, no headers/footers, and an optional style-area panel on the left
    showing each paragraph's style name. Optimised for editing long text on a slow machine.
  - **Read Mode** - a paginated, read-only, chrome-minimal view: no ribbon (a slim toolbar with
    `View → Edit Document` and a find box), columns reflowed to the viewport, no rulers, no
    selection handles, and object interaction reduced to selecting for copy. Editing commands are
    disabled with a reason, and `document.protection` (`w:documentProtection/@w:edit="readOnly"`)
    forces this mode.
- **States.** Mode changes are view state, persisted in `w:settings/w:view` (`print` · `web` ·
  `draft` · `normal`) - note `read` has **no `w:view` value** and is not persisted (Word does not
  persist it either); we persist it in host settings only.
- **Rules & edge cases.**
  - **Layout is re-run on a mode change** because the wrapping width and pagination differ, but
    **nothing in the document changes** - no properties are written, no dirty flag, no undo entry.
    A view mode that dirties the document is a defect.
  - Object **editability** per mode: Print and Web allow full object editing (Web positions
    floating objects relative to the column, which changes their rendered position - the mode's
    status bar tooltip says so); Draft allows selecting an object and editing its properties but
    not dragging it on the page; Read forbids all object edits.
  - Draft's inline object markers are chrome: they must never be written to the document, appear in
    print, or affect layout in other modes.
  - Switching modes preserves the caret's logical position (the same character), not its pixel
    position; scroll position is restored per mode (each mode remembers its own scroll offset).
    Losing the caret position on a mode switch makes users avoid the modes entirely.
  - Read mode reflows to the viewport width, so **pagination in Read mode differs from Print Layout
    and its page count is not the document's page count**; the status bar in Read mode must not show
    the print page count as if it were the same thing (it shows `n of m` for the read-mode pages,
    labelled as such). This is a small thing that prevents a genuinely confusing bug report.
  - The mode is part of the view state emitted in `view.changed` so a host can render its own
    affordances.
  - `Layout`-tab commands that only apply to paginated views (page setup, ruler-dependent controls)
    are disabled with a reason in Web/Draft/Read rather than silently doing nothing.
- **OOXML.** `w:settings/w:view/@w:val` (`print` · `web` · `draft` · `normal`; also `outline` and
  `masterPage` on read, mapped to draft/print respectively with a notice); read-only documents via
  `w:settings/w:documentProtection/@w:edit,@w:enforcement`.
- **Commands / events.** `view.mode.set({ mode })` → `view.changed` + `layout.reflow`.

## UI-32 · Empty, first-run and error states
**Priority** core · **Effort** M

Every state below is a designed state with defined content and a defined command path out of it -
not a blank rectangle and not a raw exception.

- **Empty document.** A new document is `<w:body>` with one empty `<w:p>` carrying the `Normal`
  style and a `<w:sectPr>` derived from `w:styles/w:docDefaults` and the host's default page setup
  (A4 and 2 cm margins for this product, or the host's locale default). The caret is placed in the
  empty paragraph and the placeholder text "Start typing, or insert a template field" is shown as
  chrome (never written to the document, never printed). An empty paragraph is a real paragraph:
  `<w:sectPr>` must exist even when the body is empty, or the file is invalid.
- **Empty region states.** An empty header/footer shows "Click to add header" with the
  double-click target and the `Different First Page` explainer; an empty table cell shows nothing
  (Word does not annotate cells); an empty text box shows a caret and a selection frame.
- **First run.** The first time the editor mounts in a host, brief callout hints (dismissible,
  max 3, persisted as "seen") point at the ribbon, the ruler and the object handles. The hints are
  chrome, are disabled by `chrome.hints: false`, and never block interaction.
- **Loading.** A document is parsed incrementally and the first page renders before the whole
  document is laid out: a skeleton page with a progress indicator in the status bar, cancellable.
  **The editor must never show a blank white area with no feedback** - the previous attempt's
  perceived slowness was largely an unlabelled wait.
- **Errors and unsupported content** - each renders an **inline, selectable, preserved placeholder**
  with a specific message and an "object not rendered, saved unchanged" guarantee:
  - Unsigned/unreadable OOXML construct → "This content cannot be displayed. It will be preserved
    when you save." (with the part and element name in a details disclosure).
  - Missing media part (`r:embed` unresolved) → a broken-media placeholder sized from
    `wp:extent`, with the relationship preserved (OBJ-15).
  - EMF/WMF/TIFF that the browser cannot decode → a placeholder showing the image type and size,
    with "Open in Word to view" guidance, **preserved on save**.
  - A font referenced by the document that is not available → rendered with the fallback chain, and
    a non-blocking notice listing the missing fonts and offering "Substitute" - degrading silently
    changes pagination, which is worse than a notice.
  - A corrupt or unparseable DOCX → the editor does not mount a partial document; it shows an error
    surface naming the failing part and offering the raw bytes for download. Never a partially
    edited document that would be saved over the original.
  - An OLE/embedded object (`w:object`) → a static preview if the part contains one
    (`w:object/w:shape` preview image), otherwise a placeholder with the ProgID; preserved on save.
  - Content controls (`w:sdt`) the editor does not support → rendered as their content with a
    tagged boundary in the "show content controls" view, editable if the control is not locked.
  - Overlapping-floats layout failures, or a text box overflowing: an explicit overflow marker
    (OBJ-20), never silent clipping or a console-only warning.
- **Error surface content rules.** Every error states: what failed, what it affects, whether the
  document is still safe to save, and one action ("Retry", "Open in Word", "Download the original").
  No raw stack traces in the UI; the error object carries them for the host's `onError` handler.
- **OOXML.** The unrendered-content registry is keyed by element/part so the placeholder can name
  the exact element (`w:object`, `v:shape`, `m:oMath` if maths is deferred, `w:altChunk`). Nothing
  in this feature writes to the document except the deliberate "remove unsupported content" action
  the host may expose (never offered by default).
- **Commands / events.** `document.load.start/progress/complete/error`, `placeholder.render`,
  `font.missing` → `status.changed`, `document.error`.

## UI-33 · Theming, density and layout tokens
**Priority** important · **Effort** M

- **Behaviour.** Every visual value in the chrome comes from a documented set of CSS custom
  properties (`--docier-*`) on the container, with sensible neutral defaults. A host theme
  overrides the property block; the library ships **no brand palette of its own**, because a
  framework-agnostic library must not impose one.
- **Token groups.** Surface (`--docier-surface`, `--docier-surface-raised`, `--docier-border`,
  `--docier-page`, `--docier-pasteboard`) · text (`--docier-text`, `--docier-text-muted`,
  `--docier-text-disabled`) · accent (`--docier-accent`, `--docier-accent-text`) · state
  (`--docier-selection`, `--docier-guide`, `--docier-error`, `--docier-warning`, `--docier-success`,
  `--docier-focus-ring`) · typography (`--docier-ui-font`, `--docier-ui-font-size`, and a
  `--docier-doc-font` used only for chrome that previews document content, e.g. gallery thumbnails)
  · metrics (`--docier-control-height`, `--docier-handle-size`, `--docier-ruler-size`,
  `--docier-radius`, `--docier-gap`) · elevation (`--docier-shadow-1/2/3`).
- **Density.** `--docier-density` values `compact` (28 px controls), `comfortable` (32 px, default),
  `touch` (44 px controls, 20 px handles, larger key tips and rulers). Density changes hit targets
  and spacing, never the document layout (obviously) and never the meaning of any control.
- **Rules & edge cases.**
  - Dark and light: the chrome respects the host's `color-scheme`. The **page** keeps its own
    background (`--docier-page`, white by default) independent of the chrome theme, because a
    document's page colour is a document property (`w:background`, `w:sectPr`) and a dark chrome
    must not darken a page that is white in the file. Conflating them produces documents that look
    right in the editor and print wrong.
  - Contrast: every token pair used for text meets WCAG AA (4.5:1 for body, 3:1 for large/UI
    components); the shipped defaults are checked, and a host override that fails contrast produces
    a console warning in development builds.
  - Focus rings are never removed; `--docier-focus-ring` is used for every focusable chrome element
    and every object handle.
  - `prefers-reduced-motion` disables all chrome animation (ribbon expand, contextual tab
    appearance, menu/panel transitions, guide animations).
  - Chrome must survive `zoom` (browser page zoom) up to 200 % and text-only zoom without
    overflowing; the ribbon scrolls its groups rather than clipping.
  - The editor is usable at a 400 px viewport width: ribbon collapses to tabs, sidebar becomes an
    overlay sheet, dialogs stack, context menus flip and scroll, the status bar drops
    lower-priority items in a defined order (save state and page count last to go).
  - Theming is documented as a table in the README with a copy-pasteable default block, so a host
    can see every knob in one place.
- **OOXML.** Page colour reads `w:background/@w:color,@w:themeColor` and section background via
  `w:sectPr/w:pgBorders`/`w:background` for the page surface token's document-level counterpart.
  Everything else is chrome-only.
- **Commands / events.** `ui.theme.set({ tokens, density })` → `ui.theme.changed` (a chrome-only
  event; never dirty).

---

## 4. Feature counts

| Group | Count | core | important | later |
|---|---|---|---|---|
| Objects (OBJ-01…OBJ-38) | 38 | 20 | 17 | 1 |
| UI chrome (UI-01…UI-33) | 33 | 22 | 11 | 0 |
| **Total** | **71** | **42** | **28** | **1** |

The single `later` feature is OBJ-38 (connector attachment and re-routing), which is deferred
because it is a layout-engine feature rather than a data-model one; OBJ-16 still ships connectors
as round-tripping drawn geometry. Bezier-handle editing (OBJ-17) and the gradient-fill editor
(OBJ-16) are scoped as deferred *within* `important` features rather than counted separately.

## 5. Open decisions (not resolved here)

1. **"Move with text" has no OOXML attribute** (OBJ-25). It is derived from
   `wp:positionV/@relativeFrom`, and toggling it rewrites the reference frame while preserving the
   resolved position. This needs an ADR before implementation, because it is the only place in this
   spec where a Word UI state has no direct file representation, and the round-trip fidelity
   depends on which frame Word picks when it re-saves the file.
2. **Chrome delivery mechanism.** This spec defines a slot/contract API and does not decide whether
   the default chrome ships as framework-agnostic custom elements, as a plain-DOM renderer, or as
   optional per-framework adapters. That is a packaging decision for spec 05.
3. **Where image compression runs.** In-browser `OffscreenCanvas`/`WebCodecs` versus a host-provided
   endpoint. OBJ-14 assumes in-browser with a host hook; the quality/PPI defaults and the codec
   matrix are not settled.
4. **Freeform depth.** How much Bézier node editing ships in v1 (OBJ-17 marks handle editing
   `later` but the boundary between "node editing" and "handle editing" is not fixed).
5. **Section-move drag in the navigation pane** (UI-30) is `important` but ships only if the
   `sectPr`-carrying move can be proven correct; otherwise the pane is navigate-only in v1.
6. **Connector re-routing** (OBJ-38) is `later`, but OBJ-16 ships connectors as static geometry, so
   the v1 behaviour of a connector whose shape has moved (it stays where it was drawn) is a
   deliberate, user-visible limitation rather than a bug. If the product owner considers a visibly
   detached connector unacceptable in v1, OBJ-38 must be promoted and the layout engine must expose
   connection-site geometry earlier than planned - that trade-off is not mine to make.
