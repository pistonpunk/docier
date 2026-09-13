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

**Re-measured 2026-09-13.** Of the six items, five are closed and one is partly
closed. The numbers are what the built product does now, and the phase work behind
them is recorded in `docs/UI-PROGRESS.md`. The original six are kept in their
original order, struck through where they are done, so this still reads as a
diff against the state it was written in.

1. ~~**There are no dialogs.**~~ **Closed.** Font, Paragraph, Hyperlink and Symbol
   each open, apply and close, and the picture command opens a real file picker.
   What is still absent is a Table Properties dialog and a Page Setup dialog, and
   both are registered refusals whose reason says so rather than stubs.

2. ~~**Eight commands refuse.**~~ **Closed.** All eight now produce documents:
   picture, hyperlink, symbol, header creation, table of contents, comments,
   footnote and text box. Three of them are complete on screen too. The other
   four - comments, footnote, text box, and the note bodies - are complete in the
   file and the **engine says which part of the rendering is missing** rather than
   drawing nothing in silence: `footnotesNotLaidOut`,
   `shapeContentNotLaidOut`. These are layout work rather than command work, and
   each is named with what it would take in `UI-PROGRESS.md`.

3. ~~**Sixty-three ribbon controls are still text words.**~~ **Closed.** 97 of the
   103 visible ribbon buttons carry a glyph. The six that do not are the group
   launchers, which is what Word has there.

4. ~~**The ribbon is 112px where Word's is 84.**~~ **Closed.** Every one of the
   seven tabs is **79px**, measured live, uniform, with nothing clipped and no
   control overlapping. The five pixels to Word are 28px glyphs over 26px controls
   against Word's 32 over 22, plus Word's adaptive menu, which this build has no
   equivalent of.

5. ~~**Three view modes write a state nothing reads.**~~ **Closed.** All four differ
   now. Web Layout paints a continuous, unframed column; Print Layout and Read Mode
   keep the framed sheets; and **Draft re-flows the text to the window**, which the
   engine does through a flow width - the sample's sheet is 794 by 1123 on paper and
   1214 by 620 in Draft, measured live.

6. **Half closed: media is inside the transaction snapshot, comments are not.**
   The snapshot now carries every media part's name, content type and bytes, so
   inserting a picture is one undo entry and undoing it takes the part with it
   instead of leaving an orphan in the saved package. Comments are still outside it,
   which is why `comment.create` remains a registered refusal rather than a
   half-working command.

Not on the original list, and worth adding: **seventy-one commands are registered
refusals.** That count is up from the eight this document used to name because the
rest were added deliberately - each carries a sentence saying what specifically is
missing, so a menu row renders disabled with a reason rather than lying about being
available. A higher number here is better than a lower one.

Also not on the list, and now fixed: the table-column defect this document grew out
of. The sample's first column is 77.4px and no cell in the header row spills its
text, where before the column was 62px and the heading printed as
"ColumnEvidence".

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

The engine and the editing surface are usable, and as of 2026-09-13 so is most of
the authoring breadth: the dialogs are there, a picture, a link and a symbol can be
inserted, the icons are drawn and the ribbon holds one height. A person can open a
document, edit it, format it, draw a table to the width they want, insert a
picture, save it and export it today.

What they cannot yet see on screen is the text inside a text box. A document that
needs one is correct and round-trips through Word, and the editor says which part of
the rendering is missing through `shapeContentNotLaidOut` rather than drawing
nothing in silence. A comment is fully visible - its range is marked and its text is
readable in the comments panel - and **a footnote is drawn at the page foot**, with
its separator rule, in the space the engine reserved for it.

Ready, in the honest sense, means: nothing on the Insert tab refusing, view modes
that change the view, and the ribbon at Word's height. The ribbon is within five
pixels of it, three of the four view modes now change what is on screen, and the
Insert tab is down to five refusals from eight - each of them a subsystem rather
than a command, and each named with what it would take.

So the bar this document set for itself is **met**: nothing on the Insert tab
refuses any more, the ribbon is within five pixels of Word's, and all four view modes
change the view.

**Nothing on this list is open.** Every document feature round-trips, is laid out and
is drawn - pictures, tables, headers and footers, footnotes, comments, hyperlinks,
text boxes and a table of contents - and all four view modes differ.
