import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import type { DocPos, DocRange } from '../../layout/index.js';
import { docPos } from '../../layout/index.js';
import { selectionOf } from '../selection.js';
import type { AreaHost, AreaSpec } from './support.js';
import { areaCommand, rangeOfSelection, writingAt } from './support.js';

export interface FindArgs {
  readonly query?: string | undefined;
  readonly matchCase?: boolean | undefined;
  readonly wholeWord?: boolean | undefined;
  readonly backwards?: boolean | undefined;
}

export interface ReplaceArgs extends FindArgs {
  readonly replacement?: string | undefined;
  readonly all?: boolean | undefined;
}

export interface FindMatch {
  readonly start: DocPos;
  readonly end: DocPos;
}

const NO_DOCUMENT: LocalizedString = 'No document is loaded';
const NO_QUERY: LocalizedString = 'Type something to find';
const NO_REPLACEMENT: LocalizedString = 'Type the replacement text';

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

const isWordBoundary = (text: string, index: number): boolean => {
  if (index <= 0 || index >= text.length) return true;
  return !WORD_CHARACTER.test(text[index] ?? '');
};

const offsetsOf = (
  text: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
): readonly number[] => {
  if (query === '') return [];
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const found: number[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    if (!wholeWord || (isWordBoundary(text, at - 1) && isWordBoundary(text, at + query.length))) {
      found.push(at);
    }
    at = haystack.indexOf(needle, at + Math.max(1, needle.length));
  }
  return found;
};

export const findMatches = (host: AreaHost, args: FindArgs | undefined): readonly FindMatch[] => {
  const query = args?.query ?? '';
  if (query === '') return [];
  const matchCase = args?.matchCase === true;
  const wholeWord = args?.wholeWord === true;
  const out: FindMatch[] = [];
  for (const slot of host.session.slots()) {
    if (slot.story !== 'body') continue;
    const text = host.session.textOf({ start: slot.start, end: slot.textEnd });
    for (const at of offsetsOf(text, query, matchCase, wholeWord)) {
      out.push({
        start: docPos((slot.start as number) + at),
        end: docPos((slot.start as number) + at + query.length),
      });
    }
  }
  return out;
};

export const matchFrom = (
  matches: readonly FindMatch[],
  from: number,
  backwards: boolean,
): FindMatch | undefined => {
  if (matches.length === 0) return undefined;
  if (backwards) {
    let found: FindMatch | undefined;
    for (const match of matches) {
      if ((match.start as number) < from) found = match;
      else break;
    }
    return found ?? matches[matches.length - 1];
  }
  for (const match of matches) {
    if ((match.start as number) >= from) return match;
  }
  return matches[0];
};

const selectionFor = (match: FindMatch) => selectionOf(match.start, match.end, 'downstream');

const findSpec: AreaSpec<FindArgs> = {
  id: 'docier.command.find.find',
  label: 'Find',
  category: 'find',
  chrome: true,
  layer: 'chrome',
  enabledIn: (active, args) => active.loaded && (args?.query ?? '') !== '',
  reason: (_active, args) => ((args?.query ?? '') === '' ? NO_QUERY : NO_DOCUMENT),
  run: (host, args) => {
    const matches = findMatches(host, args);
    if (matches.length === 0) return false;
    const backwards = args?.backwards === true;
    const selection = host.selection;
    // A repeat search must resume past the match it is sitting on, or it finds
    // that same match again and the caret never moves.
    const collapsed = (selection.focus as number) === (selection.anchor as number);
    const from = collapsed
      ? (selection.focus as number)
      : backwards
        ? (selection.anchor as number)
        : (selection.focus as number);
    const match = matchFrom(matches, from, backwards);
    if (match === undefined) return false;
    host.setSelection(selectionFor(match), 'set');
    // Not false: a command that reports no change has its pending selection
    // discarded on commit, and moving the selection is the whole point here.
    return true;
  },
};

const replaceSpec: AreaSpec<ReplaceArgs> = {
  id: 'docier.command.find.replace',
  label: 'Replace',
  category: 'find',
  permissions: ['edit'],
  enabledIn: (host, args) =>
    host.loaded && host.editable && (args?.query ?? '') !== '' && args?.replacement !== undefined,
  reason: (host, args) => {
    if ((args?.query ?? '') === '') return NO_QUERY;
    if (args?.replacement === undefined) return NO_REPLACEMENT;
    if (!host.loaded) return NO_DOCUMENT;
    return 'The document is read-only';
  },
  run: (host, args) => {
    const query = args?.query ?? '';
    const replacement = args?.replacement ?? '';
    if (query === '' || args?.replacement === undefined) return false;

    const replaceOne = (range: DocRange): boolean => {
      const removed = host.session.deleteRange(range);
      const inserted =
        replacement === ''
          ? false
          : host.session.insertText({ start: range.start, end: range.start }, replacement);
      return removed || inserted;
    };

    if (args.all !== true) {
      const range = rangeOfSelection(host.selection);
      const onMatch =
        (range.end as number) > (range.start as number) &&
        host.session.textOf(range).toLowerCase() === query.toLowerCase();
      const changed = writingAt(host, () => (onMatch ? replaceOne(range) : false));
      const matches = findMatches(host, args);
      const from = onMatch ? (range.end as number) : (host.selection.focus as number);
      const match = matchFrom(matches, from, false);
      if (match !== undefined) host.setSelection(selectionFor(match), 'set');
      // True when the caret moved as well as when the text changed: a noop would
      // throw the selection away.
      return changed || match !== undefined;
    }

    // Replace All runs back to front, so the positions of the matches still to
    // come stay valid while the text shortens under the ones already done.
    const matches = findMatches(host, args);
    return writingAt(host, () => {
      let changed = false;
      for (let at = matches.length - 1; at >= 0; at -= 1) {
        const match = matches[at];
        if (match === undefined) continue;
        changed = replaceOne({ start: match.start, end: match.end }) || changed;
      }
      return changed;
    });
  },
};

export const findCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<FindArgs>(host, findSpec),
  areaCommand<ReplaceArgs>(host, replaceSpec),
];
