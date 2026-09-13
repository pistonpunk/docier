# Phase progress

Working record for `docs/UI-AUDIT.md` (behaviour) and `docs/WORD-UI.md`
(appearance). Each phase is ticked off as it is done, with what was verified and
how. Findings that turn up along the way go in the appendices at the end and are
addressed when the phase that owns them is reached.

**Those two documents are the audit as it was found and are deliberately not
updated.** They are the evidence the phases were written against - the measured
112px ribbon, the sixty-three iconless controls, the dialogs that did not exist -
and rewriting them would destroy the record of what was wrong. This file is where
completion against them is tracked, and `docs/READINESS.md` is the live answer to
"is this ready", re-measured rather than remembered.

Status: **A complete. Phase B**: B1 to B4 done. **Phase C**: C1 to C5 done. **Phase D**: D1 to D4 done. **Phase E**: E1 to E3 done, wired and verified live. **Phase F**: picture, hyperlink and symbol done and verified live; five entries still refused, each for a reason named below. **View modes**: three of four now change what is on screen, recorded after Phase F.

Every count above was re-measured in a browser on 2026-09-13. `docs/READINESS.md` is the live answer to "is this ready" and was re-measured at the same time. The four defects that sat under the phases - the table column allocation, the `markDirty` trap, the right-click that destroyed a selection and the missing Picture context menu - are closed; see the appendices.

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
| B4 | Table width handles, proportional write, `tblLayout` fixed | **done** |

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

**B4 done.** A table could be resized only by dragging a cell border, which moved
one column and grew the table: the audit measured a 60px drag taking it 623 to
686. The decision was width only, no height handle and no move, so what was
missing was a handle on the table's own outer edges.

`tableWidthEdgeInPage` finds the outer left and right edges of every table on the
page, and `tableEdgeAt` prefers them over a column edge, so the outermost boundary
is the table's and an inner boundary is still the column's. Verified in the
browser: both outer edges report `ew-resize`, and the first cell's right edge
still reports `col-resize`.

The commit is `docier.command.table.setWidth`. It scales every column
proportionally so the grid sums to the width that was dragged, then writes all
three places the width lives - `w:tblW`, every `w:gridCol` and every `w:tcW`,
summing a spanned cell's columns for its own width - and sets `w:tblLayout` to
fixed, without which Word resizes the table again on open.

**The bug the first version had, and the reason the argument exists.** It scaled
the widths declared in `tblGrid`. The sample's table is autofit, so its grid
columns and its real columns are different numbers, and the first drag came back
with the columns **equalised** - measured 62/180/310 becoming 189/189/253 - which
is a table someone would have to fix by hand. The drag now reads the column widths
the layout actually resolved (`TableFragment.columns`, the same authority the
paint uses) and passes them in, so the scale is taken from what the user can see.
With that, the same drag on the same table gives 71/206/355 for a table that grew
551 to 631 pixels, and each column is the same multiple of what it was.

Verified live, in Chromium, against the built demo:

| Check | Measured |
|---|---|
| Outer left and right edges cue a width drag | `ew-resize` on both |
| An inner cell border is still a column edge | `col-resize` |
| The guide follows the pointer and hides on release | present during, hidden after |
| The table grows by the drag | 551 to 631 for an 80px drag |
| Every column keeps its proportion | 62/180/310 to 71/206/355 |
| One commit per gesture | 551 to 611 to 651, undo to 611 by one step |
| Undo stops at the start | a third undo leaves 551 |
| Redo replays both gestures | 611, then 651 |
| The saved file carries the width | `tblLayout fixed`, `tblW 8000 dxa`, grid and cell widths |
| Console and page errors | none |

Not done, recorded rather than implied: there is no table-level width control in
the menu or on the Table tab, so the only way to reach this is the pointer; a
table with no `tblGrid` has nothing to scale from and is refused; the left handle
grows the table to the right, matching Word, so it does not preserve the table's
left edge; and nothing here touches a table inside a header or footer, which the
layout still does not lay out.

## Phase C - The menu surface

