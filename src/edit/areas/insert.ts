import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { R_NAMESPACE, xml } from '../../ooxml/index.js';
import type { BorderSide } from '../../model/index.js';
import { createWElement, setWAttr } from '../../model/index.js';
import { buildTextBoxDrawing } from '../../ooxml/drawing.js';
import { twip, twipToEmu } from '../../units/index.js';
import { appendRun, insertContainerAt, insertRunChildAt } from './content.js';
import { nextDocPrId } from './object.js';
import { docPos } from '../../layout/index.js';
import { caretSelection } from '../selection.js';
import { areaCommand, writingAt } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

const HYPERLINK_RELATIONSHIP = `${R_NAMESPACE}/hyperlink`;

const NOT_ALIGNED: LocalizedString =
  'This document lays out in a way the editing layer cannot map onto paragraphs, so this command is unavailable';

export const HYPERLINK_STYLE = 'Hyperlink';

export interface SymbolArgs {
  readonly char?: string | undefined;
  readonly codePoint?: number | undefined;
  readonly font?: string | undefined;
}

export interface LinkArgs {
  readonly url?: string | undefined;
  readonly text?: string | undefined;
  readonly tooltip?: string | undefined;
}

export interface FieldArgs {
  readonly instruction?: string | undefined;
  readonly format?: string | undefined;
}

const DEFAULT_SYMBOL_FONT = 'Segoe UI Symbol';

interface CaretTarget {
  readonly element: XmlElement;
  readonly offset: number;
  readonly partName: string | undefined;
}

const caretOf = (host: AreaHost): CaretTarget | undefined => {
  const target = host.session.resolve(host.selection.focus);
  if (target === undefined) return undefined;
  return {
    element: target.slot.element,
    offset: target.offset,
    partName: host.session.model.story(target.slot.story)?.partName,
  };
};

export const hexOf = (args: SymbolArgs): string | undefined => {
  const point =
    args.codePoint ??
    (args.char === undefined || args.char === '' ? undefined : args.char.codePointAt(0));
  if (point === undefined || !Number.isFinite(point) || point < 0) return undefined;
  return point.toString(16).toUpperCase().padStart(4, '0');
};

const symbolSpec: AreaSpec<SymbolArgs> = {
  id: 'docier.command.insert.symbol',
  label: 'Symbol',
  category: 'insert',
  permissions: ['insert'],
  enabledIn: (_host, args) => hexOf(args ?? {}) !== undefined,
  reason: () => 'This control needs a symbol to insert',
  run: (active, args) => {
    const hex = hexOf(args);
    const target = caretOf(active);
    if (hex === undefined || target === undefined) return false;
    return writingAt(active, () =>
      insertRunChildAt(active.session.model, target.element, target.offset, (run) => {
        const symbol = createWElement(run, 'sym');
        setWAttr(symbol, 'font', args.font ?? DEFAULT_SYMBOL_FONT);
        setWAttr(symbol, 'char', hex);
        run.children.push(symbol);
      }),
    );
  },
};

const relationshipFor = (host: AreaHost, url: string, partName: string | undefined): string => {
  const pkg = host.session.model.package;
  const owner = partName ?? pkg.mainDocumentPartName;
  const existing = pkg
    .getRelationships(owner, HYPERLINK_RELATIONSHIP)
    .find((relationship) => relationship.target === url && relationship.targetMode === 'External');
  if (existing !== undefined) return existing.id;
  return pkg.addRelationship(owner, {
    type: HYPERLINK_RELATIONSHIP,
    target: url,
    targetMode: 'External',
  }).id;
};

const linkSpec: AreaSpec<LinkArgs> = {
  id: 'docier.command.insert.link',
  label: 'Hyperlink',
  category: 'insert',
  permissions: ['insert'],
  enabledIn: (_host, args) => args?.url !== undefined && args.url !== '',
  reason: () => 'This control needs a web address to link to',
  run: (active, args) => {
    const url = args.url;
    const target = caretOf(active);
    if (url === undefined || url === '' || target === undefined) return false;
    const relationshipId = relationshipFor(active, url, target.partName);
    return writingAt(active, () =>
      insertContainerAt(
        active.session.model,
        target.element,
        target.offset,
        'hyperlink',
        (container) => {
          xml.setAttribute(container, 'id', relationshipId, 'r', R_NAMESPACE);
          if (args.tooltip !== undefined) setWAttr(container, 'tooltip', args.tooltip);
          const run = appendRun(container, args.text ?? url);
          const properties = createWElement(run, 'rPr');
          const style = createWElement(properties, 'rStyle');
          setWAttr(style, 'val', HYPERLINK_STYLE);
          properties.children.push(style);
          run.children.unshift(properties);
        },
      ),
    );
  },
};

