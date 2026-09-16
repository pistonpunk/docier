import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { DiagnosticCollector } from '../diagnostics.js';
import {
  ensureOrderedChild,
  findOrderedChild,
  findOrderedChildren,
  insertOrdered,
} from '../schema-order.js';
import { createWElement, setWAttr, wAttr } from '../xml.js';
import { builtinStyle, styleElementOf } from './builtin.js';
import type { StyleType } from './style.js';
import { Style } from './style.js';

export interface LatentStyleException {
  readonly name: string;
  readonly uiPriority: number | undefined;
  readonly isSemiHidden: boolean;
  readonly isUnhideWhenUsed: boolean;
  readonly isQFormat: boolean;
  readonly isLocked: boolean;
  readonly element: XmlElement;
}

export class StylesPart {
  private readonly root: XmlElement;
  private readonly context: ModelContext;
  private readonly diagnostics: DiagnosticCollector;
  private readonly styleById = new Map<string, Style>();
  private readonly idByName = new Map<string, string>();
  private readonly chains = new Map<string, readonly Style[]>();
  private built = false;
  private version = 0;

  constructor(root: XmlElement, context: ModelContext, diagnostics?: DiagnosticCollector) {
    this.root = root;
    this.context = context;
    this.diagnostics = diagnostics ?? context.diagnostics;
  }

  get element(): XmlElement {
    return this.root;
  }

  get revision(): number {
    return this.version;
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    for (const element of findOrderedChildren(this.root, 'style')) {
      const style = this.context.view(element, (id, target) => new Style(id, target));
      const styleId = style.styleId;
      if (styleId.length === 0) {
        this.diagnostics.warn('duplicateStyleId', 'w:style without w:styleId', {
          partName: 'styles.xml',
        });
        continue;
      }
      if (this.styleById.has(styleId)) {
        this.diagnostics.warn('duplicateStyleId', `duplicate w:styleId ${styleId}`, {
          name: styleId,
          partName: 'styles.xml',
        });
        continue;
      }
      this.styleById.set(styleId, style);
      const name = style.name;
      if (name !== undefined && !this.idByName.has(name)) this.idByName.set(name, styleId);
    }
  }

  ensure(styleId: string): Style | undefined {
    this.build();
    const existing = this.styleById.get(styleId);
    if (existing !== undefined) return existing;
    const definition = builtinStyle(styleId);
    if (definition === undefined) return undefined;
    const element = styleElementOf(this.root, definition);
    this.invalidate();
    return this.context.view(element, (id, target) => new Style(id, target));
  }

  invalidate(): void {
    this.built = false;
    this.version += 1;
    this.styleById.clear();
    this.idByName.clear();
    this.chains.clear();
  }

  styleElements(): readonly XmlElement[] {
    return findOrderedChildren(this.root, 'style');
  }

  styles(): readonly Style[] {
    this.build();
    return [...this.styleById.values()];
  }

  get styleCount(): number {
    this.build();
    return this.styleById.size;
  }

  style(styleId: string): Style | undefined {
    this.build();
    return this.styleById.get(styleId);
  }

  hasStyle(styleId: string): boolean {
    this.build();
    return this.styleById.has(styleId);
  }

  styleByName(name: string): Style | undefined {
    this.build();
    const styleId = this.idByName.get(name);
    return styleId === undefined ? undefined : this.styleById.get(styleId);
  }

  stylesOfType(type: StyleType): readonly Style[] {
    return this.styles().filter((style) => style.type === type);
  }

  defaultStyle(type: StyleType): Style | undefined {
    this.build();
    for (const style of this.styleById.values()) {
      if (style.type === type && style.isDefault) return style;
    }
    return undefined;
  }

  effectiveDefaultStyle(type: StyleType): Style | undefined {
    const declared = this.defaultStyle(type);
    if (declared !== undefined) return declared;
    const fallback = type === 'paragraph' ? 'Normal' : type === 'table' ? 'TableNormal' : undefined;
    if (fallback === undefined) return undefined;
    const style = this.style(fallback);
    if (style === undefined) {
      this.diagnostics.warn('defaultStyleMissing', `no default ${type} style`, {
        name: fallback,
        partName: 'styles.xml',
      });
    }
    return style;
  }

  linkedStyle(style: Style): Style | undefined {
    const link = style.link;
    return link === undefined ? undefined : this.style(link);
  }

