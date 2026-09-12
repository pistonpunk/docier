const APOSTROPHES = new Set(["'", '’', '­', '_']);
const HYPHEN = '-';
const DOT = '.';

const isWordLetter = (code: number): boolean => {
  if (code < 0x80) {
    return (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x5f
    );
  }
  return true;
};

const isDigit = (code: number): boolean => code >= 0x30 && code <= 0x39;

const isWordCharacter = (text: string, index: number): boolean => {
  const character = text[index];
  if (character === undefined) return false;
  if (APOSTROPHES.has(character)) return true;
  if (character === HYPHEN) {
    const before = text[index - 1];
    const after = text[index + 1];
    if (before === undefined || after === undefined) return false;
    if (before === HYPHEN || after === HYPHEN) return false;
    return isWordLetter(before.codePointAt(0) ?? 0) && isWordLetter(after.codePointAt(0) ?? 0);
  }
  if (character === DOT) {
    const before = text[index - 1];
    const after = text[index + 1];
    if (before === undefined || after === undefined) return false;
    return isDigit(before.codePointAt(0) ?? 0) && isDigit(after.codePointAt(0) ?? 0);
  }
  return isWordLetter(character.codePointAt(0) ?? 0);
};

export interface WordRun {
  readonly start: number;
  readonly end: number;
  readonly word: boolean;
}

export const wordRuns = (text: string): readonly WordRun[] => {
  const runs: WordRun[] = [];
  let index = 0;
  while (index < text.length) {
    const word = isWordCharacter(text, index);
    const start = index;
    index += 1;
    while (index < text.length && isWordCharacter(text, index) === word) index += 1;
    runs.push({ start, end: index, word });
  }
  return runs;
};

const runAt = (runs: readonly WordRun[], at: number): WordRun | undefined =>
  runs.find((run) => at >= run.start && at < run.end);

export const nextWordStart = (text: string, from: number): number => {
  const runs = wordRuns(text);
  for (const run of runs) {
    if (run.word && run.start > from) return run.start;
  }
  return text.length;
};

export const previousWordStart = (text: string, from: number): number => {
  let found = 0;
  for (const run of wordRuns(text)) {
    if (run.word && run.start < from) found = run.start;
  }
  return found;
};

export const wordAt = (text: string, at: number): { readonly start: number; readonly end: number } => {
  const runs = wordRuns(text);
  const run = runAt(runs, at);
  if (run !== undefined && run.word) return { start: run.start, end: run.end };
  let previous: WordRun | undefined;
  for (const candidate of runs) {
    if (candidate.word && candidate.end <= at) previous = candidate;
  }
  if (previous !== undefined) return { start: previous.start, end: previous.end };
  return { start: at, end: at };
};

export const sentenceAt = (text: string, at: number): { readonly start: number; readonly end: number } => {
  const isTerminator = (character: string | undefined): boolean =>
    character === '.' || character === '!' || character === '?' || character === '\n';
  let start = 0;
  for (let index = 0; index < at; index += 1) {
    if (isTerminator(text[index])) {
      let cursor = index + 1;
      while (cursor < at && (text[cursor] === ' ' || text[cursor] === '\t')) cursor += 1;
      start = cursor;
    }
  }
  let end = text.length;
  for (let index = at; index < text.length; index += 1) {
    if (isTerminator(text[index])) {
      end = index + 1;
      break;
    }
  }
  return { start, end };
};
