# Phase progress

Working record for `docs/UI-AUDIT.md` (behaviour) and `docs/WORD-UI.md`
(appearance). Each phase is ticked off as it is done, with what was verified and
how. Findings that turn up along the way go in the appendices at the end and are
addressed when the phase that owns them is reached.

Status: **Phase A complete.** Phase B next.

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
| B1 | Delete `startDrag`, give the indent markers the margin interaction, clamp negative indents | to do |
| B2 | Make pictures visible at all, by giving the renderer the media parts | to do |
| B3 | Object selection and resize handles for inline pictures | to do |
| B4 | Table width handles, proportional write, `tblLayout` fixed | to do |

## Phase C - The menu surface

| # | Item | State |
|---|---|---|
| C1 | Style the rows, and make items fill the row | to do |
| C2 | Move the disabled reasons out of the items | to do |
| C3 | The four behavioural defects in `menu.ts` and `context-menu.ts` | to do |
| C4 | Wire Cut, Copy, Paste and the table insert rows to the commands that exist | to do |
| C5 | Fill the menus out to Word's contents | to do |

## Phase D - Ribbon content design

| # | Item | State |
|---|---|---|
| D1 | The Styles gallery as one scrolling row of preview tiles | to do |
| D2 | Large buttons for the important commands | to do |
| D3 | The remaining 63 icons | to do |
| D4 | Remove the forced ribbon height | to do |

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

## Appendices

Findings that belong to a phase other than the one being worked on. Each says
which phase owns it.

*(none yet)*
