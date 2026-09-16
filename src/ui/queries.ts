import type { EditorHandle } from '../api/editor.js';
import type { Unsubscribe } from '../api/types.js';
import { blockText } from '../edit/index.js';
import { wordRuns } from '../edit/words.js';
import type { PageFragment } from '../layout/index.js';
import { DEFAULT_ZOOM } from '../api/constants.js';
import { ATTR } from '../render/dom.js';
import { tableOf } from '../edit/tables.js';
import type { RulerIndents } from './ruler.js';
import type { ContextSurface, SaveState } from './types.js';

export interface EditorQueries {
  readonly words: () => number;
  readonly page: () => number;
  readonly pages: () => number;
  readonly zoom: () => number;
  readonly save: () => SaveState;
  readonly language: () => string | undefined;
  readonly selectionEmpty: () => boolean;
  readonly caretSurface: () => 'table' | 'image' | null;
  readonly tableProperties: () => TablePropertiesSummary | undefined;
  readonly surface: () => ContextSurface | null;
  setSurface(value: ContextSurface | null): void;
  readonly indents: () => RulerIndents | undefined;
  readonly comments: () => readonly CommentSummary[];
  readonly pageFragment: (index: number) => PageFragment | undefined;
  readonly offsetPx: () => number;
  readonly offsetYPx: () => number;
  dispose(): void;
}

const DEFAULT_INDENTS: RulerIndents = { firstLineTwips: 0, leftTwips: 0, rightTwips: 0 };

export interface TablePropertiesSummary {
  readonly alignment: 'left' | 'center' | 'right' | undefined;
  readonly widthTwips: number | undefined;
  readonly layout: 'autofit' | 'fixed' | undefined;
}

const ALIGNMENTS: readonly string[] = ['left', 'center', 'right'];

const tablePropertiesOf = (handle: EditorHandle): TablePropertiesSummary | undefined => {
  const session = handle.session;
  if (session === undefined) return undefined;
  const resolved = session.resolve(session.index.clamp(handle.selection.focus));
  if (resolved === undefined || resolved.slot.cell === undefined) return undefined;
  const table = tableOf(session.model, resolved.slot.element);
  if (table === undefined) return undefined;
  const justification = table.properties.justification;
  const width = table.properties.width.twips;
  const measurable = typeof width === 'number' && width > 0 ? width : undefined;
  return {
    alignment:
      justification !== undefined && ALIGNMENTS.includes(justification)
        ? (justification as 'left' | 'center' | 'right')
        : undefined,
    widthTwips: measurable,
    layout: table.properties.layout,
  };
};

export interface EditorQueryOptions {
  readonly indents?: ((page: number) => RulerIndents | undefined) | undefined;
  readonly language?: (() => string | undefined) | undefined;
}

export interface CommentSummary {
  readonly id: number;
  readonly author: string;
  readonly initials: string | undefined;
  readonly date: string | undefined;
  readonly text: string;
}

const attributeOf = (element: { readonly attributes: readonly { readonly localName: string; readonly value: string }[] }, name: string): string | undefined =>
  element.attributes.find((entry) => entry.localName === name)?.value;

export const documentComments = (handle: EditorHandle): readonly CommentSummary[] => {
  const model = handle.document;
  if (model === undefined) return [];
  const story = model.stories().find((candidate) => candidate.kind === 'comment');
  if (story === undefined) return [];
  return story
    .notes()
    .filter((note) => note.noteKind === 'normal')
    .map((note) => ({
      id: note.noteId,
      author: attributeOf(note.element, 'author') ?? '',
      initials: attributeOf(note.element, 'initials'),
      date: attributeOf(note.element, 'date'),
      text: note.logicalText.trim(),
    }));
};

export const countWords = (handle: EditorHandle): number => {
  const session = handle.session;
  if (session === undefined) return 0;
  let total = 0;
  for (const span of session.index.paragraphs) {
    const text = blockText(span);
    for (const run of wordRuns(text)) {
      if (run.word) total += 1;
    }
  }
  return total;
};

export const createEditorQueries = (
  handle: EditorHandle,
  options?: EditorQueryOptions,
): EditorQueries => {
  let save: SaveState = 'saved';
  let surface: ContextSurface | null = null;
  let disposed = false;

  const unsubscribes: Unsubscribe[] = [
    handle.events.on('docier:ready', () => {
      save = 'saved';
    }),
    handle.events.on('docier:history:change', (event) => {
      save = event.savePoint ? 'saved' : 'unsaved';
    }),
    handle.events.on('docier:doc:change', () => {
      if (save === 'saved') save = 'unsaved';
    }),
  ];

  const pageOriginPx = (): number => {
    const sheet = handle.element.querySelector<HTMLElement>(`[${ATTR.page}]`);
    if (sheet === null) return 0;
    return sheet.getBoundingClientRect().left - handle.element.getBoundingClientRect().left;
  };

  const pageOriginYPx = (): number => {
    const sheet = handle.element.querySelector<HTMLElement>(`[${ATTR.page}]`);
    if (sheet === null) return 0;
    const host = handle.element.querySelector<HTMLElement>('.docier-canvas') ?? handle.element;
    return sheet.getBoundingClientRect().top - host.getBoundingClientRect().top;
  };

  const self: Omit<EditorQueries, 'setSurface'> = {
    words: () => countWords(handle),
    page: () => {
      const session = handle.session;
      if (session === undefined) return 1;
      const focus = handle.selection.focus;
      const line = session.index.lineAt(focus, handle.selection.affinity);
      if (line !== undefined) return line.page + 1;
      const geometry = handle.caretGeometry();
      return geometry === undefined ? 1 : geometry.page + 1;
    },
    pages: () => handle.layout?.pages.length ?? 1,
    zoom: () => {
      const node = handle.element.querySelector<HTMLElement>(`[${ATTR.zoom}]`);
      const raw = node?.getAttribute(ATTR.zoom);
      const parsed = raw === null || raw === undefined ? Number.NaN : Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ZOOM;
    },
    save: () => save,
    language: () => options?.language?.() ?? handle.config.locale,
    selectionEmpty: () => handle.selection.anchor === handle.selection.focus,
    caretSurface: () => {
      const session = handle.session;
      if (session === undefined) return null;
      const resolved = session.resolve(session.index.clamp(handle.selection.focus));
      return resolved !== undefined && resolved.slot.cell !== undefined ? 'table' : null;
    },
    tableProperties: () => tablePropertiesOf(handle),
    surface: () => surface,
    indents: () => options?.indents?.(self.page()) ?? DEFAULT_INDENTS,
    comments: () => documentComments(handle),
    pageFragment: (index) => handle.layout?.pages[index],
    offsetPx: () => pageOriginPx(),
    offsetYPx: () => pageOriginYPx(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribes.splice(0, unsubscribes.length)) unsubscribe();
    },
  };

  return {
    ...self,
    surface: () => surface,
    setSurface: (value: ContextSurface | null) => {
      surface = value;
    },
  };
};

export const NO_QUERIES: EditorQueries = {
  words: () => 0,
  page: () => 1,
  pages: () => 1,
  zoom: () => DEFAULT_ZOOM,
  save: () => 'saved',
  language: () => undefined,
  selectionEmpty: () => true,
  caretSurface: () => null,
  tableProperties: () => undefined,
  surface: () => null,
  setSurface: () => {},
  indents: () => DEFAULT_INDENTS,
  comments: () => [],
  pageFragment: () => undefined,
  offsetPx: () => 0,
  offsetYPx: () => 0,
  dispose: () => {},
};