| # | Item | State |
|---|---|---|
| C1 | Style the rows, and make items fill the row | **done** |
| C2 | Move the disabled reasons out of the items | **done** |
| C3 | The four behavioural defects in `menu.ts` and `context-menu.ts` | **done** |
| C4 | Wire Cut, Copy, Paste and the table insert rows to the commands that exist | **done, verification blocked** |
| C5 | Fill the menus out to Word's contents | **done** |

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

**C5, the table menu.** Rebuilt in Word's order: Insert Rows, Insert Columns,
Insert Cells, then a single **Delete** submenu holding Delete Rows, Delete
Columns and Delete Table where two separate groupings used to sit, then Select,
Merge Cells, Split Cells, Split Table, Cell Alignment, AutoFit, Distribute
Columns Evenly, Distribute Rows Evenly, Borders and Shading, Text Direction,
Sort, Formula, Repeat Header Rows and Table Properties.

**The Cell Alignment defect, which was the real one.** It was three toggle nodes
with an `openDialog` action and no command, so `active` was always false and the
submenu could never show which position the caret was in. There are nine now, one
command each, `docier.command.table.cellAlign<Vertical><Horizontal>`, and each
reports its own `activeIn` by reading the cell under the caret. Applying one
writes `w:vAlign` on the cell and `w:jc` on its paragraphs together, which is what
Word's nine positions are, and it is one undo entry.

**Four rows the audit called actionable are now real commands** rather than
stubs: Repeat Header Rows (a `w:tblHeader` toggle on the caret row, lit when every
target row carries it), AutoFit Contents, AutoFit Window and Fixed Column Width
(`w:tblLayout` plus the `w:tblW` type each mode needs), and Distribute Columns
Evenly, which reuses the proportional write B4 added.

**The rows that cannot be real are registered refusals, not rows that lie.** Insert
Cells, Split Table, the three Select entries, Borders and Shading, Text Direction,
Sort, Formula, Distribute Rows Evenly and the Table Properties dialog each have a
command whose reason says what specifically is missing. Verified live: each renders
disabled and carries its own sentence, where before Insert Cells, Select and the
rest either did not exist or would have printed a generic refusal.

Table Properties deserves its own line. It named `table.setProperties`, which is a
real command that needs a width or a layout argument, so the row could never enable
and its reason was "This control needs a table property to apply" - true, and
useless to the person reading it. It now names a refusal that says the build has no
table-properties dialog. Cleanup, when a row can never be enabled, is to say so.

**The test that found the last one.** Nothing checked that a menu row names a
command the registry knows, so a row could be written and never resolve.
`menu.test.ts` now walks every node in `CONTEXT_MENUS`, `ALL_RIBBON_TABS` and its
launchers, `FLOATING_CONTROLS`, `BACKSTAGE_ITEMS`, `QUICK_ACCESS` and
`STATUS_ITEM_MENU`, and fails on any command id the registry does not have. Its
first run found `docier.command.clipboard.formatPainter`, which the ribbon's
Clipboard group names and which nothing registered - the exact "row that lies"
the audit predicted, sitting there since C4.

### Phase C verification, live in the browser

| Check | Measured |
|---|---|
| The menu's top-level order | the eighteen rows above, in that order |
| The two delete groupings | one Delete submenu, three rows |
| Rows that are enabled | the eight with real commands behind them |
| Rows that are disabled | ten, each with its own reason, none generic |
| Cell Alignment | nine toggles, exactly one lit, matching the caret's cell |
| Applying one | lit moves to Align Bottom Right, and the model carries it |
| AutoFit | three modes, exactly one lit, matching the table |
| Console and page errors | none |

### A finding that is not a C defect, and belongs to the layout

A cell's text cannot be aligned when its column has no slack. On an autofit table
that is what the column-allocation defect caused, and **that defect is now fixed**
(see appendix A5), so a column has its margins' worth of slack and alignment has
room. The measurement below was taken before the fix and is kept because it is
what showed the alignment arithmetic itself was right. Measured in the engine rather than in pixels: the same command on a
fixed-layout 8000-twip cell moves the ink from 55760 to 228750 millipoints, which
is the exact centre of a 388480-wide content box holding 42500 of text. The
alignment arithmetic is right; the autofit table is simply already tight. This is
the diagnosed column-allocation defect (`cellIntrinsic` in `table-prepare.ts` never
adds `cell.margins`) showing up through a second surface, and it is still open.

