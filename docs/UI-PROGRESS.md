# Phase progress

Working record for `docs/UI-AUDIT.md` (behaviour) and `docs/WORD-UI.md`
(appearance). Each phase is ticked off as it is done, with what was verified and
how. Findings that turn up along the way go in the appendices at the end and are
addressed when the phase that owns them is reached.

Status: **Phase B**: B1, B2 done, B3 with an agent. **Phase C**: C1 to C5 done, table menu partly. **Phase D**: D1 and D4 done, D2 and D3 to do.

Done and verified in the browser:

- **A1** `autoFocus` was dead code. `mountSession` now focuses the composer and
  reveals the caret when it is set. Verified: `activeElement` is `docier-input` on
  load and typing works without clicking first.
- **A2** Ribbon and status-bar controls cancelled the click but not the mousedown,
  so touching any of them took the keyboard away from the document while the caret
  went on blinking. Both now cancel the mousedown, as the floating toolbar and the
  menus already did. Verified: after clicking Bold, focus is still the composer and
  the next keystrokes land.
- **A7** Zoom revealed nothing, so the caret could end up below the fold.
  `setZoom` calls `reveal()` now. Verified: after a large zoom the caret is inside
  the scroll view.
- **A8** The blink was free-running at 49 percent on and never reset by input, so
  the caret was dark about half the time while typing. `reveal()` restarts its
  phase. Verified: twelve samples taken right after keystrokes are all fully
  opaque, where before they alternated.
- **A4** Selecting a range mid-run and pressing Ctrl+B was a `noop` that also
  silently split the paragraph, because `splitRunAt` mutated the paragraph's
  children without invalidating the view cache that the span scan reads.
  `splitBoundary` invalidates it now. Verified at the model level: the paragraph
  becomes exactly two runs with `b` on the first, where before it was one split
  run with no `b` at all.
- **A5** The toggle and the toolbar meant the run *ending* at the caret while
  typing continued in the run *starting* at it, so a mark written at a run
  boundary was lost on the next keystroke. `insertionPoint` now takes the
  properties from the run the caret convention points at. Verified: at the start
  of a bold run, Ctrl+B turns bold off on that run and the text typed afterwards
  is not bold, which is what the button showed.

## Phase A - The editor must accept input, and formatting must work

| # | Item | State |
|---|---|---|
| A1 | Focus on mount, so `autoFocus` stops being dead code | **done** |
| A2 | Ribbon and status-bar controls must not steal focus | **done** |
| A3 | Ctrl+A must not produce an uneditable selection | **done** |
| A4 | Range formatting: the stale-cache fix in `splitBoundary` | **done** |
| A5 | Range formatting: the run-at-the-caret convention in `insertionPoint` | **done** |
| A6 | Caret: shift the region stops so a header or footer caret is where its text is | **done** |
| A7 | Caret: reveal on zoom | **done** |
| A8 | Caret: reset the blink phase on input | **done** |
| A9 | Caret: decide the scroll from geometry rather than from the DOM | **done** |

- **A3** `Ctrl+A` selected the whole *story*, which in the sample spans table cell
  containers, and no edit command accepts a range crossing a container: every
  keystroke was swallowed while the caret went on blinking, and clicking inside the
  selection only armed a drag, so the obvious escape did not work. `selectAllAction`
  now clamps to the cell when the caret is inside one. Verified: Ctrl+A in a cell
  selects its 6 characters and typing lands, while Ctrl+A in the body still selects
  all 872.
- **A6** A header or footer caret was painted at the top of the page, about 35000
  millipoints from its text, because `placeBlocks` shifted the blocks, the lines and
  the baselines by the region offset and left `caretStops` region-local. Verified:
  the caret is now at x=560 three pixels above its text, which is also at x=560.
- **A9** `scrollCaretIntoView` decided whether to scroll by reading the caret's
  computed `display`, which an injected stylesheet can override, so a print
  stylesheet could make it believe there was nothing to scroll to. It takes the
  answer from the paint now, which knows whether geometry existed.

