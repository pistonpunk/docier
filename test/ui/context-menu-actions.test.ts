import { describe, expect, it } from 'vitest';
import {
  ALL_RIBBON_TABS,
  BACKSTAGE_ITEMS,
  CONTEXT_MENUS,
  FLOATING_CONTROLS,
  QUICK_ACCESS,
  STATUS_ITEM_MENU,
} from '../../src/ui/menu-model.js';
import type { UiNode } from '../../src/ui/menu-model.js';
import { dialogNameFor } from '../../src/ui/dialog.js';

// Two rows still open a dialog this build has not written, and they are named
// here rather than left to be rediscovered. Both want a choice of value with
// nowhere to offer it: Date and Time wants a format, Word Count wants the counts
// dialog described in the progress file. Anything else appearing in this list is
// a row that should be running its command.
const STILL_OPEN = ['docier.command.insert.dateTime', 'docier.command.proof.wordCount'];

const everyNode = (nodes: readonly UiNode[]): readonly UiNode[] => {
  const found: UiNode[] = [];
  for (const node of nodes) {
    found.push(node);
    if (node.items !== undefined) found.push(...everyNode(node.items));
  }
  return found;
};

const allNodes = (): readonly UiNode[] => [
  ...Object.values(CONTEXT_MENUS).flatMap(everyNode),
  ...everyNode(BACKSTAGE_ITEMS),
  ...ALL_RIBBON_TABS.flatMap((tab) => tab.groups.flatMap((group) => everyNode(group.nodes))),
  ...everyNode(QUICK_ACCESS),
  ...everyNode(STATUS_ITEM_MENU),
  ...everyNode(FLOATING_CONTROLS),
];

// A gallery renders its own dialog field into nothing: it lays out as a
// container and each item goes down the button path, which is the path checked
// here. A spinner or a combo dispatches openDialog with its id rather than the
// dialog it names. So a button and a toggle are the two kinds this speaks for.
const dispatchesDialog = (node: UiNode): boolean =>
  (node.kind === 'button' || node.kind === 'toggle') && node.action === 'openDialog';

const dialogOf = (node: UiNode): string => String(node.actionArgs?.dialog ?? '');

describe('a menu row that opens a dialog', () => {
  it('either opens one that exists, or runs the command it names', () => {
    const orphaned = allNodes()
      .filter(dispatchesDialog)
      .map((node) => ({ id: node.id, dialog: dialogOf(node) }))
      // a name that resolves is fine, and so is a command that runs: only a name
      // that resolves to neither leaves the reader with a message
      .filter((entry) => dialogNameFor(entry.dialog) === undefined)
      .filter((entry) => entry.dialog.startsWith('docier.command.'))
      .filter((entry) => !STILL_OPEN.includes(entry.dialog))
      .map((entry) => entry.id);
    expect(orphaned).toEqual([]);
  });

  it('keeps the ones that really are dialogs, still asking for a dialog', () => {
    const dialogs = allNodes()
      .filter(dispatchesDialog)
      .map(dialogOf)
      .filter((dialog) => dialog !== '' && !dialog.startsWith('docier.command.'));
    // dialogs this build has not written, which report that rather than pretend.
    // The status bar's four are not here: it runs openDialog from code rather
    // than from a menu node, so this walk cannot see them
    expect(dialogs).toContain('diagnostics');
    expect(dialogs).toContain('customizeRibbon');
  });

  it('still has a reason for each row it lets through', () => {
    for (const id of STILL_OPEN) {
      const found = allNodes().some((node) => dialogOf(node) === id);
      expect(found, `${id} is listed as still open but no row asks for it`).toBe(true);
    }
  });
});
