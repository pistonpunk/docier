const HEX = /^[0-9a-fA-F]{6}$/;
const HEX_SHORT = /^[0-9a-fA-F]{3}$/;

export const DEFAULT_TEXT_COLOR = '#000000';
export const DEFAULT_BORDER_COLOR = '#000000';

export const textColorOf = (value: string | undefined): string => {
  if (value === undefined) return DEFAULT_TEXT_COLOR;
  if (HEX.test(value)) return `#${value.toLowerCase()}`;
  if (HEX_SHORT.test(value)) {
    const [r, g, b] = [value[0] ?? '0', value[1] ?? '0', value[2] ?? '0'];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return DEFAULT_TEXT_COLOR;
};

export const borderColorOf = (value: string | undefined): string => {
  if (value === undefined) return DEFAULT_BORDER_COLOR;
  return textColorOf(value);
};

const HIGHLIGHTS: Readonly<Record<string, string>> = {
  black: '#000000',
  blue: '#0000ff',
  cyan: '#00ffff',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGray: '#808080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  green: '#00ff00',
  lightGray: '#c0c0c0',
  magenta: '#ff00ff',
  red: '#ff0000',
  white: '#ffffff',
  yellow: '#ffff00',
};

export const highlightColorOf = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  if (value === 'none') return undefined;
  const mapped = HIGHLIGHTS[value];
  if (mapped !== undefined) return mapped;
  return textColorOf(value);
};
