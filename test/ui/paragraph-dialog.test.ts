import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { ParagraphProperties } from '../../src/model/index.js';
import { formatUnitValue, unitToTwips } from '../../src/ui/dialog.js';
import type { ParagraphDialogHandle } from '../../src/ui/paragraph-dialog.js';
import { createParagraphDialog } from '../../src/ui/paragraph-dialog.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import { bodyOf, chromeOf, click, disposeChromes, paragraphText } from './support.js';

const dialogs: ParagraphDialogHandle[] = [];

afterEach(() => {
  while (dialogs.length > 0) dialogs.pop()?.dispose();
  disposeChromes();
  document.body.innerHTML = '';
});

interface Executed {
  readonly commandId: string;
  readonly args: Record<string, unknown>;
}

const recordCommands = (handle: EditorHandle): Executed[] => {
  const seen: Executed[] = [];
  handle.events.on('docier:command:execute', (event) => {
    seen.push({ commandId: event.commandId, args: event.args as Record<string, unknown> });
  });
  return seen;
};

const portalOf = (): HTMLElement => {
  const portal = document.querySelector<HTMLElement>('[data-docier-portal]');
  expect(portal, 'portal').not.toBeNull();
  return portal!;
};

const field = (dialog: ParagraphDialogHandle, id: string): HTMLInputElement => {
  const node = dialog.element.querySelector<HTMLInputElement>(`#${id}`);
  expect(node, id).not.toBeNull();
  return node!;
};

const select = (dialog: ParagraphDialogHandle, id: string): HTMLSelectElement => {
  const node = dialog.element.querySelector<HTMLSelectElement>(`#${id}`);
  expect(node, id).not.toBeNull();
  return node!;
};

const openParagraph = (
  chrome: ChromeHandle,
  readValue?: (key: string) => string | undefined,
): ParagraphDialogHandle => {
  const dialog = createParagraphDialog({
    context: chrome.context,
    mount: portalOf(),
    readValue,
  });
  dialogs.push(dialog);
  dialog.open();
  return dialog;
};

const indentationOf = (
  handle: EditorHandle,
  index = 0,
): { readonly left: number | undefined; readonly firstLine: number | undefined; readonly right: number | undefined } => {
  const slot = handle.session?.slots()[index];
  if (slot === undefined) throw new Error('no slot');
  const indentation = ParagraphProperties.inOwner(slot.element).indentation;
  return {
    left: indentation.left as number | undefined,
    firstLine: indentation.firstLine as number | undefined,
    right: indentation.right as number | undefined,
  };
};

const justificationOf = (handle: EditorHandle, index = 0): unknown => {
  const slot = handle.session?.slots()[index];
  if (slot === undefined) throw new Error('no slot');
  return ParagraphProperties.inOwner(slot.element).justification;
};