## Phase D - Ribbon content design

| # | Item | State |
|---|---|---|
| D1 | The Styles gallery as one scrolling row of preview tiles | **done** |
| D2 | Large buttons for the important commands | **done** |
| D3 | The remaining icons | **done** |
| D4 | Remove the forced ribbon height | **done** |

**D2 done, and D4's deferred question answered.** D4 finished with a ribbon that
fitted its contents and a document that moved 56px whenever the tab changed,
because Home's content genuinely needed more height than the others. This is the
pass that makes the content need the same height everywhere.

**The large variant.** `UiNode` gained `large`, the ribbon renders it as a column:
a 28px glyph with the label beneath, 46px tall, labels kept to one line. It can be
set on a node or on a whole group, which is what "the whole Insert tab" needs.
Applied to Paste, all seven Insert groups, both Design groups, Editing's Find, and
then - going one step past the audit's list - to every group on Layout,
References, Review and View, because the audit's own reasoning is that Word's tabs
are all the same height *because Word's tabs are all designed to need the same
height*, and those four were the ones still at one row.

**What actually held Home at 107px, and it was not the large button.** The
Clipboard and Editing groups were too narrow for their small controls to sit
beside the large one, so Cut, Copy and Format Painter wrapped onto two extra rows
under Paste: measured as a large at y=128, two smalls at 139 and one at 177, which
is 46 + 4 + 26 of controls before the group label. Widening those two groups - by
letting the Styles gallery yield width, since it scrolls its content anyway - put
the smalls back on Paste's line, and Home's tallest group fell from 91px to 70px.

**The second thing that held the tabs apart was a wrapping label.** Groups landed
at 63px or 74px with nothing to explain the difference, and the difference was a
long label like "Set Proofing Language" wrapping onto a second line and adding
eleven pixels. Large labels are now one line with an ellipsis.

**Then uniformity by construction, not by luck.** The group height is a token,
`--docier-ribbon-group-height: 70px`, so every group is the same height whatever
its contents and no tab can drift. Measured live: **every one of the seven
ribbon tabs is 79px**, where before this pass they were 107, 51, 51, 51, 51, 51
and 51. Home came down 28px, the other six came up 28px, and the document no
longer moves at all when the tab changes.

79 is not Word's 84. Word reaches 84 with 32px glyphs and 22px controls where
ours are 28 and 26, and with an adaptive menu that hides controls when the window
is narrow, which this build does not have. Five pixels short of Word, uniform,
nothing clipped and nothing overlapping is the honest place to stop, and it is
strictly better than either of the two states D4 had to choose between.

### Phase D2 verification, live in the browser

| Check | Measured |
|---|---|
| Every ribbon tab | 79px, all seven identical |
| Home, before to after | 107px to 79px |
| The other six, before to after | 51px to 79px |
| Controls clipped by their own box | zero, on every tab |
| The document's position across a tab change | unchanged |
| The large variant | 28px glyph, label beneath, one line |
| Real overlaps on Home | four, all a gallery tile against Editing |

Those four are the **probe artefact the audit already recorded** under D4, not a
regression: `overflow-x: auto` clips the gallery's tiles on screen while they go
on reporting their full bounding rectangles, so a rectangle comparison sees
Title and Subtitle reaching into the Editing group. Confirmed by name this time -
every one of the four pairs has a gallery tile on one side and a Find, Replace or
Select All on the other - and confirmed on screen.

Not done, recorded rather than implied: the large variant does not scale with the
density tokens, so a touch-density chrome keeps 46px large buttons where every
other control grows to 44px; and there is no adaptive behaviour, so a narrow
window still wraps the panel rather than collapsing groups into the dropdowns
Word shows.

## Phase E - Dialogs

