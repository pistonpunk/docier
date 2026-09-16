import type { DocumentModel, ThemeColours, ThemeFonts } from '../model/index.js';
import { EMPTY_THEME_FONTS } from '../model/index.js';
import type { ThemeResolution } from './format.js';

export const themeResolutionOf = (model: DocumentModel): ThemeResolution | undefined => {
  const theme = model.theme;
  if (theme === undefined) return undefined;
  const fonts: ThemeFonts = theme.fonts;
  const colours: ThemeColours = theme.colours;
  if (fonts.major === undefined && fonts.minor === undefined && Object.keys(colours).length === 0) {
    return undefined;
  }
  return { fonts: { ...EMPTY_THEME_FONTS, ...fonts }, colours };
};
