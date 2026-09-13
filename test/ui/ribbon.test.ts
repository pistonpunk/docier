import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedControl } from '../../src/ui/types.js';
import { applyValue } from '../../src/ui/controls.js';
import { iconFor, iconKeys } from '../../src/ui/icons.js';
import { STYLE_ELEMENT_ATTRIBUTE, renderStyles } from '../../src/ui/styles.js';
import { contentRun, paragraphOf, text } from '../layout/support.js';
import { paragraphMarksAt } from '../../src/edit/inspect.js';
import { ALL_RIBBON_TABS } from '../../src/ui/menu-model.js';
import type { UiNode } from '../../src/ui/menu-model.js';
import { bodyOf, chromeOf, chromeOfDocx, disposeChromes, longBody } from './support.js';
import { emptyEditorOf, disposeEditors } from '../api/support.js';
import { buildDocx } from '../model/support.js';
import { mountChrome } from '../../src/ui/chrome.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import { pos } from '../edit/support.js';

const extra: ChromeHandle[] = [];

afterEach(() => {
  while (extra.length > 0) extra.pop()?.dispose();
  disposeChromes();
  disposeEditors();
  document.body.innerHTML = '';
  for (const node of document.querySelectorAll(`style[${STYLE_ELEMENT_ATTRIBUTE}]`)) {
    node.parentNode?.removeChild(node);
  }
});

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>';

const PLAIN_BODY = '<w:p><w:r><w:t>hello</w:t></w:r></w:p>';

const GEORGIA_24 = '<w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="28"/></w:rPr>';

const mixedBody = (): string =>
  bodyOf(
    paragraphOf(
      '',
      contentRun(GEORGIA_24, text('Georgia run')) + contentRun('', text(' plain run')),
    ),
  );

const comboInputs = (ribbon: HTMLElement): { family: HTMLInputElement; size: HTMLInputElement } => {
  const family = ribbon.querySelector<HTMLInputElement>(
    '.docier-control-combo:not(.docier-control-spinner) input',
  );
  const size = ribbon.querySelector<HTMLInputElement>('.docier-control-spinner input');
  if (family === null || size === null) throw new Error('font controls missing');
  return { family, size };
};

const resolvedFor = (
  partial: Partial<ResolvedControl> & { readonly id: string; readonly label: string },
): ResolvedControl => ({
  enabled: true,
  active: false,
  hint: undefined,
  reason: undefined,
  description: undefined,
  registered: true,
  ...partial,
});

describe('font controls', () => {
  it('shows the family and the size of the run at the caret', async () => {
    const { handle, chrome } = await chromeOf(mixedBody());
    const { family, size } = comboInputs(chrome.menuBar!.ribbon);
    expect(family.value).toBe('Georgia');
    expect(size.value).toBe('14');

    handle.setSelection(pos(0), pos(18));
    expect(family.value).toBe('');
    handle.setSelection(pos(0), pos(4));
    expect(family.value).toBe('Georgia');
    expect(size.value).toBe('14');
  });

  it('follows the caret between runs and clears when a run carries no value', async () => {
    const { handle, chrome } = await chromeOf(mixedBody());
    const { family, size } = comboInputs(chrome.menuBar!.ribbon);
    handle.setSelection(pos(0), pos(4));
    expect(family.value).toBe('Georgia');

    handle.setSelection(pos(0), pos(18));
    expect(family.value).toBe('');
    expect(size.value).toBe('');

    handle.setSelection(pos(0), pos(1));
    expect(family.value).toBe('Georgia');
    expect(size.value).toBe('14');
  });

  it('reports half points as points', async () => {
    const singular = bodyOf(
      paragraphOf('', contentRun('<w:rPr><w:sz w:val="21"/></w:rPr>', text('ten and a half'))),
    );
    const { handle, chrome } = await chromeOf(singular);
    handle.setSelection(pos(0), pos(3));
    expect(comboInputs(chrome.menuBar!.ribbon).size.value).toBe('10.5');
  });

  it('leaves a field the user is editing alone', async () => {
    const wrapper = document.createElement('span');
    const input = document.createElement('input');
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    input.focus();
    applyValue(wrapper, resolvedFor({ id: 'font', label: 'Font', enabled: true, active: false, value: 'Georgia' }));
    expect(input.value).toBe('');
    input.blur();
    applyValue(wrapper, resolvedFor({ id: 'font', label: 'Font', enabled: true, active: false, value: 'Georgia' }));
    expect(input.value).toBe('Georgia');
  });

  it('keeps the typed text when the resolved control has no value to report', async () => {
    const wrapper = document.createElement('span');
    const input = document.createElement('input');
    input.value = 'Arial';
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);
    applyValue(wrapper, resolvedFor({ id: 'font', label: 'Font', enabled: true, active: false }));
    expect(input.value).toBe('Arial');
  });
});

