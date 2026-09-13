# Is docier ready to be fully used?

Short answer: **no, but the editing core is.** This document says what was
verified, how, and what stands between the current state and a tool someone could
use for real work. It is written to be checked, not believed.

## How this was measured

Everything below comes from driving the built product in a real browser
(Chromium, 1600x1000) against the local build of `example/`, not from reading the
source or trusting a unit test. Commands that appear as quotations are real
output.

## Verified working

| Path | What was measured |
|---|---|
| Typing | Text typed at the caret lands in the model, at the position clicked |
| Undo and redo | An edit disappears on Ctrl+Z and returns on Ctrl+Y |
| Copy and paste inside the editor | A selection copied with Ctrl+C pastes back into the body |
| Paste from the operating system | Text written to the system clipboard pastes into the body |
| Ctrl+End | Lands at the end of the **body** story, not in the footer |
| Save | `document.save()` produces 8044 bytes for the sample |
| Round trip | An edit survives save and re-load of the saved bytes |
| Tables | Inserting a row through the command surface adds a row |
| Table borders | Paint as 48 edge bands on a fixture whose borders come from a table style |
| Caret | Blinks, follows a click, follows the arrow keys, and scrolls into view |
| Selection | Painted from a drag, from shift+arrow, from select-all and from a double-click |
| Column and row resize | Dragging a border resizes and commits once |
| PDF export | 47KB with three subset fonts embedded, in 26ms |
| Divergence detection | Reports zero divergences on a correct document |

Console errors across those runs: none.

## What is missing, in the order it blocks real use

1. **There are no dialogs.** Font and Paragraph both route to a stub, so the two
   most expected dialogs in a word processor do not exist. Everything they would
   offer has to be reached through the ribbon instead, and some of it cannot be
   reached at all.
2. **Eight commands refuse.** Image, footnote, header creation, hyperlink,
   symbol, text box, table of contents and comments each return `blocked` with a
   reason rather than failing. A document that needs any of them cannot be
   produced.
3. **Sixty-three ribbon controls are still text words** where Word uses icons, on
   the Insert, Design, Layout, References, Review and View tabs. The Home tab was
   done.
4. **The ribbon is 112px where Word's is 84.** The cause is measured: the Styles
   gallery needs three or four rows because its columns follow its width, and the
   Font group needs two.
5. **The four view-mode buttons write a state nothing reads.** Print Layout, Web
   Layout, Draft and Read Mode render identically.
6. **Comments and media are outside the transaction snapshot**, which is why
   those command areas refuse rather than half-work.

Not on that list, and worth saying: the *look* is now close. The light theme
matches Word's palette, the ribbon holds a uniform height, the title bar and
quick access toolbar are in place, and the status bar and rulers read like
Word's.

## Three false negatives worth not repeating

Each of these was a probe of mine reporting breakage that was not there. They
cost real time, and the next person should be spared them.

- **Ctrl+I and Ctrl+U looked dead.** They change no text and no caret position,
  so a snapshot of text and selection could not see them. Measured against the
  rendered font style, both work.
- **Copy and paste looked broken.** The probe read body text while the paste had
  landed at the end of the document, and the check compared the wrong thing.
  Measured directly, both directions work.
- **The Font group looked like three rows.** The probe counted the combos' inner
  inputs as items on their own row. Measured by element top, it is two rows.

The pattern: a probe that measures a *subset* of the state, followed by reading
absence in that subset as breakage. Prefer measuring the thing itself.

## The verdict

The engine and the editing surface are usable. What is missing is authoring
breadth: dialogs, the eight refused commands, and the remaining icons. A person
could open a document, edit it, format it, save it and export it today. They
could not write a document from scratch that needs a picture, a link or a
comment, and they would notice the missing Font dialog within a minute.

Ready, in the honest sense, means: no dialogs missing, no refused commands on the
Insert tab, view modes that change the view, and the ribbon at Word's height.
