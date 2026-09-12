import type { XmlElement, XmlNode } from '../../ooxml/xml/index.js';
import { createWElement, isWElement, setElementText, setWAttr } from '../../model/index.js';
import { removeChild } from '../../ooxml/xml/tree.js';
import type { ClipboardDegradation, ClipboardFragment, HtmlPolicy } from './types.js';
import { DEFAULT_HTML_POLICY } from './types.js';
import { createWrapper } from './fragment.js';

const HYPERLINK_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

const SKIPPED_ELEMENTS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'head',
  'noscript',
  'title',
  'base',
  'template',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'canvas',
  'video',
  'audio',
  'map',
  'area',
  'xml',
]);

const PARAGRAPH_ELEMENTS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'dd',
  'dt',
  'address',
  'center',
  'caption',
  'figcaption',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'figure',
]);

const LIST_ELEMENTS = new Set(['ul', 'ol', 'menu', 'dir']);

const HEADING_POINTS: Readonly<Record<string, number>> = {
  h1: 24,
  h2: 18,
  h3: 14,
  h4: 12,
  h5: 10,
  h6: 8,
};

const HIGHLIGHT_BY_COLOUR: Readonly<Record<string, string>> = {
  '#ffff00': 'yellow',
  '#00ffff': 'cyan',
  '#00ff00': 'green',
  '#ff00ff': 'magenta',
  '#0000ff': 'blue',
  '#ff0000': 'red',
  '#ffffff': 'white',
  '#000000': 'black',
  '#000080': 'darkBlue',
  '#008080': 'darkCyan',
  '#008000': 'darkGreen',
  '#800080': 'darkMagenta',
  '#808000': 'darkYellow',
  '#808080': 'darkGray',
  '#c0c0c0': 'lightGray',
};

const NAMED_COLOURS: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  lime: '#00ff00',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  purple: '#800080',
  teal: '#008080',
  orange: '#ffa500',
};

const TWIPS_PER_UNIT: Readonly<Record<string, number>> = {
  pt: 20,
  in: 1440,
  cm: 567,
  mm: 57,
  pc: 240,
  px: 15,
  q: 14,
};

const DEFAULT_TABLE_WIDTH = 9020;
const DEFAULT_COLUMN_WIDTH = 1440;
const LIST_INDENT_STEP = 720;

export interface InlineStyle {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly verticalAlign: string | undefined;
  readonly color: string | undefined;
  readonly highlight: string | undefined;
  readonly shade: string | undefined;
  readonly halfPoints: number | undefined;
  readonly family: string | undefined;
  readonly pre: boolean;
}

const BASE_STYLE: InlineStyle = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  verticalAlign: undefined,
  color: undefined,
  highlight: undefined,
  shade: undefined,
  halfPoints: undefined,
  family: undefined,
  pre: false,
};

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly targetMode: string;
}

interface Shared {
  readonly scratch: XmlElement;
  readonly policy: HtmlPolicy;
  readonly degraded: ClipboardDegradation[];
  readonly relationships: Relationship[];
  nodes: number;
  truncated: boolean;
  deep: boolean;
  relationCounter: number;
}

interface Context {
  readonly shared: Shared;
  readonly blocks: XmlElement[];
  sawBlock: boolean;
  listDepth: number;
}

interface Cursor {
  current: XmlElement | undefined;
}

const degrade = (
  list: ClipboardDegradation[],
  reason: string,
  detail: string | undefined,
): void => {
  if (list.some((entry) => entry.reason === reason && entry.detail === detail)) return;
  list.push(detail === undefined ? { reason } : { reason, detail });
};

const normaliseColour = (raw: string): string | undefined => {
  const value = raw.trim().toLowerCase();
  if (value === '' || value === 'transparent' || value === 'inherit' || value === 'initial') {
    return undefined;
  }
  const named = NAMED_COLOURS[value];
  if (named !== undefined) return named;
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    const digits = value.slice(1);
    const doubled = `${digits[0] ?? ''}${digits[0] ?? ''}${digits[1] ?? ''}${digits[1] ?? ''}${digits[2] ?? ''}${digits[2] ?? ''}`;
    return `#${doubled}`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (rgb !== null) {
    const channel = (index: number): string => {
      const parsed = Number.parseInt(rgb[index] ?? '0', 10);
      const clamped = Math.max(0, Math.min(255, Number.isFinite(parsed) ? parsed : 0));
      return clamped.toString(16).padStart(2, '0');
    };
    return `#${channel(1)}${channel(2)}${channel(3)}`;
  }
  return undefined;
};