| # | Item | State |
|---|---|---|
| E1 | A dialog surface | **done** |
| E2 | The Font dialog | **done** |
| E3 | The Paragraph dialog | **done** |

### Phase E notes

**E1 done.** `src/ui/dialog.ts` is the surface: a modal overlay at z-index 1400 in
the chrome portal, a titled `role="dialog"` box at 430px, a tab strip, scrolling
panels, an optional preview band, and a footer with a live status region, OK and
Cancel. It traps Tab and Shift+Tab, closes on Escape, applies on Enter from any
control that is not a button or a textarea, refuses to close on an overlay click,
and returns focus to whatever opened it. `openEditorDialog` keeps one dialog per
`ChromeContext` in a `WeakMap`, so opening a second dialog replaces the first
instead of stacking them.

**E2 done.** `src/ui/font-dialog.ts`, in Word's two tabs. **Font** carries the
family (with a datalist of twelve families), the size, the four style
check boxes, and the colour with an Automatic box; **Advanced** carries the
position and the two effect boxes. The preview band renders the sample in the
family, size, weight, slant, decoration, position and colour the controls
currently hold, and names them beside it, live on every `input` and `change`.

Apply is a difference, not a write: the dialog reads the state on open, compares
the controls against it on OK, and issues only the commands that moved. The whole
apply is one transaction under `docier.dialog.font`, so a Font dialog edit is one
undo entry. Colour is compared through `colourOf`, so `automatic` and a hex that
happens to be the same colour do not produce a spurious write. If the family
cannot be set, the dialog renders honestly disabled with the command's own reason
in the status region rather than accepting an edit it cannot make.

**E3 done.** `src/ui/paragraph-dialog.ts`: alignment, the three indent fields in
the document's ruler unit, the hanging indent derived so it and the first-line
value cannot contradict each other, space before and after in points, and line
spacing. Same difference-apply rule, one transaction under
`docier.dialog.paragraph`.

**The wiring, which is what made them reachable.** Every `openDialog` in the menu
model landed on one stub that printed `is not available yet`, so the Font and
Paragraph dialogs existed and nothing could open them. `dialogNameFor` now maps
the dialog names the chrome publishes - `font`, `paragraph`, and the formatting
command ids that Word routes to them - onto the dialogs that exist, and
`chrome.ts` opens the mapped one. Anything unmapped still gets the honest
message, which is what keeps `styles`, `pageSetup` and the rest from lying.

`context.invoke` takes the control element as an optional second argument now, so
a dialog opens anchored under the control that asked for it - the ribbon's group
launcher passes itself and the dialog lands 6px below it, Word's placement. The
`dialogs` chrome slot is honoured if the host claimed it.

Ctrl+D opens the Font dialog, skipped while a field has focus and while a dialog
is already open.

### Phase E verification, live in the browser

Built the demo, served it, and drove the real chrome with Playwright. No console
or page errors in any of it.

| Check | Measured |
|---|---|
| Font dialog opens from the ribbon's Font group launcher | yes, `role="dialog"`, `aria-modal="true"` |
| Anchored under the launcher | dx = 0, dy = 6px below it |
| Focus on open | the first tab button, inside the dialog |
| Tab and Shift+Tab | cycle within the dialog, 14 stops forward, 3 back |
| Preview follows the controls | family Georgia, size 22pt, weight 700, sample `AaBbCc 123` |
| Applying reaches the document | run font-family `"DejaVu Sans"` to `Georgia`, size 21.33px to 29.33px |
| One undo entry | the transaction key is the dialog's |
| Ctrl+D reopens, prefilled | yes, Georgia and 22 |
| Escape closes | yes; focus returns to the launcher |
| Paragraph dialog, alignment | run moved x=239 to x=402 on Center |
| Paragraph dialog re-read | reopens showing `center` |
| An unmapped dialog stays honest | clicking Styles opens nothing and announces it |

