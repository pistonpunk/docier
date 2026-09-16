import { describe, expect, it } from 'vitest';
import { BACKSTAGE_ITEMS, CONTEXT_MENUS } from '../../src/ui/menu-model.js';
import type { UiNode } from '../../src/ui/menu-model.js';
import { dialogNameFor } from '../../src/ui/dialog.js';

const everyNode = (nodes: readonly UiNode[]): readonly UiNode[] => {
  const found: UiNode[] = [];
  for (const node of nodes) {
    found.push(node);
    if (node.items !== undefined) found.push(...everyNode(node.items));
  }
  return found;
};

// The context menus and the backstage, which are the surfaces whose rows go
// through the plain button path. A gallery reads the same field for the dialog
// its launcher would open and dispatches its items its own way, so it is not
// covered here: the walk cannot yet say which of its rows reach that field.
const allNodes = (): readonly UiNode[] => [
  ...Object.values(CONTEXT_MENUS).flatMap(everyNode),
  ...everyNode(BACKSTAGE_ITEMS),
];

const dispatched = (): readonly { readonly id: string; readonly dialog: string }[] =>
  allNodes()
    .filter((node) => node.kind === 'button' || node.kind === 'toggle')
    .filter((node) => node.action === 'openDialog')
    .map((node) => ({ id: node.id, dialog: String(node.actionArgs?.dialog ?? '') }));

describe('a menu row that opens a dialog', () => {
  it('either opens one that exists, or runs the command it names', () => {
    const orphaned = dispatched()
      // a name that resolves is fine, and so is a command that runs: only a name
      // that resolves to neither leaves the reader with a message
      .filter((entry) => dialogNameFor(entry.dialog) === undefined)
      .filter((entry) => entry.dialog.startsWith('docier.command.'))
      .map((entry) => entry.id);
    expect(orphaned).toEqual([]);
  });

  it('keeps the ones that really are dialogs, still asking for a dialog', () => {
    const dialogs = dispatched()
      .map((entry) => entry.dialog)
      .filter((dialog) => dialog !== '' && !dialog.startsWith('docier.command.'));
    // these are dialogs this build has not written yet; they report that rather
    // than pretending, which is why they are still listed here
    expect(dialogs).toContain('diagnostics');
    expect(dialogs).toContain('customizeRibbon');
  });
});