describe('styles gallery', () => {
  const styleButton = (chrome: ChromeHandle, id: string): HTMLElement | null =>
    chrome.menuBar!.ribbon.querySelector<HTMLElement>(`[data-docier-id="style:${id}"]`);

  it('enables only the styles the document defines', async () => {
    const { chrome } = await chromeOfDocx({ body: PLAIN_BODY, styles: STYLES });
    expect(styleButton(chrome, 'Heading1')!.getAttribute('aria-disabled')).toBeNull();
    expect(styleButton(chrome, 'Heading1')!.getAttribute('title')).toBe('Heading 1');
    expect(styleButton(chrome, 'Caption')!.getAttribute('aria-disabled')).toBe('true');
    expect(styleButton(chrome, 'Caption')!.getAttribute('title')).toContain('Caption');
  });

  it('re-decides every item after the document arrives', async () => {
    const handle = emptyEditorOf();
    const chrome = mountChrome(handle, { mode: 'full' });
    extra.push(chrome);
    expect(styleButton(chrome, 'Heading1')!.getAttribute('aria-disabled')).toBe('true');
    expect(styleButton(chrome, 'Heading1')!.getAttribute('title')).toContain('No document is loaded');

    await handle.load(buildDocx({ body: PLAIN_BODY, styles: STYLES }));
    expect(styleButton(chrome, 'Heading1')!.getAttribute('aria-disabled')).toBeNull();
    expect(styleButton(chrome, 'Heading1')!.getAttribute('title')).toBe('Heading 1');
  });

  it('applies the style the item names', async () => {
    const { handle, chrome } = await chromeOfDocx({ body: PLAIN_BODY, styles: STYLES });
    handle.setSelection(pos(0), pos(2));
    styleButton(chrome, 'Heading1')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await handle.whenReady();
    expect(paragraphMarksAt(handle.document!, handle.session!, pos(0))?.styleId).toBe('Heading1');
  });

  it('brings the quick access up to date after a change that moves no counter', async () => {
    const { handle, chrome } = await chromeOfDocx({ body: PLAIN_BODY, styles: STYLES });
    const undo = (): HTMLElement | null =>
      chrome.element.querySelector<HTMLElement>(
        '.docier-quick-access [data-docier-id="docier.command.history.undo"]',
      );
    expect(undo()!.getAttribute('aria-disabled')).toBe('true');

    handle.setSelection(pos(0), pos(2));
    styleButton(chrome, 'Heading1')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await handle.whenReady();
    expect(undo()!.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('icons', () => {
  const nodeFor = (key: string): UiNode =>
    ({ id: `docier.command.${key}`, kind: 'button', command: `docier.command.${key}` }) as UiNode;

  it('draws one stroked inline svg of paths for every key it publishes', () => {
    expect(iconKeys().length).toBeGreaterThan(0);
    for (const key of iconKeys()) {
      const glyph = iconFor(nodeFor(key));
      expect(glyph, key).toBeDefined();
      expect(glyph!.startsWith('<svg '), key).toBe(true);
      expect(glyph!.endsWith('</svg>'), key).toBe(true);
      expect(glyph!.split('<svg ').length, key).toBe(2);
      expect(glyph!.split('</svg>').length, key).toBe(2);
      expect(glyph!, key).toContain('<path ');
      expect(glyph!.match(/fill=/g)?.length, key).toBe(1);
      expect(glyph!, key).toContain('fill="none"');
      expect(glyph!.match(/stroke="/g)?.length, key).toBe(1);
    }
  });

  it('leaves an action without a glyph to its text label', () => {
    expect(iconFor(nodeFor('format.lineSpacing'))).toBeUndefined();
    expect(iconFor({ id: 'docier.command.nope', kind: 'button', command: 'docier.command.nope' } as UiNode)).toBeUndefined();
  });

  it('draws a glyph for every ribbon button except the group launchers', () => {
    const walk = (nodes: readonly UiNode[]): UiNode[] =>
      nodes.flatMap((entry) =>
        entry.kind === 'separator' ? [] : [entry, ...walk(entry.items ?? [])],
      );
    const buttons = ALL_RIBBON_TABS.flatMap((tab) =>
      tab.groups.flatMap((group) => walk(group.nodes)),
    ).filter((entry) => entry.kind === 'button' || entry.kind === 'toggle');
    expect(buttons.length).toBeGreaterThan(90);

    const launchers = ALL_RIBBON_TABS.flatMap((tab) =>
      tab.groups.flatMap((group) => (group.launcher === undefined ? [] : [group.launcher])),
    );
    for (const launcher of launchers) {
      expect(iconFor(launcher), launcher.id).toBeUndefined();
    }

    const missing = buttons.filter((entry) => iconFor(entry) === undefined);
    expect(missing.map((entry) => entry.id)).toEqual([]);
  });

  it('never reaches for an external asset and inherits the theme colour', () => {
    for (const key of iconKeys()) {
      const glyph = iconFor(nodeFor(key))!;
      expect(glyph, key).not.toContain('http');
      expect(glyph, key).not.toContain('<image');
      expect(glyph, key).not.toContain('url(');
      expect(glyph, key).toContain('stroke="currentColor"');
      expect(glyph, key).toContain('aria-hidden="true"');
    }
  });

  it('replaces the visible label while keeping it for assistive technology', async () => {
    const { chrome } = await chromeOf(longBody());
    const ribbon = chrome.menuBar!.ribbon;
    const bold = ribbon.querySelector<HTMLElement>('[aria-label="Bold"]');
    expect(bold).not.toBeNull();
    expect(bold!.classList.contains('docier-control-iconic')).toBe(true);
    expect(bold!.querySelector('svg')).not.toBeNull();
    expect(bold!.querySelector('.docier-control-label')!.textContent).toBe('Bold');
    expect(bold!.getAttribute('title')).toContain('Bold');
    expect(renderStyles()).toContain('.docier-control-iconic > .docier-control-label{display:none}');
  });

  it('keeps the label beside the icon where the control opens a menu', async () => {
    const { chrome } = await chromeOf(longBody());
    const bullets = chrome.menuBar!.ribbon.querySelector<HTMLElement>('[aria-label="Bullets"]');
    expect(bullets).not.toBeNull();
    expect(bullets!.classList.contains('docier-control-iconic')).toBe(false);
    expect(bullets!.querySelector('svg')).not.toBeNull();
    expect((bullets!.textContent ?? '').trim()).toBe('Bullets');
    const spacing = chrome.menuBar!.ribbon.querySelector<HTMLElement>(
      '[aria-label="Line and Paragraph Spacing"]',
    );
    expect(spacing!.querySelector('svg')).not.toBeNull();
  });

  it('keeps the text-only surfaces text-only', async () => {
    const { chrome } = await chromeOf(longBody());
    expect(chrome.element.querySelectorAll('.docier-backstage .docier-control-iconic').length).toBe(0);
    expect(
      chrome.element.querySelector('.docier-backstage-item')!.querySelector('.docier-control-label'),
    ).not.toBeNull();
  });

  it('marks every icon-only control with a label and a tooltip', async () => {
    const { chrome } = await chromeOf(longBody());
    const icons = [...chrome.menuBar!.ribbon.querySelectorAll<HTMLElement>('.docier-control-iconic')];
    expect(icons.length).toBeGreaterThan(10);
    for (const control of icons) {
      expect((control.getAttribute('aria-label') ?? '').length, control.outerHTML).toBeGreaterThan(0);
      expect((control.getAttribute('title') ?? '').length, control.outerHTML).toBeGreaterThan(0);
      expect(control.querySelector('.docier-control-icon')!.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('ribbon layout rules', () => {
  const css = renderStyles();

  it('lets a group take its natural width and wrap instead of squeezing its controls', () => {
    expect(css).toContain('.docier-group-controls > *{flex:0 0 auto}');
    expect(css).toContain(
      '.docier-group{display:flex;flex:0 1 auto;flex-direction:column;justify-content:space-between;min-width:min-content',
    );
    expect(css).toContain('.docier-group[data-docier-grow="true"]{flex:0 1 auto;min-width:0}');
  });

  it('keeps a gallery label inside its own item', () => {
    expect(css).toContain('.docier-menu-gallery > .docier-control{min-width:0;overflow:hidden}');
    expect(css).toContain('.docier-menu-gallery .docier-control-label{display:block;overflow:hidden;text-overflow:ellipsis}');
    expect(css).toContain(
      '.docier-ribbon .docier-menu-gallery{display:grid;grid-auto-flow:column;grid-auto-columns:88px;grid-template-columns:none;overflow-x:auto',
    );
    expect(css).toContain('.docier-ribbon .docier-menu-gallery .docier-control{min-height:22px');
  });

  it('clears a ribbon too narrow for its content by wrapping the groups', () => {
    expect(css).toContain('@container (max-width: 760px){.docier-ribbon-panel{flex-wrap:wrap}}');
    expect(css).toContain('container-type:inline-size');
  });

  it('hides the overflow of the ribbon rather than the page', () => {
    expect(css).toContain('.docier-ribbon{display:flex;position:relative;grid-area:ribbon;overflow:hidden');
  });
});

describe('chrome grid rules', () => {
  const css = renderStyles();

  it('orders the surfaces and gives the canvas the remaining height', () => {
    expect(css).toContain('grid-template-areas:"menubar" "ribbon" "ruler" "canvas" "status"');
    expect(css).toContain('grid-template-rows:auto auto auto minmax(0,1fr) auto');
    expect(css).toContain('.docier-status{display:flex;grid-area:status');
  });

  it('centres a page that fits and keeps the left edge reachable when it does not', () => {
    expect(css).toContain('.docier-canvas > .docier-editor .docier-surface{margin-inline:auto}');
    expect(css).toContain('.docier-canvas > .docier-editor{flex:1 1 auto;min-height:0}');
    const editor = css.slice(css.indexOf('.docier-canvas{'), css.indexOf('.docier-slot{'));
    expect(editor).not.toContain('justify-content:center');
  });

  it('saves its one important declaration for reduced motion', () => {
    const important = css.match(/[^;{]+!important/g) ?? [];
    expect(important.length).toBe(2);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