Not done, recorded rather than implied: the Paragraph dialog has **no tabs**,
where Word's has Indents and Spacing plus Line and Page Breaks, and the audit
names tabs only for the surface and the Font dialog. Ctrl+D returns focus to the
launcher rather than to the document, which is the accessible pattern but not
Word's. Every other `openDialog` target - Styles, Page Setup, Quick Access,
Customize Ribbon, Diagnostics, the numbering dialogs, the table cell alignments -
still announces that it is not available.

## Phase F - The refused commands

| # | Item | State |
|---|---|---|
| F1 | Insert a picture | **done** |
| F2 | Hyperlink | **done, no on-screen link affordance** |
| F3 | Comments | **refused, with the reason named** |
| F4 | Symbol | **done** |
| F4 | Footnote, header creation, text box, table of contents | **refused, with the reason named** |

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

**D3 done.** Measured on the build: **97 of the 103 visible ribbon buttons carry a
glyph**, and the six that do not are the group launchers - the small chevron in a
group's label - which is what Word has there too, so that is the whole count and
not a remainder.

The first pass added 23 glyphs for the commands the menus reference through
`command('...')` and missed the ones they declare through `pending(name, ...)`,
whose key is a bare name rather than a command id. The second pass drew the rest:
the Insert tab's pages, tables, illustrations, links, headers, numbers, text boxes,
symbols and the four reference builders; Design's fonts, colours, spacing and page
furniture; the object z-order, align and group commands; the proofing and comment
commands; and the accept/reject pair.

Where an icon key already existed the second pass reused it rather than adding a
near-duplicate drawing, so several `pending(name, ...)` entries now resolve through
an alias to a glyph that was already drawn.

Pinned by a census test rather than by the number in this file: `ribbon.test.ts`
walks every button and toggle in `ALL_RIBBON_TABS`, fails on any without a glyph,
and asserts the group launchers have none. A keyboard-only count would have been
easy to leave half true; the walk covers the tabs a person cannot click.

Not done, and belonging to D2 rather than here: the glyphs are all drawn on the
same 16-unit grid, and there are no 32px variants yet, because the large-button
variant that would use them does not exist.

## View modes, closed after Phase F

`READINESS.md` named three view modes writing a state nothing read as the largest
gap between the build and its own bar, and it was a smaller piece of work than any
of the five refusals left in Phase F, so it is closed here.

**What a paint-only renderer can honestly do about a view mode.** Word's Draft view
re-flows the text to the window, which is a *layout* change, and D2 says the engine
owns layout and the DOM only paints. So the four modes are divided by what they
change:

| Mode | What changes |
|---|---|
| Print Layout | nothing; this is the framed, paged view |
| Read Mode | the chrome: ribbon and rulers hidden, document moves up 99px |
| Web Layout | the paint: no page gap, no paper frame, one continuous column |
| Draft | the same as Web Layout, and see below |

The flowing modes paint each sheet with a transparent background and no shadow and
place the sheets end to end, so the document reads as one column instead of a
stack of paper. Verified live in Chromium: the sheet's computed `box-shadow` is
`none` and its background is transparent under Web Layout and Draft, and present
under Print Layout and Read Mode.

**Draft and Web Layout render the same, and that is stated rather than papered
over.** Word distinguishes them by re-flowing Draft to the window and dropping the
margins, which needs a layout pass with a different content box. This build could
do that - the engine takes the section's page size - but it would mean the paint
layer asking for a second layout, and the whole reason this library exists is that
nothing but the engine lays text out. Doing it properly is a layout feature rather
than a view mode: the engine would need a "flow to width" option and a
re-pagination rule, and until it has one, the honest paint-only difference is the
one above.

**The paint contract caught the first attempt.** The initial implementation set
`border: 0` on the sheet to remove its frame, and `assertPaintOnly` rejected it:
`border` participates in layout, so the renderer may not emit it. The frame is a
background and a shadow, so dropping those two is both sufficient and legal. The
guard is the D2 property working exactly as intended, in a place nobody was
looking for it.

The mode is stamped on the surface as `data-docier-view-mode`, so a host can style
against it and a probe can read it, and `renderDocument` takes it as an option with
`print` as the default.

## Phase F notes

