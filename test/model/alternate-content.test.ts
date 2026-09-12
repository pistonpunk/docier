import { describe, expect, it } from 'vitest';

import type { Paragraph } from '../../src/model/blocks/paragraph.js';
import {
  AlternateContent,
  AlternateContentContent,
  OBJECT_REPLACEMENT_CHARACTER,
  UNDERSTOOD_REQUIRES,
  collectAlternateContent,
  requiresPrefixes,
  selectAlternateContent,
  understoodRequiresOf,
} from '../../src/model/index.js';
import {
  MC_NAMESPACE,
  WPC_NAMESPACE,
  WPG_NAMESPACE,
  WPS_NAMESPACE,
  W_NAMESPACE,
} from '../../src/ooxml/namespaces.js';
import {
  buildDocx,
  memberText,
  openModel,
  parseElement,
  reopenModel,
  stylesRelationship,
  stylesXml,
} from './support.js';

const SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const X = 'urn:docier:vendor';

const DECLARED = `xmlns:mc="${MC_NAMESPACE}" xmlns:wps="${WPS_NAMESPACE}" xmlns:wpg="${WPG_NAMESPACE}" xmlns:svg="${SVG}" xmlns:x="${X}"`;

const STYLES = stylesXml(
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
);

const PICTURE =
  '<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="stamp" style="width:60pt;height:60pt">' +
  '<v:imagedata r:id="rId9"/></v:shape></w:pict>';

const SHAPE =
  '<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
  '<wp:extent cx="254000" cy="254000"/><wp:docPr id="1" name="Shape 1"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  `<a:graphicData uri="${WPS_NAMESPACE}"><wps:wsp xmlns:wps="${WPS_NAMESPACE}"/></a:graphicData>` +
  '</a:graphic></wp:inline></w:drawing>';

const alternate = (children: string, declared = DECLARED): string =>
  `<mc:AlternateContent ${declared}>${children}</mc:AlternateContent>`;

const choice = (requires: string, body = ''): string =>
  `<mc:Choice Requires="${requires}">${body}</mc:Choice>`;

const fallback = (body = ''): string => `<mc:Fallback>${body}</mc:Fallback>`;

const selectionOf = (children: string, declared?: string) =>
  selectAlternateContent(parseElement(alternate(children, declared)));

const paragraphOf = async (body: string, extraNamespaces = ''): Promise<Paragraph> => {
  const model = await openModel({
    body,
    styles: STYLES,
    documentRelationships: [stylesRelationship()],
    extraDocumentNamespaces: extraNamespaces,
  });
  const paragraph = model.paragraphs()[0];
  if (paragraph === undefined) throw new Error('no paragraph');
  return paragraph;
};

const runOf = async (body: string, extraNamespaces = '') => {
  const paragraph = await paragraphOf(body, extraNamespaces);
  const run = paragraph.runs()[0];
  if (run === undefined) throw new Error('no run');
  return run;
};