Not done in A3, deliberately: the alternative fix of collapsing the selection when
a click lands inside it. The clamp removes the wedged state, and collapsing would
have removed drag-to-move, which works and is worth keeping.

## Phase B - Direct manipulation

| # | Item | State |
|---|---|---|
| B1 | Delete `startDrag`, give the indent markers the margin interaction, clamp negative indents | **done** |
| B2 | Make pictures visible at all, by giving the renderer the media parts | **done** |
| B3 | Object selection and resize handles for inline pictures | **done** |
| B4 | Table width handles, proportional write, `tblLayout` fixed | to do |

### Phase B notes

**B1 done.** The indent markers could not be dragged at all: `startDrag` cancelled
the default on pointerdown, which makes Chromium suppress the compatibility mouse
events, and then listened for `mousemove` and `mouseup`, neither of which ever
fired. Because `mouseup` never fired, its document-level handlers also leaked, one
set per press, and every later mouse movement committed an indent change against a
stale base: a click on the marker followed by 200px of pointer travel produced four
commits and moved the indent exactly 200px, and the same leak silently overwrote
the indents of whatever paragraph was selected, including one the user had never
touched. `startDrag` is deleted and the markers use the same shape the margin
markers do.

Verified in the browser: the marker follows the pointer live (343, 358, 373, 393
for 10, 25, 40, 60px of travel), the guide line follows it and both the guide and
the badge hide on release, the badge shows the resulting indent in centimetres, and
the whole gesture commits exactly once. Moving the pointer across the page
afterwards with no button pressed produces **zero** commits, where before it
produced one per movement.

Negative indents are clamped: both `w:ind/@w:left` and `@w:right` are unsigned in
OOXML, and the old code wrote `w:left="-600"` happily.

**B2 done.** No picture rendered in the demo at all: `images` and `imageProvider`
are host-supplied render options, the demo passed neither, and nothing extracted
media parts, so every picture drew a dashed red "missing image" placeholder. The
demo now reads the media relationships out of the package before the document
renders and hands the renderer a provider keyed by relationship id. Verified on
`contract.docx`: one real `img.docier-image` with a PNG data URL, zero missing
placeholders, three sources handed over.

**B3 done.** A picture could not be selected, showed no handles and could not be
moved. It has a selection frame and eight handles now, and a drag resizes it.

The first problem was identity: objects were stamped with a per-paragraph atom
ordinal, and a resize triggers a relayout, so a selection held that way is destroyed
by the edit it causes. Objects carry the document-declared `wp:docPr/@id` now,
falling back to the node id, stamped beside the atom id rather than instead of it.
Verified: the same element reports id 7 for the declared identity and 4 for the atom
one, and the selection survives the relayout.

The coordinate work was free: the overlay sits on the unscaled surface above the
zoom transform, so handles are 8 screen pixels at every zoom, verified at 0.16, 0.25,
0.63 and 1.0. Word's drag semantics are implemented, including the part that is the
opposite of most web editors: a corner locks the ratio and fixes the opposite corner,
and Shift unlocks it. A 40px corner drag took 64x64 to 84x84 on both axes. The commit
writes both extents and never touches the media, whose bytes are identical after a
resize. One gesture, one commit, one undo entry. It also fixed appendix A1.

**B3's limits, recorded as findings rather than left implicit.** None of these is
reachable from the demo's sample documents, and each would need a fixture to
reproduce:

- Only objects the layout gives an image relationship are hit-tested: shapes, charts,
  text boxes and groups are filtered by that guard, which is a heuristic rather than
  a verified type test.
- Floating (`wp:anchor`) drawings and pictures inside headers or footers cannot be
  selected, because the search walks the body's blocks only.
- Rotation is out of scope, and a rotated picture would get an axis-aligned frame.
- **At 25% zoom the eight handles' hit radii overlap**, so a corner can resolve as an
  edge. At 50% and above they are unambiguous. This is a real limitation of a fixed
  pixel hit radius at low zoom.
- The commit updates `wp:extent` and `pic:spPr/a:xfrm/a:ext` only when they exist; it
  never creates a missing one, and that path is untested.
- A drawing with no `wp:docPr/@id` falls back to the node id, which does not survive
  the relayout, so such a document would lose its selection across a resize.