The phase's own framing is the test: each of these refused "with a reason today,
which is honest but is still a document that cannot be produced". Three of the
eight can now be produced. Five cannot, and the section below says what each one
actually needs rather than restating that it is unavailable.

### F1 done: a picture

The command `docier.command.object.insertImage` takes bytes the host supplies and
does the whole job: it writes the media part, the relationship and the
`w:drawing`, and it works in a header or footer only where the layout places one,
refusing otherwise.

**The undo snapshot was the blocker, and the audit was right about why.** Undo
runs the stored closure rather than the commit hooks, so a part created by an
insert has to be inside the snapshot or it survives the undo as an orphan. The
snapshot now carries media: each part's name, content type and bytes.

Two things about that are worth keeping. The bytes are taken through
`Part.toBytes()`, which returns the array without copying when the part is already
materialised and throws when it is not - a part still sitting undecoded in the
archive stays a name with no bytes, and those are exactly the parts an edit never
removed, so the throw is caught and the entry is names-only. And restore puts a
part back **under its original name** rather than allocating a fresh one, which is
the difference between a redo that works and a redo that leaves the document
pointing at a relationship whose target no longer exists.

`DocxPackage.addMediaPart` was asynchronous because its dedupe path awaits part
bytes. `addMediaPartNow` is the synchronous twin, with the same digest-and-compare
dedupe over the parts whose bytes are already in hand: inserting the same picture
twice gives one part, two different pictures give two.

The chrome side is a real file picker: `object.insertImage` is an `openDialog`
target that opens a hidden `<input type="file" accept="image/*">`, reads the
bytes, measures the picture's natural size and fits it to six centimetres wide
keeping the ratio, falling back to a default when the browser cannot decode it.

### F2 done, with a gap recorded rather than glossed

The command and the relationship plumbing already existed; what was missing was
any way to supply an address, so the row rendered disabled forever. There is now
an Insert Hyperlink dialog: address, text to display and screen tip, with Insert
gated on the address and the fields left typable while it is gated. Applying
writes the `w:hyperlink` with the relationship, the text and the tooltip, and
applies Word's `Hyperlink` run style so a document that defines that style shows
the link as one.

**The gap.** Nothing in the layout or the renderer knows what a hyperlink is:
there is no `data-docier-hyperlink` node, no pointer cue, and no way to open one.
A hyperlink renders as its own characters - styled if the document defines the
`Hyperlink` style and plain text if it does not - and it is only a link in the
file and in Word. That is recorded here rather than fixed, because a click target
and a Ctrl+click to open are a different piece of work from producing the markup,
and the acceptance this phase was written against is that the document can be
produced.

### F4, symbol: done, and a real bug fixed on the way

`docier.command.insert.symbol` writes `w:sym`, and it always wrote `w:char` as the
**literal character** it was handed. `w:char` is a hexadecimal code point, so a
caller passing `§` produced `w:char="§"`, which is not a symbol Word can resolve.
It now reads `char` as a character and `codePoint` as a number, and converts to
the four-digit hex both need. The old test that pinned the literal-hex reading was
written against the bug and now pins the two correct forms.

The dialog is a 52-symbol palette in five groups - legal marks, currency,
punctuation, mathematics, arrows and shapes - each button named for assistive
technology, and clicking one inserts it and closes. It is small on purpose: this
is a convenience palette for the symbols a contract actually uses, not Word's
character map with its font browser.

### The five that are still refused, and what each actually needs

Every one of these now carries a reason that names its own missing machinery
rather than a generic refusal, which is the state the phase asked for.

