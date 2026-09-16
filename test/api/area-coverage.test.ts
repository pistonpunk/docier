import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { unsupportedIds } from '../../src/edit/areas/index.js';
import {
  ALL_RIBBON_TABS,
  BACKSTAGE_ITEMS,
  CONTEXT_MENUS,
  FLOATING_CONTROLS,
  QUICK_ACCESS,
  STATUS_ITEM_MENU,
  visibleNodes,
  visibleTabs,
} from '../../src/ui/menu-model.js';
import type { UiNode } from '../../src/ui/menu-model.js';
import {
  bodyOf,
  disposeEditors,
  editorOf,
  mountPoint,
  paragraphText,
  track,
} from '../edit/support.js';

const FIXTURE = bodyOf(paragraphText('alpha'), paragraphText('beta'));

const CLIPBOARD_AREA_IDS = [
  'docier.command.clipboard.formatPainter',
  'docier.command.clipboard.pasteSpecial',
];

const GENERIC_REASONS = [
  'The command cannot run here',
  'No such command',
  'This command is not available in this build',
  'No document is loaded',
];

const DIALOG_COMMANDS: Readonly<Record<string, string>> = {
  'insert.link': 'docier.command.insert.link',
  'insert.symbol': 'docier.command.insert.symbol',
  'object.insertImage': 'docier.command.object.insertImage',
};

const collect = (nodes: readonly UiNode[], into: Set<string>): void => {
  for (const node of nodes) {
    if (node.command !== undefined) into.add(node.command);
    if (node.action === 'openDialog') {
      const name = node.actionArgs?.dialog;
      if (typeof name === 'string') {
        const command = DIALOG_COMMANDS[name] ?? name;
        if (DIALOG_COMMANDS[name] !== undefined) into.add(command);
      }
    }
    if (node.items !== undefined) collect(node.items, into);
  }
};

const dispatchedIds = (): readonly string[] => {
  const ids = new Set<string>();
  for (const tab of ALL_RIBBON_TABS) for (const group of tab.groups) collect(group.nodes, ids);
  for (const surface of Object.keys(CONTEXT_MENUS) as readonly (keyof typeof CONTEXT_MENUS)[]) {
    collect(CONTEXT_MENUS[surface], ids);
  }
  collect(QUICK_ACCESS, ids);
  collect(STATUS_ITEM_MENU, ids);
  collect(FLOATING_CONTROLS, ids);
  collect(BACKSTAGE_ITEMS, ids);
  return [...ids].sort();
};

const reasonOf = (handle: EditorHandle, id: string): string =>
  String(handle.commands.disabledReason(id) ?? '');

const outcomeOf = (
  result: Awaited<ReturnType<EditorHandle['commands']['execute']>>,
): string => (result.status === 'blocked' ? `blocked ${String(result.reason)}` : result.status);

afterEach(() => {
  disposeEditors();
});

describe('chrome command coverage', () => {
  it('registers every id the chrome dispatches', async () => {
    const handle = await editorOf(FIXTURE);
    const ids = dispatchedIds();
    expect(ids.length).toBeGreaterThan(100);

    const unregistered = ids.filter((id) => handle.commands.get(id) === undefined);
    expect(unregistered.filter((id) => !CLIPBOARD_AREA_IDS.includes(id))).toEqual([]);
  });

  it('gives every dispatched id a descriptor that is enabled or explains itself', async () => {
    const handle = await editorOf(FIXTURE);
    const silent: string[] = [];
    const generic: string[] = [];
    for (const id of dispatchedIds()) {
      const descriptor = handle.commands.list({ ids: [id] })[0];
      if (descriptor === undefined) continue;
      expect(String(descriptor.label).length).toBeGreaterThan(0);
      if (descriptor.enabled) continue;
      const reason = descriptor.disabledReason === undefined ? '' : String(descriptor.disabledReason);
      if (reason.length === 0) silent.push(id);
      else if (GENERIC_REASONS.includes(reason)) generic.push(id);
    }
    expect(silent).toEqual([]);
    expect(generic).toEqual([]);
  });

  it('reports which areas the chrome can now reach', async () => {
    const handle = await editorOf(FIXTURE);
    const areas = new Map<string, number>();
    let registered = 0;
    for (const id of dispatchedIds()) {
      if (handle.commands.get(id) === undefined) continue;
      registered += 1;
      const area = id.slice('docier.command.'.length).split('.')[0] ?? '';
      areas.set(area, (areas.get(area) ?? 0) + 1);
    }

    // the number rises whenever a menu entry is wired from a dialog stub to the
    // command it names, or when a menu row that named nothing gains a command.
    // The last rise was Change Case, a new Home > Font menu of five modes, and
    // the last fall was Table Properties: the ribbon and the context menu used to
    // name two different commands for one dialog, and both rows now open the
    // dialog through table.setProperties, which is one id instead of two.
    // Before that it was the whole field set behind Insert > Field, and before
    // that Find and Replace, which open the find dialog instead of being executed
    // from the ribbon, so the dialog dispatches them rather than the chrome
    expect(registered).toBe(140);
    expect([...areas.keys()].sort()).toEqual([
      'clipboard',
      'comment',
      'doc',
      'edit',
      'export',
      'format',
      'history',
      'insert',
      'numbering',
      'object',
      'proof',
      'style',
      'table',
      'theme',
      'token',
      'view',
    ]);
    expect(areas.get('doc')).toBe(15);
    expect(areas.get('insert')).toBe(22);
    // one more than it was: the text direction command, which the layout can now
    // lay out instead of warning that it cannot
    expect(areas.get('format')).toBe(26);
    // one fewer than it was: Table Properties was two commands, one of which was
    // the dialog refusal, and is now a single command that opens the dialog
    expect(areas.get('table')).toBe(32);
    expect(areas.get('object')).toBe(12);
    // one fewer than it was: Insert > Field used to dispatch token.insert, which
    // is the template-token subsystem rather than a field, and now dispatches the
    // insert.field set instead
    expect(areas.get('token')).toBe(5);
    expect(areas.get('theme')).toBe(3);
    expect(areas.get('view')).toBe(2);
  });
});