const cssDeclarations = (style: string): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const chunk of style.split(';')) {
    const at = chunk.indexOf(':');
    if (at < 0) continue;
    const name = chunk.slice(0, at).trim().toLowerCase();
    const value = chunk.slice(at + 1).trim();
    if (name !== '' && value !== '') out.set(name, value);
  }
  return out;
};

const declarationsOf = (element: Element): ReadonlyMap<string, string> =>
  cssDeclarations(element.getAttribute('style') ?? '');

const twipsOf = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const match = /^(-?[\d.]+)\s*([a-z%]*)$/.exec(raw.trim().toLowerCase());
  if (match === null) return undefined;
  const amount = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2] ?? '';
  if (unit === '') return amount === 0 ? 0 : undefined;
  const factor = TWIPS_PER_UNIT[unit];
  return factor === undefined ? undefined : Math.round(amount * factor);
};

const pointsOf = (raw: string | undefined): number | undefined => {
  const twips = twipsOf(raw);
  return twips === undefined ? undefined : twips / 20;
};

const weightOf = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalised = value.trim().toLowerCase();
  if (normalised === 'normal' || normalised === '400' || normalised === 'lighter') return false;
  if (normalised === 'bold' || normalised === 'bolder') return true;
  const numeric = Number.parseInt(normalised, 10);
  return Number.isFinite(numeric) ? numeric >= 600 : undefined;
};

const slantOf = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalised = value.trim().toLowerCase();
  if (normalised === 'normal') return false;
  if (normalised === 'italic' || normalised === 'oblique') return true;
  return undefined;
};

const decorationIncludes = (value: string | undefined, needle: string): boolean =>
  value !== undefined && value.toLowerCase().split(/\s+/).includes(needle);

