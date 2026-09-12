import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { NodeId } from '../ids.js';
import { ModelNode } from '../view.js';
import { W, childElements, isWElement, setElementText, setWAttr, textOfElement, wAttr } from '../xml.js';
import type { AlternateContentSelection } from './alternate-content.js';
import { isAlternateContentElement, selectAlternateContent } from './alternate-content.js';

export const TAB_CHARACTER = '\t';
export const LINE_BREAK_CHARACTER = '\n';
export const NO_BREAK_HYPHEN_CHARACTER = '\u2011';
export const SOFT_HYPHEN_CHARACTER = '\u00AD';
export const OBJECT_REPLACEMENT_CHARACTER = '\uFFFC';
export const FIELD_RESULT_BOUNDARY = '\u0001';

export type RunContentKind =
  | 'text'
  | 'deletedText'
  | 'tab'
  | 'break'
  | 'carriageReturn'
  | 'noBreakHyphen'
  | 'softHyphen'
  | 'symbol'
  | 'drawing'
  | 'picture'
  | 'object'
  | 'fieldChar'
  | 'instructionText'
  | 'noteReference'
  | 'annotationReference'
  | 'separator'
  | 'pageNumber'
  | 'lastRenderedPageBreak'
  | 'positionalTab'
  | 'alternateContent'
  | 'opaque';

export type BreakKind = 'text' | 'page' | 'column' | 'lineClear';
export type FieldCharKind = 'begin' | 'separate' | 'end';

const BREAK_KINDS: ReadonlySet<string> = new Set(['text', 'page', 'column', 'lineClear']);

export abstract class RunContent extends ModelNode {
  abstract readonly kind: RunContentKind;

  constructor(id: NodeId, element: XmlElement) {
    super(id, element);
  }

  get logicalText(): string {
    return '';
  }

  get isPreserved(): boolean {
    return false;
  }

  get rawAttributes(): readonly string[] {
    return this.element.attributes.map((attribute) => attribute.localName);
  }
}

export class TextContent extends RunContent {
  readonly kind = 'text' as const;

  get value(): string {
    return textOfElement(this.element);
  }

  set value(to: string) {
    setElementText(this.element, to);
  }

  get logicalText(): string {
    return this.value;
  }

  get isPreserved(): boolean {
    return this.element.attributes.some(
      (attribute) => attribute.localName === 'space' && attribute.value === 'preserve',
    );
  }
}

export class DeletedTextContent extends RunContent {
  readonly kind = 'deletedText' as const;

  get value(): string {
    return textOfElement(this.element);
  }

  set value(to: string) {
    setElementText(this.element, to);
  }

  get logicalText(): string {
    return this.value;
  }

  get isPreserved(): boolean {
    return this.element.attributes.some(
      (attribute) => attribute.localName === 'space' && attribute.value === 'preserve',
    );
  }
}

export class TabContent extends RunContent {
  readonly kind = 'tab' as const;

  get logicalText(): string {
    return TAB_CHARACTER;
  }
}

export class BreakContent extends RunContent {
  readonly kind = 'break' as const;

  get breakKind(): BreakKind {
    const raw = wAttr(this.element, 'type');
    return raw !== undefined && BREAK_KINDS.has(raw) ? (raw as BreakKind) : 'text';
  }

  set breakKind(to: BreakKind) {
    setWAttr(this.element, 'type', to);
  }

  get clearKind(): string | undefined {
    return wAttr(this.element, 'clear');
  }

  get logicalText(): string {
    return this.breakKind === 'text' ? LINE_BREAK_CHARACTER : '';
  }
}

export class CarriageReturnContent extends RunContent {
  readonly kind = 'carriageReturn' as const;

  get logicalText(): string {
    return LINE_BREAK_CHARACTER;
  }
}

export class HyphenContent extends RunContent {
  readonly kind: RunContentKind;

  constructor(id: NodeId, element: XmlElement) {
    super(id, element);
    this.kind = element.localName === 'noBreakHyphen' ? 'noBreakHyphen' : 'softHyphen';
  }

  get logicalText(): string {
    return this.kind === 'noBreakHyphen' ? NO_BREAK_HYPHEN_CHARACTER : SOFT_HYPHEN_CHARACTER;
  }
}

export class SymbolContent extends RunContent {
  readonly kind = 'symbol' as const;

  get font(): string | undefined {
    return wAttr(this.element, 'font');
  }

  get char(): string | undefined {
    return wAttr(this.element, 'char');
  }

