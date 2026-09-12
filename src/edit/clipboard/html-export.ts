import type { XmlElement, XmlNode } from '../../ooxml/xml/index.js';
import { childElements, isOn, isWElement, textOfElement, wAttr } from '../../model/index.js';
import { HTML_GENERATOR } from './types.js';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>]/g, (character) => ESCAPES[character] ?? character);

const TWIPS_PER_POINT = 20;

const points = (twips: string | undefined): string | undefined => {
  if (twips === undefined) return undefined;
  const parsed = Number.parseFloat(twips);
  if (!Number.isFinite(parsed)) return undefined;
  return `${String(parsed / TWIPS_PER_POINT)}pt`;
};

const styleOf = (parts: readonly (string | undefined)[]): string => {
  const kept = parts.filter((part): part is string => part !== undefined && part !== '');
  return kept.length === 0 ? '' : ` style="${kept.join(';')}"`;
};

const runStyle = (properties: XmlElement | undefined): string => {
  if (properties === undefined) return styleOf([]);
  const on = (name: string): boolean => isOn(wAttr(properties, name)) === true;
  const underline = wAttr(properties, 'u');
  const vertical = wAttr(properties, 'vertAlign');
  const color = wAttr(properties, 'color');
  const highlight = wAttr(properties, 'highlight');
  const size = wAttr(properties, 'sz');
  const fonts = childElements(properties).find((child) => isWElement(child, 'rFonts'));
  const family = fonts === undefined ? undefined : wAttr(fonts, 'ascii');
  const decorations = [
    underline !== undefined && underline !== 'none' ? 'underline' : undefined,
    on('strike') ? 'line-through' : undefined,
  ].filter((part): part is string => part !== undefined);
  const half = size === undefined ? undefined : Number.parseFloat(size);
  return styleOf([
    on('b') ? 'font-weight:bold' : undefined,
    on('i') ? 'font-style:italic' : undefined,
    decorations.length === 0 ? undefined : `text-decoration:${decorations.join(' ')}`,
    vertical === 'superscript' ? 'vertical-align:super' : undefined,
    vertical === 'subscript' ? 'vertical-align:sub' : undefined,
    color === undefined || color === 'auto' ? undefined : `color:#${color}`,
    highlight === undefined ? undefined : `background-color:${highlight}`,
    half !== undefined && Number.isFinite(half) ? `font-size:${String(half / 2)}pt` : undefined,
    family === undefined ? undefined : `font-family:${family}`,
  ]);
};

const paragraphStyle = (properties: XmlElement | undefined): string => {
  if (properties === undefined) return styleOf([]);
  const justification = wAttr(properties, 'jc');
  const spacing = childElements(properties).find((child) => isWElement(child, 'spacing'));
  const indentation = childElements(properties).find((child) => isWElement(child, 'ind'));
  const align =
    justification === 'both' || justification === 'distribute'
      ? 'justify'
      : justification === 'center' || justification === 'right'
        ? justification
        : justification === 'left'
          ? 'left'
          : undefined;
  const before = spacing === undefined ? undefined : points(wAttr(spacing, 'before'));
  const after = spacing === undefined ? undefined : points(wAttr(spacing, 'after'));
  const left = indentation === undefined ? undefined : points(wAttr(indentation, 'left'));
  const first = indentation === undefined ? undefined : points(wAttr(indentation, 'firstLine'));
  return styleOf([
    align === undefined ? undefined : `text-align:${align}`,
    before === undefined ? undefined : `margin-top:${before}`,
    after === undefined ? undefined : `margin-bottom:${after}`,
    left === undefined ? undefined : `margin-left:${left}`,
    first === undefined ? undefined : `text-indent:${first}`,
  ]);
};

const inlineHtml = (nodes: readonly XmlNode[]): string => {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += escapeHtml(node.value);
      continue;
    }
    if (node.kind !== 'element') continue;
    if (isWElement(node, 'r')) {
      const properties = childElements(node).find((child) => isWElement(child, 'rPr'));
      let inner = '';
      for (const child of node.children) {
        if (child.kind !== 'element') continue;
        if (isWElement(child, 't') || isWElement(child, 'delText')) {
          inner += escapeHtml(textOfElement(child));
          continue;
        }
        if (isWElement(child, 'tab')) {
          inner += '\t';
          continue;
        }
        if (isWElement(child, 'br') || isWElement(child, 'cr')) {
          inner += '<br>';
          continue;
        }
      }
      out += `<span${runStyle(properties)}>${inner}</span>`;
      continue;
    }
    if (isWElement(node, 'hyperlink')) {
      const anchor = childElements(node).find((child) => isWElement(child, 'anchor'));
      const label = escapeHtml(wAttr(anchor ?? node, 'anchor') ?? '');
      out += `<a href="#${label}">${inlineHtml(node.children)}</a>`;
      continue;
    }
    if (isWElement(node, 'sdt')) {
      const content = childElements(node).find((child) => isWElement(child, 'sdtContent'));
      if (content !== undefined) out += inlineHtml(content.children);
      continue;
    }
    if (isWElement(node, 'bookmarkStart') || isWElement(node, 'bookmarkEnd')) continue;
    out += inlineHtml(node.children);
  }
  return out;
};

const inlineEndsWithSpace = (nodes: readonly XmlNode[]): boolean => {
  for (let at = nodes.length - 1; at >= 0; at -= 1) {
    const node = nodes[at];
    if (node === undefined) continue;
    if (node.kind === 'text') return /\s$/.test(node.value);
    if (node.kind !== 'element') continue;
    if (isWElement(node, 't') || isWElement(node, 'delText')) return /\s$/.test(textOfElement(node));
    return inlineEndsWithSpace(node.children);
  }
  return false;
};

const wrapInline = (html: string, nodes: readonly XmlNode[]): string => {
  if (html === '') return html;
  const padded = ` ${html} `;
  const needs = inlineEndsWithSpace(nodes) || /^\s/.test(html.replace(/<[^>]*>/g, ''));
  return needs ? `<span style="white-space:pre-wrap">${padded}</span>` : html;
};

export const htmlOfParagraph = (paragraph: XmlElement): string => {
  const properties = childElements(paragraph).find((child) => isWElement(child, 'pPr'));
  const content = paragraph.children.filter(
    (child) => !(child.kind === 'element' && isWElement(child, 'pPr')),
  );
  return `<p${paragraphStyle(properties)}>${wrapInline(inlineHtml(content), content)}</p>`;
};

export const htmlOfNode = (node: XmlNode): string =>
  node.kind === 'element' && isWElement(node, 'p') ? htmlOfParagraph(node) : inlineHtml([node]);

export const generatorMeta = (): string =>
  `<meta name="Generator" content="${HTML_GENERATOR}">`;

export const htmlOfFragment = (
  blocks: readonly XmlElement[],
  tail: readonly XmlNode[],
): string => {
  const parts = blocks.map((block) => htmlOfNode(block));
  if (tail.length > 0) parts.push(wrapInline(inlineHtml(tail), tail));
  const body = parts.filter((part) => part !== '').join('');
  return `${generatorMeta()}<!--StartFragment-->${body}<!--EndFragment-->`;
};