describe('the branch-selection rule', () => {
  it('uses the first mc:Choice whose Requires names an implemented namespace', () => {
    const selection = selectionOf(choice('wps') + choice('wpg') + fallback());
    expect(selection.kind).toBe('choice');
    expect(selection.element?.localName).toBe('Choice');
    expect(selection.element?.attributes.find((a) => a.localName === 'Requires')?.value).toBe('wps');
    expect(selection.skipped).toEqual([]);
    expect(selection.fallback?.localName).toBe('Fallback');
  });

  it('skips a Choice whose namespace it does not implement and takes the mc:Fallback', () => {
    const selection = selectionOf(choice('svg') + fallback());
    expect(selection.kind).toBe('fallback');
    expect(selection.element?.localName).toBe('Fallback');
    expect(selection.skipped.length).toBe(1);
    expect(selection.skipped[0]?.resolutions).toEqual([
      { kind: 'unsupported', prefix: 'svg', namespace: SVG },
    ]);
  });

  it('reports a Requires prefix that is not declared anywhere in scope', () => {
    const selection = selectionOf(choice('docierUnimplemented') + fallback());
    expect(selection.kind).toBe('fallback');
    expect(selection.skipped[0]?.resolutions).toEqual([
      { kind: 'undeclared', prefix: 'docierUnimplemented' },
    ]);
  });

  it('treats a missing or empty Requires as unusable', () => {
    for (const requires of ['', '   ']) {
      const selection = selectionOf(`<mc:Choice Requires="${requires}"/>${fallback()}`);
      expect(selection.kind).toBe('fallback');
      expect(selection.choices[0]?.isUsable).toBe(false);
      expect(selection.choices[0]?.resolutions).toEqual([]);
    }
    const absent = selectionOf(`<mc:Choice/>${fallback()}`);
    expect(absent.choices[0]?.requires).toBe('');
    expect(absent.kind).toBe('fallback');
  });

  it('requires every prefix of a multi-prefix Requires to be understood', () => {
    expect(requiresPrefixes('  wps   wpg ')).toEqual(['wps', 'wpg']);
    expect(selectionOf(choice('wps wpg') + fallback()).kind).toBe('choice');
    const mixed = selectionOf(choice('wps svg') + fallback());
    expect(mixed.kind).toBe('fallback');
    expect(mixed.skipped[0]?.resolutions).toEqual([
      { kind: 'understood', prefix: 'wps', namespace: WPS_NAMESPACE },
      { kind: 'unsupported', prefix: 'svg', namespace: SVG },
    ]);
  });

  it('reports no branch when there is neither a usable choice nor a fallback', () => {
    const empty = selectionOf('');
    expect(empty.kind).toBe('none');
    expect(empty.element).toBeUndefined();
    expect(empty.fallback).toBeUndefined();

    const unusable = selectionOf(choice('svg'));
    expect(unusable.kind).toBe('none');
    expect(unusable.element).toBeUndefined();
    expect(unusable.skipped.length).toBe(1);
  });

  it('resolves Requires prefixes against the in-scope xml namespace declarations', () => {
    const local = selectionOf(choice('wps') + fallback(), `xmlns:mc="${MC_NAMESPACE}"`);
    expect(local.kind).toBe('fallback');

    const rebound = selectionOf(
      choice('wps') + fallback(),
      `xmlns:mc="${MC_NAMESPACE}" xmlns:wps="${WPG_NAMESPACE}"`,
    );
    expect(rebound.kind).toBe('choice');
    expect(rebound.choices[0]?.resolutions).toEqual([
      { kind: 'understood', prefix: 'wps', namespace: WPG_NAMESPACE },
    ]);
  });

  it('knows exactly the three drawing namespaces it can lay out', () => {
    expect(UNDERSTOOD_REQUIRES.map((entry) => entry.prefix)).toEqual(['wps', 'wpg', 'wpc']);
    expect(understoodRequiresOf(WPS_NAMESPACE)?.content).toBe('wordprocessingShape');
    expect(understoodRequiresOf(WPG_NAMESPACE)?.content).toBe('wordprocessingGroup');
    expect(understoodRequiresOf(WPC_NAMESPACE)?.content).toBe('wordprocessingCanvas');
    expect(understoodRequiresOf(SVG)).toBeUndefined();
    expect(understoodRequiresOf(W_NAMESPACE)).toBeUndefined();
  });
});

