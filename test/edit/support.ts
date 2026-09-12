import { createEditor } from '../../src/api/editor.js';
import type { EditorHandle } from '../../src/api/editor.js';
import type { EditorConfigPatch } from '../../src/api/types.js';
import { createEditSession } from '../../src/edit/session.js';
import type { EditSession } from '../../src/edit/session.js';
import type { DocPos } from '../../src/layout/index.js';
import type { DocumentModel } from '../../src/model/document.js';
import { PAGE, paragraphText } from '../layout/support.js';
import { openModel } from '../model/support.js';

export { PAGE, paragraphText };

export const bodyOf = (...paragraphs: readonly string[]): string =>
  `${paragraphs.join('')}${PAGE}`;

export const WRAP_TEXT =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ';

export const wrappedFixture = (): string =>
  bodyOf(
    paragraphText(WRAP_TEXT),
    ...Array.from({ length: 8 }, (_value, index) => paragraphText(`tail ${String(index)}`)),
  );

export const sessionOf = async (body: string): Promise<EditSession> => {
  const model: DocumentModel = await openModel({ body });
  return createEditSession(model, {});
};

export const pos = (value: number): DocPos => value as DocPos;

const mounted: EditorHandle[] = [];

export const mountPoint = (): HTMLElement => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
};

export const track = (handle: EditorHandle): EditorHandle => {
  mounted.push(handle);
  return handle;
};

export const editorOf = async (
  body: string,
  config?: EditorConfigPatch,
): Promise<EditorHandle> => {
  const model: DocumentModel = await openModel({ body });
  return track(createEditor(mountPoint(), config, { document: model }));
};

export const emptyEditorOf = (config?: EditorConfigPatch): EditorHandle =>
  track(createEditor(mountPoint(), config));

export const disposeEditors = (): void => {
  while (mounted.length > 0) mounted.pop()?.destroy();
};

export const paragraphTexts = (handle: EditorHandle): readonly string[] => {
  const session = handle.session;
  if (session === undefined) return [];
  return session.slots().map((slot) => session.textOf({ start: slot.start, end: slot.textEnd }));
};

export const documentText = (handle: EditorHandle): string =>
  paragraphTexts(handle).join('\n');

export const lineOfBlock = (
  handle: EditorHandle,
  blockId: number,
): readonly { readonly page: number; readonly start: DocPos; readonly end: DocPos }[] => {
  const session = handle.session;
  if (session === undefined) return [];
  return session.index.lines
    .filter((line) => line.blockId === blockId)
    .map((line) => ({ page: line.page, start: line.start, end: line.end }));
};