- No keyboard nudge, no drag-to-move, no multi-select, no rotation, no size readout.
- `docier.command.object.select` exists but no menu or toolbar dispatches it; the
  pointer path executes it directly.

## Phase C - The menu surface

| # | Item | State |
|---|---|---|
| C1 | Style the rows, and make items fill the row | **done** |
| C2 | Move the disabled reasons out of the items | **done** |
| C3 | The four behavioural defects in `menu.ts` and `context-menu.ts` | **done** |
| C4 | Wire Cut, Copy, Paste and the table insert rows to the commands that exist | **done, verification blocked** |
| C5 | Fill the menus out to Word's contents | **text menu done, table menu partly** |

### Phase C notes

**C1 done.** The rows drew as user-agent buttons: Arial 13.33px on a grey
buttonface with a 2px outset border, because the reset lives on `.docier-control`
and menu items never received that class. They also shrink-wrapped their row, so a
hover fill was a ragged patch that stopped at the label. Measured after: rows are
22px tall, every item is the full 215px of its row, the type is the 12px UI font,
and `appearance`, border and cursor are all reset. The text menu went from **451 by
327** to **217 by 116**. The same rules apply to the ribbon's menu, checked
separately.

Dark mode was also broken here and is fixed: it overrode neither state fill, so a
hover painted a light-theme colour; both now have dark values.

**C2 done.** Disabled items printed their reason inside themselves, duplicating
what the accessible name, the tooltip and the status bar already carry. The span is
gone and the reason stays in `aria-description` and `title`. The test that covered
this asserted the prose was in the row; it now asserts the row carries the reason
accessibly and does *not* print it, plus a new test that an item is as wide as its
row.

**C3 done.** Four defects, all verified in the browser after the fix.

- **Submenus opened at the trigger item's right edge** rather than the menu's, so
  they jumped. They anchor to the parent menu's edge now, two pixels overlapped,
  aligned with the row.
- **Clicking a submenu parent destroyed the parent menu.** `openMenu` ends by
  focusing a child row, which fires `focusin` synchronously, and the parent's own
  handler ran while its `child` field was still unassigned, concluded the focus had
  left its list, and closed itself. Assigning the field before the child can focus
  anything fixes it. Verified: after clicking a submenu parent, two menus are open
  and the parent is still shown.
- **The clamp measured the box before placing it**, so applying `left` constrained
  the width, long rows re-wrapped, and the box grew past the height it had clamped
  against: measured 7px past the viewport with its last row clipped. It measures
  where the box will actually be drawn now. Verified: bottom at 686 in a 700px
  viewport.
- **The menu opened with its first row under the pointer**, at exactly the cursor
  position, and at an edge the clamp then slid the box so the pointer landed on the
  last row instead. It anchors two pixels off the cursor now, and it no longer
  focuses a row when a pointer opened it, which also removes the focus outline that
  used to appear on a row the moment the menu opened. Verified: the menu sits at
  +2,+2 and the focus stays outside it.

**C5, the text menu.** Rebuilt in Word's order and filled out: Cut, Copy, Paste,
Paste Options, Font, Paragraph, Bullets, Insert, Synonyms, New Comment, Find,
Select All. Paste Options is new and reaches the plain-text paste that already
existed; New Comment is new and renders honestly disabled, because comments cannot
be created in this build and the row says so; Font and Paragraph moved above Insert,
which is Word's order. The menu measures 200 by 310.

**Still to add, and why they are not there yet.** Translate and Format Painter need
registered-unsupported commands to render honestly, and the file that holds those
(`src/edit/areas/unsupported.ts`) is held by the running object-resize agent. The
table menu should nest its two delete groupings under one Delete submenu and add
Cell Alignment's other six positions, Insert Cells, Split Table, Borders and
Shading, Text Direction, AutoFit and Distribute, Sort, Formula and Repeat Header
Rows; of those, only the delete nesting and New Comment need no new command.

## Phase D - Ribbon content design

