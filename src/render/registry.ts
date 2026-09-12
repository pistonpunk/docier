import type {
  Disposable,
  DocumentRenderer,
  PageOverlayProps,
  PageOverlayRenderer,
  SlotContent,
  SlotId,
} from './types.js';
import { ATTR, box, stamp } from './dom.js';
import { applyStyle, positionStyle } from './style.js';
import { DEFAULT_TEXT_COLOR } from './color.js';

export interface SlotOptions {
  readonly priority?: number;
}

export const DEFAULT_SLOT_PRIORITY = 0;

export interface SlotError {
  readonly code: 'SLOT_RENDERER_FAILED';
  readonly slot: SlotId;
  readonly rendererId: string;
  readonly message: string;
}

export interface RegisteredRenderer {
  readonly slot: SlotId;
  readonly id: string;
  readonly priority: number;
  readonly order: number;
}

export interface RegisteredDocumentRenderer extends RegisteredRenderer {
  readonly slot: 'document';
  readonly render: DocumentRenderer;
}

export interface RegisteredPageOverlay extends RegisteredRenderer {
  readonly slot: 'page.overlay';
  readonly render: PageOverlayRenderer;
}

export interface RendererRegistry {
  register(slot: 'document', id: string, render: DocumentRenderer, options?: SlotOptions): Disposable;
  register(slot: 'page.overlay', id: string, render: PageOverlayRenderer, options?: SlotOptions): Disposable;
  unregister(slot: SlotId, id: string): boolean;
  list(slot: SlotId): readonly RegisteredRenderer[];
  resolveDocument(): RegisteredDocumentRenderer | undefined;
  renderOverlays(props: PageOverlayProps): readonly SlotContent[];
  onError(listener: (error: SlotError) => void): Disposable;
  readonly errors: readonly SlotError[];
}

interface Entry {
  readonly slot: SlotId;
  readonly id: string;
  readonly priority: number;
  readonly order: number;
  readonly render: unknown;
}

const errorPlaceholder = (error: SlotError): HTMLElement => {
  const node = box('docier-slot-error');
  stamp(node, { [ATTR.slotError]: `${error.slot}:${error.rendererId}` });
  applyStyle(
    node,
    positionStyle({ left: 0, top: 0, width: 0, height: 0 }, { color: DEFAULT_TEXT_COLOR }),
  );
  node.textContent = `${error.code}: ${error.message}`;
  return node;
};

export const createRendererRegistry = (): RendererRegistry => {
  const entries = new Map<SlotId, Entry[]>();
  const errors: SlotError[] = [];
  const listeners = new Set<(error: SlotError) => void>();
  let counter = 0;

  const record = (error: SlotError): void => {
    errors.push(error);
    for (const listener of listeners) listener(error);
  };

  const listOf = (slot: SlotId): readonly Entry[] => {
    const found = entries.get(slot) ?? [];
    return [...found].sort((first, second) => first.priority - second.priority || first.order - second.order);
  };

  const register = (slot: SlotId, id: string, render: unknown, options?: SlotOptions): Disposable => {
    const entry: Entry = {
      slot,
      id,
      priority: options?.priority ?? DEFAULT_SLOT_PRIORITY,
      order: counter,
      render,
    };
    counter += 1;
    const found = entries.get(slot);
    if (found === undefined) entries.set(slot, [entry]);
    else found.push(entry);
    return {
      dispose: () => {
        const list = entries.get(slot);
        if (list === undefined) return;
        entries.set(
          slot,
          list.filter((candidate) => candidate !== entry),
        );
      },
    };
  };

  const registry: RendererRegistry = {
    register: register as RendererRegistry['register'],
    unregister: (slot, id) => {
      const list = entries.get(slot);
      if (list === undefined) return false;
      const next = list.filter((candidate) => candidate.id !== id);
      if (next.length === list.length) return false;
      entries.set(slot, next);
      return true;
    },
    list: (slot) =>
      listOf(slot).map((entry) => ({
        slot: entry.slot,
        id: entry.id,
        priority: entry.priority,
        order: entry.order,
      })),
    resolveDocument: () => {
      const found = listOf('document');
      const winner = found[found.length - 1];
      if (winner === undefined) return undefined;
      return {
        slot: 'document',
        id: winner.id,
        priority: winner.priority,
        order: winner.order,
        render: winner.render as DocumentRenderer,
      };
    },
    renderOverlays: (props) => {
      const out: SlotContent[] = [];
      for (const entry of listOf('page.overlay')) {
        try {
          out.push((entry.render as PageOverlayRenderer)(props));
        } catch (cause) {
          const error: SlotError = {
            code: 'SLOT_RENDERER_FAILED',
            slot: 'page.overlay',
            rendererId: entry.id,
            message: cause instanceof Error ? cause.message : String(cause),
          };
          record(error);
          out.push(errorPlaceholder(error));
        }
      }
      return out;
    },
    onError: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    errors,
  };

  return registry;
};

export const appendSlotContent = (parent: HTMLElement, content: SlotContent): void => {
  if (content === null || content === undefined) return;
  if (typeof content === 'string') {
    parent.appendChild(document.createTextNode(content));
    return;
  }
  if (content instanceof DocumentFragment) {
    parent.appendChild(content);
    return;
  }
  parent.appendChild(content);
};
