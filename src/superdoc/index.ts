import { TOKEN_TAG_PREFIX, parseTokenTag, tokenTagOf } from '../tokens/keys.js';
import type { SuperDoc } from 'superdoc';

export type SuperDocDocumentApi = NonNullable<NonNullable<SuperDoc['activeEditor']>['doc']>;

export interface SuperDocUser {
  readonly name?: string;
  readonly email?: string;
  readonly [key: string]: unknown;
}

export interface SuperDocViewOptions {
  readonly document?: Uint8Array | ArrayBuffer;
  readonly readOnly?: boolean;
  readonly locale?: string;
  readonly user?: SuperDocUser;
}

export type SuperDocTokenKind = 'field' | 'image';

export interface SuperDocTokenSpec {
  readonly kind?: SuperDocTokenKind;
  readonly label?: string;
}

export interface SuperDocToken {
  readonly key: string;
  readonly kind: string;
  readonly id: string;
  readonly text: string;
}

export interface SuperDocView {
  readonly superdoc: SuperDoc;
  readonly doc: SuperDocDocumentApi;
  bytes(): Promise<Uint8Array>;
  insertToken(key: string, token?: SuperDocTokenSpec): Promise<void>;
  listTokens(): Promise<SuperDocToken[]>;
  fill(values: Record<string, string>): Promise<string[]>;
  destroy(): void;
}

const elementOf = (target: string | HTMLElement): HTMLElement => {
  if (typeof target !== 'string') return target;
  const found = document.querySelector<HTMLElement>(target);
  if (found === null) throw new Error(`SuperDoc cannot mount: no element matches ${target}`);
  return found;
};

const started = (superdoc: SuperDoc): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    superdoc.once('ready', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    superdoc.once('exception', () => {
      if (settled) return;
      settled = true;
      reject(new Error('SuperDoc failed to start'));
    });
  });

export const createSuperDocView = async (
  target: string | HTMLElement,
  options: SuperDocViewOptions,
): Promise<SuperDocView> => {
  const { SuperDoc: SuperDocConstructor } = await import('superdoc');
  const element = elementOf(target);
  if (options.locale !== undefined) element.lang = options.locale;

  const superdoc = new SuperDocConstructor({
    selector: element,
    documentMode: options.readOnly === true ? 'viewing' : 'editing',
    ui: false,
    ...(options.document === undefined ? {} : { document: options.document }),
    ...(options.user === undefined ? {} : { user: options.user }),
  });

  if (superdoc.getDocumentApi() === null) await started(superdoc);

  const doc = superdoc.getDocumentApi() ?? superdoc.activeEditor?.doc ?? null;
  if (doc === null) throw new Error('SuperDoc started without a Document API');

  const bytes = async (): Promise<Uint8Array> => {
    const blob = await superdoc.export({ exportType: ['docx'], triggerDownload: false });
    return new Uint8Array(await blob.arrayBuffer());
  };

  const insertToken = async (key: string, token?: SuperDocTokenSpec): Promise<void> => {
    const created = await doc.create.contentControl({
      kind: 'inline',
      tag: tokenTagOf(token?.kind ?? 'field', key),
      ...(token?.label === undefined ? {} : { alias: token.label }),
    });
    if (created.success === false) {
      throw new Error(`SuperDoc refused to insert the token ${key}`);
    }
  };

  const listTokens = async (): Promise<SuperDocToken[]> => {
    const listed = await doc.contentControls.list();
    const tokens: SuperDocToken[] = [];
    for (const item of listed.items) {
      const tag = item.properties.tag;
      if (tag === undefined || !tag.startsWith(TOKEN_TAG_PREFIX)) continue;
      const parsed = parseTokenTag(tag);
      if (parsed === undefined) continue;
      tokens.push({
        key: parsed.key,
        kind: parsed.kind,
        id: item.id,
        text: item.text ?? '',
      });
    }
    return tokens;
  };

  const fill = async (values: Record<string, string>): Promise<string[]> => {
    const missing: string[] = [];
    for (const key of Object.keys(values)) {
      const value = values[key] ?? '';
      const found = await doc.contentControls.selectByTag({ tag: tokenTagOf('field', key) });
      if (found.items.length === 0) {
        missing.push(key);
        continue;
      }
      for (const item of found.items) {
        if (value === '') await doc.contentControls.clearContent({ target: item.target });
        else await doc.contentControls.replaceContent({ target: item.target, content: value, format: 'text' });
      }
    }
    return missing;
  };

  return {
    superdoc,
    doc,
    bytes,
    insertToken,
    listTokens,
    fill,
    destroy: () => {
      superdoc.destroy();
    },
  };
};