| # | Item | State |
|---|---|---|
| D1 | The Styles gallery as one scrolling row of preview tiles | **done** |
| D2 | Large buttons for the important commands | to do |
| D3 | The remaining icons | **in progress, with an agent** |
| D4 | Remove the forced ribbon height | **done, uniformity still needs D2** |

## Phase E - Dialogs

| # | Item | State |
|---|---|---|
| E1 | A dialog surface | to do |
| E2 | The Font dialog | to do |
| E3 | The Paragraph dialog | to do |

## Phase F - The refused commands

| # | Item | State |
|---|---|---|
| F1 | Insert a picture | to do |
| F2 | Hyperlink | to do |
| F3 | Comments | to do |
| F4 | Footnote, header creation, symbol, text box, table of contents | to do |

### Phase D notes

**D1 done.** The ribbon's Styles gallery was a wrapping grid whose column count
followed its width, so eight tiles rendered as four rows in a 146px column and made
that group the tallest on the tab, which is what held the ribbon at 112px. It is a
single horizontally scrolling row of 88px tiles now, set in the document font so a
style reads as itself rather than as a word in the interface font. Verified on
screen: one row of tiles, the Editing group clear of them, and the gallery
scrolling its 727px of content inside a 430px box.

**The Editing group was what set the Home height.** Its three buttons stacked in a
58px column, and three rows is exactly the 82px that every group was stretched to.
Giving that group a 76px minimum lets its buttons sit in two rows, and Home came
down from 107px to **79px**, against Word's 84, with no overflow.

**D4 done, with an honest number.** The forced ribbon height is gone, because the
commissioner's correction is that the ribbon should fit its contents. Measured after:
Home is **107px** and the other eight tabs are **51px**. So it fits its contents and
the document still moves 56px when a tab changes, from 195px down to 139px.

That gap is not a layout problem to be papered over with another token: it is what
the content needs. Home needs two rows of controls plus a header, and every other
tab needs one. Word's tabs are all the same height because Word's tabs are all
designed to need the same height, which is what **D2**, large buttons for the
principal commands, is for. Until D2 is done, fitting the contents and holding one
height are mutually exclusive, and fitting the contents is what was asked for.

An overlap count of two on Home is a **probe artefact**, recorded so nobody chases
it: the gallery's clipped tiles still report their full bounding rectangles, so a
rectangle comparison sees them overlapping the Editing group when `overflow-x: auto`
is in fact clipping them. Confirmed on screen.

**D3 in progress.** Measured on the build: **51 of 119 ribbon buttons carry an
icon**, and the group launchers are separate from that count. An earlier pass of
mine added 23 glyphs for the commands the menus reference through `command('...')`
and missed the ones they declare through `pending(name, ...)`, whose key is a bare
name rather than a command id. An agent is drawing the rest; the number to check its
work against is the 51 of 119.

## Appendices

Findings that belong to a phase other than the one being worked on. Each says
which phase owns it.

### A1. Right-clicking inside a selection collapses it

Found while verifying C4. Owner: **Phase B3's agent**, which holds
`src/edit/input.ts`, and it has been asked to fix it.

The context menu's Cut, Copy and Paste were wired to their real commands, and
neither command fires when you use them, because the right-click that opens the
menu has already destroyed the selection. Measured with the command bus tapped:

    shift+ArrowRight x6     -> selection.moveRight x6
    right-click inside it   -> selection.setCaret      <- selection gone
    Copy                    -> nothing fires, nothing is selected

Word preserves a selection that is right-clicked inside, and moves the caret when
the right-click is outside it. Until this is fixed the menu's clipboard entries
cannot work however correctly they are wired, which is why C4 is marked done but
not verified.

### A2. The context menu has no Picture surface for an unresolvable image

Owner: **Phase C**. `SURFACE_ATLAS` (`src/ui/context-menu.ts:18`) detects an image
surface with `img,[data-docier-image]`, which never matches the wrapper the
missing-image path produces, because that carries `data-docier-image-missing`. An
image with no bytes therefore gets the ordinary text menu. Adding
`[data-docier-object]` to the selector fixes it. B2 removed the missing-image case
from the demo by supplying the bytes, so this now only bites a host that does not.
