# Phase progress

Working record for `docs/UI-AUDIT.md` (behaviour) and `docs/WORD-UI.md`
(appearance). Each phase is ticked off as it is done, with what was verified and
how. Findings that turn up along the way go in the appendices at the end and are
addressed when the phase that owns them is reached.

Status: **Phase A in progress**, four of its nine items done.

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

## Phase A - The editor must accept input, and formatting must work

| # | Item | State |
|---|---|---|
| A1 | Focus on mount, so `autoFocus` stops being dead code | **done** |
| A2 | Ribbon and status-bar controls must not steal focus | **done** |
| A3 | Ctrl+A must not produce an uneditable selection, and a click inside a selection must collapse it | to do |
| A4 | Range formatting: the stale-cache fix in `splitBoundary` | to do |
| A5 | Range formatting: the run-at-the-caret convention in `insertionPoint` | to do |
| A6 | Caret: shift the region stops so a header or footer caret is where its text is | to do |
| A7 | Caret: reveal on zoom | **done** |
| A8 | Caret: reset the blink phase on input | **done** |
| A9 | Caret: stop `scrollCaretIntoView` locking itself out | to do |

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
