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

**Re-measured 2026-09-13.** Of the six items, three are closed and three are
partly closed. The numbers are what the built product does now, and the phase work behind
them is recorded in `docs/UI-PROGRESS.md`. The original six are kept in their
original order, struck through where they are done, so this still reads as a
diff against the state it was written in.

1. ~~**There are no dialogs.**~~ **Closed.** Font, Paragraph, Hyperlink and Symbol
   each open, apply and close, and the picture command opens a real file picker.
   What is still absent is a Table Properties dialog and a Page Setup dialog, and
   both are registered refusals whose reason says so rather than stubs.

2. **Three of the eight refused commands are now producible.** Picture, hyperlink
   and symbol work, verified in the browser: a 40x40 PNG inserts as a rendered
   image at 40x40 and survives undo and redo, a hyperlink writes its address, its
   text and its tooltip, and a symbol inserts at the caret. **Five still refuse** -
   comments, footnote, header creation, text box and table of contents - and
   `UI-PROGRESS.md` names for each the subsystem it would need rather than
   restating that it is unavailable.

3. ~~**Sixty-three ribbon controls are still text words.**~~ **Closed.** 97 of the
   103 visible ribbon buttons carry a glyph. The six that do not are the group
   launchers, which is what Word has there.

4. ~~**The ribbon is 112px where Word's is 84.**~~ **Closed.** Every one of the
   seven tabs is **79px**, measured live, uniform, with nothing clipped and no
   control overlapping. The five pixels to Word are 28px glyphs over 26px controls
   against Word's 32 over 22, plus Word's adaptive menu, which this build has no
   equivalent of.

5. **Three view modes write a state nothing reads.** Print Layout, Web Layout and
   Draft render identically - measured: the ribbon is 79px, the ruler is shown and
   the canvas sits at 223px in all three. Read Mode does something real: it hides
   the ribbon and the ruler and the document moves up to 124px. **This is now the
   largest gap on the list.**

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

What they cannot yet do is write a contract that needs a footnote, a table of
contents, a text box or a comment, and three of the four view modes still change
nothing on screen. The five refused commands are subsystems rather than features,
and the honest statement is that they are not in this build.

Ready, in the honest sense, means: nothing on the Insert tab refusing, view modes
that change the view, and the ribbon at Word's height. The ribbon is within five
pixels of it and the Insert tab is down to five refusals from eight, each of them a
subsystem rather than a command. **View modes are what now stands between this and
the bar this document set for itself** - three of the four write a state nothing
reads, and that is a smaller piece of work than any of the five remaining
refusals.
