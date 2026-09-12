import { createEditor } from '../../src/api/editor.js';
import type { EditorHandle, EditorMountOptions } from '../../src/api/editor.js';
import type { EditorConfigPatch, LocalizedString } from '../../src/api/types.js';
import type { DocumentModel } from '../../src/model/document.js';
import { mountPoint, track } from '../edit/support.js';
import { buildDocx, openModel } from '../model/support.js';

export {
  bodyOf,
  disposeEditors,
  documentText,
  editorOf,
  emptyEditorOf,
  mountPoint,
  PAGE,
  paragraphText,
  paragraphTexts,
  pos,
} from '../edit/support.js';

export const editorWith = async (
  body: string,
  config?: EditorConfigPatch,
  options?: EditorMountOptions,
): Promise<EditorHandle> => {
  const model: DocumentModel = await openModel({ body });
  return track(createEditor(mountPoint(), config, { ...options, document: model }));
};

export const bytesOf = (body: string): Uint8Array => buildDocx({ body });

export interface Trace {
  readonly types: readonly string[];
  countOf(type: string): number;
  indexOf(type: string): number;
  reset(): void;
}

export const trace = (handle: EditorHandle): Trace => {
  const types: string[] = [];
  handle.events.onAny((type) => {
    types.push(type);
  });
  return {
    get types(): readonly string[] {
      return [...types];
    },
    countOf: (type) => types.filter((candidate) => candidate === type).length,
    indexOf: (type) => types.indexOf(type),
    reset: () => {
      types.length = 0;
    },
  };
};

export const reasonText = (reason: LocalizedString | undefined): string =>
  typeof reason === 'string' ? reason : '';

export const resultOf = async (
  handle: EditorHandle,
  id: string,
  args?: unknown,
): Promise<{ readonly status: string; readonly code?: string; readonly reason?: string }> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'blocked') return { status: 'blocked', code: result.code, reason: reasonText(result.reason) };
  return { status: result.status };
};

export const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<void> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${reasonText(result.reason)}`);
};
