import type { XmlElement } from '../../ooxml/xml/index.js';
import { insertOrdered } from '../schema-order.js';
import { createWElement, setWAttr } from '../xml.js';

export interface BuiltinStyle {
  readonly styleId: string;
  readonly name: string;
  readonly type: 'paragraph' | 'character' | 'table' | 'numbering';
  readonly basedOn?: string;
  readonly next?: string;
  readonly paragraph?: readonly BuiltinChild[];
  readonly run?: readonly BuiltinChild[];
}

export interface BuiltinChild {
  readonly name: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: readonly BuiltinChild[];
}

const HALF_POINTS = (points: number): string => String(Math.round(points * 2));

export const BUILTIN_STYLES: readonly BuiltinStyle[] = [
  {
    styleId: 'Heading1',
    name: 'heading 1',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: [
      { name: 'keepNext' },
      { name: 'keepLines' },
      { name: 'spacing', attributes: { before: '240', after: '0' } },
      { name: 'outlineLvl', attributes: { val: '0' } },
    ],
    run: [{ name: 'b' }, { name: 'sz', attributes: { val: HALF_POINTS(16) } }],
  },
  {
    styleId: 'Heading2',
    name: 'heading 2',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: [
      { name: 'keepNext' },
      { name: 'keepLines' },
      { name: 'spacing', attributes: { before: '200', after: '0' } },
      { name: 'outlineLvl', attributes: { val: '1' } },
    ],
    run: [{ name: 'b' }, { name: 'sz', attributes: { val: HALF_POINTS(13) } }],
  },
  {
    styleId: 'Heading3',
    name: 'heading 3',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: [
      { name: 'keepNext' },
      { name: 'keepLines' },
      { name: 'spacing', attributes: { before: '160', after: '0' } },
      { name: 'outlineLvl', attributes: { val: '2' } },
    ],
    run: [{ name: 'b' }, { name: 'sz', attributes: { val: HALF_POINTS(12) } }],
  },
  {
    styleId: 'Title',
    name: 'Title',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: [
      { name: 'spacing', attributes: { after: '300' } },
      { name: 'jc', attributes: { val: 'center' } },
    ],
    run: [{ name: 'sz', attributes: { val: HALF_POINTS(28) } }],
  },
  {
    styleId: 'Subtitle',
    name: 'Subtitle',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: [{ name: 'jc', attributes: { val: 'center' } }],
    run: [
      { name: 'color', attributes: { val: '595959' } },
      { name: 'sz', attributes: { val: HALF_POINTS(13) } },
    ],
  },
  {
    styleId: 'Quote',
    name: 'Quote',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: [{ name: 'ind', attributes: { left: '720', right: '720' } }],
    run: [{ name: 'i' }],
  },
  {
    styleId: 'Caption',
    name: 'caption',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: [{ name: 'spacing', attributes: { after: '120' } }],
    run: [
      { name: 'i' },
      { name: 'color', attributes: { val: '44546A' } },
      { name: 'sz', attributes: { val: HALF_POINTS(9) } },
    ],
  },
];

export const builtinStyle = (styleId: string): BuiltinStyle | undefined =>
  BUILTIN_STYLES.find((style) => style.styleId === styleId);

const appendChild = (parent: XmlElement, child: BuiltinChild): void => {
  const element = createWElement(parent, child.name);
  for (const [name, value] of Object.entries(child.attributes ?? {})) {
    setWAttr(element, name, value);
  }
  insertOrdered(parent, element);
  for (const nested of child.children ?? []) appendChild(element, nested);
};

export const styleElementOf = (owner: XmlElement, definition: BuiltinStyle): XmlElement => {
  const style = createWElement(owner, 'style');
  setWAttr(style, 'type', definition.type);
  setWAttr(style, 'styleId', definition.styleId);
  insertOrdered(owner, style);
  appendChild(style, { name: 'name', attributes: { val: definition.name } });
  if (definition.basedOn !== undefined) {
    appendChild(style, { name: 'basedOn', attributes: { val: definition.basedOn } });
  }
  if (definition.next !== undefined) {
    appendChild(style, { name: 'next', attributes: { val: definition.next } });
  }
  appendChild(style, { name: 'qFormat' });
  if (definition.paragraph !== undefined && definition.paragraph.length > 0) {
    appendChild(style, { name: 'pPr', children: definition.paragraph });
  }
  if (definition.run !== undefined && definition.run.length > 0) {
    appendChild(style, { name: 'rPr', children: definition.run });
  }
  return style;
};