  get codePoint(): number | undefined {
    const raw = this.char;
    if (raw === undefined) return undefined;
    const parsed = Number.parseInt(raw, 16);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  get logicalText(): string {
    const codePoint = this.codePoint;
    return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
  }
}

export class DrawingContent extends RunContent {
  readonly kind: 'drawing' | 'picture' | 'object';

  constructor(id: NodeId, element: XmlElement) {
    super(id, element);
    this.kind =
      element.localName === 'drawing' ? 'drawing' : element.localName === 'pict' ? 'picture' : 'object';
  }

  get isInlineDrawing(): boolean {
    return this.element.children.some(
      (child) => child.kind === 'element' && child.localName === 'inline',
    );
  }

  get isAnchoredDrawing(): boolean {
    return this.element.children.some(
      (child) => child.kind === 'element' && child.localName === 'anchor',
    );
  }

  get textboxParagraphs(): readonly XmlElement[] {
    return childElements(this.element).flatMap((child) => descendantsNamed(child, 'txbxContent')).flatMap(
      (content) => childElements(content).filter((element) => isWElement(element, 'p')),
    );
  }

  get logicalText(): string {
    return OBJECT_REPLACEMENT_CHARACTER;
  }
}

const descendantsNamed = (element: XmlElement, localName: string): readonly XmlElement[] => {
  const found: XmlElement[] = [];
  for (const child of childElements(element)) {
    if (child.localName === localName) found.push(child);
    found.push(...descendantsNamed(child, localName));
  }
  return found;
};

export class FieldCharContent extends RunContent {
  readonly kind = 'fieldChar' as const;

  get fieldCharKind(): FieldCharKind {
    const raw = wAttr(this.element, 'fldCharType');
    if (raw === 'begin' || raw === 'separate' || raw === 'end') return raw;
    return 'begin';
  }

  get isDirty(): boolean {
    return wAttr(this.element, 'dirty') !== undefined;
  }

  get isLocked(): boolean {
    return wAttr(this.element, 'fldLock') !== undefined;
  }

  get logicalText(): string {
    return this.fieldCharKind === 'separate' ? FIELD_RESULT_BOUNDARY : '';
  }
}

export class InstructionTextContent extends RunContent {
  readonly kind = 'instructionText' as const;

  get value(): string {
    return textOfElement(this.element);
  }

  set value(to: string) {
    setElementText(this.element, to);
  }
}

export class NoteReferenceContent extends RunContent {
  readonly kind: 'noteReference' | 'annotationReference';

  constructor(id: NodeId, element: XmlElement) {
    super(id, element);
    this.kind =
      element.localName === 'footnoteReference' || element.localName === 'endnoteReference'
        ? 'noteReference'
        : 'annotationReference';
  }

  get noteId(): number | undefined {
    const raw = wAttr(this.element, 'id');
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  get isFootnote(): boolean {
    return this.element.localName === 'footnoteReference';
  }

  get logicalText(): string {
    return this.kind === 'noteReference' ? OBJECT_REPLACEMENT_CHARACTER : '';
  }
}

export class MarkerContent extends RunContent {
  readonly kind: 'separator' | 'pageNumber' | 'lastRenderedPageBreak' | 'positionalTab';

  constructor(id: NodeId, element: XmlElement) {
    super(id, element);
    this.kind =
      element.localName === 'pgNum'
        ? 'pageNumber'
        : element.localName === 'lastRenderedPageBreak'
          ? 'lastRenderedPageBreak'
          : element.localName === 'ptab'
            ? 'positionalTab'
            : 'separator';
  }

  get alignment(): string | undefined {
    return wAttr(this.element, 'alignment');
  }

  get logicalText(): string {
    return this.kind === 'positionalTab' ? TAB_CHARACTER : '';
  }
}

export class OpaqueContent extends RunContent {
  readonly kind = 'opaque' as const;

  get localName(): string {
    return this.element.localName;
  }

  get namespaceUri(): string {
    return this.element.uri;
  }
}

export class AlternateContentContent extends RunContent {
  readonly kind = 'alternateContent' as const;
  private readonly resolution: AlternateContentSelection;

  constructor(id: NodeId, element: XmlElement) {
    super(id, element);
    this.resolution = selectAlternateContent(element);
  }

  get selection(): AlternateContentSelection {
    return this.resolution;
  }

  get chosenElement(): XmlElement | undefined {
    return this.resolution.element;
  }