  chain(styleId: string | undefined): readonly Style[] {
    if (styleId === undefined || styleId.length === 0) return [];
    this.build();
    const cached = this.chains.get(styleId);
    if (cached !== undefined) return cached;
    const reversed: Style[] = [];
    const visited = new Set<string>();
    let current = this.styleById.get(styleId);
    if (current === undefined) {
      this.diagnostics.warn('missingStyleReference', `unknown w:styleId ${styleId}`, {
        name: styleId,
        partName: 'styles.xml',
      });
      this.chains.set(styleId, reversed);
      return reversed;
    }
    while (current !== undefined) {
      const currentId = current.styleId;
      if (visited.has(currentId)) {
        this.diagnostics.warn('basedOnCycle', `w:basedOn cycle at ${currentId}`, {
          name: currentId,
          partName: 'styles.xml',
        });
        break;
      }
      visited.add(currentId);
      reversed.push(current);
      const basedOn = current.basedOn;
      if (basedOn === undefined || basedOn.length === 0) break;
      const parent = this.styleById.get(basedOn);
      if (parent === undefined) {
        this.diagnostics.warn('missingStyleReference', `unknown w:basedOn ${basedOn}`, {
          name: basedOn,
          partName: 'styles.xml',
        });
        break;
      }
      current = parent;
    }
    reversed.reverse();
    this.chains.set(styleId, reversed);
    return reversed;
  }

  ancestors(styleId: string | undefined): readonly string[] {
    return this.chain(styleId)
      .map((style) => style.styleId)
      .filter((id) => id !== styleId);
  }

  docDefaultsElement(): XmlElement | undefined {
    return findOrderedChild(this.root, 'docDefaults');
  }

  ensureDocDefaults(): XmlElement {
    return ensureOrderedChild(this.root, 'docDefaults');
  }

  defaultRunPropertiesElement(): XmlElement | undefined {
    const defaults = this.docDefaultsElement();
    if (defaults === undefined) return undefined;
    const container = findOrderedChild(defaults, 'rPrDefault');
    return container === undefined ? undefined : findOrderedChild(container, 'rPr');
  }

  defaultParagraphPropertiesElement(): XmlElement | undefined {
    const defaults = this.docDefaultsElement();
    if (defaults === undefined) return undefined;
    const container = findOrderedChild(defaults, 'pPrDefault');
    return container === undefined ? undefined : findOrderedChild(container, 'pPr');
  }

  ensureDefaultRunProperties(): XmlElement {
    return ensureOrderedChild(ensureOrderedChild(this.ensureDocDefaults(), 'rPrDefault'), 'rPr');
  }

  ensureDefaultParagraphProperties(): XmlElement {
    return ensureOrderedChild(ensureOrderedChild(this.ensureDocDefaults(), 'pPrDefault'), 'pPr');
  }

  latentStylesElement(): XmlElement | undefined {
    return findOrderedChild(this.root, 'latentStyles');
  }

  latentStyleExceptions(): readonly LatentStyleException[] {
    const latent = this.latentStylesElement();
    if (latent === undefined) return [];
    return findOrderedChildren(latent, 'lsdException').map((element) => ({
      name: wAttr(element, 'name') ?? '',
      uiPriority: numericAttribute(element, 'uiPriority'),
      isSemiHidden: booleanAttribute(element, 'semiHidden'),
      isUnhideWhenUsed: booleanAttribute(element, 'unhideWhenUsed'),
      isQFormat: booleanAttribute(element, 'qFormat'),
      isLocked: booleanAttribute(element, 'locked'),
      element,
    }));
  }

  createStyle(styleId: string, type: StyleType, name?: string): Style {
    this.build();
    const element = createWElement(this.root, 'style');
    setWAttr(element, 'styleId', styleId);
    setWAttr(element, 'type', type);
    insertOrdered(this.root, element);
    const style = this.context.view(element, (id, target) => new Style(id, target));
    if (name !== undefined) style.name = name;
    this.styleById.set(styleId, style);
    const label = style.name;
    if (label !== undefined) this.idByName.set(label, styleId);
    this.chains.clear();
    this.version += 1;
    return style;
  }

  removeStyle(styleId: string): boolean {
    this.build();
    const style = this.styleById.get(styleId);
    if (style === undefined) return false;
    const parent = style.element.parent;
    if (parent === undefined) return false;
    const index = parent.children.indexOf(style.element);
    if (index >= 0) parent.children.splice(index, 1);
    style.element.parent = undefined;
    this.context.forgetSubtree(style.element);
    this.styleById.delete(styleId);
    const label = style.name;
    if (label !== undefined && this.idByName.get(label) === styleId) this.idByName.delete(label);
    this.chains.clear();
    this.version += 1;
    return true;
  }

  referencesTo(styleId: string): readonly string[] {
    return this.styles()
      .filter((style) => style.basedOn === styleId || style.link === styleId)
      .map((style) => style.styleId);
  }
}

const numericAttribute = (element: XmlElement, localName: string): number | undefined => {
  const raw = wAttr(element, localName);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const booleanAttribute = (element: XmlElement, localName: string): boolean => {
  const raw = wAttr(element, localName);
  if (raw === undefined) return false;
  return raw === '1' || raw === 'true' || raw === 'on';
};
