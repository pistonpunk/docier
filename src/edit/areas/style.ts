import type { CommandDefinition } from '../../api/types.js';
import { ParagraphProperties } from '../../model/index.js';
import { builtinStyle } from '../../model/styles/builtin.js';
import { areaCommand, forEachSlot, NEEDS_VALUE } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

export interface StyleArgs {
  readonly styleId?: string | undefined;
}

const styleOf = (host: AreaHost, styleId: string): boolean => {
  const styles = host.session.model.styles;
  return styles !== undefined && styles.style(styleId) !== undefined;
};

const definable = (host: AreaHost, styleId: string): boolean => {
  const styles = host.session.model.styles;
  return styles !== undefined && builtinStyle(styleId) !== undefined;
};

const applySpec: AreaSpec<StyleArgs> = {
  id: 'docier.command.style.apply',
  label: 'Style',
  category: 'style',
  permissions: ['format'],
  code: 'STYLE_NOT_FOUND',
  enabledIn: (host, args) =>
    args?.styleId !== undefined &&
    (styleOf(host, args.styleId) || definable(host, args.styleId)),
  reason: (_host, args) =>
    args?.styleId === undefined
      ? NEEDS_VALUE
      : `There is no style called "${args.styleId}" in this document`,
  run: (active, args) => {
    const styleId = args.styleId;
    if (styleId === undefined) return false;
    const styles = active.session.model.styles;
    if (styles === undefined) return false;
    if (!styleOf(active, styleId)) {
      active.session.changeStyles(() => {
        styles.ensure(styleId);
      });
    }
    return forEachSlot(active, (slot) => {
      const properties = ParagraphProperties.inOwner(slot.element);
      if (properties.styleId === styleId) return false;
      properties.styleId = styleId;
      return true;
    });
  },
};

export const styleCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<StyleArgs>(host, applySpec),
];