| Command | What it needs |
|---|---|
| Comments | A `word/comments.xml` part, a comments part type and content type, a relationship per comment, `w:commentReference` and `w:commentRangeStart/End` runs, and a surface to read them in. The editing layer creates no part of its own except media, and none of the layout or the chrome knows a comment exists. |
| Footnote | A `word/footnotes.xml` part, the `w:footnoteReference` run, and **footnote layout**: the note area has to be measured, reserved at the foot of the page and paginated against, which is a second page-fitting pass this build does not have. |
| Header creation | The document may only be edited through parts it already has. Creating one means a new `word/headerN.xml`, its content type, its relationship and the `w:headerReference` in the section - and then the region has to accept a first paragraph, which `region.ts` refuses today by design. The undo snapshot would need to cover arbitrary parts rather than the media parts it now covers. |
| Text box | A drawing with a text body: `wps:wsp` inside a `wps:txbx`, whose content is a whole nested story. This build authors exactly one kind of drawing, a picture from host bytes. |
| Table of contents | Field evaluation. A TOC is a `TOC` field whose result is generated by walking the headings, and this build substitutes `PAGE`, `NUMPAGES`, `SECTION` and `SECTIONPAGES` before measuring but evaluates nothing that depends on the document's structure. |

Each of these is a subsystem rather than a command. Recording them as such is the
honest end of this phase: the ones that were a command's worth of work are done
and verified, and the ones that are not are named with what they would take.

### Phase F verification, live in the browser

| Check | Measured |
|---|---|
| The Insert tab's Picture opens a file picker | yes, a real `input[type=file]` |
| Inserting a 40x40 PNG | one `data-docier-image` rendered, zero placeholders |
| The size it lands at | 40x40 pixels, from the picture's own dimensions |
| Undo | the picture goes and the media part with it |
| Redo | the picture comes back, rendered, not a placeholder |
| The hyperlink dialog | opens from the Link row, three fields, Insert gated on the address |
| Applying it | the address, the text and the tooltip are written |
| The symbol dialog | 52 buttons, each with its name |
| Clicking Section | `§` lands in the paragraph at the caret |
| Console and page errors | none, in any of it |

## Appendices

Findings that belong to a phase other than the one being worked on. Each says
which phase owns it.

### A1. Right-clicking inside a selection collapses it - CLOSED

**Fixed.** `onPointerDown` returns before touching the caret when the button is
not the primary one and the point is inside the selection, so a right-click inside
a selection leaves it alone.

Verified the way the finding was written - by the user path rather than by
inspecting the handler. Select eight characters, right-click inside the
selection, click Copy in the context menu, click past the end and press Ctrl+V:
the paragraph goes from `docier demo document` to
`docier demo documentocier de`, so the selection survived the right-click and the
menu's Copy read it. **C4's blocked verification is unblocked.**

The original text follows.

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

### A2. The context menu has no Picture surface for an unresolvable image - CLOSED

**Fixed.** The selector was `img,[data-docier-image]`, which never matched the
missing-image wrapper. It now reads
`img,[data-docier-image],[data-docier-image-missing],[data-docier-object]`, so a
picture with no bytes, a picture with bytes and the object wrapper the overlay
draws all route to the Picture menu. Pinned by a test over the four attributes, and
by one that a cell containing a picture takes the picture surface rather than the
table's.

The original text follows.

Owner: **Phase C**. `SURFACE_ATLAS` (`src/ui/context-menu.ts:18`) detects an image
surface with `img,[data-docier-image]`, which never matches the wrapper the
missing-image path produces, because that carries `data-docier-image-missing`. An
image with no bytes therefore gets the ordinary text menu. Adding
`[data-docier-object]` to the selector fixes it. B2 removed the missing-image case
from the demo by supplying the bytes, so this now only bites a host that does not.

### A3. The committed tree did not typecheck its own tests, and CI could not have said so

Owner: **nothing; fixed here.** Found while verifying Phase E.

`npx tsc -p tsconfig.test.json` fails at `HEAD`, not because of anything Phase E
did. B3 added `objectId` to `ObjectPlacement` (`src/layout/types.ts:93`) and the
layout populates it, but left two test fixtures building the old shape:
`test/render/contract.test.ts` (three object literals) and
`test/render/images.test.ts:102` (the `imageBoxOf` fallback argument). Proved by
extracting the committed tree with `git archive HEAD` and running the test
typecheck against it: four `TS2345`s, all `objectId is missing`.

Fixed by giving each fixture an `objectId`. The suite is unchanged by it, which
is the point - the fixtures only exercise geometry.

