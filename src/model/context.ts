import type { XmlElement } from '../ooxml/xml/index.js';
import { DiagnosticCollector } from './diagnostics.js';
import type { ModelNode, ViewFactory } from './view.js';
import { ViewCache } from './view.js';

export class ModelContext {
  readonly cache: ViewCache;
  readonly diagnostics: DiagnosticCollector;

  constructor(cache: ViewCache = new ViewCache(), diagnostics: DiagnosticCollector = new DiagnosticCollector()) {
    this.cache = cache;
    this.diagnostics = diagnostics;
  }

  view<T extends ModelNode>(element: XmlElement, create: ViewFactory<T>): T {
    return this.cache.view(element, create);
  }

  peek(element: XmlElement): ModelNode | undefined {
    return this.cache.peek(element);
  }

  forget(element: XmlElement): void {
    this.cache.forget(element);
  }

  forgetSubtree(element: XmlElement): void {
    this.cache.forgetSubtree(element);
  }

  get size(): number {
    return this.cache.size;
  }
}