const fieldSpec = (id: string, label: string, instruction: string): AreaSpec<FieldArgs> => ({
  id,
  label,
  category: 'insert',
  permissions: ['insert'],
  run: (active, args) => {
    const target = caretOf(active);
    if (target === undefined) return false;
    const format = args.format;
    const text =
      args.instruction ??
      (format === undefined || format === '' ? instruction : `${instruction} \\@ "${format}"`);
    return writingAt(active, () =>
      insertContainerAt(active.session.model, target.element, target.offset, 'fldSimple', (container) => {
        setWAttr(container, 'instr', text);
        setWAttr(container, 'dirty', 'true');
      }),
    );
  },
});

const paragraphWith = (
  parent: XmlElement,
  build: (paragraph: XmlElement) => void,
  style?: string,
): XmlElement => {
  const paragraph = createWElement(parent, 'p');
  paragraph.selfClosing = false;
  if (style !== undefined) {
    const properties = createWElement(paragraph, 'pPr');
    const applied = createWElement(properties, 'pStyle');
    setWAttr(applied, 'val', style);
    properties.children.push(applied);
    paragraph.children.push(properties);
  }
  build(paragraph);
  return paragraph;
};

export type CoverDesign = 'plain' | 'banded' | 'lines';

export interface CoverPageArgs {
  readonly design?: CoverDesign;
  readonly title?: string;
  readonly subtitle?: string;
  readonly author?: string;
}

const COVER_DESIGNS: readonly CoverDesign[] = ['plain', 'banded', 'lines'];

const COVER_DEFAULT_TITLE = '[Document title]';
const COVER_DEFAULT_SUBTITLE = '[Subtitle]';
const COVER_DEFAULT_AUTHOR = '[Author]';

const pageBreak = (parent: XmlElement): XmlElement =>
  paragraphWith(parent, (paragraph) => {
    const run = appendRun(paragraph, '');
    const br = createWElement(run, 'br');
    setWAttr(br, 'type', 'page');
    run.children.push(br);
  });

const centre = (paragraph: XmlElement): void => {
  const properties = paragraph.children.find(
    (child): child is XmlElement => child.kind === 'element' && child.localName === 'pPr',
  );
  const owner = properties ?? createWElement(paragraph, 'pPr');
  const justification = createWElement(owner, 'jc');
  setWAttr(justification, 'val', 'center');
  owner.children.push(justification);
  if (properties === undefined) paragraph.children.unshift(owner);
};

const sizedRun = (
  paragraph: XmlElement,
  text: string,
  halfPoints: number,
  bold: boolean,
): void => {
  const run = appendRun(paragraph, text);
  const properties = createWElement(run, 'rPr');
  if (bold) {
    const heavy = createWElement(properties, 'b');
    properties.children.push(heavy);
  }
  const size = createWElement(properties, 'sz');
  setWAttr(size, 'val', String(halfPoints));
  properties.children.push(size);
  run.children.unshift(properties);
};

const ruleParagraph = (parent: XmlElement, sides: readonly BorderSide[]): XmlElement => {
  const paragraph = createWElement(parent, 'p');
  paragraph.selfClosing = false;
  const properties = createWElement(paragraph, 'pPr');
  const borders = createWElement(properties, 'pBdr');
  for (const side of sides) {
    const border = createWElement(borders, side);
    setWAttr(border, 'val', 'single');
    setWAttr(border, 'sz', '8');
    setWAttr(border, 'space', '1');
    setWAttr(border, 'color', 'auto');
    borders.children.push(border);
  }
  properties.children.push(borders);
  paragraph.children.push(properties);
  return paragraph;
};