  get isUsable(): boolean {
    return this.resolution.kind !== 'none';
  }

  get logicalText(): string {
    return logicalTextOfContent(this.element);
  }
}

export const resolvedRunContents = (
  context: ModelContext,
  contents: readonly RunContent[],
): readonly RunContent[] => {
  const out: RunContent[] = [];
  for (const content of contents) {
    if (!(content instanceof AlternateContentContent)) {
      out.push(content);
      continue;
    }
    const chosen = content.chosenElement;
    if (chosen === undefined) continue;
    const children = childElements(chosen).map((child) =>
      context.view(child, (id, element) => createRunContent(id, element)),
    );
    out.push(...resolvedRunContents(context, children));
  }
  return out;
};

const KIND_BY_LOCAL_NAME: Readonly<Record<string, RunContentKind>> = {
  t: 'text',
  delText: 'deletedText',
  tab: 'tab',
  br: 'break',
  cr: 'carriageReturn',
  noBreakHyphen: 'noBreakHyphen',
  softHyphen: 'softHyphen',
  sym: 'symbol',
  drawing: 'drawing',
  pict: 'picture',
  object: 'object',
  fldChar: 'fieldChar',
  instrText: 'instructionText',
  footnoteReference: 'noteReference',
  endnoteReference: 'noteReference',
  commentReference: 'annotationReference',
  annotationRef: 'annotationReference',
  separator: 'separator',
  continuationSeparator: 'separator',
  pgNum: 'pageNumber',
  lastRenderedPageBreak: 'lastRenderedPageBreak',
  ptab: 'positionalTab',
};

export const runContentKindOf = (element: XmlElement): RunContentKind =>
  (element.uri === W && KIND_BY_LOCAL_NAME[element.localName]) ||
  (isAlternateContentElement(element) ? 'alternateContent' : 'opaque');

export const createRunContent = (id: NodeId, element: XmlElement): RunContent => {
  switch (runContentKindOf(element)) {
    case 'text':
      return new TextContent(id, element);
    case 'deletedText':
      return new DeletedTextContent(id, element);
    case 'tab':
      return new TabContent(id, element);
    case 'break':
      return new BreakContent(id, element);
    case 'carriageReturn':
      return new CarriageReturnContent(id, element);
    case 'noBreakHyphen':
    case 'softHyphen':
      return new HyphenContent(id, element);
    case 'symbol':
      return new SymbolContent(id, element);
    case 'drawing':
    case 'picture':
    case 'object':
      return new DrawingContent(id, element);
    case 'fieldChar':
      return new FieldCharContent(id, element);
    case 'instructionText':
      return new InstructionTextContent(id, element);
    case 'noteReference':
    case 'annotationReference':
      return new NoteReferenceContent(id, element);
    case 'separator':
    case 'pageNumber':
    case 'lastRenderedPageBreak':
    case 'positionalTab':
      return new MarkerContent(id, element);
    case 'alternateContent':
      return new AlternateContentContent(id, element);
    default:
      return new OpaqueContent(id, element);
  }
};

export const logicalTextOfContent = (element: XmlElement): string => {
  const kind = runContentKindOf(element);
  switch (kind) {
    case 'text':
    case 'deletedText':
      return textOfElement(element);
    case 'alternateContent': {
      const chosen = selectAlternateContent(element).element;
      if (chosen === undefined) return '';
      let text = '';
      for (const child of childElements(chosen)) text += logicalTextOfContent(child);
      return text;
    }
    case 'tab':
      return TAB_CHARACTER;
    case 'break': {
      const raw = wAttr(element, 'type');
      return raw === undefined || raw === 'text' ? LINE_BREAK_CHARACTER : '';
    }
    case 'carriageReturn':
      return LINE_BREAK_CHARACTER;
    case 'noBreakHyphen':
      return NO_BREAK_HYPHEN_CHARACTER;
    case 'softHyphen':
      return SOFT_HYPHEN_CHARACTER;
    case 'positionalTab':
      return TAB_CHARACTER;
    case 'symbol': {
      const raw = wAttr(element, 'char');
      if (raw === undefined) return '';
      const parsed = Number.parseInt(raw, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : '';
    }
    case 'drawing':
    case 'picture':
    case 'object':
    case 'noteReference':
      return OBJECT_REPLACEMENT_CHARACTER;
    case 'fieldChar':
      return wAttr(element, 'fldCharType') === 'separate' ? FIELD_RESULT_BOUNDARY : '';
    default:
      return '';
  }
};