describe('the chrome does not show placeholders', () => {
  const collectPruned = (nodes: readonly UiNode[], into: Set<string>): void => {
    for (const node of nodes) {
      if (node.command !== undefined) into.add(node.command);
      if (node.items !== undefined) collectPruned(node.items, into);
    }
  };

  const prunedIds = (): ReadonlySet<string> => {
    const ids = new Set<string>();
    for (const tab of visibleTabs(ALL_RIBBON_TABS)) {
      for (const group of tab.groups) collectPruned(group.nodes, ids);
    }
    for (const surface of Object.keys(CONTEXT_MENUS) as readonly (keyof typeof CONTEXT_MENUS)[]) {
      collectPruned(visibleNodes(CONTEXT_MENUS[surface]), ids);
    }
    collectPruned(visibleNodes(QUICK_ACCESS), ids);
    collectPruned(visibleNodes(STATUS_ITEM_MENU), ids);
    collectPruned(visibleNodes(FLOATING_CONTROLS), ids);
    collectPruned(visibleNodes(BACKSTAGE_ITEMS), ids);
    return ids;
  };

  it('renders no command that the registry cannot ever run', () => {
    const shown = prunedIds();
    const placeholders = unsupportedIds.filter((id) => shown.has(id));
    expect(placeholders).toEqual([]);
  });

  it('still refuses a good number of them in the registry, so the rule has teeth', () => {
    const raw = new Set<string>();
    for (const tab of ALL_RIBBON_TABS) {
      for (const group of tab.groups) collectPruned(group.nodes, raw);
    }
    for (const surface of Object.keys(CONTEXT_MENUS) as readonly (keyof typeof CONTEXT_MENUS)[]) {
      collectPruned(CONTEXT_MENUS[surface], raw);
    }
    collectPruned(QUICK_ACCESS, raw);
    collectPruned(STATUS_ITEM_MENU, raw);
    collectPruned(FLOATING_CONTROLS, raw);
    collectPruned(BACKSTAGE_ITEMS, raw);
    const wouldHaveBeenShown = unsupportedIds.filter((id) => raw.has(id));
    // the floor tracks how many refusals there still are; it falls as features
    // are built, which is the direction it is meant to fall in
    expect(wouldHaveBeenShown.length).toBeGreaterThan(25);
    expect(prunedIds().size).toBeLessThan(raw.size);
  });
});