const keydown = (target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('the paragraph dialog', () => {
  it('renders a labelled control for every paragraph property it applies', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const unit = chrome.context.state.units;
    const dialog = openParagraph(chrome);

    expect(dialog.name).toBe('paragraph');
    const labels = [...dialog.element.querySelectorAll('label')].map((label) => label.textContent);
    for (const name of ['Left indent', 'Right indent', 'First line indent', 'Hanging indent']) {
      expect(labels).toContain(`${name} (${unit})`);
    }
    expect(labels).toContain('Space Before (pt)');
    expect(labels).toContain('Space After (pt)');
    expect(labels).toContain('Line and Paragraph Spacing');

    const alignment = select(dialog, 'docier-paragraph-alignment');
    expect([...alignment.options].map((option) => option.value)).toEqual([
      'left',
      'center',
      'right',
      'both',
    ]);
    expect(alignment.value).toBe('left');

    for (const id of ['docier-paragraph-left', 'docier-paragraph-right']) {
      expect(field(dialog, id).type).toBe('number');
    }
    for (const id of ['docier-paragraph-first-line', 'docier-paragraph-hanging']) {
      expect(field(dialog, id).type).toBe('number');
    }
    for (const id of [
      'docier-paragraph-before',
      'docier-paragraph-after',
      'docier-paragraph-line-spacing',
    ]) {
      expect(dialog.element.querySelector(`#${id}`), id).not.toBeNull();
    }

    const group = (key: string): HTMLElement | null =>
      dialog.element.querySelector<HTMLElement>(`[data-docier-dialog-group="${key}"]`);
    expect(group('indentation')).not.toBeNull();
    expect(group('spacing')).not.toBeNull();
  });

  it('applies the alignment, the indents and the spacing through the command surface', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const unit = chrome.context.state.units;
    const dialog = openParagraph(chrome);

    select(dialog, 'docier-paragraph-alignment').value = 'center';
    field(dialog, 'docier-paragraph-left').value = '1';
    field(dialog, 'docier-paragraph-right').value = '0.5';
    field(dialog, 'docier-paragraph-first-line').value = '0.25';
    field(dialog, 'docier-paragraph-before').value = '6';
    field(dialog, 'docier-paragraph-after').value = '12';
    select(dialog, 'docier-paragraph-line-spacing').value = '2';
    click(dialog.applyButton);
    await handle.whenReady();

    expect(seen.map((entry) => entry.commandId)).toEqual([
      'docier.command.format.alignCenter',
      'docier.command.format.setParagraphIndent',
      'docier.command.format.setSpaceBefore',
      'docier.command.format.setSpaceAfter',
      'docier.command.format.setLineSpacing',
    ]);
    expect(seen[1]?.args).toEqual({
      leftTwips: unitToTwips(1, unit),
      rightTwips: unitToTwips(0.5, unit),
      firstLineTwips: unitToTwips(0.25, unit),
    });
    expect(seen[2]?.args.twips).toBe(120);
    expect(seen[3]?.args.twips).toBe(240);
    expect(seen[4]?.args.lineSpacing).toBe(2);

    expect(justificationOf(handle)).toBe('center');
    expect(indentationOf(handle)).toEqual({
      left: unitToTwips(1, unit),
      right: unitToTwips(0.5, unit),
      firstLine: unitToTwips(0.25, unit),
    });
  });

  it('writes a hanging indent as a negative first line', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const unit = chrome.context.state.units;
    const dialog = openParagraph(chrome);

    field(dialog, 'docier-paragraph-hanging').value = '0.5';
    click(dialog.applyButton);
    await handle.whenReady();

    expect(seen.map((entry) => entry.commandId)).toEqual([
      'docier.command.format.setParagraphIndent',
    ]);
    expect(seen[0]?.args.firstLineTwips).toBe(-unitToTwips(0.5, unit));
    expect(indentationOf(handle).firstLine).toBe(-unitToTwips(0.5, unit));
  });

  it('applies nothing when OK is pressed without a change', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const dialog = openParagraph(chrome);
    click(dialog.applyButton);
    await handle.whenReady();
    expect(seen).toEqual([]);
  });

  it('reads the paragraph through the value reader the chrome supplies', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const unit = chrome.context.state.units;
    const dialog = openParagraph(chrome, (key) => (key === 'indentLeft' ? '720' : undefined));

    expect(field(dialog, 'docier-paragraph-left').value).toBe(formatUnitValue(720, unit, 3));
    click(dialog.applyButton);
    await handle.whenReady();
    expect(seen).toEqual([]);
  });

  it('closes without applying on Escape and leaves the paragraph alone', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const dialog = openParagraph(chrome);

    select(dialog, 'docier-paragraph-alignment').value = 'right';
    field(dialog, 'docier-paragraph-left').value = '2';
    const event = keydown(field(dialog, 'docier-paragraph-left'), 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.isOpen).toBe(false);
    await handle.whenReady();

    expect(seen).toEqual([]);
    expect(justificationOf(handle)).toBeUndefined();
    expect(indentationOf(handle).left).toBeUndefined();
  });

  it('closes without applying on Cancel and leaves the paragraph alone', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const dialog = openParagraph(chrome);

    field(dialog, 'docier-paragraph-before').value = '18';
    click(dialog.cancelButton);
    await handle.whenReady();

    expect(seen).toEqual([]);
    expect(indentationOf(handle).left).toBeUndefined();
  });

  it('takes focus into the dialog and gives it back to the opener', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const dialog = createParagraphDialog({ context: chrome.context, mount: portalOf() });
    dialogs.push(dialog);
    dialog.open();
    expect(dialog.element.contains(document.activeElement)).toBe(true);
    expect(dialog.opener).toBe(opener);

    dialog.close();
    expect(document.activeElement).toBe(opener);
  });

  it('refreshes the controls from the document', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const unit = chrome.context.state.units;
    const indentReader = (key: string): string | undefined => {
      const current = indentationOf(handle);
      if (key === 'indentLeft') return current.left === undefined ? '' : String(current.left);
      if (key === 'indentRight') return current.right === undefined ? '' : String(current.right);
      if (key === 'indentFirstLine') {
        return current.firstLine === undefined ? '' : String(current.firstLine);
      }
      return undefined;
    };
    const dialog = openParagraph(chrome, indentReader);

    await handle.commands.execute('docier.command.format.alignRight', {}, { source: 'api' });
    await handle.commands.execute(
      'docier.command.format.setParagraphIndent',
      { leftTwips: 1440 },
      { source: 'api' },
    );
    await handle.whenReady();

    dialog.refresh();
    expect(select(dialog, 'docier-paragraph-alignment').value).toBe('right');
    expect(field(dialog, 'docier-paragraph-left').value).toBe(formatUnitValue(1440, unit, 3));
  });
});
