import type { UiNode } from './menu-model.js';

const OPEN =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

const GLYPHS: Readonly<Record<string, string>> = {
  'clipboard.paste':
    '<path d="M6 3.5H4.5A1.5 1.5 0 0 0 3 5v8a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5a1.5 1.5 0 0 0-1.5-1.5H10"/>' +
    '<rect x="6" y="2" width="4" height="3" rx="1"/><path d="M5.5 8.5h5"/><path d="M5.5 11h3"/>',
  'clipboard.cut':
    '<circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><path d="M5.5 10.5 12 2"/><path d="M10.5 10.5 4 2"/>',
  'clipboard.copy':
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/>' +
    '<path d="M10.5 5.5V3.7A1.2 1.2 0 0 0 9.3 2.5H3.7A1.2 1.2 0 0 0 2.5 3.7v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8"/>',
  'clipboard.formatPainter':
    '<path d="M4 2.5h8V6H4z"/><path d="M8 6v2.5"/><path d="M6.4 12.6a1.6 1.6 0 0 0 3.2 0V8.5H6.4z"/>',
  'history.undo': '<path d="M3 8a5 5 0 1 1 1.8 3.85"/><path d="M3 3.5V8h4.5"/>',
  'history.redo': '<path d="M13 8a5 5 0 1 0-1.8 3.85"/><path d="M13 3.5V8H8.5"/>',
  'doc.save':
    '<path d="M3 3.5h7.5L13 6v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>' +
    '<path d="M5.5 3.5v3H10v-3"/><path d="M5.5 9h5v4.5"/>',
  'format.growFont': '<path d="M2.5 12.5 6 4l3.5 8.5"/><path d="M3.8 9.8h4.4"/><path d="M12.5 10.5v-6"/><path d="m10.5 6.5 2-2 2 2"/>',
  'format.shrinkFont': '<path d="M2.5 12.5 6 4l3.5 8.5"/><path d="M3.8 9.8h4.4"/><path d="M12.5 5.5v6"/><path d="m10.5 9.5 2 2 2-2"/>',
  'format.bold': '<path d="M4.5 3h3.8a2.5 2.5 0 0 1 0 5H4.5z"/><path d="M4.5 8h4.4a2.5 2.5 0 0 1 0 5H4.5z"/>',
  'format.italic': '<path d="M6.5 3h5"/><path d="M4.5 13h5"/><path d="M9.5 3 6.5 13"/>',
  'format.underline': '<path d="M4 3v5a4 4 0 0 0 8 0V3"/><path d="M3 14h10"/>',
  'format.strike':
    '<path d="M11.4 5A3.5 3.5 0 0 0 8.4 3.2C6.6 3.2 5.2 4.2 5.2 5.6c0 .8.4 1.4 1.2 1.9"/>' +
    '<path d="M4.6 11.2A3.6 3.6 0 0 0 7.9 13c1.9 0 3.3-1 3.3-2.4 0-.5-.2-1-.5-1.3"/><path d="M2.5 8h11"/>',
  'format.superscript': '<path d="M3 12.5 7.5 5"/><path d="M7.5 12.5 3 5"/><path d="M10.5 5.5h3l-3 3h3"/>',
  'format.subscript': '<path d="M3 11 7.5 3.5"/><path d="M7.5 11 3 3.5"/><path d="M10.5 9.5h3l-3 3h3"/>',
  'format.setColor': '<path d="M3.2 11 6.8 3.5 10.4 11"/><path d="M4.6 8.6h4.4"/><path d="M3 14h10"/>',
  'format.setLineSpacing':
    '<path d="M2.5 4h5"/><path d="M2.5 8h5"/><path d="M2.5 12h5"/>' +
    '<path d="M11.2 3.5v9"/><path d="m9.7 5 1.5-1.5L12.7 5"/><path d="m9.7 11 1.5 1.5L12.7 11"/>',
  'format.setHighlight': '<path d="M9.5 3.2 12.8 6.5 8 11.3H4.7V8z"/><path d="M3 13.8h10"/>',
  'format.clearCharacterFormatting':
    '<path d="M9.8 3.4 6 7.2l3.4 3.4 3.8-3.8z"/>' +
    '<path d="M6 7.2 3.4 9.8a1 1 0 0 0 0 1.4l1.4 1.4a1 1 0 0 0 1.4 0l3-3"/><path d="M8 14h5"/>',
  'numbering.bullets':
    '<path d="M5.5 4h8"/><path d="M5.5 8h8"/><path d="M5.5 12h8"/>' +
    '<circle cx="3" cy="4" r=".9"/><circle cx="3" cy="8" r=".9"/><circle cx="3" cy="12" r=".9"/>',
  'numbering.numbers':
    '<path d="M5.5 4h8"/><path d="M5.5 8h8"/><path d="M5.5 12h8"/>' +
    '<path d="M2.2 2.4 3.2 2v4"/><path d="M2 7.4h2l-2 2h2"/><path d="M2 11.6h2v2"/>',
  'numbering.multilevel':
    '<path d="M5.5 3h8"/><path d="M7.5 8h6"/><path d="M9.5 13h4"/>' +
    '<circle cx="3" cy="3" r=".9"/><circle cx="5" cy="8" r=".9"/><circle cx="7" cy="13" r=".9"/>',
  'format.decreaseIndent': '<path d="M8 4h6"/><path d="M8 8h6"/><path d="M8 12h6"/><path d="m5 6-2.5 2L5 10"/>',
  'format.increaseIndent': '<path d="M8 4h6"/><path d="M8 8h6"/><path d="M8 12h6"/><path d="m2.5 6 2.5 2-2.5 2"/>',
  'format.alignLeft': '<path d="M2.5 3.5h11"/><path d="M2.5 6.5h7"/><path d="M2.5 9.5h11"/><path d="M2.5 12.5h7"/>',
  'format.alignCenter': '<path d="M2.5 3.5h11"/><path d="M4.5 6.5h7"/><path d="M2.5 9.5h11"/><path d="M4.5 12.5h7"/>',
  'format.alignRight': '<path d="M2.5 3.5h11"/><path d="M6.5 6.5h7"/><path d="M2.5 9.5h11"/><path d="M6.5 12.5h7"/>',
  'format.alignJustify': '<path d="M2.5 3.5h11"/><path d="M2.5 6.5h11"/><path d="M2.5 9.5h11"/><path d="M2.5 12.5h11"/>',
  'find.find': '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/>',
  'find.replace': '<circle cx="6.5" cy="6.5" r="3.7"/><path d="m9.3 9.3 2.7 2.7"/><path d="M2.5 13.5h11"/>',
  'edit.selectAll':
    '<path d="M3 5.5V4a1 1 0 0 1 1-1h1.5"/><path d="M10.5 3H12a1 1 0 0 1 1 1v1.5"/>' +
    '<path d="M13 10.5V12a1 1 0 0 1-1 1h-1.5"/><path d="M5.5 13H4a1 1 0 0 1-1-1v-1.5"/>' +
    '<rect x="5.5" y="5.5" width="5" height="5" rx="1"/>',
};

const keyOf = (node: UiNode): string | undefined => {
  const source = node.command ?? node.id;
  return source.startsWith('docier.command.') ? source.slice('docier.command.'.length) : source;
};

export const iconFor = (node: UiNode): string | undefined => {
  const key = keyOf(node);
  if (key === undefined) return undefined;
  const glyph = GLYPHS[key];
  return glyph === undefined ? undefined : `${OPEN}${glyph}</svg>`;
};

export const iconKeys = (): readonly string[] => Object.keys(GLYPHS);