const styleFor = (parent: InlineStyle, element: Element): InlineStyle => {
  const declarations = declarationsOf(element);
  const tag = element.localName.toLowerCase();
  const weight = weightOf(declarations.get('font-weight'));
  const slant = slantOf(declarations.get('font-style'));
  const decoration = declarations.get('text-decoration') ?? declarations.get('text-decoration-line');
  const background = declarations.get('background-color') ?? declarations.get('background');
  const colour = normaliseColour(declarations.get('color') ?? '');
  const size = pointsOf(declarations.get('font-size'));
  const family = declarations.get('font-family');
  const vertical = declarations.get('vertical-align');
  const backgroundColour = background === undefined ? undefined : normaliseColour(background);
  const highlight = backgroundColour === undefined ? undefined : HIGHLIGHT_BY_COLOUR[backgroundColour];
  return {
    bold: weight ?? (tag === 'b' || tag === 'strong' ? true : parent.bold),
    italic: slant ?? (tag === 'i' || tag === 'em' ? true : parent.italic),
    underline:
      decorationIncludes(decoration, 'underline') ||
      (decoration === undefined && (tag === 'u' || tag === 'ins' ? true : parent.underline)),
    strike:
      decorationIncludes(decoration, 'line-through') ||
      (decoration === undefined && (tag === 's' || tag === 'strike' || tag === 'del' ? true : parent.strike)),
    verticalAlign:
      tag === 'sup' || vertical?.toLowerCase() === 'super'
        ? 'superscript'
        : tag === 'sub' || vertical?.toLowerCase() === 'sub'
          ? 'subscript'
          : parent.verticalAlign,
    color: colour ?? parent.color,
    highlight: highlight ?? (backgroundColour === undefined ? parent.highlight : undefined),
    shade: highlight === undefined && backgroundColour !== undefined ? backgroundColour : parent.shade,
    halfPoints: size === undefined ? parent.halfPoints : Math.round(size * 2),
    family: family === undefined ? parent.family : (family.split(',')[0] ?? '').replace(/["']/g, '').trim(),
    pre: parent.pre || tag === 'pre' || declarations.get('white-space') === 'pre',
  };
};

const dropIfEmpty = (element: XmlElement): void => {
  const parent = element.parent;
  if (parent === undefined) return;
  removeChild(parent, element);
};

const applyRunProperties = (run: XmlElement, style: InlineStyle): void => {
  const properties = createWElement(run, 'rPr');
  if (style.bold) createWElement(properties, 'b');
  if (style.italic) createWElement(properties, 'i');
  if (style.underline) setWAttr(createWElement(properties, 'u'), 'val', 'single');
  if (style.strike) createWElement(properties, 'strike');
  if (style.verticalAlign === 'superscript' || style.verticalAlign === 'subscript') {
    setWAttr(createWElement(properties, 'vertAlign'), 'val', style.verticalAlign);
  }
  if (style.color !== undefined) {
    setWAttr(createWElement(properties, 'color'), 'val', style.color.slice(1));
  }
  if (style.highlight !== undefined) {
    setWAttr(createWElement(properties, 'highlight'), 'val', style.highlight);
  } else if (style.shade !== undefined) {
    const shade = createWElement(properties, 'shd');
    setWAttr(shade, 'val', 'clear');
    setWAttr(shade, 'color', 'auto');
    setWAttr(shade, 'fill', style.shade.slice(1).toUpperCase());
  }
  if (style.halfPoints !== undefined) {
    setWAttr(createWElement(properties, 'sz'), 'val', String(style.halfPoints));
  }
  if (style.family !== undefined && style.family !== '') {
    const fonts = createWElement(properties, 'rFonts');
    setWAttr(fonts, 'ascii', style.family);
    setWAttr(fonts, 'hAnsi', style.family);
  }
  if (properties.children.length === 0) dropIfEmpty(properties);
};

const appendRun = (paragraph: XmlElement, style: InlineStyle, text: string): void => {
  const run = createWElement(paragraph, 'r');
  applyRunProperties(run, style);
  setElementText(createWElement(run, 't'), text);
};

const urlAllowed = (value: string): boolean => {
  const lowered = value.trim().toLowerCase().replace(/[\u0000-\u0020\u007f]/g, '');
  if (lowered === '') return false;
  if (lowered.startsWith('javascript:') || lowered.startsWith('vbscript:') || lowered.startsWith('file:')) {
    return false;
  }
  return !lowered.startsWith('data:') || lowered.startsWith('data:image/');
};

const relationshipFor = (shared: Shared, target: string): string => {
  shared.relationCounter += 1;
  const id = `rIdHtml${String(shared.relationCounter)}`;
  shared.relationships.push({
    id,
    type: HYPERLINK_RELATIONSHIP,
    target,
    targetMode: 'External',
  });
  return id;
};

const noteComment = (shared: Shared, node: Node): void => {
  const data = (node.nodeValue ?? '').toLowerCase();
  if (data.includes('[if') && (data.includes('<w:') || data.includes('<o:'))) {
    degrade(shared.degraded, 'conditional-comment', 'mso');
  }
};

const appendEmbedded = (
  shared: Shared,
  paragraph: XmlElement,
  element: Element,
  style: InlineStyle,
): void => {
  const source = element.getAttribute('src') ?? '';
  const alt = (element.getAttribute('alt') ?? '').trim();
  if (source.startsWith('data:')) {
    degrade(shared.degraded, 'image-data-uri', 'unsupported');
  } else if (source === '') {
    degrade(shared.degraded, 'image-dropped', 'no-source');
  } else if (shared.policy.remoteImages === 'block') {
    degrade(shared.degraded, 'image-blocked', source);
  } else {
    degrade(shared.degraded, 'image-placeholder', source);
  }
  const placeholder = alt !== '' ? `[${alt}]` : source === '' ? '' : `[${source}]`;
  if (placeholder !== '') appendRun(paragraph, style, placeholder);
};

const inlineInto = (
  context: Context,
  paragraph: XmlElement,
  node: Node,
  style: InlineStyle,
  depth: number,
): void => {
  const shared = context.shared;
  if (node.nodeType === 3) {
    const raw = node.nodeValue ?? '';
    const text = style.pre ? raw : raw.replace(/\s+/g, ' ');
    if (text !== '') appendRun(paragraph, style, text);
    return;
  }
  if (node.nodeType === 8) {
    noteComment(shared, node);
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  const tag = element.localName.toLowerCase();
  if (SKIPPED_ELEMENTS.has(tag)) return;
  shared.nodes += 1;
  if (shared.nodes > shared.policy.maxNodes) {
    shared.truncated = true;
    return;
  }
  if (depth > shared.policy.maxDepth) {
    shared.deep = true;
    return;
  }
  if (tag === 'br') {
    createWElement(paragraph, 'br');
    return;
  }
  if (tag === 'img') {
    appendEmbedded(shared, paragraph, element, style);
    return;
  }
  if (PARAGRAPH_ELEMENTS.has(tag) || LIST_ELEMENTS.has(tag) || tag === 'table' || tag === 'hr') {
    return;
  }
  const inner = styleFor(style, element);
  if (tag === 'a') {
    const href = (element.getAttribute('href') ?? '').trim();
    const host = urlAllowed(href) ? wrapHyperlink(context, paragraph, href) : undefined;
    if (host === undefined && href !== '') degrade(shared.degraded, 'url-rejected', href);
    for (const child of element.childNodes) {
      inlineInto(context, host ?? paragraph, child, inner, depth + 1);
    }
    if (host !== undefined && host.children.length === 0) dropIfEmpty(host);
    return;
  }
  for (const child of element.childNodes) inlineInto(context, paragraph, child, inner, depth + 1);
};

const wrapHyperlink = (context: Context, paragraph: XmlElement, href: string): XmlElement => {
  const link = createWElement(paragraph, 'hyperlink');
  setWAttr(link, 'id', relationshipFor(context.shared, href));
  link.selfClosing = false;
  return link;
};

const applyParagraphProperties = (context: Context, paragraph: XmlElement, element: Element): void => {
  const declarations = declarationsOf(element);
  const tag = element.localName.toLowerCase();
  const properties = createWElement(paragraph, 'pPr');
  const justify = declarations.get('text-align')?.trim().toLowerCase();
  const mapped =
    justify === 'justify'
      ? 'both'
      : justify === 'center' || justify === 'right' || justify === 'left'
        ? justify
        : undefined;
  if (mapped !== undefined) setWAttr(createWElement(properties, 'jc'), 'val', mapped);
  const msoList = declarations.get('mso-list');
  let listLeft: number | undefined;
  if (msoList !== undefined) {
    const level = /level(\d+)/i.exec(msoList);
    const parsed = level === null ? 1 : Number.parseInt(level[1] ?? '1', 10);
    listLeft = Math.max(0, parsed - 1) * LIST_INDENT_STEP;
    degrade(context.shared.degraded, 'list-flattened', 'mso-list');
  } else if (tag === 'li') {
    listLeft = Math.max(0, context.listDepth - 1) * LIST_INDENT_STEP;
    degrade(context.shared.degraded, 'list-flattened', 'li');
  }
  const left = Math.max(
    twipsOf(declarations.get('margin-left') ?? declarations.get('padding-left')) ?? 0,
    listLeft ?? 0,
  );
  const indent = twipsOf(declarations.get('text-indent'));
  if (left > 0 || indent !== undefined) {
    const indentation = createWElement(properties, 'ind');
    if (left > 0) setWAttr(indentation, 'left', String(left));
    if (indent !== undefined) setWAttr(indentation, 'firstLine', String(indent));
  }
  const before = twipsOf(declarations.get('margin-top'));
  const after = twipsOf(declarations.get('margin-bottom'));
  if (before !== undefined || after !== undefined) {
    const spacing = createWElement(properties, 'spacing');
    if (before !== undefined) setWAttr(spacing, 'before', String(Math.max(0, before)));
    if (after !== undefined) setWAttr(spacing, 'after', String(Math.max(0, after)));
  }
  if (properties.children.length === 0) dropIfEmpty(properties);
};

const headingStyle = (tag: string, style: InlineStyle): InlineStyle => {
  const points = HEADING_POINTS[tag];
  return points === undefined ? style : { ...style, bold: true, halfPoints: style.halfPoints ?? points * 2 };
};

const childBlocks = (shared: Shared, source: Element, depth: number, style: InlineStyle): readonly XmlElement[] => {
  const nested: Context = {
    shared,
    blocks: [],
    sawBlock: false,
    listDepth: 0,
  };
  walkBlocks(nested, { current: undefined }, source, depth, style);
  return nested.blocks;
};

const COLUMN_SPAN = (cell: Element): number => {
  const raw = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
};

const ROW_SPAN = (cell: Element): number => {
  const raw = Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
};

const cellWidth = (cell: Element): number | undefined =>
  twipsOf(cell.getAttribute('width') ?? '') ?? twipsOf(declarationsOf(cell).get('width'));

const tableOf = (
  context: Context,
  element: Element,
  depth: number,
  style: InlineStyle,
): XmlElement | undefined => {
  const rows: Element[] = [];
  const collect = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      const candidate = child as Element;
      const tag = candidate.localName.toLowerCase();
      if (tag === 'tr') rows.push(candidate);
      else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') collect(candidate);
    }
  };
  collect(element);
  if (rows.length === 0) {
    degrade(context.shared.degraded, 'table-dropped', 'no-rows');
    return undefined;
  }
  const firstRow = rows[0];
  const widths: number[] = [];
  if (firstRow !== undefined) {
    for (const child of firstRow.childNodes) {
      if (child.nodeType !== 1) continue;
      const cell = child as Element;
      const tag = cell.localName.toLowerCase();
      if (tag !== 'td' && tag !== 'th') continue;
      const span = COLUMN_SPAN(cell);
      const declared = cellWidth(cell);
      const each = declared === undefined ? DEFAULT_COLUMN_WIDTH : Math.round(declared / span);
      for (let at = 0; at < span; at += 1) widths.push(each);
    }
  }
  let columns = 0;
  for (const row of rows) {
    let count = 0;
    for (const child of row.childNodes) {
      if (child.nodeType !== 1) continue;
      const cell = child as Element;
      const tag = cell.localName.toLowerCase();
      if (tag === 'td' || tag === 'th') count += COLUMN_SPAN(cell);
    }
    columns = Math.max(columns, count);
  }
  if (columns === 0) columns = 1;
  const declared = widths.length >= columns && widths.every((value) => value > 0);
  const total = widths.slice(0, columns).reduce((sum, value) => sum + value, 0);
  const even = Math.max(1, Math.round(DEFAULT_TABLE_WIDTH / columns));
  const columnWidths: number[] = [];
  for (let at = 0; at < columns; at += 1) {
    columnWidths.push(declared ? (widths[at] ?? DEFAULT_COLUMN_WIDTH) : even);
  }
  if (declared && total > 0) {
    const scale = DEFAULT_TABLE_WIDTH / total;
    for (let at = 0; at < columnWidths.length; at += 1) {
      columnWidths[at] = Math.max(1, Math.round((columnWidths[at] ?? even) * scale));
    }
  }
  const table = createWElement(context.shared.scratch, 'tbl');
  const properties = createWElement(table, 'tblPr');
  const width = createWElement(properties, 'tblW');
  setWAttr(width, 'w', String(DEFAULT_TABLE_WIDTH));
  setWAttr(width, 'type', 'dxa');
  const grid = createWElement(table, 'tblGrid');
  for (const value of columnWidths) setWAttr(createWElement(grid, 'gridCol'), 'w', String(value));
  const carry = new Map<number, number>();
  let emitted = 0;
  for (const row of rows) {
    const rowElement = createWElement(table, 'tr');
    const cells: Element[] = [];
    for (const child of row.childNodes) {
      if (child.nodeType !== 1) continue;
      const cell = child as Element;
      const tag = cell.localName.toLowerCase();
      if (tag === 'td' || tag === 'th') cells.push(cell);
    }
    let column = 0;
    let next = 0;
    while (column < columns) {
      const remaining = carry.get(column) ?? 0;
      if (remaining > 0) {
        const continuation = createWElement(rowElement, 'tc');
        const properties = createWElement(continuation, 'tcPr');
        createWElement(properties, 'vMerge');
        createWElement(continuation, 'p');
        carry.set(column, remaining - 1);
        column += 1;
        continue;
      }
      const source = cells[next];
      next += 1;
      if (source === undefined) break;
      const span = COLUMN_SPAN(source);
      const rowSpan = ROW_SPAN(source);
      const cell = createWElement(rowElement, 'tc');
      const cellProperties = createWElement(cell, 'tcPr');
      if (span > 1) setWAttr(createWElement(cellProperties, 'gridSpan'), 'val', String(span));
      if (rowSpan > 1) setWAttr(createWElement(cellProperties, 'vMerge'), 'val', 'restart');
      if (cellProperties.children.length === 0) dropIfEmpty(cellProperties);
      const produced = childBlocks(context.shared, source, depth + 1, style);
      if (produced.length === 0) {
        createWElement(cell, 'p');
      } else {
        for (const block of produced) {
          block.parent = cell;
          cell.children.push(block);
        }
        cell.selfClosing = false;
      }
      if (rowSpan > 1) {
        for (let at = 0; at < span; at += 1) carry.set(column + at, rowSpan - 1);
      }
      column += span;
    }
    if (rowElement.children.length === 0) {
      dropIfEmpty(rowElement);
      continue;
    }
    emitted += 1;
  }
  if (emitted === 0) {
    degrade(context.shared.degraded, 'table-dropped', 'empty');
    return undefined;
  }
  return table;
};

const walkBlocks = (
  context: Context,
  cursor: Cursor,
  parent: Node,
  depth: number,
  style: InlineStyle,
): void => {
  for (const node of parent.childNodes) {
    if (node.nodeType === 3) {
      if ((node.nodeValue ?? '').replace(/\s+/g, '') === '') continue;
      inlineInto(context, paragraphOf(context, cursor), node, style, depth);
      continue;
    }
    if (node.nodeType === 8) {
      noteComment(context.shared, node);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (SKIPPED_ELEMENTS.has(tag)) continue;
    context.shared.nodes += 1;
    if (context.shared.nodes > context.shared.policy.maxNodes) {
      context.shared.truncated = true;
      return;
    }
    if (depth > context.shared.policy.maxDepth) {
      context.shared.deep = true;
      continue;
    }
    if (tag === 'table') {
      flush(context, cursor);
      const table = tableOf(context, element, depth, style);
      if (table !== undefined) {
        context.sawBlock = true;
        context.blocks.push(table);
      }
      continue;
    }
    if (LIST_ELEMENTS.has(tag)) {
      flush(context, cursor);
      if (depth === 0) context.sawBlock = true;
      context.listDepth += 1;
      walkBlocks(context, cursor, element, depth + 1, style);
      context.listDepth -= 1;
      continue;
    }
    if (tag === 'hr') {
      degrade(context.shared.degraded, 'rule-dropped', 'hr');
      continue;
    }
    if (PARAGRAPH_ELEMENTS.has(tag)) {
      flush(context, cursor);
      if (depth === 0) context.sawBlock = true;
      const paragraph = createWElement(context.shared.scratch, 'p');
      applyParagraphProperties(context, paragraph, element);
      const nested: Cursor = { current: paragraph };
      walkBlocks(context, nested, element, depth + 1, headingStyle(tag, styleFor(style, element)));
      flush(context, nested);
      continue;
    }
    inlineInto(context, paragraphOf(context, cursor), node, styleFor(style, element), depth + 1);
  }
  flush(context, cursor);
};

const paragraphOf = (context: Context, cursor: Cursor): XmlElement => {
  if (cursor.current === undefined) {
    cursor.current = createWElement(context.shared.scratch, 'p');
  }
  return cursor.current;
};

const flush = (context: Context, cursor: Cursor): void => {
  if (cursor.current === undefined) return;
  context.blocks.push(cursor.current);
  cursor.current = undefined;
};

const sliceFragment = (html: string): string => {
  const marker = '<!--StartFragment-->';
  const start = html.indexOf(marker);
  const end = html.indexOf('<!--EndFragment-->');
  return start >= 0 && end > start ? html.slice(start + marker.length, end) : html;
};

export const importHtml = (
  html: string,
  documentId: string,
  revision: number,
  policy: HtmlPolicy = DEFAULT_HTML_POLICY,
): ClipboardFragment | undefined => {
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (Parser === undefined) return undefined;
  let parsed: Document;
  try {
    parsed = new Parser().parseFromString(sliceFragment(html), 'text/html');
  } catch {
    return undefined;
  }
  const shared: Shared = {
    scratch: createWrapper(),
    policy,
    degraded: [],
    relationships: [],
    nodes: 0,
    truncated: false,
    deep: false,
    relationCounter: 0,
  };
  const context: Context = { shared, blocks: [], sawBlock: false, listDepth: 0 };
  walkBlocks(context, { current: undefined }, parsed.body, 0, BASE_STYLE);
  if (shared.truncated) degrade(shared.degraded, 'html-truncated', String(policy.maxNodes));
  if (shared.deep) degrade(shared.degraded, 'html-depth-exceeded', String(policy.maxDepth));
  const first = context.blocks[0];
  if (first === undefined) return undefined;
  const inline = context.blocks.length === 1 && !context.sawBlock;
  const blocks: readonly XmlElement[] = inline ? [] : context.blocks;
  const tail: readonly XmlNode[] = inline
    ? first.children.filter((child) => !(child.kind === 'element' && isWElement(child, 'pPr')))
    : [];
  return {
    documentId,
    revision,
    includesParagraphMark: blocks.length > 0,
    blocks,
    tail,
    relationships: shared.relationships,
    degraded: shared.degraded,
  };
};
