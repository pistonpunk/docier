export type CaseMode = 'sentence' | 'lower' | 'upper' | 'capitalize' | 'toggle';

export const CASE_MODES: readonly CaseMode[] = [
  'sentence',
  'lower',
  'upper',
  'capitalize',
  'toggle',
];

const capitalizeWord = (word: string): string =>
  word.length === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;

const sentenceCase = (text: string): string => {
  const lowered = text.toLowerCase();
  return lowered.replace(
    /(^|[.!?]\s+)(\p{L})/gu,
    (_whole, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`,
  );
};

const toggleCase = (text: string): string =>
  [...text]
    .map((character) => {
      const upper = character.toUpperCase();
      const lower = character.toLowerCase();
      if (upper === lower) return character;
      return character === upper ? lower : upper;
    })
    .join('');

const capitalizeEachWord = (text: string): string =>
  text.replace(/\p{L}[\p{L}'’]*/gu, (word) => capitalizeWord(word));

export const applyCase = (text: string, mode: CaseMode): string => {
  switch (mode) {
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'sentence':
      return sentenceCase(text);
    case 'capitalize':
      return capitalizeEachWord(text);
    case 'toggle':
      return toggleCase(text);
    default:
      return text;
  }
};

export const isCaseMode = (value: unknown): value is CaseMode =>
  typeof value === 'string' && (CASE_MODES as readonly string[]).includes(value);