**The part worth keeping is why nothing noticed.** My first account of this said
CI had been red since B3. That was wrong, and checking it took one command: CI
does not run the test typecheck at all. `npm run typecheck` is `tsc -b --noEmit`
against `tsconfig.json`, whose `include` is `["src"]`, so the step covers the
library and never the tests. Vitest transpiles without typechecking, so the same
holds for `npm test`. The failure was invisible to the whole pipeline and to the
verification loop in `agent_progress.md`, which lists
`npx tsc --noEmit -p tsconfig.test.json` as a step and then claims CI runs the
same thing on every push.

So the fix is in two places, not one: the fixtures, and a `Typecheck tests` step
in `.github/workflows/ci.yml` running the `typecheck:test` script that already
existed and was never called. A verification step that only a person remembers to
run is the step that stops being run.

### A4. A test passed a source the event bus does not accept

Owner: **nothing; fixed here.** `test/ui/paragraph-dialog.test.ts` called
`handle.commands.execute(..., { source: 'test' })` twice, and `EventSource`
(`src/api/types.ts:22`) is `'ui' | 'api' | 'undo' | 'collab' | 'auto' | 'plugin'`.
Vitest did not care, because the type error is invisible at runtime; the test
typecheck did. Changed to `'api'`, which is what the test is actually doing -
driving the editor through its public surface.

### A5. The table column defect, closed - the one open since the audit began

**Fixed and verified.** The diagnosis in `agent_progress.md` was right in every
particular: `cellIntrinsic` derived a cell's minimum and preferred widths from its
paragraphs alone, while `contentWidth` at the other end of the same comparison was
a **box** width with the cell's margins and border halves already subtracted. So a
column could be allocated less than its own content plus its padding, and the text
overflowed into the next cell.

The fix adds `cell.margins.left + cell.margins.right` and the two border halves to
both figures, so the requirement and the comparison are in the same units.

The four expectations the previous attempt could not re-derive are now derived
rather than observed. Each moves by exactly `DEFAULT_CELL_MARGIN_MP * 2`, the
5760-millipoint default margin on each side, and the test says so:

| Case | Before | After | What it is |
|---|---|---|---|
| preferred fits | 20000 | 31520 | preferred content 20000 + 11520 padding |
| shrunk | 17500 | 21520 | minimum content 10000 + 11520 padding |
| one frozen | 20000, 15000 | 31520, 21520 | preferred and minimum, each plus padding |
| target too small | 20000 | 31520 | the floor, with `tableOverflow` still reported |

Verified in the browser against the document the audit measured: the sample's
first column is **77.4px** where the diagnosis asked for 78, its `Column` heading
needs 62px, and **no cell in the header row spills its text** - where before the
column was 62px and the heading printed as "ColumnEvidence".

Two tests guard it rather than the four numbers: every column in five fixtures
holds the same floor however small the declared table width is, and one asserts
the floor is content plus padding by name.

### A6. The `markDirty` trap, closed

**Fixed.** `Part.markDirty()` set a dirty flag that `writePlan()` never consulted:
a part whose content was still `original` went down the passthrough path, so
marking an unread part dirty marked nothing and the part saved as its original
bytes. A caller could believe it had edited a part and find the file unchanged -
the same shape as the Phase 1 bug that silently dropped every model edit.

It now throws `PART_NOT_READ` when the part was never read, because in that state
there is nothing to write and the only honest outcomes are an error at the call
site or a lie at save time. The three existing callers all `await part.document()`
first, so none of them changed behaviour. A new error code rather than reusing
`PART_NOT_FOUND`: the part exists, it has simply never been materialised.

### A7. A full `vitest run` failed 531 tests once, and passed on a re-run

Owner: **whoever next sees a red suite and reaches for `git bisect`.** Recorded so
it is not chased. One invocation of `npx vitest run` - both projects, while a
vite preview server and a Playwright browser were also running - failed 42 files
with `Not implemented: HTMLCanvasElement.prototype.getContext` out of the
divergence detector. Run separately the same two projects passed 810 and 555, and
the next combined run passed 1365. Treat a sudden mass failure with that canvas
error as resource contention, not a regression, and re-run before believing it.