describe('deliberately unavailable commands', () => {
  it('registers each of them with a specific reason instead of a generic one', async () => {
    const handle = await editorOf(FIXTURE);
    expect(unsupportedIds.length).toBeGreaterThan(36);

    const missing: string[] = [];
    const generic: string[] = [];
    for (const id of unsupportedIds) {
      if (handle.commands.get(id) === undefined) {
        missing.push(id);
        continue;
      }
      if (!handle.commands.isEnabled(id)) {
        const reason = reasonOf(handle, id);
        if (reason.length === 0 || GENERIC_REASONS.includes(reason)) generic.push(id);
      }
    }
    expect(missing).toEqual([]);
    expect(generic).toEqual([]);
  });

  it('blocks with the stated reason when it is forced past availability', async () => {
    const handle = await editorOf(FIXTURE);
    const wrong: string[] = [];
    for (const id of unsupportedIds) {
      const expected = reasonOf(handle, id);
      const result = await handle.commands.execute(id, undefined, { force: true });
      const actual = result.status === 'blocked' ? String(result.reason) : result.status;
      if (actual !== expected) wrong.push(`${id} -> ${outcomeOf(result)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('never records history or emits a change for them', async () => {
    const handle = await editorOf(FIXTURE);
    const seen: string[] = [];
    handle.events.onAny((type) => {
      seen.push(type);
    });
    for (const id of unsupportedIds) {
      await handle.commands.execute(id, undefined, { force: true });
    }
    expect(seen.filter((type) => type === 'docier:doc:change')).toEqual([]);
    expect(seen.filter((type) => type === 'docier:history:change')).toEqual([]);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('names the token subsystem rather than a missing document setting', async () => {
    const handle = await editorOf(FIXTURE);
    expect(reasonOf(handle, 'docier.command.token.insert')).toBe(
      'Tokenization is not enabled for this document',
    );

    handle.updateConfig({ tokenization: { enabled: true } });
    expect(reasonOf(handle, 'docier.command.token.insert')).toBe(
      'This build has no token subsystem',
    );
  });

  it('explains the half-implemented areas in terms of the model they need', async () => {
    const handle = await editorOf(FIXTURE);
    expect(handle.commands.isEnabled('docier.command.insert.table')).toBe(true);
    expect(reasonOf(handle, 'docier.command.table.insertRowsBelow')).toContain(
      'Place the caret inside a table',
    );
    expect(reasonOf(handle, 'docier.command.object.insertImage')).toContain('needs the bytes of a picture');
    expect(reasonOf(handle, 'docier.command.object.insertShape')).toContain('no geometry for a preset shape');
    expect(handle.commands.isEnabled('docier.command.insert.header')).toBe(true);
    expect(reasonOf(handle, 'docier.command.insert.closeHeaderFooter')).toContain('not in a header');
    expect(reasonOf(handle, 'docier.command.numbering.cleanup')).toContain('w:abstractNum');
    // the theme commands are implemented now, so they refuse only for a missing
    // argument, and the document they run against carries a theme part
    expect(reasonOf(handle, 'docier.command.theme.setColors')).toContain('colour scheme');
    expect(
      handle.commands.disabledReason('docier.command.theme.setColors', { palette: 'office' }),
    ).toBeUndefined();
    expect(
      handle.commands.disabledReason('docier.command.theme.setFonts', { major: 'Georgia' }),
    ).toBeUndefined();
    expect(handle.commands.isEnabled('docier.command.doc.save')).toBe(true);
    expect(reasonOf(handle, 'docier.command.export.pdf')).toContain('exportPdf handler');
    expect(reasonOf(handle, 'docier.command.find.find')).toBe('Type something to find');
    // with no arguments both want a query first, and replace asks for the
    // replacement once it has one
    expect(reasonOf(handle, 'docier.command.find.replace')).toBe('Type something to find');
    expect(handle.commands.disabledReason('docier.command.find.replace', { query: 'cat' })).toBe(
      'Type the replacement text',
    );
    // line numbering is implemented now, so it asks for its argument instead of
    // naming the deferred item it used to be
    expect(reasonOf(handle, 'docier.command.doc.setLineNumbers')).toContain('line number setting');
  });
});

describe('availability across the areas', () => {
  it('blocks every implementing area with a reason while no document is loaded', async () => {
    const handle = track(createEditor(mountPoint()));
    const sample = [
      'docier.command.doc.setMargins',
      'docier.command.format.setParagraphIndent',
      'docier.command.format.setLineSpacing',
      'docier.command.style.apply',
      'docier.command.insert.symbol',
      'docier.command.proof.setLanguage',
    ];
    const wrong: string[] = [];
    for (const id of sample) {
      const result = await handle.commands.execute(id, { side: 'left', twips: 10 });
      if (result.status !== 'blocked' || String(result.reason) !== 'No document is loaded') {
        wrong.push(`${id} -> ${outcomeOf(result)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('blocks document changes and allows nothing to succeed while read-only', async () => {
    const handle = await editorOf(FIXTURE, { permissions: { readOnly: true } });
    const sample = [
      'docier.command.doc.setMargins',
      'docier.command.doc.setOrientation',
      'docier.command.format.setParagraphIndent',
      'docier.command.format.setTabs',
      'docier.command.format.growFont',
      'docier.command.insert.symbol',
      'docier.command.insert.link',
      'docier.command.proof.setLanguage',
    ];
    const wrong: string[] = [];
    for (const id of sample) {
      const result = await handle.commands.execute(id, {
        side: 'left',
        twips: 100,
        orientation: 'landscape',
        leftTwips: 100,
        positionTwips: 100,
        codePoint: 0x2022,
        url: 'https://example.com',
        language: 'en-GB',
        styleId: 'Normal',
      });
      if (result.status !== 'blocked' || String(result.reason) !== 'The document is read-only') {
        wrong.push(`${id} -> ${outcomeOf(result)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