describe('mc:AlternateContent inside a run', () => {
  it('keeps the wrapper as one content and resolves the chosen branch on expansion', async () => {
    const run = await runOf(
      `<w:p><w:r>${alternate(choice('wps', '<w:drawing/>') + fallback('<w:t>fallback</w:t>'))}</w:r></w:p>`,
    );
    const contents = run.contents();
    expect(contents.map((content) => content.kind)).toEqual(['alternateContent']);

    const wrapper = contents[0];
    expect(wrapper).toBeInstanceOf(AlternateContentContent);
    if (!(wrapper instanceof AlternateContentContent)) throw new Error('not a wrapper');
    expect(wrapper.isUsable).toBe(true);
    expect(wrapper.chosenElement?.localName).toBe('Choice');
    expect(wrapper.selection.kind).toBe('choice');
    expect(wrapper.selection.fallback?.localName).toBe('Fallback');

    expect(run.resolvedContents().map((content) => content.kind)).toEqual(['drawing']);
    expect(run.hasDrawing).toBe(true);
    expect(run.logicalText).toBe(OBJECT_REPLACEMENT_CHARACTER);
  });

  it('resolves the fallback when the choice names a namespace it cannot use', async () => {
    const run = await runOf(
      `<w:p><w:r>${alternate(choice('svg', '<w:drawing/>') + fallback('<w:t>fallback</w:t>'))}</w:r></w:p>`,
    );
    expect(run.resolvedContents().map((content) => content.kind)).toEqual(['text']);
    expect(run.hasDrawing).toBe(false);
    expect(run.logicalText).toBe('fallback');
  });

  it('resolves a Requires prefix declared on an ancestor element', async () => {
    const run = await runOf(
      `<w:p><w:r>${alternate(choice('wps', '<w:drawing/>') + fallback(), `xmlns:mc="${MC_NAMESPACE}"`)}</w:r></w:p>`,
      ` xmlns:wps="${WPS_NAMESPACE}"`,
    );
    const wrapper = run.contents()[0];
    if (!(wrapper instanceof AlternateContentContent)) throw new Error('not a wrapper');
    expect(wrapper.selection.kind).toBe('choice');
    expect(run.resolvedContents().map((content) => content.kind)).toEqual(['drawing']);
  });

  it('resolves a wrapper nested inside a chosen branch', async () => {
    const inner = alternate(
      choice('svg', '<w:drawing/>') + fallback('<w:t>inner</w:t>'),
      `xmlns:mc="${MC_NAMESPACE}" xmlns:svg="${SVG}"`,
    );
    const run = await runOf(`<w:p><w:r>${alternate(choice('wps', inner) + fallback())}</w:r></w:p>`);
    expect(run.contents().map((content) => content.kind)).toEqual(['alternateContent']);
    expect(run.resolvedContents().map((content) => content.kind)).toEqual(['text']);
    expect(run.logicalText).toBe('inner');
  });

  it('resolves nothing when no branch is usable', async () => {
    const run = await runOf(`<w:p><w:r>${alternate(choice('svg', '<w:drawing/>'))}</w:r></w:p>`);
    const wrapper = run.contents()[0];
    if (!(wrapper instanceof AlternateContentContent)) throw new Error('not a wrapper');
    expect(wrapper.isUsable).toBe(false);
    expect(wrapper.chosenElement).toBeUndefined();
    expect(run.resolvedContents()).toEqual([]);
    expect(run.logicalText).toBe('');
  });
});

