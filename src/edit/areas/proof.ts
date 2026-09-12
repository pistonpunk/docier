import type { CommandDefinition } from '../../api/types.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { Paragraph, RunProperties } from '../../model/index.js';
import { paragraphLength, runSpans } from '../mutation.js';
import { areaCommand, rangeOfSelection } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

export interface LanguageArgs {
  readonly language?: string | undefined;
}

const touchedSlots = (host: AreaHost): readonly { readonly element: XmlElement; readonly from: number; readonly to: number }[] => {
  const range = rangeOfSelection(host.selection);
  const out: { element: XmlElement; from: number; to: number }[] = [];
  for (const slot of host.session.slots()) {
    if ((slot.end as number) <= (range.start as number)) continue;
    if ((slot.start as number) > (range.end as number)) break;
    out.push({
      element: slot.element,
      from: Math.max(0, (range.start as number) - (slot.start as number)),
      to: Math.min(slot.length, (range.end as number) - (slot.start as number)),
    });
  }
  return out;
};

const setLanguage = (host: AreaHost, language: string): boolean => {
  const model = host.session.model;
  const collapsed = (host.selection.anchor as number) === (host.selection.focus as number);
  let changed = false;
  for (const target of touchedSlots(host)) {
    let hit = false;
    const total = paragraphLength(model, target.element);
    const to = Math.min(total, Math.max(target.from, target.to));
    for (const span of runSpans(model, target.element)) {
      const covered = collapsed
        ? target.from > span.start && target.from <= span.end
        : span.end > target.from && span.start < to;
      if (!covered) continue;
      hit = true;
      const properties = RunProperties.inOwner(span.element).language;
      if (properties.value === language) continue;
      properties.value = language;
      changed = true;
    }
    if (!hit && collapsed) {
      const mark = Paragraph.of(model.context, target.element).markProperties;
      const properties = RunProperties.of(mark.ensure()).language;
      if (properties.value !== language) {
        properties.value = language;
        changed = true;
      }
    }
    if (changed) model.context.forgetSubtree(target.element);
  }
  return changed;
};

const languageSpec: AreaSpec<LanguageArgs> = {
  id: 'docier.command.proof.setLanguage',
  label: 'Proofing language',
  category: 'proof',
  permissions: ['format'],
  enabledIn: (_host, args) => args?.language !== undefined && args.language !== '',
  reason: () => 'This control needs a language tag such as en-GB',
  run: (active, args) => {
    const language = args.language;
    if (language === undefined || language === '') return false;
    return setLanguage(active, language);
  },
};

export const proofCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<LanguageArgs>(host, languageSpec),
];