const coverSpec: AreaSpec<CoverPageArgs> = {
  id: 'docier.command.insert.coverPage',
  label: 'Cover page',
  category: 'insert',
  permissions: ['insert'],
  enabledIn: (host) =>
    host.session.aligned &&
    host.selection.focus === host.session.index.documentStart &&
    host.session.index.storyAt(host.selection.focus)?.kind === 'body',
  reason: (host) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    if (host.session.index.storyAt(host.selection.focus)?.kind !== 'body') {
      return 'Place the caret in the body to insert a cover page';
    }
    return 'A cover page goes at the start of the document; move the caret to the first paragraph';
  },
  run: (host, args) => {
    const design = args?.design ?? 'plain';
    if (!COVER_DESIGNS.includes(design)) return false;
    const model = host.session.model;
    const body = model.body().element;
    const styles = model.styles;
    const changed = writingAt(host, () => {
      for (const id of ['Title', 'Subtitle']) styles?.ensure(id);
      const blocks: XmlElement[] = [];
      if (design === 'banded') blocks.push(ruleParagraph(body, ['bottom']));
      blocks.push(
        paragraphWith(
          body,
          (paragraph) => {
            centre(paragraph);
            sizedRun(paragraph, args?.title ?? COVER_DEFAULT_TITLE, 56, true);
          },
          'Title',
        ),
      );
      blocks.push(
        paragraphWith(
          body,
          (paragraph) => {
            centre(paragraph);
            sizedRun(paragraph, args?.subtitle ?? COVER_DEFAULT_SUBTITLE, 26, false);
          },
          'Subtitle',
        ),
      );
      if (design === 'lines') blocks.push(ruleParagraph(body, ['top', 'bottom']));
      blocks.push(paragraphWith(body, (paragraph) => appendRun(paragraph, args?.author ?? COVER_DEFAULT_AUTHOR)));
      blocks.push(pageBreak(body));

      const first = body.children.findIndex(
        (child) => child.kind === 'element' && (child.localName === 'p' || child.localName === 'tbl'),
      );
      const at = first < 0 ? body.children.length : first;
      for (const block of blocks) block.parent = body;
      body.children.splice(at, 0, ...blocks);
      body.selfClosing = false;
      model.context.forgetSubtree(body);
      return true;
    });
    if (!changed) return false;
    host.session.relayout();
    host.setSelection(caretSelection(docPos(0), 'downstream'), 'input');
    return true;
  },
};

export interface TextBoxArgs {
  readonly text?: string | undefined;
  readonly widthTwips?: number | undefined;
  readonly heightTwips?: number | undefined;
  readonly name?: string | undefined;
}

const DEFAULT_TEXT_BOX = { width: 3600, height: 1440 } as const;

const textBoxSpec: AreaSpec<TextBoxArgs> = {
  id: 'docier.command.insert.textBox',
  label: 'Text box',
  category: 'insert',
  permissions: ['insert'],
  enabledIn: (host) =>
    host.session.aligned && host.session.index.storyAt(host.selection.focus)?.kind === 'body',
  reason: (host) =>
    host.session.aligned ? 'Place the caret in the body to insert a text box' : NOT_ALIGNED,
  run: (host, args) => {
    const target = caretOf(host);
    if (target === undefined) return false;
    const width = Math.max(720, Math.floor(args?.widthTwips ?? DEFAULT_TEXT_BOX.width));
    const height = Math.max(720, Math.floor(args?.heightTwips ?? DEFAULT_TEXT_BOX.height));
    const name = args?.name ?? 'Text Box';
    const drawing = buildTextBoxDrawing({
      cx: twipToEmu(twip(width)),
      cy: twipToEmu(twip(height)),
      docPrId: nextDocPrId(host.session.model),
      name,
      text: args?.text ?? '',
    });
    const changed = writingAt(host, () =>
      insertRunChildAt(host.session.model, target.element, target.offset, (run) => {
        run.children.push(drawing);
        drawing.parent = run;
      }),
    );
    if (!changed) return false;
    host.session.model.context.forgetSubtree(target.element);
    return true;
  },
};

export const FIELD_INSERTS: readonly { readonly id: string; readonly label: string; readonly instruction: string }[] = [
  { id: 'docier.command.insert.pageNumber', label: 'Page number', instruction: 'PAGE' },
  { id: 'docier.command.insert.pageCount', label: 'Page count', instruction: 'NUMPAGES' },
  { id: 'docier.command.insert.sectionNumber', label: 'Section number', instruction: 'SECTION' },
  { id: 'docier.command.insert.sectionPageCount', label: 'Section page count', instruction: 'SECTIONPAGES' },
  { id: 'docier.command.insert.dateTime', label: 'Date and time', instruction: 'DATE' },
  { id: 'docier.command.insert.time', label: 'Time', instruction: 'TIME' },
];

export const insertCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<SymbolArgs>(host, symbolSpec),
  areaCommand<LinkArgs>(host, linkSpec),
  ...FIELD_INSERTS.map((field) =>
    areaCommand<FieldArgs>(host, fieldSpec(field.id, field.label, field.instruction)),
  ),
  areaCommand<CoverPageArgs>(host, coverSpec),
  areaCommand<TextBoxArgs>(host, textBoxSpec),
];
