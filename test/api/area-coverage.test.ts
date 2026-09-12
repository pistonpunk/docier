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

const collect = (nodes: readonly UiNode[], into: Set<string>): void => {
  for (const node of nodes) {
    if (node.command !== undefined) into.add(node.command);
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

    expect(registered).toBe(112);
    expect([...areas.keys()].sort()).toEqual([
      'clipboard',
      'comment',
      'doc',
      'edit',
      'export',
      'find',
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
    expect(areas.get('insert')).toBe(18);
    expect(areas.get('format')).toBe(24);
    expect(areas.get('table')).toBe(10);
    expect(areas.get('object')).toBe(12);
    expect(areas.get('token')).toBe(6);
    expect(areas.get('theme')).toBe(3);
    expect(areas.get('view')).toBe(2);
  });
});

describe('deliberately unavailable commands', () => {
  it('registers each of them with a specific reason instead of a generic one', async () => {
    const handle = await editorOf(FIXTURE);
    expect(unsupportedIds.length).toBeGreaterThan(50);

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
    expect(reasonOf(handle, 'docier.command.object.insertImage')).toContain('drawing content');
    expect(reasonOf(handle, 'docier.command.insert.header')).toContain('no header');
    expect(reasonOf(handle, 'docier.command.insert.closeHeaderFooter')).toContain('not in a header');
    expect(reasonOf(handle, 'docier.command.numbering.cleanup')).toContain('w:abstractNum');
    expect(reasonOf(handle, 'docier.command.theme.setColors')).toContain('theme part');
    expect(reasonOf(handle, 'docier.command.doc.save')).toContain('host application');
    expect(reasonOf(handle, 'docier.command.find.find')).toContain('search engine');
    expect(reasonOf(handle, 'docier.command.doc.setLineNumbers')).toContain('LE-044');
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