describe('mc:AlternateContent outside a run', () => {
  it('collects a paragraph-level wrapper and exposes its chosen branch as inline children', async () => {
    const paragraph = await paragraphOf(
      `<w:p>${alternate(choice('wps', '<w:r><w:t>chosen</w:t></w:r>') + fallback('<w:r><w:t>fallback</w:t></w:r>'))}</w:p>`,
    );
    const wrappers = collectAlternateContent(paragraph.inlineChildren());
    expect(wrappers.length).toBe(1);

    const wrapper = wrappers[0];
    expect(wrapper).toBeInstanceOf(AlternateContent);
    if (wrapper === undefined) throw new Error('no wrapper');
    expect(wrapper.isUsable).toBe(true);
    expect(wrapper.children().map((child) => child.inlineKind)).toEqual(['run']);
    expect(wrapper.logicalText).toBe('chosen');
    expect(wrapper.isTextual).toBe(true);

    expect(paragraph.logicalText).toBe('chosen');
    expect(paragraph.runs().map((run) => run.logicalText)).toEqual(['chosen']);
  });

  it('collects a wrapper nested inside a hyperlink', async () => {
    const paragraph = await paragraphOf(
      `<w:p><w:hyperlink w:anchor="top">${alternate(choice('wps', '<w:r><w:t>linked</w:t></w:r>') + fallback())}</w:hyperlink></w:p>`,
    );
    const wrappers = collectAlternateContent(paragraph.inlineChildren());
    expect(wrappers.length).toBe(1);
    expect(wrappers[0]?.logicalText).toBe('linked');
    expect(paragraph.logicalText).toBe('linked');
  });

  it('reports a paragraph-level wrapper with no usable branch', async () => {
    const paragraph = await paragraphOf(
      `<w:p>${alternate(choice('svg', '<w:r><w:t>vector</w:t></w:r>'))}</w:p>`,
    );
    const wrapper = collectAlternateContent(paragraph.inlineChildren())[0];
    if (wrapper === undefined) throw new Error('no wrapper');
    expect(wrapper.isUsable).toBe(false);
    expect(wrapper.chosenElement).toBeUndefined();
    expect(wrapper.children()).toEqual([]);
    expect(wrapper.logicalText).toBe('');
    expect(paragraph.logicalText).toBe('');
  });
});

describe('the wrapper survives a write back', () => {
  const BODY =
    `<w:p><w:r>${alternate(choice('wps', SHAPE) + fallback(PICTURE))}</w:r></w:p>` +
    '<w:p><w:r><w:t>edit me</w:t></w:r></w:p>';

  const SPEC = {
    body: BODY,
    styles: STYLES,
    documentRelationships: [stylesRelationship()],
  };

  const documentXml = (bytes: Uint8Array): string => {
    const text = memberText(bytes, 'word/document.xml');
    if (text === undefined) throw new Error('no word/document.xml in the archive');
    return text;
  };

  it('hands an untouched document with a wrapper back unchanged', async () => {
    const archive = buildDocx(SPEC);
    const model = await reopenModel(archive);

    expect(await model.synchroniseEditedParts()).toEqual([]);
    const saved = await model.save();

    expect(documentXml(saved)).toBe(documentXml(archive));
    expect(documentXml(saved)).toContain('<mc:AlternateContent');
    expect(documentXml(saved)).toContain('<mc:Choice Requires="wps">');
    expect(documentXml(saved)).toContain('<mc:Fallback>');
    expect(documentXml(saved)).toContain('<v:shape');
  });

  it('keeps the wrapper verbatim when another paragraph is edited', async () => {
    const model = await reopenModel(buildDocx(SPEC));
    const second = model.paragraphs()[1];
    if (second === undefined) throw new Error('no second paragraph');
    second.setText('edited');

    const xml = documentXml(await model.save());
    expect(xml).toContain('>edited<');
    expect(xml).toContain(`<mc:AlternateContent ${DECLARED}>`);
    expect(xml).toContain('<wps:wsp xmlns:wps="' + WPS_NAMESPACE + '"/>');
    expect(xml).toContain(PICTURE);
  });

  it('keeps the wrapper resolvable across a save and a reload', async () => {
    const model = await reopenModel(buildDocx(SPEC));
    const first = model.paragraphs()[0]?.runs()[0]?.contents()[0];
    if (!(first instanceof AlternateContentContent)) throw new Error('no wrapper');
    expect(first.selection.kind).toBe('choice');

    const reopened = await reopenModel(await model.save());
    const again = reopened.paragraphs()[0]?.runs()[0]?.contents()[0];
    if (!(again instanceof AlternateContentContent)) throw new Error('no wrapper after reload');
    expect(again.selection.kind).toBe('choice');
    expect(again.selection.skipped).toEqual([]);
    expect(
      reopened.paragraphs()[0]?.runs()[0]?.resolvedContents().map((content) => content.kind),
    ).toEqual(['drawing']);
    expect(again.logicalText).toBe(OBJECT_REPLACEMENT_CHARACTER);
  });
});
